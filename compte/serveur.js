const express = require('express');
const cors = require('cors');
const socketIo = require('socket.io');
const http = require('http'); // Pour créer le serveur HTTP
const { v4: uuidv4 } = require('uuid'); // Pour générer des IDs uniques (installez via npm install uuid)

const app = express();
app.use(cors({ origin: '*' })); // Autorise toutes origines pour dev; restreignez en prod

// Endpoint basique pour vérifier le serveur
app.get('/', (req, res) => res.send('Atherion Signaling Server - Online'));

// Endpoint pour lister toutes les salles (pour admin ou debug)
app.get('/rooms', (req, res) => {
    res.json(Object.keys(rooms).map(roomId => ({
        id: roomId,
        userCount: rooms[roomId] ? rooms[roomId].length : 0
    })));
});

// Créer le serveur HTTP
const server = http.createServer(app);

// Initialiser Socket.IO avec options avancées
const io = socketIo(server, {
    cors: { origin: '*' },
    pingInterval: 10000, // Intervalle de ping pour détecter déconnexions
    pingTimeout: 5000,
    maxHttpBufferSize: 1e8 // Augmente la taille max pour les SDP grandes (WebRTC)
});

let rooms = {}; // { roomId: [{id: socket.id, name: string, isAdmin: bool}] }
let socketToRoom = {}; // { socket.id: roomId }
let users = {}; // { username: { socketId: string, rooms: [] } } pour tracking global

io.on('connection', socket => {
    console.log(`[connect] ${socket.id}`);

    // Événement pour créer une salle (génère ID si non fourni)
    socket.on('create', data => {
        let roomId = data.room || uuidv4(); // Génère ID unique si pas fourni
        if (!rooms[roomId]) {
            rooms[roomId] = [];
        }
        socket.emit('room_created', { room: roomId });
        console.log(`[create] room: ${roomId} by ${data.name}`);
    });

    // Événement pour rejoindre une salle
    socket.on('join', data => {
        const roomId = data.room;
        if (!rooms[roomId]) {
            rooms[roomId] = [];
        }
        socket.join(roomId);
        socketToRoom[socket.id] = roomId;
        const isAdmin = data.name === 'yasscode'; // Détection admin simple
        rooms[roomId].push({ id: socket.id, name: data.name, isAdmin });

        // Mettre à jour tracking users global
        if (!users[data.name]) users[data.name] = { socketId: socket.id, rooms: [] };
        users[data.name].rooms.push(roomId);

        // Envoyer la liste des users dans la salle au nouveau
        const roomUsers = rooms[roomId].map(u => u.name);
        socket.emit('room_users', roomUsers);

        // Broadcast à la salle qu'un user a rejoint
        socket.to(roomId).emit('user_joined', { name: data.name });

        // Si admin, envoyer liste globale des connectés
        if (isAdmin) {
            const allUsers = Object.keys(users);
            socket.emit('all_users', allUsers);
        }

        console.log(`[join] room: ${roomId}, name: ${data.name}, admin: ${isAdmin}`);
    });

    // Signaling WebRTC: Offer (par salle)
    socket.on('offer', data => {
        const roomId = socketToRoom[socket.id];
        if (roomId) {
            socket.to(roomId).emit('offer', { sdp: data.sdp, sender: socket.id });
            console.log(`[offer] from ${socket.id} in room ${roomId}`);
        }
    });

    // Signaling WebRTC: Answer (ciblé au sender)
    socket.on('answer', data => {
        const roomId = socketToRoom[socket.id];
        if (roomId && data.target) {
            io.to(data.target).emit('answer', { sdp: data.sdp, sender: socket.id });
            console.log(`[answer] from ${socket.id} to ${data.target} in room ${roomId}`);
        }
    });

    // Signaling WebRTC: ICE Candidate (par salle ou ciblé)
    socket.on('ice-candidate', data => {
        const roomId = socketToRoom[socket.id];
        if (roomId) {
            socket.to(roomId).emit('ice-candidate', { candidate: data.candidate, sender: socket.id });
            console.log(`[ice-candidate] from ${socket.id} in room ${roomId}`);
        }
    });

    // Chat: Message par salle
    socket.on('message', data => {
        const roomId = socketToRoom[socket.id];
        if (roomId) {
            io.to(roomId).emit('message', { user: data.user, text: data.text, timestamp: Date.now() });
            console.log(`[message] from ${data.user} in room ${roomId}: ${data.text}`);
        }
    });

    // Admin: Kick user from room
    socket.on('kick', data => {
        const roomId = socketToRoom[socket.id];
        const user = rooms[roomId].find(u => u.id === socket.id);
        if (user && user.isAdmin && data.targetId) {
            io.to(data.targetId).emit('kicked', { reason: 'Kicked by admin' });
            const targetSocket = io.sockets.sockets.get(data.targetId);
            if (targetSocket) targetSocket.leave(roomId);
            rooms[roomId] = rooms[roomId].filter(u => u.id !== data.targetId);
            console.log(`[kick] ${data.targetId} from room ${roomId} by admin`);
        }
    });

    // Demande liste users globale (pour admin)
    socket.on('get_all_users', () => {
        const roomId = socketToRoom[socket.id];
        const user = rooms[roomId]?.find(u => u.id === socket.id);
        if (user && user.isAdmin) {
            const allUsers = Object.entries(users).map(([name, info]) => ({ name, rooms: info.rooms }));
            socket.emit('all_users', allUsers);
        }
    });

    // Déconnexion
    socket.on('disconnect', () => {
        const roomId = socketToRoom[socket.id];
        if (roomId && rooms[roomId]) {
            const user = rooms[roomId].find(u => u.id === socket.id);
            rooms[roomId] = rooms[roomId].filter(u => u.id !== socket.id);
            if (user) {
                // Mettre à jour users global
                if (users[user.name]) {
                    users[user.name].rooms = users[user.name].rooms.filter(r => r !== roomId);
                    if (users[user.name].rooms.length === 0) delete users[user.name];
                }
                // Broadcast déconnexion
                socket.to(roomId).emit('user_left', { name: user.name });
            }
            if (rooms[roomId].length === 0) delete rooms[roomId]; // Nettoie salle vide
        }
        delete socketToRoom[socket.id];
        console.log(`[disconnect] ${socket.id} from room ${roomId}`);
    });
});

// Lancer le serveur
const PORT = process.env.PORT
