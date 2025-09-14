const express = require('express');
const cors = require('cors');
const socketIo = require('socket.io');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Atherion Signaling Server'));

const server = app.listen(3000, () => console.log('Server on http://localhost:3000'));

const io = socketIo(server, { cors: { origin: '*' } });

let rooms = {};
let socketToRoom = {};

io.on('connection', socket => {
  socket.on('join', data => {
    const roomId = data.room;
    socket.join(roomId);
    socketToRoom[socket.id] = roomId;
    if (!rooms[roomId]) rooms[roomId] = [];
    rooms[roomId].push({ id: socket.id, name: data.name });
    const users = rooms[roomId].filter(user => user.id !== socket.id);
    io.to(socket.id).emit('room_users', users);
    console.log(`[joined] room: ${roomId}, name: ${data.name}`);
  });

  socket.on('offer', sdp => {
    socket.broadcast.emit('getOffer', sdp);
    console.log(`offer: ${socket.id}`);
  });

  socket.on('answer', sdp => {
    socket.broadcast.emit('getAnswer', sdp);
    console.log(`answer: ${socket.id}`);
  });

  socket.on('candidate', candidate => {
    socket.broadcast.emit('getCandidate', candidate);
    console.log(`candidate: ${socket.id}`);
  });

  socket.on('disconnect', () => {
    const roomId = socketToRoom[socket.id];
    if (rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter(user => user.id !== socket.id);
      socket.broadcast.to(roomId).emit('user_exit', { id: socket.id });
    }
    console.log(`[${roomId}]: ${socket.id} exit`);
  });
});