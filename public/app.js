const socket = io();

let roomCode = "";
let roomPassword = "";
let userName = "";
let myId = "";
let isHost = false;
let canControl = false;
let currentContentType = "";
let player = null;
let ytReady = false;
let ignoreEvents = false;

let screenStream = null;
let peers = {};

const ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ]
};

const playerArea = document.getElementById("playerArea");

function randomRoom() {
  document.getElementById("spRoom").value = "ROOM-" + Math.floor(1000 + Math.random() * 9000);
}

function cleanRoom(code) {
  return String(code || "").trim().replace(/\s+/g, "-").toUpperCase();
}

function enterRoom() {
  roomCode = cleanRoom(document.getElementById("spRoom").value);
  userName = document.getElementById("spName").value.trim();
  roomPassword = document.getElementById("spPass").value.trim();

  if (!userName) return alert("اكتب اسمك");
  if (!roomCode) return alert("اكتب كود الغرفة");
  if (!roomPassword) return alert("اكتب كلمة المرور");

  socket.emit("create-or-join-room", { roomCode, password: roomPassword, name: userName });
}

function detectYoutubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    if (u.pathname.includes("/embed/")) return u.pathname.split("/embed/")[1].split("?")[0];
  } catch (e) {}
  return "";
}

function setContent() {
  if (!canControl) return alert("ليس لديك صلاحية التحكم");

  const contentType = document.getElementById("contentType").value;
  const contentUrl = document.getElementById("contentUrl").value.trim();

  if (!contentUrl) return alert("ضع الرابط");

  socket.emit("set-content", { roomCode, contentType, contentUrl });
}

function uploadVideo() {
  if (!canControl) return alert("ليس لديك صلاحية التحكم");

  const file = document.getElementById("videoFile").files[0];
  if (!file) return alert("اختر فيديو أولًا");

  const form = new FormData();
  form.append("video", file);

  const xhr = new XMLHttpRequest();
  const wrap = document.getElementById("uploadProgressWrap");
  const bar = document.getElementById("uploadProgressBar");

  wrap.style.display = "block";
  bar.style.width = "0%";

  xhr.upload.onprogress = function (e) {
    if (e.lengthComputable) bar.style.width = Math.round((e.loaded / e.total) * 100) + "%";
  };

  xhr.onload = function () {
    if (xhr.status >= 200 && xhr.status < 300) {
      const data = JSON.parse(xhr.responseText);
      const url = location.origin + data.url;
      socket.emit("set-content", { roomCode, contentType: "mp4", contentUrl: url });
    } else {
      alert("فشل رفع الفيديو");
    }
  };

  xhr.onerror = () => alert("خطأ أثناء رفع الفيديو");
  xhr.open("POST", "/upload");
  xhr.send(form);
}

function loadContent(type, url, startTime = 0, shouldPlay = false) {
  currentContentType = type;
  playerArea.innerHTML = "";

  if (type === "youtube") {
    const id = detectYoutubeId(url);
    if (!id) {
      playerArea.innerHTML = '<div class="empty">رابط يوتيوب غير صحيح</div>';
      return;
    }

    const div = document.createElement("div");
    div.id = "youtubePlayer";
    div.style.width = "100%";
    playerArea.appendChild(div);

    player = new YT.Player("youtubePlayer", {
      width: "100%",
      height: "500",
      videoId: id,
      playerVars: { start: Math.floor(startTime || 0), playsinline: 1, rel: 0 },
      events: {
        onReady: function () {
          ytReady = true;
          if (shouldPlay) player.playVideo();
        },
        onStateChange: function (event) {
          if (!canControl || ignoreEvents || !ytReady) return;
          const t = player.getCurrentTime ? player.getCurrentTime() : 0;

          if (event.data === YT.PlayerState.PLAYING) socket.emit("host-control", { roomCode, action: "play", currentTime: t });
          if (event.data === YT.PlayerState.PAUSED) socket.emit("host-control", { roomCode, action: "pause", currentTime: t });
        }
      }
    });
  }

  if (type === "mp4") {
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    video.preload = "auto";
    video.playsInline = true;
    video.currentTime = startTime || 0;

    playerArea.appendChild(video);
    player = video;

    video.addEventListener("play", function () {
      if (canControl && !ignoreEvents) socket.emit("host-control", { roomCode, action: "play", currentTime: video.currentTime });
    });

    video.addEventListener("pause", function () {
      if (canControl && !ignoreEvents) socket.emit("host-control", { roomCode, action: "pause", currentTime: video.currentTime });
    });

    video.addEventListener("seeked", function () {
      if (canControl && !ignoreEvents) socket.emit("host-seek", { roomCode, currentTime: video.currentTime });
    });

    if (shouldPlay) video.play().catch(function () {});
  }

  if (type === "website") {
    const iframe = document.createElement("iframe");
    iframe.src = url;
    iframe.allow = "autoplay; fullscreen; picture-in-picture";
    playerArea.appendChild(iframe);
  }
}

function applySync(action, currentTime) {
  ignoreEvents = true;

  if (currentContentType === "youtube" && player && ytReady) {
    player.seekTo(currentTime, true);
    if (action === "play") player.playVideo();
    if (action === "pause") player.pauseVideo();
  }

  if (currentContentType === "mp4" && player) {
    player.currentTime = currentTime;
    if (action === "play") player.play().catch(function () {});
    if (action === "pause") player.pause();
  }

  setTimeout(() => ignoreEvents = false, 700);
}

async function toggleScreenShare() {
  if (screenStream) {
    stopScreenShare();
    return;
  }

  if (!canControl) return alert("ليس لديك صلاحية التحكم");

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: true
    });

    screenStream.getVideoTracks()[0].addEventListener("ended", stopScreenShare);

    document.getElementById("screenShareIndicator").classList.add("active");
    document.getElementById("screenShareBtn").innerText = "إيقاف مشاركة الشاشة";

    showLocalScreen();

    socket.emit("screen-share-start", { roomCode });
  } catch (e) {
    alert("فشل تشغيل مشاركة الشاشة");
  }
}

function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }

  Object.keys(peers).forEach(id => {
    try { peers[id].close(); } catch (e) {}
    delete peers[id];
  });

  document.getElementById("screenShareIndicator").classList.remove("active");
  document.getElementById("screenShareBtn").innerText = "مشاركة الشاشة";

  socket.emit("screen-share-stop", { roomCode });
}

function showLocalScreen() {
  playerArea.innerHTML = "";

  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.controls = true;
  video.srcObject = screenStream;

  playerArea.appendChild(video);
}

async function makeOffer(viewerId) {
  if (!screenStream) return;

  const pc = new RTCPeerConnection(ICE);
  peers[viewerId] = pc;

  screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));

  pc.onicecandidate = function (e) {
    if (e.candidate) socket.emit("ss-ice", { to: viewerId, c: e.candidate });
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("ss-offer", { to: viewerId, sdp: offer });
}

function prepareViewerPeer(hostId) {
  const pc = new RTCPeerConnection(ICE);
  peers[hostId] = pc;

  playerArea.innerHTML = '<div class="empty">جاري الاتصال بمشاركة الشاشة...</div>';

  pc.ontrack = function (e) {
    playerArea.innerHTML = "";

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.controls = true;
    video.srcObject = e.streams[0];

    playerArea.appendChild(video);
  };

  pc.onicecandidate = function (e) {
    if (e.candidate) socket.emit("ss-ice-v", { to: hostId, c: e.candidate });
  };

  socket.emit("ss-viewer-ready", { to: hostId });
}

function grantControl(targetId, allow) {
  if (!isHost) return alert("المنظّم فقط يستطيع إعطاء التحكم");
  socket.emit("grant-control", { roomCode, targetId, allow });
}

function sendChat() {
  const input = document.getElementById("chatInput");
  const message = input.value.trim();

  if (!message) return;

  socket.emit("chat-message", { roomCode, name: userName, message });
  input.value = "";
}

function renderViewers(viewers) {
  const box = document.getElementById("viewersBox");

  box.innerHTML = viewers.map(v => {
    const badges =
      (v.isHost ? ' <span class="badge">منظّم</span>' : "") +
      (v.canControl && !v.isHost ? ' <span class="control-badge">كنترول</span>' : "");

    let actions = "";

    if (isHost && v.id !== myId && !v.isHost) {
      actions = `
        <div class="viewer-actions">
          <button class="green" onclick="grantControl('${v.id}', true)">أعطه كنترول</button>
          <button class="red" onclick="grantControl('${v.id}', false)">اسحب الكنترول</button>
        </div>
      `;
    }

    return `<div class="viewer-row"><div>${v.name}${badges}</div>${actions}</div>`;
  }).join("") || "لا يوجد متفرجون";
}

socket.on("join-error", msg => alert(msg));

socket.on("room-state", state => {
  myId = state.yourId;
  isHost = state.isHost;
  canControl = state.canControl;
  roomCode = state.roomCode;

  document.getElementById("splashScreen").style.display = "none";
  document.getElementById("roomCodeView").innerText = roomCode;
  document.getElementById("hostBadge").innerHTML = isHost ? '<span class="badge">أنت المنظّم</span>' : "";

  if (state.contentUrl) loadContent(state.contentType, state.contentUrl, state.currentTime, state.isPlaying);
  if (state.screenHostId && state.screenHostId !== myId) prepareViewerPeer(state.screenHostId);
});

socket.on("control-permission", data => {
  isHost = data.isHost;
  canControl = data.canControl;
});

socket.on("viewers-update", viewers => {
  renderViewers(viewers);

  if (screenStream) {
    viewers.forEach(v => {
      if (v.id !== myId && !peers[v.id]) makeOffer(v.id);
    });
  }
});

socket.on("content-changed", data => loadContent(data.contentType, data.contentUrl, data.currentTime, data.isPlaying));
socket.on("sync-control", data => applySync(data.action, data.currentTime));

socket.on("chat-message", data => {
  const box = document.getElementById("chatBox");
  const div = document.createElement("div");

  div.className = "msg";
  div.innerHTML = "<b>" + data.name + ":</b> " + data.message + "<br><small>" + data.time + "</small>";

  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
});

socket.on("screen-share-started", data => {
  if (data.hostId !== myId) prepareViewerPeer(data.hostId);
});

socket.on("screen-share-stopped", () => {
  document.getElementById("screenShareIndicator").classList.remove("active");

  Object.keys(peers).forEach(id => {
    try { peers[id].close(); } catch (e) {}
    delete peers[id];
  });

  if (!screenStream) playerArea.innerHTML = '<div class="empty">انتهت مشاركة الشاشة</div>';
});

socket.on("ss-viewer-ready", data => {
  if (screenStream) makeOffer(data.from);
});

socket.on("ss-offer", async data => {
  const pc = peers[data.from];
  if (!pc) return;

  await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("ss-answer", { to: data.from, sdp: answer });
});

socket.on("ss-answer", async data => {
  const pc = peers[data.from];
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
});

socket.on("ss-ice", async data => {
  const pc = peers[data.from];
  if (pc && data.c) {
    try { await pc.addIceCandidate(new RTCIceCandidate(data.c)); } catch (e) {}
  }
});

socket.on("ss-ice-v", async data => {
  const pc = peers[data.from];
  if (pc && data.c) {
    try { await pc.addIceCandidate(new RTCIceCandidate(data.c)); } catch (e) {}
  }
});

const roomFromUrl = new URLSearchParams(location.search).get("room");

if (roomFromUrl) {
  document.getElementById("spRoom").value = roomFromUrl;
} else {
  randomRoom();
}
