const express = require('express');
const cors = require('cors');
const socketIo = require('socket.io');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

// Base de données in-memory (remplacez par MongoDB en prod)
let usersDB = {}; // { username: { hashedPass: string, isAdmin: bool } }
let messagesDB = {}; // { username: [{ id: uuid, type: string, text: string, from: string, read: bool }] }

const app = express();
app.use(cors({ origin: '*' }));

app.get('/', (req, res) => res.send('Atherion Signaling Server - Online'));

const server = http.createServer(app);

const io = socketIo(server, {
    cors: { origin: '*' },
    pingInterval: 10000,
    pingTimeout: 5000,
    maxHttpBufferSize: 1e8
});

let rooms = {};
let socketToRoom = {};
let users = {};

io.on('connection', socket => {
    console.log(`[connect] ${socket.id}`);

    // Créer compte
    socket.on('create_account', (data) => {
        const { username, hashedPass } = data;
        if (usersDB[username]) {
            socket.emit('account_created', false);
        } else {
            usersDB[username] = { hashedPass, isAdmin: false };
            messagesDB[username] = [];
            socket.emit('account_created', true);
        }
    });

    // Login
    socket.on('login', (data) => {
        const { username, hashedPass } = data;
        const user = usersDB[username];
        const isAdmin = username === 'yasscode' && hashedPass === user?.hashedPass; // Vérifiez admin hash
        if (user && user.hashedPass === hashedPass) {
            socket.emit('login_response', { success: true, isAdmin });
        } else {
            socket.emit('login_response', { success: false });
        }
    });

    // Récupérer inbox
    socket.on('get_inbox', (data) => {
        const inbox = messagesDB[data.user] || [];
        socket.emit('inbox_update', inbox);
    });

    // Marquer lu
    socket.on('mark_read', (data) => {
        const { user, messageId } = data;
        const msg = messagesDB[user]?.find(m => m.id === messageId);
        if (msg) msg.read = true;
    });

    // Admin: Envoyer message
    socket.on('admin_send_message', (data) => {
        const { target, type, text, from } = data;
        const msg = { id: uuidv4(), type, text, from, read: false };
        if (target === 'all') {
            for (const u in messagesDB) {
                messagesDB[u].push({ ...msg });
                io.to(u).emit('new_message', msg); // Assume users have socket rooms by username
            }
        } else if (messagesDB[target]) {
            messagesDB[target].push(msg);
            io.to(target).emit('new_message', msg);
        }
    });

    // Admin: Supprimer user
    socket.on('admin_delete_user', (data) => {
        const { username } = data;
        delete usersDB[username];
        delete messagesDB[username];
        socket.emit('user_deleted');
    });

    // Admin: Accéder user data
    socket.on('admin_access_user', (data) => {
        const { username } = data;
        const userData = { messages: messagesDB[username] || [] };
        socket.emit('user_data', userData);
    });

    // Admin: Get all users
    socket.on('get_all_users', () => {
        socket.emit('all_users', Object.keys(usersDB));
    });

    // Autres événements (join, offer, etc.) restent les mêmes...
    // Ajoutez ici le code des événements précédents comme 'create', 'join', 'offer', etc.

    socket.on('disconnect', () => {
        // Code disconnect précédent
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
