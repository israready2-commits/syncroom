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

  socket.on('video-change', ({ videoId, videoType }) => {
    const sala = salas[socket.roomCode];
    if (!sala) return;
    sala.video = videoId;
    sala.videoType = videoType;
    sala.playing = false;
    sala.currentTime = 0;
    io.to(socket.roomCode).emit('video-change', { videoId, videoType });
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
// Resuelve el problema de redirecciones y CORS de Drive
// El servidor actúa de intermediario entre el cliente y Drive
app.get('/api/drive-stream/:fileId', async (req, res) => {
  const { fileId } = req.params;

  // Primero intentar obtener la URL real de stream via Drive API
  // Si no hay token, usar la URL pública directa
  const token = req.query.token || '';

  // URL base de Drive para streaming
  const baseUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const fallbackUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;

  const targetUrl = token ? baseUrl : fallbackUrl;

  const fetchOptions = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(req.headers.range ? { 'Range': req.headers.range } : {}),
    },
    redirect: 'manual', // manejar redirecciones manualmente
  };

  try {
    // Importar node-fetch dinámicamente (compatible con CommonJS)
    let fetchFn;
    try {
      fetchFn = require('node-fetch');
    } catch(e) {
      // node-fetch v3 es ESM, usar https nativo
      fetchFn = null;
    }

    if (!fetchFn) {
      // Usar https nativo de Node.js
      const https = require('https');
      const url = require('url');

      const makeRequest = (reqUrl, redirectCount = 0) => {
        if (redirectCount > 5) {
          res.status(500).send('Demasiadas redirecciones');
          return;
        }

        const parsedUrl = new url.URL(reqUrl);
        const options = {
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          headers: fetchOptions.headers,
        };

        const request = https.request(options, (driveRes) => {
          // Manejar redirecciones
          if ([301, 302, 303, 307, 308].includes(driveRes.statusCode)) {
            const location = driveRes.headers['location'];
            if (location) {
              driveRes.resume(); // consumir respuesta
              makeRequest(location.startsWith('http') ? location : `https://drive.google.com${location}`, redirectCount + 1);
              return;
            }
          }

          // Verificar si es HTML (página de confirmación de Drive)
          const ct = driveRes.headers['content-type'] || '';
          if (ct.includes('text/html')) {
            let html = '';
            driveRes.on('data', chunk => html += chunk);
            driveRes.on('end', () => {
              // Buscar la URL de confirmación en el HTML
              const match = html.match(/action="(\/uc[^"]+)"/);
              if (match) {
                const confirmUrl = 'https://drive.google.com' + match[1].replace(/&amp;/g, '&') + '&confirm=t';
                makeRequest(confirmUrl, redirectCount + 1);
              } else {
                res.status(403).send('Acceso denegado. Asegúrate de que el archivo sea público en Drive.');
              }
            });
            return;
          }

          // Stream del video al cliente
          res.status(driveRes.statusCode || 200);
          const allowedHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified'];
          allowedHeaders.forEach(h => {
            if (driveRes.headers[h]) res.setHeader(h, driveRes.headers[h]);
          });
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'no-store');
          driveRes.pipe(res);
        });

        request.on('error', (err) => {
          console.error('Drive proxy error:', err);
          if (!res.headersSent) res.status(500).send('Error al conectar con Drive');
        });

        request.end();
      };

      makeRequest(targetUrl);
    }
  } catch (err) {
    console.error('Drive stream error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SyncRoom corriendo en http://localhost:${PORT}`));

