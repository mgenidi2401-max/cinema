const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

const rooms = {};

function getRoom(roomCode) {
  if (!rooms[roomCode]) {
    rooms[roomCode] = {
      password: "",
      contentUrl: "",
      contentType: "",
      currentTime: 0,
      isPlaying: false,
      lastUpdate: Date.now(),
      hostId: null,
      controllerIds: {},
      viewers: {}
    };
  }
  return rooms[roomCode];
}

function canControl(room, socketId) {
  return socketId === room.hostId || !!room.controllerIds[socketId];
}

function publicRoomState(room, socketId, roomCode) {
  return {
    contentUrl: room.contentUrl,
    contentType: room.contentType,
    currentTime: room.currentTime,
    isPlaying: room.isPlaying,
    yourId: socketId,
    isHost: socketId === room.hostId,
    canControl: canControl(room, socketId),
    roomCode
  };
}

function viewersList(room) {
  return Object.values(room.viewers).map(v => ({
    ...v,
    canControl: canControl(room, v.id)
  }));
}

io.on("connection", (socket) => {
  socket.on("create-or-join-room", ({ roomCode, password, name }) => {
    if (!roomCode) return;

    const room = getRoom(roomCode);
    const isNewRoom = !room.hostId;

    if (isNewRoom) {
      room.password = String(password || "");
      room.hostId = socket.id;
    } else {
      if (String(password || "") !== String(room.password || "")) {
        socket.emit("join-error", "كلمة المرور غير صحيحة");
        return;
      }
    }

    socket.join(roomCode);

    room.viewers[socket.id] = {
      id: socket.id,
      name: name || "مشاهد",
      isHost: socket.id === room.hostId
    };

    socket.emit("room-state", publicRoomState(room, socket.id, roomCode));
    io.to(roomCode).emit("viewers-update", viewersList(room));
  });

  socket.on("set-content", ({ roomCode, contentUrl, contentType }) => {
    const room = getRoom(roomCode);
    if (!canControl(room, socket.id)) return;

    room.contentUrl = String(contentUrl || "");
    room.contentType = String(contentType || "");
    room.currentTime = 0;
    room.isPlaying = false;
    room.lastUpdate = Date.now();

    io.to(roomCode).emit("content-changed", {
      contentUrl: room.contentUrl,
      contentType: room.contentType,
      currentTime: 0,
      isPlaying: false
    });
  });

  socket.on("host-control", ({ roomCode, action, currentTime }) => {
    const room = getRoom(roomCode);
    if (!canControl(room, socket.id)) return;

    room.currentTime = Number(currentTime) || 0;
    room.isPlaying = action === "play";
    room.lastUpdate = Date.now();

    socket.to(roomCode).emit("sync-control", {
      action,
      currentTime: room.currentTime
    });
  });

  socket.on("host-seek", ({ roomCode, currentTime }) => {
    const room = getRoom(roomCode);
    if (!canControl(room, socket.id)) return;

    room.currentTime = Number(currentTime) || 0;
    room.lastUpdate = Date.now();

    socket.to(roomCode).emit("sync-control", {
      action: room.isPlaying ? "play" : "pause",
      currentTime: room.currentTime
    });
  });

  socket.on("grant-control", ({ roomCode, targetId, allow }) => {
    const room = getRoom(roomCode);
    if (socket.id !== room.hostId) return;
    if (!room.viewers[targetId]) return;

    if (allow) {
      room.controllerIds[targetId] = true;
    } else {
      delete room.controllerIds[targetId];
    }

    io.to(roomCode).emit("viewers-update", viewersList(room));
    io.to(targetId).emit("control-permission", {
      canControl: canControl(room, targetId),
      isHost: targetId === room.hostId
    });
  });

  socket.on("chat-message", ({ roomCode, name, message }) => {
    if (!roomCode || !message) return;
    io.to(roomCode).emit("chat-message", {
      name: name || "مشاهد",
      message: String(message).slice(0, 300),
      time: new Date().toLocaleTimeString("ar-EG")
    });
  });

  socket.on("disconnect", () => {
    for (const roomCode of Object.keys(rooms)) {
      const room = rooms[roomCode];
      if (!room.viewers[socket.id]) continue;

      delete room.viewers[socket.id];
      delete room.controllerIds[socket.id];

      if (room.hostId === socket.id) {
        const nextHost = Object.keys(room.viewers)[0];
        room.hostId = nextHost || null;
        room.controllerIds = {};
        if (nextHost) room.viewers[nextHost].isHost = true;
      }

      io.to(roomCode).emit("viewers-update", viewersList(room));

      for (const viewerId of Object.keys(room.viewers)) {
        io.to(viewerId).emit("control-permission", {
          canControl: canControl(room, viewerId),
          isHost: viewerId === room.hostId
        });
      }

      if (Object.keys(room.viewers).length === 0) {
        delete rooms[roomCode];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Private Cinema running on port " + PORT));