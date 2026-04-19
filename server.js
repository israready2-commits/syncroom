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

    // Enviar estado actual al nuevo participante (incluye token de Drive si hay)
    socket.emit('room-state', {
      video: sala.video,
      videoType: sala.videoType,
      playing: sala.playing,
      currentTime: sala.currentTime,
      accessToken: sala.driveAccessToken || '',
      host: { userName: sala.host.userName, avatarSeed: sala.host.avatarSeed },
      guests: sala.guests.map(g => ({ userName: g.userName, avatarSeed: g.avatarSeed }))
    });

    // Notificar a todos
    io.to(roomCode).emit('user-joined', { userName, avatarSeed, isHost });
    io.to(roomCode).emit('system-message', `${userName} se unió a la sala`);
  });

  // Ping
  socket.on('ping-check', () => socket.emit('pong-check'));

  // --- Controles de video (solo el host puede emitirlos) ---
  socket.on('video-play', ({ currentTime }) => {
    const sala = salas[socket.roomCode];
    if (!sala || sala.host.socketId !== socket.id) return;
    sala.playing = true;
    sala.currentTime = currentTime;
    sala.lastUpdate = Date.now();
    socket.to(socket.roomCode).emit('video-play', { currentTime });
  });

  socket.on('video-pause', ({ currentTime }) => {
    const sala = salas[socket.roomCode];
    if (!sala || sala.host.socketId !== socket.id) return;
    sala.playing = false;
    sala.currentTime = currentTime;
    sala.lastUpdate = Date.now();
    socket.to(socket.roomCode).emit('video-pause', { currentTime });
  });

  socket.on('video-seek', ({ currentTime }) => {
    const sala = salas[socket.roomCode];
    if (!sala || sala.host.socketId !== socket.id) return;
    sala.currentTime = currentTime;
    sala.lastUpdate = Date.now();
    socket.to(socket.roomCode).emit('video-seek', { currentTime });
  });

  socket.on('video-change', ({ videoId, videoType, accessToken }) => {
    const sala = salas[socket.roomCode];
    if (!sala) return;
    sala.video = videoId;
    sala.videoType = videoType;
    sala.playing = false;
    sala.currentTime = 0;
    // Guardar el token para nuevos participantes que se unan después
    if (accessToken) sala.driveAccessToken = accessToken;
    io.to(socket.roomCode).emit('video-change', { videoId, videoType, accessToken: accessToken || '' });
  });

  // Sincronización — el servidor calcula el tiempo real ajustando por tiempo transcurrido
  socket.on('sync-request', ({ currentTime }) => {
    const sala = salas[socket.roomCode];
    if (!sala) return;
    let adjustedTime = sala.currentTime;
    if (sala.playing && sala.lastUpdate) {
      const elapsed = (Date.now() - sala.lastUpdate) / 1000;
      adjustedTime = sala.currentTime + elapsed;
    }
    socket.emit('sync-response', {
      currentTime: adjustedTime,
      serverTimestamp: Date.now()
    });
  });

  // Duración del video Drive (el host la ingresa manualmente y se comparte)
  socket.on('drive-duration', ({ duration }) => {
    const sala = salas[socket.roomCode];
    if (!sala || sala.host.socketId !== socket.id) return;
    sala.driveDuration = duration;
    socket.to(socket.roomCode).emit('drive-duration', { duration });
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

// --- Proxy de stream para Google Drive ---
// Recibe el access_token del cliente (obtenido via OAuth2 en el browser)
// y hace el request autenticado a la Drive API desde el servidor.
// Esto evita el CORS y el bloqueo de Drive a requests sin auth.
app.get('/api/drive-stream/:fileId', (req, res) => {
  const { fileId } = req.params;
  const token = req.query.token || '';

  if (!token) {
    return res.status(401).send('Token de acceso requerido. El host debe iniciar sesión con Google.');
  }

  const https = require('https');

  // Esta es la URL que usa Rave internamente — Drive API v3 con alt=media
  // Con el Bearer token, Google devuelve el video directamente sin redirecciones
  const driveApiUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;

  const requestHeaders = {
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'Mozilla/5.0 SyncRoom/1.0',
  };

  // Soportar Range requests para que el seek del <video> funcione
  if (req.headers.range) {
    requestHeaders['Range'] = req.headers.range;
  }

  const parsedUrl = new (require('url').URL)(driveApiUrl);
  const options = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: requestHeaders,
  };

  const driveReq = https.request(options, (driveRes) => {
    const status = driveRes.statusCode || 200;

    if (status === 401 || status === 403) {
      return res.status(status).send('Token inválido o sin permisos para este archivo.');
    }

    // Pasar los headers necesarios para streaming
    res.status(status);
    ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(h => {
      if (driveRes.headers[h]) res.setHeader(h, driveRes.headers[h]);
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    driveRes.pipe(res);

    req.on('close', () => driveReq.destroy());
  });

  driveReq.on('error', (err) => {
    console.error('[SyncRoom] Drive proxy error:', err.message);
    if (!res.headersSent) res.status(500).send('Error al conectar con Drive API');
  });

  driveReq.end();
});

const PORT

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SyncRoom corriendo en http://localhost:${PORT}`));

