const express = require('express');
const cors = require('cors');
const socketIo = require('socket.io');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cluster = require('cluster');
const os = require('os');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const winston = require('winston');
const Redis = require('ioredis');
const { promisify } = require('util');
const { MongoClient } = require('mongodb');

// Configuration
const numCPUs = os.cpus().length;
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'ultimate_atherion_secret';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/atherion';
const REDIS_URI = process.env.REDIS_URI || 'redis://localhost:6379';
const UPLOAD_DIR = './uploads';

// Logger Setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'server.log' })
    ]
});

// Redis Client for caching and pub/sub
const redis = new Redis(REDIS_URI);
const redisGetAsync = promisify(redis.get).bind(redis);
const redisSetAsync = promisify(redis.set).bind(redis);

// MongoDB Client
let db;
async function connectDB() {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db('atherion');
    logger.info('MongoDB connected');
}

// File Upload Setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max

// Clustering for Performance
if (cluster.isMaster) {
    logger.info(`Master process ${process.pid} is running`);
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }
    cluster.on('exit', (worker) => {
        logger.warn(`Worker ${worker.process.pid} died`);
        cluster.fork();
    });
} else {
    startServer();
}

async function startServer() {
    await connectDB();

    const app = express();

    // Security and Performance Middlewares
    app.use(helmet()); // Security headers
    app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } })); // Logging
    app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], credentials: true }));
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));
    app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 })); // Rate limiting

    // Static Files for Uploads
    app.use('/uploads', express.static(UPLOAD_DIR));

    // HTTPS Setup (self-signed for dev; use certbot in prod)
    let httpServer = http.createServer(app);
    let httpsOptions = {};
    try {
        httpsOptions = {
            key: fs.readFileSync('key.pem'),
            cert: fs.readFileSync('cert.pem')
        };
        httpServer = https.createServer(httpsOptions, app);
        logger.info('HTTPS enabled');
    } catch (err) {
        logger.warn('HTTPS certs not found, falling back to HTTP');
    }

    // Socket.IO with Redis Adapter for Scalability
    const io = socketIo(httpServer, {
        cors: { origin: '*' },
        pingInterval: 10000,
        pingTimeout: 5000,
        maxHttpBufferSize: 1e8,
        adapter: require('socket.io-redis')({ pubClient: redis, subClient: redis.duplicate() })
    });

    // Middleware for Socket Auth
    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token;
        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                socket.user = decoded;
                next();
            } catch (err) {
                next(new Error('Authentication error'));
            }
        } else {
            next(new Error('No token provided'));
        }
    });

    // Data Structures (with Mongo persistence)
    let rooms = {}; // Cached in Redis
    async function loadRooms() {
        rooms = JSON.parse(await redisGetAsync('rooms') || '{}');
    }
    async function saveRooms() {
        await redisSetAsync('rooms', JSON.stringify(rooms));
        await db.collection('rooms').updateOne({ _id: 'rooms' }, { $set: rooms }, { upsert: true });
    }
    loadRooms(); // Initial load

    // API Endpoints (RESTful for non-socket ops)
    app.post('/register', async (req, res) => {
        const { username, password } = req.body;
        if (await db.collection('users').findOne({ username })) return res.status(400).json({ error: 'User exists' });
        const hashed = await bcrypt.hash(password, 12);
        await db.collection('users').insertOne({ username, hashed, isAdmin: false, createdAt: new Date() });
        res.status(201).json({ success: true });
    });

    app.post('/login', async (req, res) => {
        const { username, password } = req.body;
        const user = await db.collection('users').findOne({ username });
        if (!user || !await bcrypt.compare(password, user.hashed)) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ username, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token, isAdmin: user.isAdmin });
    });

    app.post('/upload', upload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file' });
        res.json({ url: `/uploads/${req.file.filename}` });
    });

    app.get('/stats', async (req, res) => {
        const userCount = await db.collection('users').countDocuments();
        const roomCount = Object.keys(rooms).length;
        res.json({ users: userCount, rooms: roomCount, uptime: process.uptime() });
    });

    // Socket Events (Ultimate Features)
    io.on('connection', socket => {
        logger.info(`[connect] ${socket.id} - User: ${socket.user.username}`);
        
        // Join Room with Validation
        socket.on('join', async (data) => {
            const roomId = data.room;
            if (!rooms[roomId]) rooms[roomId] = [];
            socket.join(roomId);
            rooms[roomId].push({ id: socket.id, name: socket.user.username });
            io.to(roomId).emit('user_joined', socket.user.username);
            await saveRooms();
        });

        // Private Message
        socket.on('private_message', async (data) => {
            const { target, text } = data;
            const targetSocket = Object.values(users).find(u => u.name === target)?.id;
            if (targetSocket) io.to(targetSocket).emit('private_message', { from: socket.user.username, text });
            await db.collection('messages').insertOne({ type: 'private', from: socket.user.username, to: target, text, timestamp: new Date() });
        });

        // Admin Ban User
        socket.on('admin_ban', async (data) => {
            if (socket.user.isAdmin) {
                const { username, reason } = data;
                await db.collection('users').updateOne({ username }, { $set: { banned: true, banReason: reason } });
                io.emit('user_banned', { username, reason });
            }
        });

        // Voice Transcription (simulate with placeholder; integrate Whisper API in prod)
        socket.on('voice_message', (data) => {
            // Process audio blob, transcribe, send as text
            io.to(data.room).emit('voice_transcript', { from: socket.user.username, text: '[Transcribed Voice]' });
        });

        // Real-time Collaboration (ex. shared whiteboard)
        socket.on('draw', (data) => {
            socket.to(data.room).emit('draw_update', data.points);
        });

        // Analytics Event
        socket.on('analytics_event', async (data) => {
            await db.collection('analytics').insertOne({ ...data, user: socket.user.username, timestamp: new Date() });
        });

        // Disconnect with Cleanup
        socket.on('disconnect', async () => {
            logger.info(`[disconnect] ${socket.id}`);
            for (const roomId in rooms) {
                rooms[roomId] = rooms[roomId].filter(u => u.id !== socket.id);
                if (rooms[roomId].length === 0) delete rooms[roomId];
            }
            await saveRooms();
        });

        // ... Ajoutez d'autres events comme offer, answer, etc. du code original
    });

    httpServer.listen(PORT, () => logger.info(`Worker ${process.pid} on port ${PORT}`));
}
