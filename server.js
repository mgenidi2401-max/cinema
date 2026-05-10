const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', socket => {

  socket.on('join-room', ({ roomId, userName }) => {

    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = [];
    }

    rooms[roomId].push({
      id: socket.id,
      name: userName
    });

    socket.roomId = roomId;

    io.to(roomId).emit('users-update', rooms[roomId]);

    socket.to(roomId).emit('user-connected', socket.id);
  });

  socket.on('webrtc-offer', ({ target, offer }) => {
    io.to(target).emit('webrtc-offer', {
      sender: socket.id,
      offer
    });
  });

  socket.on('webrtc-answer', ({ target, answer }) => {
    io.to(target).emit('webrtc-answer', {
      sender: socket.id,
      answer
    });
  });

  socket.on('ice-candidate', ({ target, candidate }) => {
    io.to(target).emit('ice-candidate', {
      sender: socket.id,
      candidate
    });
  });

  socket.on('disconnect', () => {

    const roomId = socket.roomId;

    if (!roomId || !rooms[roomId]) return;

    rooms[roomId] = rooms[roomId].filter(u => u.id !== socket.id);

    io.to(roomId).emit('users-update', rooms[roomId]);

    socket.to(roomId).emit('user-disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 8080;
