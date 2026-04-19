/* ================================
   SyncRoom — Player v7
   Soporta:
   - URL directa de video (.mp4, .mkv, .webm, etc.)
   - Google Drive (convierte el link automáticamente)
   - YouTube (IFrame API)
   ================================ */

const playerState = {
  videoType: null,   // 'native' | 'youtube'
  videoId: null,
  isHost: false,
  ignoreEvents: false,
  controlsTimeout: null,
  syncCheckInterval: null,
  onSyncUpdate: null,
  videoEl: null,
  ytPlayer: null,
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

  playBtn && playBtn.addEventListener('click', () => {
    if (!playerState.isHost) return;
    addRipple(playBtn);
    const t = getCurrentTime();
    if (isPlaying()) {
      pauseLocal(); onPause && onPause(t);
    } else {
      playLocal();  onPlay  && onPlay(t);
    }
    updatePlayBtn();
  });

  rewindBtn && rewindBtn.addEventListener('click', () => {
    if (!playerState.isHost) return;
    const t = Math.max(0, getCurrentTime() - 10);
    seekLocal(t); onSeek && onSeek(t);
  });

  forwardBtn && forwardBtn.addEventListener('click', () => {
    if (!playerState.isHost) return;
    const t = getCurrentTime() + 10;
    seekLocal(t); onSeek && onSeek(t);
  });

  progressEl && progressEl.addEventListener('click', (e) => {
    if (!playerState.isHost) return;
    const rect  = progressEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const dur   = getDuration();
    if (!dur) return;
    const t = ratio * dur;
    seekLocal(t); onSeek && onSeek(t);
  });

  volSlider && volSlider.addEventListener('input', () => {
    const v = Number(volSlider.value) / 100;
    if (playerState.videoEl) playerState.videoEl.volume = v;
    if (playerState.ytPlayer) playerState.ytPlayer.setVolume(Number(volSlider.value));
  });

  fsBtn && fsBtn.addEventListener('click', () => {
    const el = document.getElementById('watch-container') || document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen && el.requestFullscreen();
    else document.exitFullscreen && document.exitFullscreen();
  });

  setInterval(() => { updateProgressBar(fillEl, timeEl); updatePlayBtn(); }, 500);

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
   CARGAR VIDEO NATIVO (Drive, URL directa, cualquier .mp4)
   ======================================================== */
function loadDriveVideo(fileId, accessToken) {
  // fileId puede ser: ID de Drive, URL de Drive, o URL directa de video
  // accessToken: token OAuth del host (obtenido via Google Sign-In)
  const resolved = _resolveVideoUrl(fileId, accessToken);
  _loadNativeVideo(resolved.url, resolved.label, resolved.driveId);
}

function _resolveVideoUrl(input, accessToken) {
  if (!input) return { url: '', label: 'Video' };

  // 1. YouTube
  if (input.includes('youtube.com') || input.includes('youtu.be')) {
    return { url: input, label: 'YouTube' };
  }

  // 2. Google Drive — usar proxy autenticado (igual que Rave)
  const driveId = (typeof parseDriveId === 'function') ? parseDriveId(input) : null;
  if (driveId) {
    if (accessToken) {
      // Con token: stream directo via Drive API v3 a través de nuestro proxy
      const streamUrl = (typeof buildDriveStreamUrl === 'function')
        ? buildDriveStreamUrl(driveId, accessToken)
        : `/api/drive-stream/${driveId}?token=${encodeURIComponent(accessToken)}`;
      return { url: streamUrl, label: 'Google Drive', driveId };
    } else {
      // Sin token: intentar URL pública (solo funciona para archivos muy pequeños)
      return {
        url: `https://drive.google.com/uc?id=${driveId}&export=download`,
        label: 'Google Drive (sin auth)',
        driveId
      };
    }
  }

  // 3. URL directa de video (.mp4, .webm, etc.)
  return { url: input.trim(), label: 'Video directo' };
}

function _loadNativeVideo(url, label) {
  playerState.videoType = 'native';
  playerState.ytPlayer  = null;

  const container = document.getElementById('player-inner');
  if (!container) return;

  container.innerHTML = `
    <video
      id="native-video"
      style="width:100%;height:100%;background:#000;display:block;outline:none;"
      playsinline
      preload="auto"
    >
      <source src="${url}" type="video/mp4">
      <source src="${url}" type="video/webm">
      <source src="${url}" type="video/ogg">
    </video>
  `;

  const video = document.getElementById('native-video');
  playerState.videoEl = video;
  playerState.videoId = url;

  video.addEventListener('loadedmetadata', () => {
    document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');
  });

  // Timeout: si en 12 segundos no carga, mostrar error con alternativas
  const loadTimeout = setTimeout(() => {
    if (video.readyState < 1) {
      _mostrarErrorCarga(url);
    }
  }, 12000);

  video.addEventListener('loadedmetadata', () => clearTimeout(loadTimeout));
  video.addEventListener('error', () => {
    clearTimeout(loadTimeout);
    _mostrarErrorCarga(url);
  });

  // Eventos → socket (solo host)
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

function _mostrarErrorCarga(url) {
  document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');
  const container = document.getElementById('player-inner');
  if (!container) return;

  // Intentar extraer el ID de Drive si la URL era de Drive
  const driveMatch = url.match(/id=([a-zA-Z0-9_-]{10,})/);
  const driveId = driveMatch ? driveMatch[1] : null;

  container.innerHTML = `
    <div style="
      width:100%;height:100%;min-height:300px;
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      gap:14px;padding:24px;text-align:center;
      background:#0D0D14;color:#EEEEF2;
      font-family:var(--font-body);
    ">
      <div style="font-size:2.5rem;">🎬</div>
      <div style="font-size:1rem;font-weight:600;font-family:var(--font-display);">
        No se pudo cargar el video
      </div>

      ${driveId ? `
        <div style="background:#1E1E2A;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;max-width:360px;font-size:0.8125rem;line-height:1.7;color:#7A7A8C;text-align:left;">
          <strong style="color:#9B7FD4;">Google Drive requiere que el archivo sea público:</strong><br>
          1. Abre <a href="https://drive.google.com/file/d/${driveId}/view" target="_blank" style="color:#7C5CBF;">este archivo en Drive ↗</a><br>
          2. Click en <strong style="color:#EEEEF2;">Compartir</strong><br>
          3. En "Acceso general" → <strong style="color:#EEEEF2;">Cualquiera con el enlace</strong><br>
          4. Guarda y vuelve a intentarlo
        </div>
        <button onclick="_reintentarCarga('${url}')" style="
          padding:10px 20px;background:#7C5CBF;color:#fff;
          border:none;border-radius:10px;cursor:pointer;font-size:0.875rem;
        ">🔄 Reintentar</button>
      ` : `
        <div style="color:#7A7A8C;font-size:0.8125rem;max-width:320px;line-height:1.6;">
          El archivo no pudo cargarse. Asegúrate de que la URL sea un link directo a un video (.mp4, .webm) o un video de Drive/YouTube público.
        </div>
      `}

      <div style="color:#7A7A8C;font-size:0.75rem;margin-top:8px;">
        💡 <strong style="color:#EEEEF2;">Tip:</strong> YouTube funciona siempre sin restricciones
      </div>
    </div>
  `;
}

function _reintentarCarga(url) {
  document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'flex');
  _loadNativeVideo(url, 'Video');
}

/* ========================================================
   YOUTUBE
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
      playerVars: { controls: 0, disablekb: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1 },
      events: {
        onReady(e) {
          e.target.setVolume(80);
          document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');
        },
        onStateChange(e) {
          if (playerState.ignoreEvents || !playerState.isHost) return;
          const t = playerState.ytPlayer.getCurrentTime();
          if (e.data === YT.PlayerState.PLAYING) { emitPlay(t); playerState.onSyncUpdate && playerState.onSyncUpdate(true); }
          if (e.data === YT.PlayerState.PAUSED)  { emitPause(t); }
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
  if (playerState.videoEl) playerState.videoEl.play().catch(console.warn);
  else if (playerState.ytPlayer) playerState.ytPlayer.playVideo();
}

function pauseLocal() {
  if (playerState.videoEl) playerState.videoEl.pause();
  else if (playerState.ytPlayer) playerState.ytPlayer.pauseVideo();
}

function seekLocal(time) {
  if (playerState.videoEl) playerState.videoEl.currentTime = Math.max(0, time);
  else if (playerState.ytPlayer) playerState.ytPlayer.seekTo(time, true);
}

function pauseVideo() { pauseLocal(); }

/* ========================================================
   GETTERS
   ======================================================== */
function getCurrentTime() {
  if (playerState.videoEl) return playerState.videoEl.currentTime || 0;
  if (playerState.ytPlayer && playerState.ytPlayer.getCurrentTime) return playerState.ytPlayer.getCurrentTime() || 0;
  return 0;
}

function getDuration() {
  if (playerState.videoEl) return playerState.videoEl.duration || 0;
  if (playerState.ytPlayer && playerState.ytPlayer.getDuration) return playerState.ytPlayer.getDuration() || 0;
  return 0;
}

function isPlaying() {
  if (playerState.videoEl) return !playerState.videoEl.paused && !playerState.videoEl.ended;
  if (playerState.ytPlayer && playerState.ytPlayer.getPlayerState) return playerState.ytPlayer.getPlayerState() === 1;
  return false;
}

/* ========================================================
   HANDLERS REMOTOS
   ======================================================== */
function onRemotePlay({ currentTime }) {
  playerState.ignoreEvents = true;
  seekLocal(currentTime); playLocal();
  setTimeout(() => { playerState.ignoreEvents = false; }, 500);
  playerState.onSyncUpdate && playerState.onSyncUpdate(true);
}

function onRemotePause({ currentTime }) {
  playerState.ignoreEvents = true;
  seekLocal(currentTime); pauseLocal();
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
  timeEl && (timeEl.textContent = dur > 0 ? `${formatTime(cur)} / ${formatTime(dur)}` : formatTime(cur));
}

function formatTime(secs) {
  if (!secs || isNaN(secs)) return '00:00';
  const s = Math.floor(secs), m = Math.floor(s / 60), h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0'), mm = String(m % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function addRipple(btn) {
  const r = document.createElement('span');
  r.className = 'play-ripple';
  btn.appendChild(r);
  setTimeout(() => r.remove(), 600);
}
