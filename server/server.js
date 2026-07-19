/* ==========================================================================
   EchoLink Messenger — Backend Server
   Node.js + Express + Socket.IO
   No database. Everything lives in memory and disappears when a room empties.
   ========================================================================== */

"use strict";

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const MAX_ROOM_SIZE = 8; // group chat cap — raise/lower as needed
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY = 200;
const MAX_FILE_BYTES = 12 * 1024 * 1024; // ~12MB ceiling for any single file (base64 data URL)
const MAX_FILENAME_LENGTH = 120;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 16 * 1024 * 1024, // allow base64 image/file payloads
});

/* ---------------- Static frontend ---------------- */
app.use(express.static(path.join(__dirname, "..")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", rooms: rooms.size });
});

/* ---------------- In-memory room store ----------------
   rooms: Map<roomCode, {
     users: Map<socketId, { username }>,
     history: Array<message>
   }>
------------------------------------------------------- */
const rooms = new Map();

/* ---------------- Helpers ---------------- */
function sanitizeText(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .slice(0, MAX_MESSAGE_LENGTH);
}

function sanitizeFileName(str) {
  if (typeof str !== "string") return "file";
  const clean = str
    .replace(/[\\/]/g, "_")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .slice(0, MAX_FILENAME_LENGTH)
    .trim();
  return clean || "file";
}

function isValidRoomCode(code) {
  return typeof code === "string" && /^[A-Za-z0-9]{4,8}$/.test(code);
}

function isValidUsername(name) {
  return typeof name === "string" && name.trim().length >= 1 && name.trim().length <= 20;
}

function isValidDataUrl(content, requiredPrefix) {
  return (
    typeof content === "string" &&
    content.startsWith(requiredPrefix) &&
    content.length <= MAX_FILE_BYTES
  );
}

function getOrCreateRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, { users: new Map(), history: [] });
  }
  return rooms.get(code);
}

function getUsernames(roomData) {
  return Array.from(roomData.users.values()).map((u) => u.username);
}

function broadcastOnlineCount(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit("online-count", {
    onlineCount: room.users.size,
    users: getUsernames(room),
  });
}

function pushHistory(room, message) {
  room.history.push(message);
  if (room.history.length > MAX_HISTORY) room.history.shift();
}

/* ---------------- Socket.IO logic ---------------- */
io.on("connection", (socket) => {
  socket.data.room = null;
  socket.data.username = null;

  socket.on("join-room", ({ room, username }) => {
    const code = typeof room === "string" ? room.trim().toUpperCase() : "";
    const name = typeof username === "string" ? username.trim().slice(0, 20) : "";

    if (!isValidRoomCode(code)) {
      socket.emit("join-error", { message: "Invalid room code." });
      return;
    }
    if (!isValidUsername(name)) {
      socket.emit("join-error", { message: "Invalid username." });
      return;
    }

    const roomData = getOrCreateRoom(code);

    if (roomData.users.size >= MAX_ROOM_SIZE) {
      socket.emit("join-error", { message: `This room is full (max ${MAX_ROOM_SIZE} people).` });
      return;
    }

    // Prevent duplicate usernames in the same room
    const nameTaken = Array.from(roomData.users.values()).some(
      (u) => u.username.toLowerCase() === name.toLowerCase()
    );
    const finalName = nameTaken ? `${name}-${Math.floor(Math.random() * 900 + 100)}` : name;

    socket.join(code);
    socket.data.room = code;
    socket.data.username = finalName;
    roomData.users.set(socket.id, { username: finalName });

    socket.emit("join-success", {
      room: code,
      history: roomData.history,
      onlineCount: roomData.users.size,
      users: getUsernames(roomData),
      maxRoomSize: MAX_ROOM_SIZE,
    });

    socket.to(code).emit("user-joined", {
      username: finalName,
      onlineCount: roomData.users.size,
      users: getUsernames(roomData),
    });

    broadcastOnlineCount(code);
  });

  socket.on("chat-message", (payload) => {
    const { room, type, content, fileName, fileSize, fileType } = payload || {};
    const code = socket.data.room;
    if (!code || code !== room) return;
    const roomData = rooms.get(code);
    if (!roomData) return;

    let message = null;

    if (type === "text") {
      const clean = sanitizeText(content);
      if (!clean.trim()) return;
      message = {
        type: "text",
        sender: socket.data.username,
        content: clean,
        timestamp: Date.now(),
      };
    } else if (type === "audio") {
      if (!isValidDataUrl(content, "data:audio/")) return;
      message = {
        type: "audio",
        sender: socket.data.username,
        content,
        timestamp: Date.now(),
      };
    } else if (type === "image") {
      if (!isValidDataUrl(content, "data:image/")) return;
      message = {
        type: "image",
        sender: socket.data.username,
        content,
        fileName: sanitizeFileName(fileName),
        timestamp: Date.now(),
      };
    } else if (type === "file") {
      if (typeof content !== "string" || !content.startsWith("data:") || content.length > MAX_FILE_BYTES) return;
      message = {
        type: "file",
        sender: socket.data.username,
        content,
        fileName: sanitizeFileName(fileName),
        fileSize: typeof fileSize === "number" ? fileSize : null,
        fileType: typeof fileType === "string" ? fileType.slice(0, 100) : "",
        timestamp: Date.now(),
      };
    } else {
      return;
    }

    pushHistory(roomData, message);
    io.to(code).emit("chat-message", message);
  });

  socket.on("typing", ({ room, isTyping }) => {
    const code = socket.data.room;
    if (!code || code !== room) return;
    socket.to(code).emit("typing", {
      username: socket.data.username,
      isTyping: !!isTyping,
    });
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    const name = socket.data.username;
    if (!code) return;
    const roomData = rooms.get(code);
    if (!roomData) return;

    roomData.users.delete(socket.id);

    if (roomData.users.size === 0) {
      rooms.delete(code); // Room + history fully deleted — nothing persists
    } else {
      socket.to(code).emit("user-left", {
        username: name,
        onlineCount: roomData.users.size,
        users: getUsernames(roomData),
      });
      broadcastOnlineCount(code);
    }
  });
});

server.listen(PORT, () => {
  console.log(`EchoLink Messenger server running on http://localhost:${PORT}`);
});
