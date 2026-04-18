/* ================================
   SyncRoom — Player v4
   Drive: embed iframe + capa de intercepción + reloj manual
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
  // Reloj manual para Drive (el iframe no expone currentTime)
  driveStartTime: null,   // Date.now() del último play
  driveOffset: 0,         // segundos acumulados antes del último play
  drivePlaying: false,
  driveDuration: 7200,    // 2h por defecto
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

  // Ocultar controles tras 3s de inactividad
  function resetControlsTimer() {
    controls && controls.classList.remove('hidden');
    clearTimeout(playerState.controlsTimeout);
    playerState.controlsTimeout = setTimeout(() => {
      controls && controls.classList.add('hidden');
    }, 3000);
  }
  wrapper && wrapper.addEventListener('mousemove', resetControlsTimer);
  wrapper && wrapper.addEventListener('touchstart', resetControlsTimer, { passive: true });
  // La capa de intercepción también reactiva los controles
  document.addEventListener('click', (e) => {
    if (e.target.id === 'drive-intercept') resetControlsTimer();
  });
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

  // Barra de progreso — solo host
  progressEl && progressEl.addEventListener('click', (e) => {
    if (!playerState.isHost) return;
    const rect  = progressEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t     = ratio * getDuration();
    seekLocal(t);
    onSeek && onSeek(t);
  });

  // Volumen (solo YouTube)
  volSlider && volSlider.addEventListener('input', () => {
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

  // Actualizar barra de progreso cada 500ms
  setInterval(() => {
    updateProgressBar(fillEl, timeEl);
    updatePlayBtn();
  }, 500);

  // Invitado verifica sync cada 5s
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
   DRIVE — embed iframe con capa de intercepción

   La capa transparente (#drive-intercept) se pone ENCIMA del
   iframe. Esto hace que:
   - El iframe cargue y reproduzca el video normalmente
   - Ningún click llegue al iframe (el usuario no puede usar
     los controles nativos de Drive)
   - Nuestros controles custom son los únicos que funcionan
   ======================================================== */
function loadDriveVideo(fileId) {
  playerState.videoType      = 'drive';
  playerState.videoId        = fileId;
  playerState.ytPlayer       = null;
  playerState.drivePlaying   = false;
  playerState.driveOffset    = 0;
  playerState.driveStartTime = null;

  _buildDrivePlayer(fileId, 0, false);
  document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');
}

function _buildDrivePlayer(fileId, startSecs, autoplay) {
  const container = document.getElementById('player-inner');
  if (!container) return;

  const t   = Math.floor(Math.max(0, startSecs));
  // El #t= en el embed hace que Drive empiece desde ese segundo
  const src = `https://drive.google.com/file/d/${fileId}/preview${t > 0 ? `#t=${t}` : ''}`;

  container.innerHTML = `
    <div style="position:relative;width:100%;height:100%;background:#000;overflow:hidden;">

      <!-- El iframe reproduce el video -->
      <iframe
        id="drive-iframe"
        src="${src}"
        style="
          position:absolute;
          /* Agrandar el iframe para ocultar la barra de controles
             nativa de Drive que aparece en la parte inferior */
          top: -4px;
          left: 0;
          width: 100%;
          height: calc(100% + 60px);
          border: none;
          pointer-events: none;
        "
        allow="autoplay; fullscreen"
        allowfullscreen
        referrerpolicy="no-referrer-when-downgrade"
      ></iframe>

      <!-- Capa transparente que intercepta TODOS los clicks
           impidiendo que lleguen al iframe de Drive -->
      <div
        id="drive-intercept"
        style="
          position:absolute;
          inset:0;
          z-index:5;
          cursor:default;
          /* Sin background para que sea invisible */
        "
      ></div>

      <!-- Pantalla de pausa: visible cuando está pausado -->
      <div id="drive-pause-overlay" style="
        display: ${autoplay ? 'none' : 'flex'};
        position:absolute;
        inset:0;
        z-index:6;
        background: rgba(13,13,20,0.6);
        align-items:center;
        justify-content:center;
        flex-direction:column;
        gap:12px;
        pointer-events:none;
      ">
        <div style="
          width:80px;height:80px;
          background:var(--color-primary);
          border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 0 40px var(--color-primary-glow);
          opacity:0.95;
        ">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
        </div>
        <span style="color:rgba(255,255,255,0.8);font-size:0.9rem;font-family:var(--font-body);">
          ${playerState.isHost ? 'Presiona ▶ para reproducir' : 'Esperando al host...'}
        </span>
      </div>

    </div>
  `;
}

function _showDrivePauseOverlay(show) {
  const overlay = document.getElementById('drive-pause-overlay');
  if (overlay) overlay.style.display = show ? 'flex' : 'none';
}

/* ========================================================
   YOUTUBE — IFrame API
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
      width: '100%', height: '100%',
      playerVars: { controls: 0, disablekb: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1 },
      events: {
        onReady(e) {
          e.target.setVolume(80);
          document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');
        },
        onStateChange(e) {
          if (playerState.ignoreEvents || !playerState.isHost) return;
          const t = playerState.ytPlayer.getCurrentTime();
          if (e.data === YT.PlayerState.PLAYING)  { emitPlay(t);  playerState.onSyncUpdate && playerState.onSyncUpdate(true); }
          if (e.data === YT.PlayerState.PAUSED)   { emitPause(t); }
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
  if (playerState.videoType === 'drive') {
    const t = getCurrentTime();
    playerState.driveOffset    = t;
    playerState.drivePlaying   = true;
    playerState.driveStartTime = Date.now();
    // Reconstruir iframe con autoplay en el segundo correcto
    _buildDrivePlayer(playerState.videoId, t, true);
    _showDrivePauseOverlay(false);
    playerState.onSyncUpdate && playerState.onSyncUpdate(true);
  } else if (playerState.ytPlayer) {
    playerState.ytPlayer.playVideo();
  }
}

function pauseLocal() {
  if (playerState.videoType === 'drive') {
    if (playerState.drivePlaying && playerState.driveStartTime) {
      playerState.driveOffset += (Date.now() - playerState.driveStartTime) / 1000;
    }
    playerState.drivePlaying   = false;
    playerState.driveStartTime = null;
    // Reconstruir iframe pausado en el segundo actual
    _buildDrivePlayer(playerState.videoId, playerState.driveOffset, false);
    _showDrivePauseOverlay(true);
  } else if (playerState.ytPlayer) {
    playerState.ytPlayer.pauseVideo();
  }
}

function seekLocal(time) {
  if (playerState.videoType === 'drive') {
    const wasPlaying = playerState.drivePlaying;
    playerState.driveOffset    = Math.max(0, time);
    playerState.driveStartTime = wasPlaying ? Date.now() : null;
    _buildDrivePlayer(playerState.videoId, playerState.driveOffset, wasPlaying);
    _showDrivePauseOverlay(!wasPlaying);
  } else if (playerState.ytPlayer) {
    playerState.ytPlayer.seekTo(time, true);
  }
}

// Alias para compatibilidad con onHostLeft
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
  if (playerState.ytPlayer && playerState.ytPlayer.getCurrentTime) return playerState.ytPlayer.getCurrentTime() || 0;
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
   HANDLERS REMOTOS — vía socket
   ======================================================== */
function onRemotePlay({ currentTime }) {
  playerState.ignoreEvents   = true;
  playerState.driveOffset    = currentTime;
  playerState.drivePlaying   = true;
  playerState.driveStartTime = Date.now();
  if (playerState.videoType === 'drive') {
    _buildDrivePlayer(playerState.videoId, currentTime, true);
    _showDrivePauseOverlay(false);
  } else {
    seekLocal(currentTime);
    if (playerState.ytPlayer) playerState.ytPlayer.playVideo();
  }
  setTimeout(() => { playerState.ignoreEvents = false; }, 500);
  playerState.onSyncUpdate && playerState.onSyncUpdate(true);
}

function onRemotePause({ currentTime }) {
  playerState.ignoreEvents   = true;
  playerState.driveOffset    = currentTime;
  playerState.drivePlaying   = false;
  playerState.driveStartTime = null;
  if (playerState.videoType === 'drive') {
    _buildDrivePlayer(playerState.videoId, currentTime, false);
    _showDrivePauseOverlay(true);
  } else {
    seekLocal(currentTime);
    if (playerState.ytPlayer) playerState.ytPlayer.pauseVideo();
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
   UI helpers
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
  const r = document.createElement('span');
  r.className = 'play-ripple';
  btn.appendChild(r);
  setTimeout(() => r.remove(), 600);
}
