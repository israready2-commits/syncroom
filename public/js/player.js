/* ================================
   SyncRoom — Módulo del Player
   ================================ */

const playerState = {
  iframe: null,
  ytPlayer: null,
  videoType: null,       // 'drive' | 'youtube'
  videoId: null,
  duration: 0,
  currentTime: 0,
  playing: false,
  isHost: false,
  iframeReady: false,
  controlsTimeout: null,
  syncCheckInterval: null,
  onSyncUpdate: null     // callback para actualizar el badge de sync
};

/**
 * Inicializa el player.
 */
function initPlayer({ isHost, onPlay, onPause, onSeek, onSyncUpdate }) {
  playerState.isHost = isHost;
  playerState.onSyncUpdate = onSyncUpdate;

  const wrapper    = document.getElementById('player-wrapper');
  const controls   = document.getElementById('player-controls');
  const playBtn    = document.getElementById('ctrl-play');
  const rewindBtn  = document.getElementById('ctrl-rewind');
  const forwardBtn = document.getElementById('ctrl-forward');
  const progressEl = document.getElementById('progress-bar');
  const fillEl     = document.getElementById('progress-fill');
  const timeEl     = document.getElementById('time-display');
  const volSlider  = document.getElementById('vol-slider');
  const fsBtn      = document.getElementById('ctrl-fs');

  // Mostrar/ocultar controles tras inactividad
  function resetControlsTimer() {
    controls && controls.classList.remove('hidden');
    clearTimeout(playerState.controlsTimeout);
    playerState.controlsTimeout = setTimeout(() => {
      controls && controls.classList.add('hidden');
    }, 3000);
  }

  wrapper && wrapper.addEventListener('mousemove', resetControlsTimer);
  wrapper && wrapper.addEventListener('touchstart', resetControlsTimer);
  resetControlsTimer();

  // Botón play/pause
  playBtn && playBtn.addEventListener('click', () => {
    if (!playerState.isHost) return; // Solo el host controla
    addRipple(playBtn);

    if (playerState.playing) {
      pauseVideo();
      onPause && onPause(playerState.currentTime);
    } else {
      playVideo();
      onPlay && onPlay(playerState.currentTime);
    }
  });

  // Rewind / Forward
  rewindBtn && rewindBtn.addEventListener('click', () => {
    if (!playerState.isHost) return;
    const newTime = Math.max(0, playerState.currentTime - 10);
    seekTo(newTime);
    onSeek && onSeek(newTime);
  });

  forwardBtn && forwardBtn.addEventListener('click', () => {
    if (!playerState.isHost) return;
    const newTime = playerState.currentTime + 10;
    seekTo(newTime);
    onSeek && onSeek(newTime);
  });

  // Barra de progreso
  progressEl && progressEl.addEventListener('click', (e) => {
    if (!playerState.isHost) return;
    const rect = progressEl.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const newTime = ratio * (playerState.duration || 0);
    seekTo(newTime);
    onSeek && onSeek(newTime);
  });

  // Volumen
  volSlider && volSlider.addEventListener('input', () => {
    setVolume(Number(volSlider.value) / 100);
  });

  // Pantalla completa
  fsBtn && fsBtn.addEventListener('click', () => {
    const el = document.getElementById('watch-container') || document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen && el.requestFullscreen();
    } else {
      document.exitFullscreen && document.exitFullscreen();
    }
  });

  // Actualizar UI del progreso
  setInterval(() => {
    updateProgress();
  }, 500);

  // Verificar sync cada 5 segundos
  playerState.syncCheckInterval = setInterval(() => {
    if (!playerState.isHost) {
      emitSyncRequest(playerState.currentTime);
    }
  }, 5000);

  function updateProgress() {
    if (!playerState.duration) return;
    const ratio = (playerState.currentTime / playerState.duration) * 100;
    fillEl && (fillEl.style.width = `${ratio}%`);
    timeEl && (timeEl.textContent = `${formatTime(playerState.currentTime)} / ${formatTime(playerState.duration)}`);
    updatePlayBtn();
  }

  function updatePlayBtn() {
    if (!playBtn) return;
    playBtn.innerHTML = playerState.playing
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  }

  updatePlayBtn();
}

/**
 * Carga un video de Google Drive.
 */
function loadDriveVideo(fileId) {
  playerState.videoId = fileId;
  playerState.videoType = 'drive';
  playerState.playing = false;
  playerState.currentTime = 0;

  const container = document.getElementById('player-inner');
  if (!container) return;

  container.innerHTML = `
    <iframe
      id="drive-iframe"
      src="https://drive.google.com/file/d/${fileId}/preview"
      width="100%" height="100%"
      allow="autoplay; fullscreen"
      allowfullscreen
      frameborder="0"
      style="border:none; width:100%; height:100%;"
    ></iframe>
  `;

  playerState.iframe = document.getElementById('drive-iframe');
  playerState.iframeReady = true;
  playerState.duration = 0; // Drive no expone duración directamente

  // Estimación de duración (placeholder)
  playerState.duration = 3600; // 1 hora por defecto
  document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');
}

/**
 * Carga un video de YouTube.
 */
function loadYouTubeVideo(videoId) {
  playerState.videoId = videoId;
  playerState.videoType = 'youtube';
  playerState.playing = false;
  playerState.currentTime = 0;

  const container = document.getElementById('player-inner');
  if (!container) return;

  container.innerHTML = `<div id="yt-player" style="width:100%;height:100%;"></div>`;

  if (window.YT && window.YT.Player) {
    crearYTPlayer(videoId);
  } else {
    window.onYouTubeIframeAPIReady = () => crearYTPlayer(videoId);
    if (!document.getElementById('yt-api-script')) {
      const script = document.createElement('script');
      script.id = 'yt-api-script';
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  }
}

function crearYTPlayer(videoId) {
  playerState.ytPlayer = new YT.Player('yt-player', {
    videoId,
    playerVars: { controls: 0, disablekb: 1, rel: 0, modestbranding: 1 },
    events: {
      onReady(e) {
        playerState.duration = e.target.getDuration();
        document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');
      },
      onStateChange(e) {
        if (e.data === YT.PlayerState.PLAYING) {
          playerState.playing = true;
          playerState.currentTime = playerState.ytPlayer.getCurrentTime();
          if (playerState.isHost) emitPlay(playerState.currentTime);
        }
        if (e.data === YT.PlayerState.PAUSED) {
          playerState.playing = false;
          playerState.currentTime = playerState.ytPlayer.getCurrentTime();
          if (playerState.isHost) emitPause(playerState.currentTime);
        }
      }
    }
  });

  // Actualizar currentTime
  setInterval(() => {
    if (playerState.ytPlayer && playerState.ytPlayer.getCurrentTime) {
      playerState.currentTime = playerState.ytPlayer.getCurrentTime();
    }
  }, 500);
}

// --- Controles de video ---

function playVideo() {
  playerState.playing = true;
  if (playerState.videoType === 'youtube' && playerState.ytPlayer) {
    playerState.ytPlayer.playVideo();
  }
  // Drive iframe: no tenemos control directo de play nativo, pero enviamos sync
}

function pauseVideo() {
  playerState.playing = false;
  if (playerState.videoType === 'youtube' && playerState.ytPlayer) {
    playerState.ytPlayer.pauseVideo();
  }
}

function seekTo(time) {
  playerState.currentTime = time;
  if (playerState.videoType === 'youtube' && playerState.ytPlayer) {
    playerState.ytPlayer.seekTo(time, true);
  }
}

function setVolume(vol) {
  if (playerState.videoType === 'youtube' && playerState.ytPlayer) {
    playerState.ytPlayer.setVolume(vol * 100);
  }
}

/**
 * Aplicar sincronización recibida del servidor.
 */
function applySyncResponse({ currentTime, serverTimestamp }) {
  const lag = (Date.now() - serverTimestamp) / 1000;
  const targetTime = currentTime + lag + (socketState.latency / 1000);
  const diff = Math.abs(targetTime - playerState.currentTime);

  if (diff > 2) {
    // Fuera de sync → corregir
    seekTo(targetTime);
    showToast('🔄 Sincronizando...', 'info', 1500);
    playerState.onSyncUpdate && playerState.onSyncUpdate(false);
  } else {
    playerState.onSyncUpdate && playerState.onSyncUpdate(true);
  }
}

// --- Handlers para eventos de socket ---

function onRemotePlay({ currentTime }) {
  playerState.currentTime = currentTime;
  seekTo(currentTime);
  playVideo();
  playerState.onSyncUpdate && playerState.onSyncUpdate(true);
}

function onRemotePause({ currentTime }) {
  playerState.currentTime = currentTime;
  seekTo(currentTime);
  pauseVideo();
}

function onRemoteSeek({ currentTime }) {
  playerState.currentTime = currentTime;
  seekTo(currentTime);
}

// --- Helpers ---

function formatTime(secs) {
  const s = Math.floor(secs);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function addRipple(btn) {
  const ripple = document.createElement('span');
  ripple.className = 'play-ripple';
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
}
