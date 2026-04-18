const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MAX_GUESTS = 3; // 3 invitados + 1 host = 4 personas
const salas = {};

const PALABRAS = [
  'LUNA', 'NOCHE', 'ASTRO', 'NEBULA', 'NOVA',
  'COSMO', 'ORION', 'LYRA', 'VEGA', 'SIRIO',
  'ATLAS', 'EDEN', 'ZENIT', 'ALPHA', 'BETA'
];

function generarCodigo() {
  const palabra = PALABRAS[Math.floor(Math.random() * PALABRAS.length)];
  const numero = Math.floor(Math.random() * 90) + 10;
  return `${palabra}-${numero}`;
}

function codigoUnico() {
  let codigo;
  do {
    codigo = generarCodigo();
  } while (salas[codigo]);
  return codigo;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getEffectiveCurrentTime(sala) {
  if (!sala) return 0;

  const base = toNumber(sala.currentTime, 0);

  if (!sala.playing) {
    return Math.max(0, base);
  }

  const lastUpdate = toNumber(sala.lastUpdate, Date.now());
  const elapsed = Math.max(0, (Date.now() - lastUpdate) / 1000);
  return Math.max(0, base + elapsed);
}

function syncSalaClock(sala) {
  if (!sala) return 0;
  sala.currentTime = getEffectiveCurrentTime(sala);
  sala.lastUpdate = Date.now();
  return sala.currentTime;
}

function buildRoomState(sala) {
  return {
    video: sala.video,
    videoType: sala.videoType,
    playing: sala.playing,
    currentTime: getEffectiveCurrentTime(sala),
    host: {
      userName: sala.host.userName,
      avatarSeed: sala.host.avatarSeed
    },
    guests: sala.guests.map(g => ({
      userName: g.userName,
      avatarSeed: g.avatarSeed
    }))
  };
}

/* ---------- Rutas HTML ---------- */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/sala/:codigo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lobby.html'));
});

app.get('/sala/:codigo/watch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

/* ---------- API REST ---------- */

app.post('/api/sala/crear', (req, res) => {
  const { userName, avatarSeed } = req.body;

  if (!userName) {
    return res.status(400).json({ error: 'Nombre requerido' });
  }

  const codigo = codigoUnico();

  salas[codigo] = {
    codigo,
    host: {
      userName,
      avatarSeed,
      socketId: null
    },
    guests: [],
    video: null,
    videoType: null,
    playing: false,
    currentTime: 0,
    lastUpdate: Date.now()
  };

  res.json({ codigo });
});

app.post('/api/sala/unirse', (req, res) => {
  const { codigo, userName } = req.body;
  const sala = salas[codigo];

  if (!sala) {
    return res.status(404).json({ error: 'Sala no encontrada' });
  }

  if (!userName) {
    return res.status(400).json({ error: 'Nombre requerido' });
  }

  if (sala.guests.length >= MAX_GUESTS) {
    return res.status(403).json({ error: 'La sala está llena (máximo 4 personas)' });
  }

  res.json({ ok: true, isHost: false });
});

app.get('/api/sala/:codigo', (req, res) => {
  const sala = salas[req.params.codigo];

  if (!sala) {
    return res.status(404).json({ error: 'Sala no encontrada' });
  }

  res.json({
    codigo: sala.codigo,
    hostName: sala.host.userName,
    guestCount: sala.guests.length,
    isFull: sala.guests.length >= MAX_GUESTS,
    video: sala.video,
    videoType: sala.videoType,
    playing: sala.playing,
    currentTime: getEffectiveCurrentTime(sala)
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || process.env.GOOGLECLIENTID || '',
    googleApiKey: process.env.GOOGLE_API_KEY || process.env.GOOGLEAPIKEY || ''
  });
});

/* ---------- Socket.IO ---------- */

io.on('connection', socket => {
  socket.on('join-room', (roomCode, userName, avatarSeed, isHost) => {
    const sala = salas[roomCode];

    if (!sala) {
      socket.emit('error-sala', 'Sala no encontrada');
      return;
    }

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.userName = userName;
    socket.isHost = !!isHost;

    if (isHost) {
      sala.host.socketId = socket.id;
      sala.host.userName = userName;
      sala.host.avatarSeed = avatarSeed;
    } else {
      const yaExiste = sala.guests.find(g => g.userName === userName);

      if (!yaExiste) {
        if (sala.guests.length >= MAX_GUESTS) {
          socket.emit('sala-llena', 'Esta sala ya está llena (máximo 4 personas)');
          return;
        }

        sala.guests.push({
          userName,
          avatarSeed,
          socketId: socket.id
        });
      } else {
        yaExiste.socketId = socket.id;
        yaExiste.avatarSeed = avatarSeed;
      }
    }

    socket.emit('room-state', buildRoomState(sala));

    io.to(roomCode).emit('user-joined', {
      userName,
      avatarSeed,
      isHost: !!isHost
    });

    io.to(roomCode).emit('system-message', `${userName} se unió a la sala`);
  });

  socket.on('ping-check', () => {
    socket.emit('pong-check');
  });

  socket.on('video-play', currentTime => {
    const sala = salas[socket.roomCode];
    if (!sala) return;

    sala.playing = true;
    sala.currentTime = Math.max(0, toNumber(currentTime, 0));
    sala.lastUpdate = Date.now();

    socket.to(socket.roomCode).emit('video-play', sala.currentTime);
  });

  socket.on('video-pause', currentTime => {
    const sala = salas[socket.roomCode];
    if (!sala) return;

    sala.currentTime = Math.max(0, toNumber(currentTime, getEffectiveCurrentTime(sala)));
    sala.playing = false;
    sala.lastUpdate = Date.now();

    socket.to(socket.roomCode).emit('video-pause', sala.currentTime);
  });

  socket.on('video-seek', currentTime => {
    const sala = salas[socket.roomCode];
    if (!sala) return;

    sala.currentTime = Math.max(0, toNumber(currentTime, 0));
    sala.lastUpdate = Date.now();

    socket.to(socket.roomCode).emit('video-seek', sala.currentTime);
  });

  socket.on('video-change', (videoId, videoType) => {
    const sala = salas[socket.roomCode];
    if (!sala) return;

    sala.video = videoId;
    sala.videoType = videoType;
    sala.playing = false;
    sala.currentTime = 0;
    sala.lastUpdate = Date.now();

    io.to(socket.roomCode).emit('video-change', {
      videoId,
      videoType
    });
  });

  socket.on('sync-request', () => {
    const sala = salas[socket.roomCode];
    if (!sala) return;

    socket.emit('sync-response', {
      currentTime: getEffectiveCurrentTime(sala),
      playing: sala.playing,
      videoType: sala.videoType,
      serverTimestamp: Date.now()
    });
  });

  socket.on('chat-message', (text, userName, avatarSeed) => {
    if (!text || !text.trim()) return;

    io.to(socket.roomCode).emit('chat-message', {
      text: text.trim(),
      userName,
      avatarSeed,
      timestamp: Date.now()
    });
  });

  socket.on('disconnect', () => {
    const sala = salas[socket.roomCode];
    if (!sala) return;

    if (socket.isHost) {
      sala.currentTime = syncSalaClock(sala);
      sala.playing = false;

      io.to(socket.roomCode).emit('host-left', {
        userName: socket.userName
      });

      io.to(socket.roomCode).emit('system-message', `${socket.userName} (host) se desconectó`);

      const disconnectedHostId = socket.id;
      setTimeout(() => {
        const room = salas[socket.roomCode];
        if (!room) return;

        if (room.host.socketId === disconnectedHostId) {
          delete salas[socket.roomCode];
        }
      }, 5 * 60 * 1000);
    } else {
      sala.guests = sala.guests.filter(g => g.socketId !== socket.id);

      io.to(socket.roomCode).emit('user-left', {
        userName: socket.userName
      });

      io.to(socket.roomCode).emit('system-message', `${socket.userName} salió de la sala`);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`SyncRoom corriendo en http://localhost:${PORT}`);
});