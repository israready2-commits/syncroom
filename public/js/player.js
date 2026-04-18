/* ================================
   SyncRoom — Player v3
   Drive: embed iframe + sync por postMessage/señales
   YouTube: IFrame API completa
   ================================ */

const playerState = {
  videoType: null,
  videoId: null,
  isHost: false,
  ignoreEvents: false,
  controlsTimeout: null,
  syncCheckInterval: null,
  onSyncUpdate: null,
  ytPlayer: null,
  // Para Drive: rastreamos tiempo manualmente
  driveStartTime: null,    // Date.now() cuando se dio play
  driveOffset: 0,          // segundos acumulados antes del último play
  drivePlaying: false,
  driveDuration: 7200,     // 2h por defecto (Drive no lo expone)
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

  // Controles: ocultar tras 3s
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

  // Play / Pause
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
    const ratio = (e.clientX - rect.left) / rect.width;
    const t     = ratio * playerState.driveDuration;
    seekLocal(t);
    onSeek && onSeek(t);
  });

  // Volumen (solo YouTube — Drive iframe no lo expone)
  volSlider && volSlider.addEventListener('input', () => {
    if (playerState.ytPlayer) {
      playerState.ytPlayer.setVolume(Number(volSlider.value));
    }
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

  // Actualizar UI cada 500ms
  setInterval(() => {
    updateProgressBar(fillEl, timeEl);
    updatePlayBtn();
  }, 500);

  // El invitado verifica sync cada 5s
  playerState.syncCheckInterval = setInterval(() => {
    if (!playerState.isHost) {
      emitSyncRequest(getCurrentTime());
    }
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
   CARGAR DRIVE
   Usa embed /preview con parámetro t= para seek inicial.
   La sincronización se hace recargando el iframe con el tiempo correcto.
   ======================================================== */
function loadDriveVideo(fileId) {
  playerState.videoType    = 'drive';
  playerState.videoId      = fileId;
  playerState.ytPlayer     = null;
  playerState.drivePlaying = false;
  playerState.driveOffset  = 0;
  playerState.driveStartTime = null;

  const container = document.getElementById('player-inner');
  if (!container) return;

  _renderDriveIframe(fileId, 0);

  document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');
}

function _renderDriveIframe(fileId, startSeconds) {
  const container = document.getElementById('player-inner');
  if (!container) return;

  // El parámetro t= en el embed de Drive hace que empiece en ese segundo
  const t = Math.floor(startSeconds);
  const src = `https://drive.google.com/file/d/${fileId}/preview${t > 0 ? `#t=${t}` : ''}`;

  container.innerHTML = `
    <div style="position:relative;width:100%;height:100%;background:#000;">
      <iframe
        id="drive-iframe"
        src="${src}"
        style="width:100%;height:100%;border:none;display:block;"
        allow="autoplay; fullscreen"
        allowfullscreen
        referrerpolicy="no-referrer-when-downgrade"
      ></iframe>
      ${!playerState.drivePlaying ? `
        <div id="drive-overlay" style="
          position:absolute;inset:0;
          background:rgba(13,13,20,0.75);
          display:flex;flex-direction:column;
          align-items:center;justify-content:center;gap:12px;
          cursor:pointer;
        " onclick="hostClickPlay()">
          <div style="
            width:72px;height:72px;
            background:var(--color-primary);
            border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            box-shadow:0 0 32px var(--color-primary-glow);
          ">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
          </div>
          <span style="color:rgba(255,255,255,0.7);font-size:0.875rem;">
            ${playerState.isHost ? 'Click para reproducir' : 'Esperando que el host reproduzca...'}
          </span>
        </div>
      ` : ''}
    </div>
  `;
}

// El host hace click en el overlay → da play y notifica
function hostClickPlay() {
  if (!playerState.isHost) return;
  const t = playerState.driveOffset;
  playLocal();
  emitPlay(t);
  // Quitar overlay
  const overlay = document.getElementById('drive-overlay');
  if (overlay) overlay.remove();
}

/* ========================================================
   CARGAR YOUTUBE — IFrame API completa
   ======================================================== */
function loadYouTubeVideo(videoId) {
  playerState.videoType = 'youtube';
  playerState.videoId   = videoId;

  const container = document.getElementById('player-inner');
  if (!container) return;

  container.innerHTML = `<div id="yt-player" style="width:100%;height:100%;"></div>`;

  const crearPlayer = () => {
    playerState.ytPlayer = new YT.Player('yt-player', {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { controls: 0, disablekb: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1 },
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
      s.id    = 'yt-api-script';
      s.src   = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
      window.onYouTubeIframeAPIReady = () => (window._ytCallbacks || []).forEach(cb => cb());
    }
  }
}

/* ========================================================
   CONTROLES LOCALES
   ======================================================== */
function playLocal() {
  if (playerState.videoType === 'drive') {
    // Recargar iframe desde el offset actual para forzar autoplay
    playerState.drivePlaying   = true;
    playerState.driveStartTime = Date.now();
    _renderDriveIframe(playerState.videoId, playerState.driveOffset);
    playerState.onSyncUpdate && playerState.onSyncUpdate(true);
  } else if (playerState.ytPlayer) {
    playerState.ytPlayer.playVideo();
  }
}

function pauseLocal() {
  if (playerState.videoType === 'drive') {
    if (playerState.drivePlaying && playerState.driveStartTime) {
      // Acumular tiempo transcurrido
      playerState.driveOffset += (Date.now() - playerState.driveStartTime) / 1000;
    }
    playerState.drivePlaying   = false;
    playerState.driveStartTime = null;
    // Recargar iframe pausado en el segundo actual
    _renderDriveIframe(playerState.videoId, playerState.driveOffset);
  } else if (playerState.ytPlayer) {
    playerState.ytPlayer.pauseVideo();
  }
}

function seekLocal(time) {
  if (playerState.videoType === 'drive') {
    const wasPlaying = playerState.drivePlaying;
    // Actualizar offset al nuevo tiempo
    if (wasPlaying) {
      playerState.drivePlaying   = false;
      playerState.driveStartTime = null;
    }
    playerState.driveOffset = time;
    if (wasPlaying) {
      playerState.drivePlaying   = true;
      playerState.driveStartTime = Date.now();
    }
    _renderDriveIframe(playerState.videoId, time);
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
  if (playerState.videoType === 'drive') {
    if (playerState.drivePlaying && playerState.driveStartTime) {
      return playerState.driveOffset + (Date.now() - playerState.driveStartTime) / 1000;
    }
    return playerState.driveOffset;
  }
  if (playerState.ytPlayer && playerState.ytPlayer.getCurrentTime) {
    return playerState.ytPlayer.getCurrentTime() || 0;
  }
  return 0;
}

function getDuration() {
  if (playerState.videoType === 'drive') return playerState.driveDuration;
  if (playerState.ytPlayer && playerState.ytPlayer.getDuration) return playerState.ytPlayer.getDuration() || 0;
  return 0;
}

function isPlaying() {
  if (playerState.videoType === 'drive') return playerState.drivePlaying;
  if (playerState.ytPlayer && playerState.ytPlayer.getPlayerState) return playerState.ytPlayer.getPlayerState() === 1;
  return false;
}

/* ========================================================
   HANDLERS REMOTOS — recibidos vía socket
   ======================================================== */
function onRemotePlay({ currentTime }) {
  playerState.ignoreEvents = true;
  if (playerState.videoType === 'drive') {
    playerState.driveOffset    = currentTime;
    playerState.drivePlaying   = true;
    playerState.driveStartTime = Date.now();
    _renderDriveIframe(playerState.videoId, currentTime);
    // Quitar overlay si existe
    setTimeout(() => {
      const overlay = document.getElementById('drive-overlay');
      if (overlay) overlay.remove();
    }, 500);
  } else {
    seekLocal(currentTime);
    playLocal();
  }
  setTimeout(() => { playerState.ignoreEvents = false; }, 500);
  playerState.onSyncUpdate && playerState.onSyncUpdate(true);
}

function onRemotePause({ currentTime }) {
  playerState.ignoreEvents = true;
  if (playerState.videoType === 'drive') {
    playerState.driveOffset    = currentTime;
    playerState.drivePlaying   = false;
    playerState.driveStartTime = null;
    _renderDriveIframe(playerState.videoId, currentTime);
  } else {
    seekLocal(currentTime);
    pauseLocal();
  }
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

  if (diff > 3) {
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
  timeEl && (timeEl.textContent = `${formatTime(cur)} / ${formatTime(dur)}`);
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
  const r     = document.createElement('span');
  r.className = 'play-ripple';
  btn.appendChild(r);
  setTimeout(() => r.remove(), 600);
}
