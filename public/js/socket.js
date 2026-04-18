/* ================================
   SyncRoom — Conexión Socket.IO
   ================================ */

// Estado global del socket (sin localStorage)
const socketState = {
  socket: null,
  roomCode: null,
  userName: null,
  avatarSeed: null,
  isHost: false,
  latency: 0
};

/**
 * Inicializa la conexión Socket.IO y une al usuario a la sala.
 */
function initSocket({ roomCode, userName, avatarSeed, isHost, onRoomState, onUserJoined, onUserLeft, onHostLeft, onSystemMessage, onChatMessage, onVideoPlay, onVideoPause, onVideoSeek, onVideoChange, onSyncResponse }) {
  const socket = io();
  socketState.socket = socket;
  socketState.roomCode = roomCode;
  socketState.userName = userName;
  socketState.avatarSeed = avatarSeed;
  socketState.isHost = isHost;

  // Medir latencia al conectar
  socket.on('connect', () => {
    const start = Date.now();
    socket.emit('ping-check');
    socket.once('pong-check', () => {
      socketState.latency = (Date.now() - start) / 2;
      console.log(`Latencia: ${socketState.latency}ms`);
    });

    socket.emit('join-room', { roomCode, userName, avatarSeed, isHost });
  });

  // Reconexión automática
  socket.on('reconnect', () => {
    showToast('🔄 Reconectado a la sala', 'success');
    socket.emit('join-room', { roomCode, userName, avatarSeed, isHost });
  });

  socket.on('disconnect', () => {
    showToast('⚠️ Conexión perdida, reconectando...', 'error');
  });

  // --- Eventos de sala ---
  socket.on('room-state', (state) => onRoomState && onRoomState(state));
  socket.on('user-joined', (data) => onUserJoined && onUserJoined(data));
  socket.on('user-left', (data) => onUserLeft && onUserLeft(data));
  socket.on('host-left', (data) => onHostLeft && onHostLeft(data));
  socket.on('system-message', (msg) => onSystemMessage && onSystemMessage(msg));
  socket.on('sala-llena', (msg) => {
    showToast('❌ La sala está llena', 'error');
    setTimeout(() => window.location.href = '/', 2000);
  });
  socket.on('error-sala', (msg) => {
    showToast(`❌ ${msg}`, 'error');
  });

  // --- Chat ---
  socket.on('chat-message', (data) => onChatMessage && onChatMessage(data));

  // --- Video sync ---
  socket.on('video-play',   (data) => onVideoPlay   && onVideoPlay(data));
  socket.on('video-pause',  (data) => onVideoPause  && onVideoPause(data));
  socket.on('video-seek',   (data) => onVideoSeek   && onVideoSeek(data));
  socket.on('video-change', (data) => onVideoChange && onVideoChange(data));
  // Duración del video Drive enviada por el host
  socket.on('drive-duration', ({ duration }) => {
    if (typeof playerState !== 'undefined') {
      playerState.driveDuration = duration;
    }
  });
  socket.on('sync-response',(data) => onSyncResponse && onSyncResponse(data));

  return socket;
}

// Emitir eventos de video (solo host)
function emitPlay(currentTime) {
  socketState.socket && socketState.socket.emit('video-play', { currentTime });
}

function emitPause(currentTime) {
  socketState.socket && socketState.socket.emit('video-pause', { currentTime });
}

function emitSeek(currentTime) {
  socketState.socket && socketState.socket.emit('video-seek', { currentTime });
}

function emitVideoChange(videoId, videoType) {
  socketState.socket && socketState.socket.emit('video-change', { videoId, videoType });
}

function emitChat(text) {
  socketState.socket && socketState.socket.emit('chat-message', {
    text,
    userName: socketState.userName,
    avatarSeed: socketState.avatarSeed
  });
}

function emitSyncRequest(currentTime) {
  socketState.socket && socketState.socket.emit('sync-request', { currentTime });
}
