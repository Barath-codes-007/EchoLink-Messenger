/* ==========================================================================
   EchoLink Messenger — Client Script
   ========================================================================== */

(() => {
  "use strict";

  /* ---------------- Elements ---------------- */
  const homeView = document.getElementById("homeView");
  const chatView = document.getElementById("chatView");

  const entryForm = document.getElementById("entryForm");
  const usernameInput = document.getElementById("username");
  const roomCodeInput = document.getElementById("roomCode");
  const generateBtn = document.getElementById("generateBtn");
  const copyBtn = document.getElementById("copyBtn");
  const qrBtn = document.getElementById("qrBtn");
  const joinBtn = document.getElementById("joinBtn");

  const qrModal = document.getElementById("qrModal");
  const qrClose = document.getElementById("qrClose");
  const qrCanvas = document.getElementById("qrCanvas");
  const qrRoomLabel = document.getElementById("qrRoomLabel");

  const roomLabel = document.getElementById("roomLabel");
  const onlineDot = document.getElementById("onlineDot");
  const onlineText = document.getElementById("onlineText");
  const copyRoomBtn = document.getElementById("copyRoomBtn");
  const leaveBtn = document.getElementById("leaveBtn");

  const messagesEl = document.getElementById("messages");
  const typingIndicator = document.getElementById("typingIndicator");
  const typingWho = document.getElementById("typingWho");
  const typingSuffix = document.getElementById("typingSuffix");

  const messageInput = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");
  const emojiBtn = document.getElementById("emojiBtn");
  const emojiPickerWrap = document.getElementById("emojiPickerWrap");
  const emojiPicker = document.getElementById("emojiPicker");

  const uploadBtn = document.getElementById("uploadBtn");
  const fileInput = document.getElementById("fileInput");
  const dropZone = document.getElementById("dropZone");

  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightboxImg");
  const lightboxClose = document.getElementById("lightboxClose");

  const micBtn = document.getElementById("micBtn");
  const recordingBar = document.getElementById("recordingBar");
  const recordTimer = document.getElementById("recordTimer");
  const cancelRecordBtn = document.getElementById("cancelRecordBtn");
  const sendRecordBtn = document.getElementById("sendRecordBtn");

  const themeToggle = document.getElementById("themeToggle");
  const themeIconMoon = document.getElementById("themeIconMoon");
  const themeIconSun = document.getElementById("themeIconSun");

  const messageSound = document.getElementById("messageSound");
  const joinSound = document.getElementById("joinSound");
  const leaveSound = document.getElementById("leaveSound");

  /* ---------------- State ---------------- */
  let socket = null;
  let currentRoom = "";
  let currentUser = "";
  let typingTimeout = null;
  const MAX_FILE_BYTES = 12 * 1024 * 1024; // 12MB, mirrors server cap
  const typingUsers = new Map(); // username -> auto-clear timeout id

  /* ---------------- Theme ---------------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeIconMoon.classList.toggle("hidden", theme === "dark");
    themeIconSun.classList.toggle("hidden", theme !== "dark");
    localStorage.setItem("echolink-theme", theme);
  }
  (function initTheme() {
    const saved = localStorage.getItem("echolink-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(saved || (prefersDark ? "dark" : "light"));
  })();
  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  });

  /* ---------------- Ripple effect ---------------- */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".ripple");
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const circle = document.createElement("span");
    const size = Math.max(rect.width, rect.height);
    circle.className = "ripple-effect";
    circle.style.width = circle.style.height = `${size}px`;
    circle.style.left = `${e.clientX - rect.left - size / 2}px`;
    circle.style.top = `${e.clientY - rect.top - size / 2}px`;
    btn.appendChild(circle);
    setTimeout(() => circle.remove(), 650);
  });

  /* ---------------- Sanitization ---------------- */
  function sanitize(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function isValidRoomCode(code) {
    return /^[A-Za-z0-9]{4,8}$/.test(code);
  }
  function isValidUsername(name) {
    return name.trim().length >= 1 && name.trim().length <= 20;
  }

  /* ---------------- Room code generation ---------------- */
  function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }
  generateBtn.addEventListener("click", () => {
    roomCodeInput.value = generateRoomCode();
  });

  copyBtn.addEventListener("click", () => copyToClipboard(roomCodeInput.value, copyBtn));
  copyRoomBtn.addEventListener("click", () => copyToClipboard(currentRoom, copyRoomBtn));

  function copyToClipboard(text, btn) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const original = btn.innerHTML;
      btn.innerHTML = "✅";
      setTimeout(() => (btn.innerHTML = original), 1200);
    }).catch(() => {});
  }

  /* ---------------- QR Code ---------------- */
  qrBtn.addEventListener("click", () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!code) {
      roomCodeInput.focus();
      return;
    }
    qrCanvas.innerHTML = "";
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(code)}`;
    // eslint-disable-next-line no-undef
    new QRCode(qrCanvas, { text: url, width: 200, height: 200 });
    qrRoomLabel.textContent = code;
    qrModal.classList.remove("hidden");
  });
  qrClose.addEventListener("click", () => qrModal.classList.add("hidden"));
  qrModal.addEventListener("click", (e) => {
    if (e.target === qrModal) qrModal.classList.add("hidden");
  });

  /* Pre-fill room code from URL (?room=CODE) */
  (function prefillFromURL() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    if (room) roomCodeInput.value = room.toUpperCase();
  })();

  roomCodeInput.addEventListener("input", () => {
    roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  /* ---------------- Join Room ---------------- */
  entryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = usernameInput.value.trim();
    const room = roomCodeInput.value.trim().toUpperCase();

    if (!isValidUsername(name)) {
      alert("Please enter a name between 1 and 20 characters.");
      return;
    }
    if (!isValidRoomCode(room)) {
      alert("Room code must be 4–8 letters/numbers.");
      return;
    }

    currentUser = name;
    currentRoom = room;
    joinBtn.disabled = true;
    joinBtn.innerHTML = '<span class="spinner"></span> Joining…';

    connectSocket();
  });

  /* ---------------- Socket.IO ---------------- */
  function connectSocket() {
    socket = io({ transports: ["websocket", "polling"] });

    socket.on("connect", () => {
      socket.emit("join-room", { room: currentRoom, username: currentUser });
    });

    socket.on("join-error", ({ message }) => {
      alert(message || "Could not join room.");
      joinBtn.disabled = false;
      joinBtn.innerHTML = "<span>Join Room</span>";
      socket.disconnect();
    });

    socket.on("join-success", ({ room, history, onlineCount, users }) => {
      switchToChat(room);
      history.forEach(renderMessage);
      updateOnlineStatus(onlineCount, users);
    });

    socket.on("user-joined", ({ username, onlineCount, users }) => {
      renderSystemMessage(`${username} joined the room`);
      updateOnlineStatus(onlineCount, users);
      playSound(joinSound);
    });

    socket.on("user-left", ({ username, onlineCount, users }) => {
      renderSystemMessage(`${username} left the room`);
      updateOnlineStatus(onlineCount, users);
      clearTypingUser(username);
      playSound(leaveSound);
    });

    socket.on("online-count", ({ onlineCount, users }) => updateOnlineStatus(onlineCount, users));

    socket.on("chat-message", (msg) => {
      renderMessage(msg);
      if (msg.sender !== currentUser) playSound(messageSound);
    });

    socket.on("typing", ({ username, isTyping }) => {
      if (isTyping) {
        setTypingUser(username);
      } else {
        clearTypingUser(username);
      }
    });

    socket.on("room-closed", () => {
      alert("The room was closed because everyone left.");
      window.location.reload();
    });

    socket.on("disconnect", () => {
      onlineDot.className = "status-dot offline";
      onlineText.textContent = "Disconnected";
    });
  }

  function switchToChat(room) {
    currentRoom = room;
    roomLabel.textContent = room;
    homeView.classList.add("hidden");
    chatView.classList.remove("hidden");
    joinBtn.disabled = false;
    joinBtn.innerHTML = "<span>Join Room</span>";
    messageInput.focus();
  }

  function updateOnlineStatus(count, users) {
    if (count >= 2) {
      onlineDot.className = "status-dot online";
      onlineText.textContent = `${count} people online`;
    } else {
      onlineDot.className = "status-dot offline";
      onlineText.textContent = "Waiting for others to join…";
    }
    if (Array.isArray(users) && users.length) {
      onlineText.title = users.join(", ");
    }
  }

  function renderTypingIndicator() {
    const names = Array.from(typingUsers.keys());
    if (names.length === 0) {
      typingIndicator.classList.add("hidden");
      return;
    }
    if (names.length === 1) {
      typingWho.textContent = names[0];
      typingSuffix.textContent = " is typing…";
    } else if (names.length <= 3) {
      typingWho.textContent = names.join(", ");
      typingSuffix.textContent = " are typing…";
    } else {
      typingWho.textContent = `${names.length} people`;
      typingSuffix.textContent = " are typing…";
    }
    typingIndicator.classList.remove("hidden");
  }

  function setTypingUser(username) {
    if (typingUsers.has(username)) clearTimeout(typingUsers.get(username));
    const timeout = setTimeout(() => clearTypingUser(username), 4000); // safety auto-clear
    typingUsers.set(username, timeout);
    renderTypingIndicator();
  }

  function clearTypingUser(username) {
    if (typingUsers.has(username)) {
      clearTimeout(typingUsers.get(username));
      typingUsers.delete(username);
      renderTypingIndicator();
    }
  }

  /* ---------------- Messages ---------------- */
  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function linkify(escapedHtml) {
    // Operates on already-escaped text, so this only wraps plain substrings — safe.
    const urlPattern = /((https?:\/\/|www\.)[^\s<]+)/gi;
    return escapedHtml.replace(urlPattern, (match) => {
      const href = match.startsWith("http") ? match : `https://${match}`;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="msg-link">${match}</a>`;
    });
  }

  function formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fileIconFor(fileType, fileName) {
    const name = (fileName || "").toLowerCase();
    const type = (fileType || "").toLowerCase();
    if (type.includes("pdf") || name.endsWith(".pdf")) return "📄";
    if (type.includes("zip") || type.includes("compressed") || /\.(zip|rar|7z)$/.test(name)) return "🗜️";
    if (type.includes("word") || /\.(docx?|rtf)$/.test(name)) return "📝";
    if (type.includes("sheet") || /\.(xlsx?|csv)$/.test(name)) return "📊";
    if (type.includes("presentation") || /\.(pptx?)$/.test(name)) return "📽️";
    if (type.startsWith("video/")) return "🎬";
    if (type.startsWith("text/")) return "📃";
    return "📎";
  }

  function renderMessage(msg) {
    const isMe = msg.sender === currentUser;
    const row = document.createElement("div");
    row.className = `msg-row ${isMe ? "me" : "them"} slide-in`;

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    if (msg.type === "audio") {
      bubble.innerHTML = `
        <div class="msg-audio">
          <audio controls src="${msg.content}"></audio>
        </div>`;
    } else if (msg.type === "image") {
      const safeName = sanitize(msg.fileName || "photo");
      bubble.innerHTML = `
        <div class="msg-image">
          <img src="${msg.content}" alt="${safeName}" loading="lazy" />
          <div class="msg-filename">${safeName}</div>
        </div>`;
      const img = bubble.querySelector("img");
      img.addEventListener("click", () => openLightbox(msg.content));
    } else if (msg.type === "file") {
      const safeName = sanitize(msg.fileName || "file");
      const sizeLabel = formatFileSize(msg.fileSize);
      const icon = fileIconFor(msg.fileType, msg.fileName);
      bubble.innerHTML = `
        <div class="msg-file">
          <div class="msg-file-icon">${icon}</div>
          <div class="msg-file-info">
            <span class="msg-file-name" title="${safeName}">${safeName}</span>
            <span class="msg-file-size">${sizeLabel}</span>
          </div>
          <a class="msg-file-download" href="${msg.content}" download="${safeName}" title="Download">⬇️</a>
        </div>`;
    } else {
      bubble.innerHTML = linkify(sanitize(msg.content).replace(/\n/g, "<br>"));
    }

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.innerHTML = `${!isMe ? `<span class="msg-sender">${sanitize(msg.sender)}</span>` : ""}${formatTime(msg.timestamp)}`;

    row.appendChild(bubble);
    row.appendChild(meta);
    messagesEl.appendChild(row);
    scrollToBottom();
  }

  function openLightbox(src) {
    lightboxImg.src = src;
    lightbox.classList.remove("hidden");
  }
  lightboxClose.addEventListener("click", () => lightbox.classList.add("hidden"));
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) lightbox.classList.add("hidden");
  });

  function renderSystemMessage(text) {
    const div = document.createElement("div");
    div.className = "system-msg";
    div.textContent = text;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function playSound(el) {
    try {
      el.currentTime = 0;
      el.play().catch(() => {});
    } catch (_) { /* ignore */ }
  }

  /* ---------------- Sending text ---------------- */
  function autoResize() {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
  }
  messageInput.addEventListener("input", () => {
    autoResize();
    if (!socket) return;
    socket.emit("typing", { room: currentRoom, isTyping: messageInput.value.length > 0 });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit("typing", { room: currentRoom, isTyping: false });
    }, 1500);
  });

  function sendTextMessage() {
    const text = messageInput.value.trim();
    if (!text || !socket) return;
    socket.emit("chat-message", { room: currentRoom, type: "text", content: text });
    messageInput.value = "";
    autoResize();
    socket.emit("typing", { room: currentRoom, isTyping: false });
  }

  sendBtn.addEventListener("click", sendTextMessage);
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  });

  /* ---------------- Emoji Picker ---------------- */
  emojiBtn.addEventListener("click", () => {
    emojiPickerWrap.classList.toggle("hidden");
  });
  emojiPicker.addEventListener("emoji-click", (event) => {
    messageInput.value += event.detail.unicode;
    messageInput.focus();
    autoResize();
  });
  document.addEventListener("click", (e) => {
    if (
      !emojiPickerWrap.classList.contains("hidden") &&
      !emojiPickerWrap.contains(e.target) &&
      e.target !== emojiBtn &&
      !emojiBtn.contains(e.target)
    ) {
      emojiPickerWrap.classList.add("hidden");
    }
  });

  /* ---------------- File Upload / Drag & Drop (any file type) ---------------- */
  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) sendFile(file);
    fileInput.value = "";
  });

  let dragCounter = 0;
  ["dragenter", "dragover"].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      if (chatView.classList.contains("hidden")) return;
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      dragCounter++;
      dropZone.classList.remove("hidden");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      if (evt === "dragleave") {
        dragCounter = Math.max(0, dragCounter - 1);
        if (dragCounter === 0) dropZone.classList.add("hidden");
      } else {
        e.preventDefault();
        dragCounter = 0;
        dropZone.classList.add("hidden");
        if (chatView.classList.contains("hidden")) return;
        const file = e.dataTransfer.files[0];
        if (file) sendFile(file);
      }
    });
  });

  function sendFile(file) {
    if (!socket) return;
    if (file.size > MAX_FILE_BYTES) {
      alert(`File too large (max ${formatFileSize(MAX_FILE_BYTES)}).`);
      return;
    }

    let msgType = "file";
    if (file.type.startsWith("image/")) msgType = "image";
    else if (file.type.startsWith("audio/")) msgType = "audio";

    const reader = new FileReader();
    reader.onload = () => {
      socket.emit("chat-message", {
        room: currentRoom,
        type: msgType,
        content: reader.result, // base64 data URL
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });
    };
    reader.onerror = () => alert("Couldn't read that file. Please try again.");
    reader.readAsDataURL(file);
  }

  /* ---------------- Voice Recording ---------------- */
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordStream = null;
  let recordStartTime = 0;
  let recordTimerInterval = null;
  let recordCancelled = false;

  function pickSupportedMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const type of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
    }
    return ""; // let the browser choose a default
  }

  function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Your browser doesn't support microphone recording.");
      return;
    }
    if (!window.MediaRecorder) {
      alert("Your browser doesn't support MediaRecorder.");
      return;
    }

    try {
      recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      alert("Microphone access was denied or unavailable.");
      return;
    }

    recordedChunks = [];
    recordCancelled = false;
    const mimeType = pickSupportedMimeType();
    mediaRecorder = mimeType
      ? new MediaRecorder(recordStream, { mimeType })
      : new MediaRecorder(recordStream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stopStreamTracks();
      clearInterval(recordTimerInterval);

      if (recordCancelled || recordedChunks.length === 0) {
        recordedChunks = [];
        return;
      }

      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      recordedChunks = [];

      if (blob.size > MAX_FILE_BYTES) {
        alert(`That voice message is too long/large to send (max ${formatFileSize(MAX_FILE_BYTES)}).`);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        if (!socket) return;
        socket.emit("chat-message", {
          room: currentRoom,
          type: "audio",
          content: reader.result,
        });
      };
      reader.readAsDataURL(blob);
    };

    mediaRecorder.start();
    recordStartTime = Date.now();
    recordTimer.textContent = "0:00";
    recordTimerInterval = setInterval(() => {
      recordTimer.textContent = formatDuration(Date.now() - recordStartTime);
    }, 250);

    micBtn.classList.add("recording");
    recordingBar.classList.remove("hidden");
  }

  function stopStreamTracks() {
    if (recordStream) {
      recordStream.getTracks().forEach((track) => track.stop());
      recordStream = null;
    }
  }

  function finishRecording(cancelled) {
    recordCancelled = cancelled;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    } else {
      stopStreamTracks();
      clearInterval(recordTimerInterval);
    }
    micBtn.classList.remove("recording");
    recordingBar.classList.add("hidden");
  }

  micBtn.addEventListener("click", () => {
    if (!socket) {
      alert("You need to be in a room to send a voice message.");
      return;
    }
    if (mediaRecorder && mediaRecorder.state === "recording") {
      finishRecording(false); // toggle mic button acts as send too, for convenience
    } else {
      startRecording();
    }
  });

  sendRecordBtn.addEventListener("click", () => finishRecording(false));
  cancelRecordBtn.addEventListener("click", () => finishRecording(true));

  /* ---------------- Leave Room ---------------- */
  leaveBtn.addEventListener("click", () => {
    if (confirm("Leave the room? This will end the chat for both users if you're the last one here.")) {
      if (mediaRecorder && mediaRecorder.state === "recording") finishRecording(true);
      if (socket) socket.disconnect();
      window.location.href = window.location.pathname;
    }
  });

  window.addEventListener("beforeunload", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") finishRecording(true);
    if (socket) socket.disconnect();
  });
})();
