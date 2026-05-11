const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Server } = require("socket.io");

const app = express();

const server = http.createServer(app);

const io = new Server(server,{
  cors:{origin:"*"}
});

const publicDir = path.join(__dirname,"public");

const uploadsDir = path.join(publicDir,"uploads");

if(!fs.existsSync(uploadsDir)){
  fs.mkdirSync(uploadsDir,{recursive:true});
}

app.use(express.static(publicDir));

const storage = multer.diskStorage({

  destination:(req,file,cb)=>{
    cb(null,uploadsDir);
  },

  filename:(req,file,cb)=>{

    const safe = file.originalname
      .replace(/[^\w\u0600-\u06FF.\- ]+/g,"_")
      .replace(/\s+/g,"_");

    cb(null,Date.now()+"_"+safe);

  }

});

const upload = multer({
  storage,
  limits:{
    fileSize:1024*1024*700
  }
});

app.post("/upload",upload.single("video"),(req,res)=>{

  if(!req.file){

    return res.status(400).json({
      error:"لم يتم رفع ملف"
    });

  }

  res.json({
    ok:true,
    url:"/uploads/"+req.file.filename
  });

});

app.get("/",(req,res)=>{
  res.sendFile(path.join(publicDir,"index.html"));
});

io.on("connection",(socket)=>{

  socket.on("screen-share-start",()=>{

    socket.broadcast.emit("screen-share-started");

  });

  socket.on("screen-share-stop",()=>{

    socket.broadcast.emit("screen-share-stopped");

  });

});

const PORT = process.env.PORT || 3000;

server.listen(PORT,()=>{
  console.log("Cinema running on port "+PORT);
});
