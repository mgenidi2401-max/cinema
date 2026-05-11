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
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadsDir));
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w\u0600-\u06FF.\- ]+/g, "_").replace(/\s+/g, "_");
    cb(null, Date.now() + "_" + safe);
  }
});
const upload = multer({storage, limits:{fileSize:1024*1024*700}, fileFilter:(req,file,cb)=> file.mimetype.startsWith("video/") ? cb(null,true) : cb(new Error("Only video files"))});
app.post("/upload", upload.single("video"), (req,res)=>{
  if(!req.file) return res.status(400).json({error:"لم يتم رفع ملف"});
  res.json({ok:true,url:`/uploads/${req.file.filename}`,originalName:req.file.originalname,size:req.file.size});
});
app.get("/", (req,res)=>res.sendFile(path.join(publicDir,"index.html")));
const rooms = {};
function getRoom(roomCode){ if(!rooms[roomCode]) rooms[roomCode]={password:"",contentUrl:"",contentType:"",currentTime:0,isPlaying:false,lastUpdate:Date.now(),hostId:null,controllerIds:{},viewers:{}}; return rooms[roomCode]; }
function canControl(room,id){ return id===room.hostId || !!room.controllerIds[id]; }
function state(room,id,roomCode){ return {contentUrl:room.contentUrl,contentType:room.contentType,currentTime:room.currentTime,isPlaying:room.isPlaying,yourId:id,isHost:id===room.hostId,canControl:canControl(room,id),roomCode}; }
function viewersList(room){ return Object.values(room.viewers).map(v=>({...v,canControl:canControl(room,v.id)})); }
io.on("connection", socket=>{
  socket.on("create-or-join-room", ({roomCode,password,name})=>{
    if(!roomCode) return; const room=getRoom(roomCode); const isNew=!room.hostId;
    if(isNew){room.password=String(password||""); room.hostId=socket.id;} else if(String(password||"")!==String(room.password||"")){socket.emit("join-error","كلمة المرور غير صحيحة"); return;}
    socket.join(roomCode); room.viewers[socket.id]={id:socket.id,name:name||"مشاهد",isHost:socket.id===room.hostId};
    socket.emit("room-state", state(room,socket.id,roomCode)); io.to(roomCode).emit("viewers-update", viewersList(room));
  });
  socket.on("set-content", ({roomCode,contentUrl,contentType})=>{ const room=getRoom(roomCode); if(!canControl(room,socket.id)) return; room.contentUrl=String(contentUrl||""); room.contentType=String(contentType||""); room.currentTime=0; room.isPlaying=false; room.lastUpdate=Date.now(); io.to(roomCode).emit("content-changed",{contentUrl:room.contentUrl,contentType:room.contentType,currentTime:0,isPlaying:false}); });
  socket.on("host-control", ({roomCode,action,currentTime})=>{ const room=getRoom(roomCode); if(!canControl(room,socket.id)) return; room.currentTime=Number(currentTime)||0; room.isPlaying=action==="play"; room.lastUpdate=Date.now(); socket.to(roomCode).emit("sync-control",{action,currentTime:room.currentTime}); });
  socket.on("host-seek", ({roomCode,currentTime})=>{ const room=getRoom(roomCode); if(!canControl(room,socket.id)) return; room.currentTime=Number(currentTime)||0; socket.to(roomCode).emit("sync-control",{action:room.isPlaying?"play":"pause",currentTime:room.currentTime}); });
  socket.on("grant-control", ({roomCode,targetId,allow})=>{ const room=getRoom(roomCode); if(socket.id!==room.hostId || !room.viewers[targetId]) return; if(allow) room.controllerIds[targetId]=true; else delete room.controllerIds[targetId]; io.to(roomCode).emit("viewers-update", viewersList(room)); io.to(targetId).emit("control-permission",{canControl:canControl(room,targetId),isHost:targetId===room.hostId}); });
  socket.on("chat-message", ({roomCode,name,message})=>{ if(!roomCode||!message) return; io.to(roomCode).emit("chat-message",{name:name||"مشاهد",message:String(message).slice(0,300),time:new Date().toLocaleTimeString("ar-EG")}); });
  // ===== SCREEN SHARE SIGNALING =====
  socket.on("screen-share-start",({roomCode})=>{const room=getRoom(roomCode);if(!canControl(room,socket.id))return;room.screenShareHostId=socket.id;socket.to(roomCode).emit("screen-share-started",{hostId:socket.id});});
  socket.on("screen-share-stop",({roomCode})=>{const room=rooms[roomCode];if(room&&room.screenShareHostId===socket.id)room.screenShareHostId=null;socket.to(roomCode).emit("screen-share-stopped");});
  socket.on("ss-viewer-ready",({roomCode,to,from})=>{io.to(to).emit("ss-viewer-ready",{from:from||socket.id});});
  socket.on("ss-offer",({roomCode,to,sdp})=>{io.to(to).emit("ss-offer",{from:socket.id,sdp});});
  socket.on("ss-answer",({roomCode,to,sdp})=>{io.to(to).emit("ss-answer",{from:socket.id,sdp});});
  socket.on("ss-ice",({roomCode,to,c})=>{io.to(to).emit("ss-ice",{from:socket.id,c});});
  socket.on("ss-ice-v",({roomCode,to,c})=>{io.to(to).emit("ss-ice-v",{from:socket.id,c});});

  socket.on("disconnect", ()=>{ for(const roomCode of Object.keys(rooms)){ const room=rooms[roomCode]; if(!room.viewers[socket.id]) continue; delete room.viewers[socket.id]; delete room.controllerIds[socket.id]; if(room.hostId===socket.id){ const next=Object.keys(room.viewers)[0]; room.hostId=next||null; room.controllerIds={}; if(next) room.viewers[next].isHost=true; } io.to(roomCode).emit("viewers-update", viewersList(room)); for(const id of Object.keys(room.viewers)) io.to(id).emit("control-permission",{canControl:canControl(room,id),isHost:id===room.hostId}); if(Object.keys(room.viewers).length===0) delete rooms[roomCode]; }});
});
const PORT = process.env.PORT || 3000; server.listen(PORT,()=>console.log("Private Cinema running on port "+PORT));
