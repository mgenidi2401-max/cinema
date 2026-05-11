const socket = io();

let screenStream = null;

async function toggleScreenShare(){

  if(screenStream){
    stopScreenShare();
    return;
  }

  try{

    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video:{
        frameRate:{ideal:60,max:60},
        width:{ideal:1920},
        height:{ideal:1080}
      },
      audio:true
    });

    const video = document.createElement("video");

    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;

    video.srcObject = screenStream;

    const playerArea = document.getElementById("playerArea");

    playerArea.innerHTML = "";
    playerArea.appendChild(video);

    document
      .getElementById("screenShareIndicator")
      .classList.add("active");

    socket.emit("screen-share-start");

    screenStream
      .getVideoTracks()[0]
      .addEventListener("ended",stopScreenShare);

  }catch(err){

    alert("فشل مشاركة الشاشة");

  }

}

function stopScreenShare(){

  if(screenStream){

    screenStream
      .getTracks()
      .forEach(track=>track.stop());

    screenStream = null;
  }

  document
    .getElementById("screenShareIndicator")
    .classList.remove("active");

  socket.emit("screen-share-stop");

}
