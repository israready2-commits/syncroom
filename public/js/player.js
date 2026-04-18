/* ================================
   SyncRoom — Player con sync real
   HTML5 nativo para Drive · IFrame API para YouTube
   ================================ */

const playerState = {
  videoType: null,       // 'drive' | 'youtube'
  videoId: null,
  isHost: false,
  ignoreEvents: false,   // evita loops: recibir evento → mover player → disparar evento
  controlsTimeout: null,
  syncCheckInterval: null,
  onSyncUpdate: null,
  videoEl: null,         // <video> HTML5 nativo (Drive)
  ytPlayer: null,        // objeto YT.Player (YouTube)
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

  // Rewind 10s — solo host
  rewindBtn && rewindBtn.addEventListener('click', () => {
    if (!playerState.isHost) return;
    const t = Math.max(0, getCurrentTime() - 10);
    seekLocal(t);
    onSeek && onSeek(t);
  });

  // Forward 10s — solo host
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
    const ratio = (e.clientX - rect.left) / rect.width;
    const dur   = getDuration();
    if (!dur) return;
    const t = ratio * dur;
    seekLocal(t);
    onSeek && onSeek(t);
  });

  // Volumen
  volSlider && volSlider.addEventListener('input', () => {
    setVolumeLocal(Number(volSlider.value) / 100);
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

  // El invitado pide sync al servidor cada 5 segundos
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
   CARGAR DRIVE — <video> HTML5 nativo
   Requiere que el archivo sea público ("cualquiera con el enlace").
   URL directa de descarga: permite play/pause/seek programático.
   ======================================================== */
function loadDriveVideo(fileId) {
  playerState.videoType = 'drive';
  playerState.videoId   = fileId;
  playerState.ytPlayer  = null;

  const container = document.getElementById('player-inner');
  if (!container) return;

  // URL de stream directo de Drive (funciona si el archivo es compartido públicamente)
  const streamUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;

  container.innerHTML = `
    <video
      id="native-video"
      style="width:100%;height:100%;background:#000;display:block;max-height:100%;"
      playsinline
      preload="metadata"
    >
      <source src="${streamUrl}" type="video/mp4">
      <source src="${streamUrl}" type="video/webm">
    </video>
    <div id="drive-fallback" style="display:none;width:100%;height:100%;position:absolute;inset:0;background:#000;">
      <iframe
        src="https://drive.google.com/file/d/${fileId}/preview"
        style="width:100%;height:100%;border:none;"
        allow="autoplay; fullscreen"
        allowfullscreen
      ></iframe>
      <div style="position:absolute;bottom:72px;left:50%;transform:translateX(-50%);background:rgba(124,92,191,0.92);padding:10px 18px;border-radius:10px;font-size:0.78rem;color:#fff;white-space:nowrap;pointer-events:none;text-align:center;">
        ⚠️ El archivo no es streamable — compártelo como "cualquiera con el enlace"
      </div>
    </div>
  `;

  const video = document.getElementById('native-video');
  playerState.videoEl = video;

  // Ocultar loading cuando el video tenga metadata
  video.addEventListener('loadedmetadata', () => {
    document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');
  });

  // Si el stream directo falla → mostrar iframe embed como fallback
  video.addEventListener('error', () => {
    console.warn('[SyncRoom] Stream directo falló, mostrando embed de Drive');
    video.style.display = 'none';
    playerState.videoEl = null; // sin control nativo posible
    const fb = document.getElementById('drive-fallback');
    if (fb) fb.style.display = 'block';
    document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');
    showToast('⚠️ Comparte el archivo como público en Drive para sync completa', 'error', 7000);
  });

  // Eventos nativos → emitir por socket (solo host, solo si no es sync remota)
  video.addEventListener('play', () => {
    if (playerState.ignoreEvents) return;
    if (playerState.isHost) emitPlay(video.currentTime);
    playerState.onSyncUpdate && playerState.onSyncUpdate(true);
  });

  video.addEventListener('pause', () => {
    if (playerState.ignoreEvents) return;
    if (playerState.isHost) emitPause(video.currentTime);
  });

  video.addEventListener('seeked', () => {
    if (playerState.ignoreEvents) return;
    if (playerState.isHost) emitSeek(video.currentTime);
  });
}

/* ========================================================
   CARGAR YOUTUBE — IFrame API
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
      width: '100%',
      height: '100%',
      playerVars: {
        controls: 0,
        disablekb: 1,
        rel: 0,
        modestbranding: 1,
        iv_load_policy: 3,
        playsinline: 1,
      },
      events: {
        onReady(e) {
          e.target.setVolume(80);
          document.getElementById('player-loading') && (document.getElementById('player-loading').style.display = 'none');
        },
        onStateChange(e) {
          // Solo el host emite eventos. El invitado solo escucha del socket.
          if (playerState.ignoreEvents) return;
          if (!playerState.isHost) return;
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
      const s   = document.createElement('script');
      s.id      = 'yt-api-script';
      s.src     = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
      window.onYouTubeIframeAPIReady = () => {
        (window._ytCallbacks || []).forEach(cb => cb());
      };
    }
  }
}

/* ========================================================
   CONTROLES LOCALES — NO emiten socket.
   Se usan cuando llega un evento remoto para aplicarlo sin re-emitir.
   ======================================================== */
function playLocal() {
  if (playerState.videoType === 'drive' && playerState.videoEl) {
    playerState.videoEl.play().catch(console.warn);
  } else if (playerState.videoType === 'youtube' && playerState.ytPlayer) {
    playerState.ytPlayer.playVideo();
  }
}

function pauseLocal() {
  if (playerState.videoType === 'drive' && playerState.videoEl) {
    playerState.videoEl.pause();
  } else if (playerState.videoType === 'youtube' && playerState.ytPlayer) {
    playerState.ytPlayer.pauseVideo();
  }
}

function seekLocal(time) {
  if (playerState.videoType === 'drive' && playerState.videoEl) {
    playerState.videoEl.currentTime = time;
  } else if (playerState.videoType === 'youtube' && playerState.ytPlayer) {
    playerState.ytPlayer.seekTo(time, true);
  }
}

function setVolumeLocal(vol) {
  if (playerState.videoType === 'drive' && playerState.videoEl) {
    playerState.videoEl.volume = vol;
  } else if (playerState.videoType === 'youtube' && playerState.ytPlayer) {
    playerState.ytPlayer.setVolume(vol * 100);
  }
}

// Alias para compatibilidad con room.html (onHostLeft llama pauseVideo)
function pauseVideo() { pauseLocal(); }

/* ========================================================
   GETTERS
   ======================================================== */
function getCurrentTime() {
  if (playerState.videoType === 'drive' && playerState.videoEl) {
    return playerState.videoEl.currentTime || 0;
  }
  if (playerState.videoType === 'youtube' && playerState.ytPlayer && playerState.ytPlayer.getCurrentTime) {
    return playerState.ytPlayer.getCurrentTime() || 0;
  }
  return 0;
}

function getDuration() {
  if (playerState.videoType === 'drive' && playerState.videoEl) {
    return playerState.videoEl.duration || 0;
  }
  if (playerState.videoType === 'youtube' && playerState.ytPlayer && playerState.ytPlayer.getDuration) {
    return playerState.ytPlayer.getDuration() || 0;
  }
  return 0;
}

function isPlaying() {
  if (playerState.videoType === 'drive' && playerState.videoEl) {
    return !playerState.videoEl.paused && !playerState.videoEl.ended;
  }
  if (playerState.videoType === 'youtube' && playerState.ytPlayer && playerState.ytPlayer.getPlayerState) {
    return playerState.ytPlayer.getPlayerState() === 1; // YT.PlayerState.PLAYING
  }
  return false;
}

/* ========================================================
   HANDLERS REMOTOS — recibidos vía socket
   ignoreEvents = true evita que el <video> / ytPlayer re-emita el evento
   ======================================================== */

// El host hizo play → invitado reproduce en el mismo tiempo
function onRemotePlay({ currentTime }) {
  playerState.ignoreEvents = true;
  seekLocal(currentTime);
  playLocal();
  setTimeout(() => { playerState.ignoreEvents = false; }, 400);
  playerState.onSyncUpdate && playerState.onSyncUpdate(true);
}

// El host pausó → invitado pausa en el mismo tiempo
function onRemotePause({ currentTime }) {
  playerState.ignoreEvents = true;
  seekLocal(currentTime);
  pauseLocal();
  setTimeout(() => { playerState.ignoreEvents = false; }, 400);
}

// El host hizo seek → invitado salta al mismo punto
function onRemoteSeek({ currentTime }) {
  playerState.ignoreEvents = true;
  seekLocal(currentTime);
  setTimeout(() => { playerState.ignoreEvents = false; }, 400);
}

// Respuesta del servidor al pedido de sync periódico del invitado
function applySyncResponse({ currentTime, serverTimestamp }) {
  const lag        = (Date.now() - serverTimestamp) / 1000;
  const targetTime = currentTime + lag + ((socketState.latency || 0) / 1000);
  const diff       = Math.abs(targetTime - getCurrentTime());

  if (diff > 2) {
    // Desync mayor a 2s → corregir silenciosamente
    playerState.ignoreEvents = true;
    seekLocal(targetTime);
    setTimeout(() => { playerState.ignoreEvents = false; }, 400);
    playerState.onSyncUpdate && playerState.onSyncUpdate(false);
    showToast('🔄 Re-sincronizando...', 'info', 1500);
  } else {
    playerState.onSyncUpdate && playerState.onSyncUpdate(true);
  }
}

/* ========================================================
   UI — barra de progreso
   ======================================================== */
function updateProgressBar(fillEl, timeEl) {
  const dur = getDuration();
  const cur = getCurrentTime();
  const pct = dur > 0 ? (cur / dur) * 100 : 0;
  fillEl && (fillEl.style.width = `${pct}%`);
  timeEl && (timeEl.textContent = `${formatTime(cur)} / ${formatTime(dur)}`);
}

/* ========================================================
   HELPERS
   ======================================================== */
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
