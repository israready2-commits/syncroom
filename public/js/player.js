const playerState = {
  iframe: null,
  ytPlayer: null,
  videoType: null, // 'drive' | 'youtube'
  videoId: null,
  duration: 0,
  currentTime: 0,
  playing: false,
  isHost: false,
  iframeReady: false,
  controlsTimeout: null,
  syncCheckInterval: null,
  ytTimeInterval: null,
  onSyncUpdate: null,
  onPlay: null,
  onPause: null,
  onSeek: null,
  suppressBroadcast: false
};

function initPlayer(isHost, onPlay, onPause, onSeek, onSyncUpdate) {
  playerState.isHost = !!isHost;
  playerState.onPlay = onPlay;
  playerState.onPause = onPause;
  playerState.onSeek = onSeek;
  playerState.onSyncUpdate = onSyncUpdate;

  const wrapper = document.getElementById('player-wrapper');
  const controls = document.getElementById('player-controls');
  const playBtn = document.getElementById('ctrl-play');
  const rewindBtn = document.getElementById('ctrl-rewind');
  const forwardBtn = document.getElementById('ctrl-forward');
  const progressEl = document.getElementById('progress-bar');
  const volSlider = document.getElementById('vol-slider');
  const fsBtn = document.getElementById('ctrl-fs');

  function resetControlsTimer() {
    if (!controls) return;
    controls.classList.remove('hidden');
    clearTimeout(playerState.controlsTimeout);
    playerState.controlsTimeout = setTimeout(() => {
      controls.classList.add('hidden');
    }, 3000);
  }

  if (wrapper) {
    wrapper.addEventListener('mousemove', resetControlsTimer);
    wrapper.addEventListener('touchstart', resetControlsTimer, { passive: true });
  }

  resetControlsTimer();

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (!playerState.isHost) return;
      if (!isControllableVideo()) {
        showToast('Drive no permite play/pause sincronizado en este modo', 'error', 2500);
        return;
      }

      addRipple(playBtn);

      if (playerState.playing) {
        pauseVideo();
      } else {
        playVideo();
      }
    });
  }

  if (rewindBtn) {
    rewindBtn.addEventListener('click', () => {
      if (!playerState.isHost || !isControllableVideo()) return;
      const newTime = Math.max(0, playerState.currentTime - 10);
      seekTo(newTime, { emit: true });
    });
  }

  if (forwardBtn) {
    forwardBtn.addEventListener('click', () => {
      if (!playerState.isHost || !isControllableVideo()) return;
      const maxTime = playerState.duration > 0 ? playerState.duration : playerState.currentTime + 10;
      const newTime = Math.min(maxTime, playerState.currentTime + 10);
      seekTo(newTime, { emit: true });
    });
  }

  if (progressEl) {
    progressEl.addEventListener('click', e => {
      if (!playerState.isHost || !isControllableVideo() || !playerState.duration) return;

      const rect = progressEl.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const newTime = ratio * playerState.duration;
      seekTo(newTime, { emit: true });
    });
  }

  if (volSlider) {
    volSlider.addEventListener('input', () => {
      setVolume(Number(volSlider.value) / 100);
    });
  }

  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      const el = document.getElementById('watch-container') || document.documentElement;
      if (!document.fullscreenElement) {
        if (el.requestFullscreen) el.requestFullscreen();
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
      }
    });
  }

  clearInterval(playerState.syncCheckInterval);
  playerState.syncCheckInterval = setInterval(() => {
    if (!playerState.isHost && playerState.videoType === 'youtube') {
      emitSyncRequest(playerState.currentTime);
    }
  }, 4000);

  setInterval(updateProgress, 250);
  updatePlayBtn();
  updateControlsState();
}

function destroyCurrentPlayer() {
  clearInterval(playerState.ytTimeInterval);
  playerState.ytTimeInterval = null;

  if (playerState.ytPlayer && typeof playerState.ytPlayer.destroy === 'function') {
    try {
      playerState.ytPlayer.destroy();
    } catch (_) {}
  }

  playerState.ytPlayer = null;
  playerState.iframe = null;
  playerState.iframeReady = false;
  playerState.playing = false;
  playerState.currentTime = 0;
  playerState.duration = 0;
  updatePlayBtn();
}

function isControllableVideo() {
  return playerState.videoType === 'youtube' && !!playerState.ytPlayer;
}

function withSuppressedBroadcast(fn, wait = 350) {
  playerState.suppressBroadcast = true;
  try {
    fn();
  } finally {
    setTimeout(() => {
      playerState.suppressBroadcast = false;
    }, wait);
  }
}

function setStatusNote(message = '') {
  const note = document.getElementById('host-note');
  if (!note) return;

  if (!message) {
    note.style.display = 'none';
    note.textContent = '';
    return;
  }

  note.textContent = message;
  note.style.display = 'block';
}

function updateControlsState() {
  const playBtn = document.getElementById('ctrl-play');
  const rewindBtn = document.getElementById('ctrl-rewind');
  const forwardBtn = document.getElementById('ctrl-forward');
  const progressEl = document.getElementById('progress-bar');
  const volSlider = document.getElementById('vol-slider');

  const controllable = isControllableVideo();
  const canHostControl = playerState.isHost && controllable;
  const canUseVolume = controllable;

  [playBtn, rewindBtn, forwardBtn].forEach(btn => {
    if (!btn) return;
    btn.disabled = !canHostControl;
    btn.style.opacity = canHostControl ? '1' : '0.45';
    btn.style.pointerEvents = canHostControl ? 'auto' : 'none';
  });

  if (progressEl) {
    progressEl.style.opacity = canHostControl ? '1' : '0.55';
    progressEl.style.pointerEvents = canHostControl ? 'auto' : 'none';
    progressEl.style.cursor = canHostControl ? 'pointer' : 'default';
  }

  if (volSlider) {
    volSlider.disabled = !canUseVolume;
    volSlider.style.opacity = canUseVolume ? '1' : '0.45';
    volSlider.style.pointerEvents = canUseVolume ? 'auto' : 'none';
  }

  if (playerState.videoType === 'drive') {
    setStatusNote('Drive solo se muestra en modo visual. Para sincronía real usa YouTube.');
  } else if (!playerState.isHost) {
    setStatusNote('Solo el host puede controlar el video.');
  } else {
    setStatusNote('');
  }
}

function updateProgress() {
  const fillEl = document.getElementById('progress-fill');
  const timeEl = document.getElementById('time-display');

  if (playerState.videoType === 'youtube' && playerState.ytPlayer && typeof playerState.ytPlayer.getCurrentTime === 'function') {
    const current = Number(playerState.ytPlayer.getCurrentTime());
    if (Number.isFinite(current)) {
      playerState.currentTime = current;
    }

    const duration = Number(playerState.ytPlayer.getDuration && playerState.ytPlayer.getDuration());
    if (Number.isFinite(duration) && duration > 0) {
      playerState.duration = duration;
    }
  }

  if (fillEl && playerState.duration > 0) {
    const ratio = Math.min(100, Math.max(0, (playerState.currentTime / playerState.duration) * 100));
    fillEl.style.width = `${ratio}%`;
  } else if (fillEl) {
    fillEl.style.width = '0%';
  }

  if (timeEl) {
    const left = formatTime(playerState.currentTime || 0);
    const right = playerState.duration ? formatTime(playerState.duration) : '--:--';
    timeEl.textContent = `${left} / ${right}`;
  }

  updatePlayBtn();
}

function updatePlayBtn() {
  const playBtn = document.getElementById('ctrl-play');
  if (!playBtn) return;

  playBtn.innerHTML = playerState.playing
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"></path></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>';
}

function loadDriveVideo(fileId) {
  destroyCurrentPlayer();

  playerState.videoId = fileId;
  playerState.videoType = 'drive';
  playerState.playing = false;
  playerState.currentTime = 0;
  playerState.duration = 0;

  const container = document.getElementById('player-inner');
  if (!container) return;

  container.innerHTML = `
    <iframe
      id="drive-iframe"
      src="https://drive.google.com/file/d/${fileId}/preview"
      width="100%"
      height="100%"
      allow="autoplay; fullscreen"
      allowfullscreen
      frameborder="0"
      style="border:none;width:100%;height:100%;"
    ></iframe>
  `;

  playerState.iframe = document.getElementById('drive-iframe');
  playerState.iframeReady = true;

  const loading = document.getElementById('player-loading');
  if (loading) loading.style.display = 'none';

  updateControlsState();
  updateProgress();
  if (playerState.onSyncUpdate) playerState.onSyncUpdate(false);
}

function loadYouTubeVideo(videoId) {
  destroyCurrentPlayer();

  playerState.videoId = videoId;
  playerState.videoType = 'youtube';
  playerState.playing = false;
  playerState.currentTime = 0;
  playerState.duration = 0;

  const container = document.getElementById('player-inner');
  if (!container) return;

  container.innerHTML = '<div id="yt-player" style="width:100%;height:100%;"></div>';

  if (window.YT && window.YT.Player) {
    createYTPlayer(videoId);
  } else {
    window.onYouTubeIframeAPIReady = () => createYTPlayer(videoId);

    if (!document.getElementById('yt-api-script')) {
      const script = document.createElement('script');
      script.id = 'yt-api-script';
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  }
}

function createYTPlayer(videoId) {
  playerState.ytPlayer = new YT.Player('yt-player', {
    videoId,
    playerVars: {
      controls: 0,
      disablekb: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1
    },
    events: {
      onReady: e => {
        const duration = Number(e.target.getDuration());
        if (Number.isFinite(duration) && duration > 0) {
          playerState.duration = duration;
        }

        const loading = document.getElementById('player-loading');
        if (loading) loading.style.display = 'none';

        updateControlsState();
        updateProgress();

        clearInterval(playerState.ytTimeInterval);
        playerState.ytTimeInterval = setInterval(() => {
          if (!playerState.ytPlayer || typeof playerState.ytPlayer.getCurrentTime !== 'function') return;
          const current = Number(playerState.ytPlayer.getCurrentTime());
          if (Number.isFinite(current)) playerState.currentTime = current;
        }, 250);
      },
      onStateChange: e => {
        const state = e.data;

        if (state === YT.PlayerState.PLAYING) {
          playerState.playing = true;
          playerState.currentTime = Number(playerState.ytPlayer.getCurrentTime()) || playerState.currentTime;
          playerState.duration = Number(playerState.ytPlayer.getDuration()) || playerState.duration;
          updatePlayBtn();

          if (playerState.isHost && !playerState.suppressBroadcast && typeof playerState.onPlay === 'function') {
            playerState.onPlay(playerState.currentTime);
          }
          return;
        }

        if (state === YT.PlayerState.PAUSED) {
          playerState.playing = false;
          playerState.currentTime = Number(playerState.ytPlayer.getCurrentTime()) || playerState.currentTime;
          updatePlayBtn();

          if (playerState.isHost && !playerState.suppressBroadcast && typeof playerState.onPause === 'function') {
            playerState.onPause(playerState.currentTime);
          }
          return;
        }

        if (state === YT.PlayerState.ENDED) {
          playerState.playing = false;
          playerState.currentTime = playerState.duration || playerState.currentTime;
          updatePlayBtn();

          if (playerState.isHost && !playerState.suppressBroadcast && typeof playerState.onPause === 'function') {
            playerState.onPause(playerState.currentTime);
          }
        }
      }
    }
  });
}

function playVideo() {
  if (playerState.videoType === 'youtube' && playerState.ytPlayer && typeof playerState.ytPlayer.playVideo === 'function') {
    playerState.ytPlayer.playVideo();
    return;
  }

  if (playerState.videoType === 'drive') {
    showToast('Drive no soporta play sincronizado con iframe preview', 'error', 2500);
  }
}

function pauseVideo() {
  if (playerState.videoType === 'youtube' && playerState.ytPlayer && typeof playerState.ytPlayer.pauseVideo === 'function') {
    playerState.ytPlayer.pauseVideo();
    return;
  }

  if (playerState.videoType === 'drive') {
    showToast('Drive no soporta pausa sincronizada con iframe preview', 'error', 2500);
  }
}

function seekTo(time, options = {}) {
  const { emit = false } = options;
  const safeTime = Math.max(0, Number(time) || 0);

  playerState.currentTime = safeTime;

  if (playerState.videoType === 'youtube' && playerState.ytPlayer && typeof playerState.ytPlayer.seekTo === 'function') {
    playerState.ytPlayer.seekTo(safeTime, true);
  }

  if (emit && playerState.isHost && !playerState.suppressBroadcast && typeof playerState.onSeek === 'function') {
    playerState.onSeek(safeTime);
  }

  updateProgress();
}

function setVolume(vol) {
  const normalized = Math.max(0, Math.min(1, Number(vol) || 0));

  if (playerState.videoType === 'youtube' && playerState.ytPlayer && typeof playerState.ytPlayer.setVolume === 'function') {
    playerState.ytPlayer.setVolume(normalized * 100);
  }
}

function applySyncResponse(data) {
  if (!data || playerState.videoType !== 'youtube') {
    if (playerState.onSyncUpdate) playerState.onSyncUpdate(false);
    return;
  }

  const serverTimestamp = Number(data.serverTimestamp) || Date.now();
  const currentTime = Number(data.currentTime) || 0;
  const playing = !!data.playing;

  const serverLag = Math.max(0, (Date.now() - serverTimestamp) / 1000);
  const socketLag = (window.socketState && Number(window.socketState.latency)) ? (window.socketState.latency / 1000) : 0;
  const targetTime = playing ? currentTime + serverLag + socketLag : currentTime;
  const diff = Math.abs(targetTime - playerState.currentTime);

  if (diff > 1.2) {
    withSuppressedBroadcast(() => {
      seekTo(targetTime, { emit: false });

      if (playing) {
        playVideo();
      } else {
        pauseVideo();
      }
    });

    showToast('Sincronizando...', 'info', 1200);
    if (playerState.onSyncUpdate) playerState.onSyncUpdate(false);
  } else {
    if (playerState.onSyncUpdate) playerState.onSyncUpdate(true);
  }
}

function onRemotePlay(currentTime) {
  if (playerState.videoType !== 'youtube') {
    if (playerState.onSyncUpdate) playerState.onSyncUpdate(false);
    return;
  }

  withSuppressedBroadcast(() => {
    seekTo(currentTime, { emit: false });
    playVideo();
  });

  if (playerState.onSyncUpdate) playerState.onSyncUpdate(true);
}

function onRemotePause(currentTime) {
  if (playerState.videoType !== 'youtube') {
    if (playerState.onSyncUpdate) playerState.onSyncUpdate(false);
    return;
  }

  withSuppressedBroadcast(() => {
    seekTo(currentTime, { emit: false });
    pauseVideo();
  });
}

function onRemoteSeek(currentTime) {
  if (playerState.videoType !== 'youtube') {
    if (playerState.onSyncUpdate) playerState.onSyncUpdate(false);
    return;
  }

  withSuppressedBroadcast(() => {
    seekTo(currentTime, { emit: false });
  });
}

function formatTime(secs) {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function addRipple(btn) {
  if (!btn) return;
  const ripple = document.createElement('span');
  ripple.className = 'play-ripple';
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
}