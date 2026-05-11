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
let roomCode = "";
let userName = "";

function enterRoom() {
  roomCode = document.getElementById("spRoom").value.trim();
  userName = document.getElementById("spName").value.trim();
  const password = document.getElementById("spPass").value.trim();

  if (!userName) {
    alert("اكتب اسمك");
    return;
  }

  if (!roomCode) {
    alert("اكتب كود الغرفة");
    return;
  }

  if (!password) {
    alert("اكتب كلمة المرور");
    return;
  }

  socket.emit("create-or-join-room", {
    roomCode,
    password,
    name: userName
  });

  document.getElementById("splashScreen").style.display = "none";

  const roomView = document.getElementById("roomCodeView");
  if (roomView) {
    roomView.innerText = roomCode;
  }
}

socket.on("join-error", function(message) {
  alert(message);
});

socket.on("room-state", function(state) {
  console.log("تم دخول الغرفة:", state);
});
