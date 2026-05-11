const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const publicDir = path.join(__dirname, "public");
const uploadsDir = path.join(publicDir, "uploads");

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(express.static(publicDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^\w\u0600-\u06FF.\- ]+/g, "_").replace(/\s+/g, "_");
    cb(null, Date.now() + "_" + safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 700 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("video/")) cb(null, true);
    else cb(new Error("Only video files are allowed"));
  }
});

app.post("/upload", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "لم يتم رفع ملف" });
  res.json({ ok: true, url: "/uploads/" + req.file.filename, name: req.file.originalname, size: req.file.size });
});

app.get("/", (req, res) => res.sendFile(path.join(publicDir, "index.html")));

const rooms = {};

function cleanRoomCode(roomCode) {
  return String(roomCode || "").trim().replace(/\s+/g, "-").toUpperCase();
}

function getRoom(roomCode) {
  const code = cleanRoomCode(roomCode);
  if (!rooms[code]) {
    rooms[code] = {
      password: "",
      hostId: null,
      controllers: {},
      viewers: {},
      contentUrl: "",
      contentType: "",
      currentTime: 0,
      isPlaying: false,
      screenHostId: null
    };
  }
  return rooms[code];
}

function canControl(room, socketId) {
  return socketId === room.hostId || !!room.controllers[socketId];
}

function viewersList(room) {
  return Object.values(room.viewers).map(viewer => ({
    id: viewer.id,
    name: viewer.name,
    isHost: viewer.id === room.hostId,
    canControl: canControl(room, viewer.id)
  }));
}

function emitViewers(roomCode) {
  const room = getRoom(roomCode);
  io.to(roomCode).emit("viewers-update", viewersList(room));
  Object.keys(room.viewers).forEach(id => {
    io.to(id).emit("control-permission", {
      isHost: id === room.hostId,
      canControl: canControl(room, id)
    });
  });
}

io.on("connection", socket => {
  socket.on("create-or-join-room", data => {
    const roomCode = cleanRoomCode(data.roomCode);
    const password = String(data.password || "");
    const name = String(data.name || "مشاهد").slice(0, 40);

    if (!roomCode) return;

    const room = getRoom(roomCode);
    const isNewRoom = !room.hostId;

    if (isNewRoom) {
      room.password = password;
      room.hostId = socket.id;
    } else if (password !== room.password) {
      socket.emit("join-error", "كلمة المرور غير صحيحة");
      return;
    }

    socket.join(roomCode);
    socket.roomCode = roomCode;

    room.viewers[socket.id] = { id: socket.id, name };

    socket.emit("room-state", {
      roomCode,
      yourId: socket.id,
      isHost: socket.id === room.hostId,
      canControl: canControl(room, socket.id),
      contentUrl: room.contentUrl,
      contentType: room.contentType,
      currentTime: room.currentTime,
      isPlaying: room.isPlaying,
      screenHostId: room.screenHostId
    });

    emitViewers(roomCode);

    if (room.screenHostId && room.screenHostId !== socket.id) {
      io.to(socket.id).emit("screen-share-started", { hostId: room.screenHostId });
    }
  });

  socket.on("set-content", data => {
    const roomCode = cleanRoomCode(data.roomCode);
    const room = getRoom(roomCode);
    if (!canControl(room, socket.id)) return;

    room.contentUrl = String(data.contentUrl || "");
    room.contentType = String(data.contentType || "");
    room.currentTime = 0;
    room.isPlaying = false;
    room.screenHostId = null;

    io.to(roomCode).emit("content-changed", {
      contentUrl: room.contentUrl,
      contentType: room.contentType,
      currentTime: 0,
      isPlaying: false
    });
    io.to(roomCode).emit("screen-share-stopped");
  });

  socket.on("host-control", data => {
    const roomCode = cleanRoomCode(data.roomCode);
    const room = getRoom(roomCode);
    if (!canControl(room, socket.id)) return;

    room.currentTime = Number(data.currentTime) || 0;
    room.isPlaying = data.action === "play";
    socket.to(roomCode).emit("sync-control", { action: data.action, currentTime: room.currentTime });
  });

  socket.on("host-seek", data => {
    const roomCode = cleanRoomCode(data.roomCode);
    const room = getRoom(roomCode);
    if (!canControl(room, socket.id)) return;

    room.currentTime = Number(data.currentTime) || 0;
    socket.to(roomCode).emit("sync-control", {
      action: room.isPlaying ? "play" : "pause",
      currentTime: room.currentTime
    });
  });

  socket.on("grant-control", data => {
    const roomCode = cleanRoomCode(data.roomCode);
    const room = getRoom(roomCode);
    const targetId = data.targetId;

    if (socket.id !== room.hostId) return;
    if (!room.viewers[targetId]) return;

    if (data.allow) room.controllers[targetId] = true;
    else delete room.controllers[targetId];

    emitViewers(roomCode);
  });

  socket.on("chat-message", data => {
    const roomCode = cleanRoomCode(data.roomCode);
    const name = String(data.name || "مشاهد").slice(0, 40);
    const message = String(data.message || "").slice(0, 300);

    if (!roomCode || !message) return;

    io.to(roomCode).emit("chat-message", {
      name,
      message,
      time: new Date().toLocaleTimeString("ar-EG")
    });
  });

  socket.on("screen-share-start", data => {
    const roomCode = cleanRoomCode(data.roomCode);
    const room = getRoom(roomCode);
    if (!canControl(room, socket.id)) return;

    room.screenHostId = socket.id;
    room.contentUrl = "";
    room.contentType = "screen";

    socket.to(roomCode).emit("screen-share-started", { hostId: socket.id });
  });

  socket.on("screen-share-stop", data => {
    const roomCode = cleanRoomCode(data.roomCode);
    const room = getRoom(roomCode);
    if (room.screenHostId === socket.id) room.screenHostId = null;
    socket.to(roomCode).emit("screen-share-stopped");
  });

  socket.on("ss-viewer-ready", data => io.to(data.to).emit("ss-viewer-ready", { from: socket.id }));
  socket.on("ss-offer", data => io.to(data.to).emit("ss-offer", { from: socket.id, sdp: data.sdp }));
  socket.on("ss-answer", data => io.to(data.to).emit("ss-answer", { from: socket.id, sdp: data.sdp }));
  socket.on("ss-ice", data => io.to(data.to).emit("ss-ice", { from: socket.id, c: data.c }));
  socket.on("ss-ice-v", data => io.to(data.to).emit("ss-ice-v", { from: socket.id, c: data.c }));

  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms[roomCode]) return;

    const room = rooms[roomCode];

    delete room.viewers[socket.id];
    delete room.controllers[socket.id];

    if (room.screenHostId === socket.id) {
      room.screenHostId = null;
      socket.to(roomCode).emit("screen-share-stopped");
    }

    if (room.hostId === socket.id) {
      const nextHost = Object.keys(room.viewers)[0] || null;
      room.hostId = nextHost;
      room.controllers = {};
    }

    if (Object.keys(room.viewers).length === 0) {
      delete rooms[roomCode];
      return;
    }

    emitViewers(roomCode);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Cinema running on port " + PORT));
