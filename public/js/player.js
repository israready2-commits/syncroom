/* ================================
   SyncRoom — Player v5
   Drive: iframe único + overlay de pausa visual + reloj manual
   El iframe se carga UNA SOLA VEZ. El primer click del usuario
   activa el autoplay. Desde ahí nuestros controles manejan todo.
   YouTube: IFrame API completa con control total.
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
  // Reloj manual para Drive
  driveStartTime: null,
  driveOffset: 0,
  drivePlaying: false,
  driveDuration: 0,        // se llena cuando el host la ingresa, o queda en 0
  driveActivated: false,   // true después del primer click del usuario
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

  // Play / Pause
  playBtn && playBtn.addEventListener('click', () => {
    if (!playerState.isHost) return;
    addRipple(playBtn);

    // Si Drive aún no fue activado por el usuario, mostrar instrucción
    if (playerState.videoType === 'drive' && !playerState.driveActivated) {
      _mostrarInstruccionClick();
      return;
    }

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
    if (playerState.videoType === 'drive' && playerState.driveDuration === 0) return;
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

  // UI cada 500ms
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
   DRIVE — carga el iframe UNA SOLA VEZ
   El primer click en el overlay activa el autoplay del navegador.
   Después de eso, nuestro overlay de pausa es puramente visual —
   el iframe sigue corriendo debajo pero tapado.
   ======================================================== */
function loadDriveVideo(fileId) {
  playerState.videoType      = 'drive';
  playerState.videoId        = fileId;
  playerState.ytPlayer       = null;
  playerState.drivePlaying   = false;
  playerState.driveOffset    = 0;
  playerState.driveStartTime = null;
  playerState.driveActivated = false;
  playerState.driveDuration  = 0;

  const container = document.getElementById('player-inner');
  if (!container) return;

  container.innerHTML = `
    <div id="drive-wrap" style="position:relative;width:100%;height:100%;background:#000;overflow:hidden;">

      <!-- Iframe: cargado una sola vez, sin pointer-events para que
           el usuario no pueda usar los controles nativos de Drive -->
      <iframe
        id="drive-iframe"
        src="https://drive.google.com/file/d/${fileId}/preview"
        style="
          position:absolute;
          top:-4px; left:0;
          width:100%;
          height:calc(100% + 64px);
          border:none;
          pointer-events:none;
        "
        allow="autoplay; fullscreen"
        allowfullscreen
        referrerpolicy="no-referrer-when-downgrade"
      ></iframe>

      <!-- Capa de intercepción: bloquea clicks hacia el iframe -->
      <div id="drive-intercept" style="position:absolute;inset:0;z-index:5;"></div>

      <!-- Overlay de activación: primer click del usuario.
           Necesario por la política de autoplay del navegador. -->
      <div id="drive-activate-overlay" style="
        position:absolute;inset:0;z-index:10;
        background:rgba(13,13,20,0.82);
        display:flex;flex-direction:column;
        align-items:center;justify-content:center;gap:16px;
        cursor:pointer;
      ">
        <div style="
          width:88px;height:88px;
          background:var(--color-primary);
          border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 0 48px var(--color-primary-glow);
        ">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
        </div>
        <div style="text-align:center;">
          <div style="color:#fff;font-size:1rem;font-weight:600;font-family:var(--font-display);margin-bottom:4px;">
            Click para activar el video
          </div>
          <div style="color:rgba(255,255,255,0.5);font-size:0.8rem;">
            Requerido por el navegador para permitir reproducción
          </div>
        </div>
      </div>

      <!-- Overlay de pausa visual (aparece cuando el host pausa) -->
      <div id="drive-pause-overlay" style="
        display:none;
        position:absolute;inset:0;z-index:8;
        background:rgba(13,13,20,0.7);
        align-items:center;justify-content:center;
        pointer-events:none;
      ">
        <div style="
          width:72px;height:72px;
          background:rgba(124,92,191,0.9);
          border-radius:50%;
          display:flex;align-items:center;justify-content:center;
        ">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
        </div>
      </div>

    </div>
  `;

  document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');

  // El overlay de activación espera el primer click del usuario
  const activateOverlay = document.getElementById('drive-activate-overlay');
  activateOverlay.addEventListener('click', () => {
    _activateDrive();
  });
}

function _activateDrive() {
  // Dar pointer-events al iframe temporalmente para que el navegador
  // registre la interacción del usuario y permita el autoplay
  const iframe = document.getElementById('drive-iframe');
  const overlay = document.getElementById('drive-activate-overlay');

  if (!iframe || !overlay) return;

  // Quitar overlay de activación
  overlay.style.display = 'none';

  // Habilitar pointer-events en el iframe brevemente para que
  // el navegador registre el click y permita autoplay
  iframe.style.pointerEvents = 'auto';

  // Simular click en el centro del iframe (activa el play de Drive)
  // y volver a quitar pointer-events después
  setTimeout(() => {
    iframe.style.pointerEvents = 'none';
    playerState.driveActivated = true;

    // Si es host: arrancar el reloj y emitir play
    if (playerState.isHost) {
      playerState.driveOffset    = 0;
      playerState.drivePlaying   = true;
      playerState.driveStartTime = Date.now();
      emitPlay(0);
      playerState.onSyncUpdate && playerState.onSyncUpdate(true);

      // Mostrar input de duración para que el host la ingrese
      _mostrarInputDuracion();
    }
    // Si es invitado: el reloj arrancará cuando llegue el evento play del host
  }, 300);
}

function _mostrarInputDuracion() {
  // Pequeño toast-panel para que el host ingrese la duración del video
  const existing = document.getElementById('duration-input-panel');
  if (existing) return;

  const panel = document.createElement('div');
  panel.id = 'duration-input-panel';
  panel.style.cssText = `
    position:fixed;bottom:90px;left:50%;transform:translateX(-50%);
    background:var(--color-surface-2);border:1px solid var(--color-border);
    border-radius:12px;padding:12px 16px;
    display:flex;align-items:center;gap:10px;
    z-index:1000;font-size:0.8125rem;color:var(--color-text-muted);
    box-shadow:0 4px 24px rgba(0,0,0,0.4);
  `;
  panel.innerHTML = `
    <span>Duración del video:</span>
    <input id="dur-h" type="number" min="0" max="10" placeholder="h"
      style="width:36px;padding:4px 6px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);text-align:center;">
    <span style="opacity:0.4;">h</span>
    <input id="dur-m" type="number" min="0" max="59" placeholder="m"
      style="width:40px;padding:4px 6px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);text-align:center;">
    <span style="opacity:0.4;">m</span>
    <input id="dur-s" type="number" min="0" max="59" placeholder="s"
      style="width:40px;padding:4px 6px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);text-align:center;">
    <span style="opacity:0.4;">s</span>
    <button onclick="_guardarDuracion()" style="
      padding:5px 12px;background:var(--color-primary);color:#fff;
      border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;
    ">OK</button>
    <button onclick="document.getElementById('duration-input-panel').remove()" style="
      padding:5px 8px;background:transparent;color:var(--color-text-muted);
      border:none;cursor:pointer;font-size:1rem;
    ">✕</button>
  `;
  document.body.appendChild(panel);
}

function _guardarDuracion() {
  const h = parseInt(document.getElementById('dur-h').value) || 0;
  const m = parseInt(document.getElementById('dur-m').value) || 0;
  const s = parseInt(document.getElementById('dur-s').value) || 0;
  const total = h * 3600 + m * 60 + s;
  if (total > 0) {
    playerState.driveDuration = total;
    // Emitir la duración a los invitados
    socketState.socket && socketState.socket.emit('drive-duration', { duration: total });
    showToast(`✓ Duración guardada: ${formatTime(total)}`, 'success');
  }
  document.getElementById('duration-input-panel') && document.getElementById('duration-input-panel').remove();
}

function _mostrarInstruccionClick() {
  showToast('👆 Primero haz click en el video para activarlo', 'info', 3000);
  // Re-mostrar overlay de activación si fue cerrado
  const overlay = document.getElementById('drive-activate-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function _setDrivePauseOverlay(show) {
  const el = document.getElementById('drive-pause-overlay');
  if (el) el.style.display = show ? 'flex' : 'none';
}

/* ========================================================
   YOUTUBE
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
    if (!playerState.driveActivated) { _mostrarInstruccionClick(); return; }
    const t = getCurrentTime();
    playerState.driveOffset    = t;
    playerState.drivePlaying   = true;
    playerState.driveStartTime = Date.now();
    _setDrivePauseOverlay(false);
    playerState.onSyncUpdate && playerState.onSyncUpdate(true);
    // El iframe ya está corriendo — solo quitamos el overlay de pausa
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
    _setDrivePauseOverlay(true);
    // El iframe sigue corriendo por debajo — el overlay tapa el video
  } else if (playerState.ytPlayer) {
    playerState.ytPlayer.pauseVideo();
  }
}

function seekLocal(time) {
  if (playerState.videoType === 'drive') {
    // Para Drive, seek = reconstruir el iframe en ese segundo
    // (es la única forma de cambiar el tiempo en un embed de Drive)
    const wasPlaying           = playerState.drivePlaying;
    playerState.driveOffset    = Math.max(0, time);
    playerState.driveStartTime = wasPlaying ? Date.now() : null;
    playerState.drivePlaying   = wasPlaying;

    const container = document.getElementById('player-inner');
    if (!container) return;
    const t   = Math.floor(Math.max(0, time));
    const src = `https://drive.google.com/file/d/${playerState.videoId}/preview#t=${t}`;
    const iframe = document.getElementById('drive-iframe');
    if (iframe) {
      iframe.src = src;
      // Después de recargar necesita activación de nuevo si no fue activado
      if (playerState.driveActivated) {
        // Dar pointer-events brevemente para que el navegador registre
        iframe.style.pointerEvents = 'auto';
        setTimeout(() => { iframe.style.pointerEvents = 'none'; }, 600);
      }
    }
    _setDrivePauseOverlay(!wasPlaying);
  } else if (playerState.ytPlayer) {
    playerState.ytPlayer.seekTo(time, true);
  }
}

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
   HANDLERS REMOTOS
   ======================================================== */
function onRemotePlay({ currentTime }) {
  playerState.ignoreEvents = true;
  if (playerState.videoType === 'drive') {
    playerState.driveOffset    = currentTime;
    playerState.drivePlaying   = true;
    playerState.driveStartTime = Date.now();
    // Para el invitado: activar el iframe si es el primer play
    if (!playerState.driveActivated) {
      const overlay = document.getElementById('drive-activate-overlay');
      // El invitado también debe dar click una vez para activar autoplay
      if (overlay) {
        overlay.querySelector('div > div:first-child').innerHTML = `
          <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
        `;
        overlay.querySelector('div:last-child div:first-child').textContent = 'El host inició la reproducción — click para unirte';
        overlay.style.cursor = 'pointer';
        // Al hacer click, activar y unirse
        overlay.onclick = () => {
          overlay.style.display = 'none';
          playerState.driveActivated = true;
          const iframe = document.getElementById('drive-iframe');
          if (iframe) {
            iframe.style.pointerEvents = 'auto';
            setTimeout(() => { iframe.style.pointerEvents = 'none'; }, 400);
          }
          _setDrivePauseOverlay(false);
          playerState.onSyncUpdate && playerState.onSyncUpdate(true);
        };
      }
    } else {
      _setDrivePauseOverlay(false);
    }
  } else {
    playerState.ignoreEvents = true;
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
    _setDrivePauseOverlay(true);
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
   UI
   ======================================================== */
function updateProgressBar(fillEl, timeEl) {
  const dur = getDuration();
  const cur = getCurrentTime();
  const pct = dur > 0 ? Math.min((cur / dur) * 100, 100) : 0;
  fillEl && (fillEl.style.width = `${pct}%`);
  if (dur > 0) {
    timeEl && (timeEl.textContent = `${formatTime(cur)} / ${formatTime(dur)}`);
  } else {
    timeEl && (timeEl.textContent = formatTime(cur));
  }
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
