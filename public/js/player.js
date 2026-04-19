/* ================================
   SyncRoom — Player v6
   
   Drive: <video> HTML5 nativo con URL directa.
     - El host pega la URL pública del video de Drive
     - Se carga en un <video> tag con control total JS
     - play/pause/seek funcionan igual que YouTube
   
   YouTube: IFrame API completa.
   ================================ */

const playerState = {
  videoType: null,
  videoId: null,
  isHost: false,
  ignoreEvents: false,
  controlsTimeout: null,
  syncCheckInterval: null,
  onSyncUpdate: null,
  videoEl: null,      // elemento <video> nativo
  ytPlayer: null,     // YT.Player
};

/* ========================================================
   INIT
   ======================================================== */
function initPlayer({ isHost, onPlay, onPause, onSeek, onSyncUpdate }) {
  playerState.isHost       = isHost;
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

  function resetControlsTimer() {
    controls && controls.classList.remove('hidden');
    clearTimeout(playerState.controlsTimeout);
    playerState.controlsTimeout = setTimeout(() => {
      controls && controls.classList.add('hidden');
    }, 3000);
  }
  wrapper && wrapper.addEventListener('mousemove', resetControlsTimer);
  wrapper && wrapper.addEventListener('touchstart', resetControlsTimer, { passive: true });
  resetControlsTimer();

  // Play / Pause — solo host
  playBtn && playBtn.addEventListener('click', () => {
    if (!playerState.isHost) return;
    addRipple(playBtn);
    const t = getCurrentTime();
    if (isPlaying()) {
      pauseLocal();
      onPause && onPause(t);
    } else {
      playLocal();
      onPlay && onPlay(t);
    }
    updatePlayBtn();
  });

  // Rewind 10s
  rewindBtn && rewindBtn.addEventListener('click', () => {
    if (!playerState.isHost) return;
    const t = Math.max(0, getCurrentTime() - 10);
    seekLocal(t);
    onSeek && onSeek(t);
  });

  // Forward 10s
  forwardBtn && forwardBtn.addEventListener('click', () => {
    if (!playerState.isHost) return;
    const t = getCurrentTime() + 10;
    seekLocal(t);
    onSeek && onSeek(t);
  });

  // Barra de progreso
  progressEl && progressEl.addEventListener('click', (e) => {
    if (!playerState.isHost) return;
    const rect  = progressEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const dur   = getDuration();
    if (!dur) return;
    const t = ratio * dur;
    seekLocal(t);
    onSeek && onSeek(t);
  });

  // Volumen
  volSlider && volSlider.addEventListener('input', () => {
    const v = Number(volSlider.value) / 100;
    if (playerState.videoEl) playerState.videoEl.volume = v;
    if (playerState.ytPlayer) playerState.ytPlayer.setVolume(Number(volSlider.value));
  });

  // Fullscreen
  fsBtn && fsBtn.addEventListener('click', () => {
    const el = document.getElementById('watch-container') || document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen && el.requestFullscreen();
    } else {
      document.exitFullscreen && document.exitFullscreen();
    }
  });

  // UI cada 500ms
  setInterval(() => {
    updateProgressBar(fillEl, timeEl);
    updatePlayBtn();
  }, 500);

  // Invitado pide sync cada 5s
  playerState.syncCheckInterval = setInterval(() => {
    if (!playerState.isHost) emitSyncRequest(getCurrentTime());
  }, 5000);

  function updatePlayBtn() {
    if (!playBtn) return;
    playBtn.innerHTML = isPlaying()
      ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
      : `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  }
  updatePlayBtn();
}

/* ========================================================
   DRIVE — <video> HTML5 nativo
   
   Recibe la URL directa del video. El host la obtiene así:
   1. Abre el video en Drive
   2. Click en ⋮ → "Obtener enlace" → "Cualquiera con el enlace"
   3. Copia el link y lo pega en SyncRoom
   
   Convertimos el link de Drive a URL de descarga directa.
   ======================================================== */
function loadDriveVideo(fileId) {
  playerState.videoType = 'drive';
  playerState.videoId   = fileId;
  playerState.ytPlayer  = null;

  // Si fileId es una URL completa, extraer el ID
  const extractedId = _extractDriveId(fileId);
  if (extractedId) playerState.videoId = extractedId;

  const container = document.getElementById('player-inner');
  if (!container) return;

  // URL de stream progresivo de Drive (funciona para archivos públicos)
  const videoUrl = `https://drive.google.com/uc?export=download&id=${playerState.videoId}&confirm=t`;

  container.innerHTML = `
    <video
      id="native-video"
      style="width:100%;height:100%;background:#000;display:block;outline:none;"
      playsinline
      preload="auto"
      crossorigin="anonymous"
    >
      <source src="${videoUrl}" type="video/mp4">
    </video>
  `;

  const video = document.getElementById('native-video');
  playerState.videoEl = video;

  // Ocultar loading cuando el video tenga metadata
  video.addEventListener('loadedmetadata', () => {
    document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');
  });

  // Si falla la carga directa → mostrar mensaje claro
  video.addEventListener('error', (e) => {
    console.error('[SyncRoom] Error cargando video de Drive:', e);
    document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');
    _mostrarErrorDrive(playerState.videoId);
  });

  // Eventos nativos → socket (solo host, solo si no es sync remota)
  video.addEventListener('play', () => {
    if (playerState.ignoreEvents || !playerState.isHost) return;
    emitPlay(video.currentTime);
    playerState.onSyncUpdate && playerState.onSyncUpdate(true);
  });

  video.addEventListener('pause', () => {
    if (playerState.ignoreEvents || !playerState.isHost) return;
    emitPause(video.currentTime);
  });

  video.addEventListener('seeked', () => {
    if (playerState.ignoreEvents || !playerState.isHost) return;
    emitSeek(video.currentTime);
  });
}

function _mostrarErrorDrive(fileId) {
  const container = document.getElementById('player-inner');
  if (!container) return;
  container.innerHTML = `
    <div style="
      width:100%;height:100%;
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      gap:16px;padding:24px;text-align:center;
      background:#0D0D14;
    ">
      <div style="font-size:2rem;">⚠️</div>
      <div style="color:#EEEEF2;font-size:1rem;font-weight:600;font-family:var(--font-display);">
        No se pudo cargar el video de Drive
      </div>
      <div style="color:#7A7A8C;font-size:0.8125rem;max-width:340px;line-height:1.6;">
        El video debe estar compartido como <strong style="color:#9B7FD4;">"Cualquiera con el enlace puede ver"</strong> en Google Drive.<br><br>
        Alternativamente, usa <strong style="color:#FF0000;">YouTube</strong> para reproducción sin restricciones.
      </div>
      <a
        href="https://drive.google.com/file/d/${fileId}/view"
        target="_blank"
        style="
          padding:10px 20px;
          background:var(--color-primary);
          color:#fff;border-radius:10px;
          font-size:0.875rem;text-decoration:none;
        "
      >Abrir en Drive para verificar →</a>
    </div>
  `;
}

function _extractDriveId(input) {
  if (!input) return null;
  // Si ya es un ID simple (no URL)
  if (/^[a-zA-Z0-9_-]{25,}$/.test(input.trim())) return input.trim();
  // Extraer ID de distintos formatos de URL de Drive
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /id=([a-zA-Z0-9_-]+)/,
    /open\?id=([a-zA-Z0-9_-]+)/,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1];
  }
  return null;
}

/* ========================================================
   YOUTUBE — IFrame API
   ======================================================== */
function loadYouTubeVideo(videoId) {
  playerState.videoType = 'youtube';
  playerState.videoId   = videoId;
  playerState.videoEl   = null;

  const container = document.getElementById('player-inner');
  if (!container) return;
  container.innerHTML = `<div id="yt-player" style="width:100%;height:100%;"></div>`;

  const crearPlayer = () => {
    playerState.ytPlayer = new YT.Player('yt-player', {
      videoId,
      width: '100%', height: '100%',
      playerVars: {
        controls: 0, disablekb: 1, rel: 0,
        modestbranding: 1, iv_load_policy: 3, playsinline: 1,
      },
      events: {
        onReady(e) {
          e.target.setVolume(80);
          document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');
        },
        onStateChange(e) {
          if (playerState.ignoreEvents || !playerState.isHost) return;
          const t = playerState.ytPlayer.getCurrentTime();
          if (e.data === YT.PlayerState.PLAYING) {
            emitPlay(t);
            playerState.onSyncUpdate && playerState.onSyncUpdate(true);
          }
          if (e.data === YT.PlayerState.PAUSED) {
            emitPause(t);
          }
        }
      }
    });
  };

  if (window.YT && window.YT.Player) {
    crearPlayer();
  } else {
    window._ytCallbacks = window._ytCallbacks || [];
    window._ytCallbacks.push(crearPlayer);
    if (!document.getElementById('yt-api-script')) {
      const s = document.createElement('script');
      s.id = 'yt-api-script';
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
      window.onYouTubeIframeAPIReady = () => (window._ytCallbacks || []).forEach(cb => cb());
    }
  }
}

/* ========================================================
   CONTROLES LOCALES
   ======================================================== */
function playLocal() {
  if (playerState.videoEl) {
    playerState.videoEl.play().catch(console.warn);
  } else if (playerState.ytPlayer) {
    playerState.ytPlayer.playVideo();
  }
}

function pauseLocal() {
  if (playerState.videoEl) {
    playerState.videoEl.pause();
  } else if (playerState.ytPlayer) {
    playerState.ytPlayer.pauseVideo();
  }
}

function seekLocal(time) {
  if (playerState.videoEl) {
    playerState.videoEl.currentTime = Math.max(0, time);
  } else if (playerState.ytPlayer) {
    playerState.ytPlayer.seekTo(time, true);
  }
}

// Alias para compatibilidad con onHostLeft en room.html
function pauseVideo() { pauseLocal(); }

/* ========================================================
   GETTERS
   ======================================================== */
function getCurrentTime() {
  if (playerState.videoEl) return playerState.videoEl.currentTime || 0;
  if (playerState.ytPlayer && playerState.ytPlayer.getCurrentTime) {
    return playerState.ytPlayer.getCurrentTime() || 0;
  }
  return 0;
}

function getDuration() {
  if (playerState.videoEl) return playerState.videoEl.duration || 0;
  if (playerState.ytPlayer && playerState.ytPlayer.getDuration) {
    return playerState.ytPlayer.getDuration() || 0;
  }
  return 0;
}

function isPlaying() {
  if (playerState.videoEl) {
    return !playerState.videoEl.paused && !playerState.videoEl.ended;
  }
  if (playerState.ytPlayer && playerState.ytPlayer.getPlayerState) {
    return playerState.ytPlayer.getPlayerState() === 1;
  }
  return false;
}

/* ========================================================
   HANDLERS REMOTOS — recibidos vía socket
   ignoreEvents evita el loop: aplicar → evento nativo → re-emitir
   ======================================================== */
function onRemotePlay({ currentTime }) {
  playerState.ignoreEvents = true;
  seekLocal(currentTime);
  playLocal();
  setTimeout(() => { playerState.ignoreEvents = false; }, 500);
  playerState.onSyncUpdate && playerState.onSyncUpdate(true);
}

function onRemotePause({ currentTime }) {
  playerState.ignoreEvents = true;
  seekLocal(currentTime);
  pauseLocal();
  setTimeout(() => { playerState.ignoreEvents = false; }, 500);
}

function onRemoteSeek({ currentTime }) {
  playerState.ignoreEvents = true;
  seekLocal(currentTime);
  setTimeout(() => { playerState.ignoreEvents = false; }, 500);
}

function applySyncResponse({ currentTime, serverTimestamp }) {
  const lag        = (Date.now() - serverTimestamp) / 1000;
  const targetTime = currentTime + lag + ((socketState.latency || 0) / 1000);
  const diff       = Math.abs(targetTime - getCurrentTime());
  if (diff > 2) {
    playerState.ignoreEvents = true;
    seekLocal(targetTime);
    setTimeout(() => { playerState.ignoreEvents = false; }, 500);
    playerState.onSyncUpdate && playerState.onSyncUpdate(false);
    showToast('🔄 Re-sincronizando...', 'info', 1500);
  } else {
    playerState.onSyncUpdate && playerState.onSyncUpdate(true);
  }
}

/* ========================================================
   UI
   ======================================================== */
function updateProgressBar(fillEl, timeEl) {
  const dur = getDuration();
  const cur = getCurrentTime();
  const pct = dur > 0 ? Math.min((cur / dur) * 100, 100) : 0;
  fillEl && (fillEl.style.width = `${pct}%`);
  timeEl && (timeEl.textContent = dur > 0
    ? `${formatTime(cur)} / ${formatTime(dur)}`
    : formatTime(cur));
}

function formatTime(secs) {
  if (!secs || isNaN(secs)) return '00:00';
  const s  = Math.floor(secs);
  const m  = Math.floor(s / 60);
  const h  = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function addRipple(btn) {
  const r = document.createElement('span');
  r.className = 'play-ripple';
  btn.appendChild(r);
  setTimeout(() => r.remove(), 600);
}
