const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MAX_GUESTS = 3; // máximo 3 invitados + 1 host = 4 personas

// --- Estado en memoria ---
const salas = {};

const PALABRAS = ['LUNA', 'NOCHE', 'ASTRO', 'NEBULA', 'NOVA', 'COSMO', 'ORION', 'LYRA', 'VEGA', 'SIRIO', 'ATLAS', 'EDEN', 'ZENIT', 'ALPHA', 'BETA'];

function generarCodigo() {
  const palabra = PALABRAS[Math.floor(Math.random() * PALABRAS.length)];
  const numero = Math.floor(Math.random() * 90) + 10;
  return `${palabra}-${numero}`;
}

function codigoUnico() {
  let codigo;
  do { codigo = generarCodigo(); } while (salas[codigo]);
  return codigo;
}

// --- Rutas HTML ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/sala/:codigo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'lobby.html')));
app.get('/sala/:codigo/watch', (req, res) => res.sendFile(path.join(__dirname, 'public', 'room.html')));

// --- API REST ---
// Crear sala
app.post('/api/sala/crear', (req, res) => {
  const { userName, avatarSeed } = req.body;
  if (!userName) return res.status(400).json({ error: 'Nombre requerido' });
  const codigo = codigoUnico();
  salas[codigo] = {
    codigo,
    host: { userName, avatarSeed, socketId: null },
    guests: [],
    video: null,
    videoType: null,
    playing: false,
    currentTime: 0,
    lastUpdate: Date.now()
  };
  res.json({ codigo });
});

// Unirse a sala
app.post('/api/sala/unirse', (req, res) => {
  const { codigo, userName } = req.body;
  const sala = salas[codigo];
  if (!sala) return res.status(404).json({ error: 'Sala no encontrada' });
  if (!userName) return res.status(400).json({ error: 'Nombre requerido' });
  if (sala.guests.length >= MAX_GUESTS) return res.status(403).json({ error: 'La sala está llena (máximo 4 personas)' });
  res.json({ ok: true, isHost: false });
});

// Verificar sala
app.get('/api/sala/:codigo', (req, res) => {
  const sala = salas[req.params.codigo];
  if (!sala) return res.status(404).json({ error: 'Sala no encontrada' });
  res.json({
    codigo: sala.codigo,
    hostName: sala.host.userName,
    guestCount: sala.guests.length,
    isFull: sala.guests.length >= MAX_GUESTS,
    video: sala.video,
    videoType: sala.videoType
  });
});

// --- Socket.IO ---
io.on('connection', (socket) => {

  // Unirse a sala vía socket
  socket.on('join-room', ({ roomCode, userName, avatarSeed, isHost }) => {
    const sala = salas[roomCode];
    if (!sala) { socket.emit('error-sala', 'Sala no encontrada'); return; }

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.userName = userName;
    socket.isHost = isHost;

    if (isHost) {
      sala.host.socketId = socket.id;
      sala.host.userName = userName;
      sala.host.avatarSeed = avatarSeed;
    } else {
      // Verificar si ya está reconectando (mismo nombre)
      const yaExiste = sala.guests.find(g => g.userName === userName);
      if (!yaExiste) {
        if (sala.guests.length >= MAX_GUESTS) {
          socket.emit('sala-llena', 'Esta sala ya está llena (máximo 4 personas)');
          return;
        }
        sala.guests.push({ userName, avatarSeed, socketId: socket.id });
      } else {
        // Actualizar socketId si reconecta
        yaExiste.socketId = socket.id;
      }
    }

    // Enviar estado actual al nuevo participante
    socket.emit('room-state', {
      video: sala.video,
      videoType: sala.videoType,
      playing: sala.playing,
      currentTime: sala.currentTime,
      host: { userName: sala.host.userName, avatarSeed: sala.host.avatarSeed },
      guests: sala.guests.map(g => ({ userName: g.userName, avatarSeed: g.avatarSeed }))
    });

    // Notificar a todos
    io.to(roomCode).emit('user-joined', { userName, avatarSeed, isHost });
    io.to(roomCode).emit('system-message', `${userName} se unió a la sala`);
  });

  // Ping
  socket.on('ping-check', () => socket.emit('pong-check'));

  // --- Controles de video ---
  socket.on('video-play', ({ currentTime }) => {
    const sala = salas[socket.roomCode];
    if (!sala) return;
    sala.playing = true;
    sala.currentTime = currentTime;
    sala.lastUpdate = Date.now();
    socket.to(socket.roomCode).emit('video-play', { currentTime });
  });

  socket.on('video-pause', ({ currentTime }) => {
    const sala = salas[socket.roomCode];
    if (!sala) return;
    sala.playing = false;
    sala.currentTime = currentTime;
    socket.to(socket.roomCode).emit('video-pause', { currentTime });
  });

  socket.on('video-seek', ({ currentTime }) => {
    const sala = salas[socket.roomCode];
    if (!sala) return;
    sala.currentTime = currentTime;
    sala.lastUpdate = Date.now();
    socket.to(socket.roomCode).emit('video-seek', { currentTime });
  });

  socket.on('video-change', ({ videoId, videoType }) => {
    const sala = salas[socket.roomCode];
    if (!sala) return;
    sala.video = videoId;
    sala.videoType = videoType;
    sala.playing = false;
    sala.currentTime = 0;
    io.to(socket.roomCode).emit('video-change', { videoId, videoType });
  });

  // Sincronización
  socket.on('sync-request', ({ currentTime }) => {
    const sala = salas[socket.roomCode];
    if (!sala) return;
    socket.emit('sync-response', {
      currentTime: sala.currentTime,
      serverTimestamp: Date.now()
    });
  });

  // Chat
  socket.on('chat-message', ({ text, userName, avatarSeed }) => {
    if (!text || !text.trim()) return;
    io.to(socket.roomCode).emit('chat-message', {
      text: text.trim(),
      userName,
      avatarSeed,
      timestamp: Date.now()
    });
  });

  // Desconexión
  socket.on('disconnect', () => {
    const sala = salas[socket.roomCode];
    if (!sala) return;

    if (socket.isHost) {
      io.to(socket.roomCode).emit('host-left', { userName: socket.userName });
      io.to(socket.roomCode).emit('system-message', `${socket.userName} (host) se desconectó`);
      setTimeout(() => {
        if (salas[socket.roomCode] && salas[socket.roomCode].host.socketId === socket.id) {
          delete salas[socket.roomCode];
        }
      }, 5 * 60 * 1000);
    } else {
      sala.guests = sala.guests.filter(g => g.socketId !== socket.id);
      io.to(socket.roomCode).emit('user-left', { userName: socket.userName });
      io.to(socket.roomCode).emit('system-message', `${socket.userName} salió de la sala`);
    }
  });
});

// --- API Config ---
app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleApiKey: process.env.GOOGLE_API_KEY || ''
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SyncRoom corriendo en http://localhost:${PORT}`));
