/* ==================================================================
   GP8 PLAYER — js/audio-sync.js
   2. AUDIO SYNC — piste embarquée dans l'AudioContext du synthé.
   ------------------------------------------------------------------
   P2 : le MP3 est décodé une fois (`decodeAudioData`) et joué par une
   `AudioBufferSourceNode` branchée sur le GainNode → destination de
   l'AudioContext d'alphaTab. Une seule horloge avec le synthé, seeks sans
   décodage média, volume/mute par GainNode.

   P2b : à vitesse utilisateur ≠ 1, on bascule sur un `<audio>` caché avec
   `preservesPitch = true`, routé dans le MÊME AudioContext via
   `MediaElementAudioSourceNode`. Le navigateur fait alors le time-stretch
   préservant la hauteur ; le régime normal ×1,0 reste sur AudioBuffer
   (aucune transposition, horloge unique).

   L'interface `AudioSync.element` imite les propriétés utilisées par
   MixSync (`currentTime`, `playbackRate`, `paused`, `play`, `pause`,
   `readyState`, `duration`, `volume`, `src`, `preservesPitch`,
   `addEventListener`).
   ================================================================== */
'use strict';

const AudioSync = (() => {
  let ctx = null;
  let gain = null;

  let buffer = null;
  let sourceBlob = null;
  let readyState = 0;

  let mode = 'buffer';            // 'buffer' | 'media'
  let desiredSpeed = 1;

  /* --- moteur AudioBuffer --- */
  let source = null;
  let sourceToken = 0;
  let rate = 1;
  let playing = false;
  let position = 0;               // secondes, source buffer arrêtée
  let startCtxTime = 0;
  let startOffset = 0;

  /* --- moteur média (P2b, vitesse ≠ 1) --- */
  let media = null;
  let mediaNode = null;
  let mediaPendingSeek = null;
  let mediaUrl = '';

  let volume = 1;
  let preservesPitch = true;
  const listeners = new Map();

  function getContext() {
    if (ctx && ctx.state !== 'closed') return ctx;
    try {
      const api = (typeof Player !== 'undefined') && Player.S && Player.S.api;
      const wrapper = api && (api._player || api.player);
      const inst = wrapper && wrapper._instance;
      const out = inst && (inst._output || inst.output);
      ctx = (out && out.context) || null;
    } catch (e) { ctx = null; }
    if (ctx) {
      gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
    }
    return ctx;
  }

  function fire(type) {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn({ type }); } catch (e) { /* jamais bloquant */ }
    }
  }

  /* ======================= moteur AudioBuffer ====================== */
  function makeSource(offset) {
    const c = getContext();
    if (!c || !buffer) return;
    stopBufferSource();
    const s = c.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = rate;
    s.connect(gain);
    const token = ++sourceToken;
    s.onended = () => {
      if (token !== sourceToken) return;
      playing = false;
      position = buffer ? buffer.duration : 0;
      source = null;
    };
    const off = Math.max(0, Math.min(offset, Math.max(0, buffer.duration - 0.001)));
    s.start(0, off);
    source = s;
    startCtxTime = c.currentTime;
    startOffset = off;
    playing = true;
  }

  function stopBufferSource() {
    sourceToken++;
    if (source) {
      try { source.onended = null; source.stop(); } catch (e) {}
      try { source.disconnect(); } catch (e) {}
      source = null;
    }
  }

  function bufferTime() {
    if (!playing || !buffer) return position;
    const c = getContext();
    if (!c) return position;
    return Math.max(0, Math.min(buffer.duration,
      startOffset + (c.currentTime - startCtxTime) * rate));
  }

  /* ======================= moteur média (P2b) ======================= */
  function ensureMedia(pos) {
    const c = getContext();
    if (!c || !sourceBlob) return false;
    if (!media) {
      media = document.createElement('audio');
      media.style.display = 'none';
      media.preload = 'auto';
      document.body.appendChild(media);
      try {
        mediaNode = c.createMediaElementSource(media);
        mediaNode.connect(gain);
      } catch (e) {
        console.warn('[audio] MediaElementAudioSourceNode indisponible', e);
        mediaNode = null;
      }
      media.addEventListener('loadedmetadata', () => {
        if (mediaPendingSeek != null) {
          const t = mediaPendingSeek; mediaPendingSeek = null;
          try { media.currentTime = t; } catch (e) {}
        }
        media.playbackRate = desiredSpeed;
        media.preservesPitch = true;
        fire('loadedmetadata');
        fire('canplay');
        if (playing && mode === 'media') {
          const p = media.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      });
      media.addEventListener('canplay', () => fire('canplay'));
      media.addEventListener('ended', () => {
        if (mode !== 'media') return;
        playing = false;
        position = media.duration || 0;
      });
    }
    if (!mediaUrl) {
      mediaUrl = URL.createObjectURL(sourceBlob);
    }
    if (media.src !== mediaUrl) {
      media.src = mediaUrl;
      media.load();
    }
    media.playbackRate = Math.max(0.06, Math.min(16, desiredSpeed));
    media.preservesPitch = true;
    try { media.webkitPreservesPitch = true; } catch (e) {}
    media.volume = 1;                            // le GainNode fait le volume
    if (pos > 0.001) {
      if (media.readyState >= 1) {
        try { media.currentTime = pos; } catch (e) { mediaPendingSeek = pos; }
      } else mediaPendingSeek = pos;
    }
    if (playing) {
      const p = media.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    return !!mediaNode;
  }

  function stopMedia() {
    if (!media) return;
    try { media.pause(); } catch (e) {}
  }

  /* ======================= changement de moteur ==================== */
  function setSpeed(v) {
    desiredSpeed = v > 0 ? v : 1;
    if (!buffer || readyState < 4) return;
    const want = Math.abs(desiredSpeed - 1) > 0.005 ? 'media' : 'buffer';
    if (want === mode) {
      if (mode === 'media' && media) media.playbackRate = desiredSpeed;
      return;
    }
    const wasPlaying = playing;
    const pos = currentSec();
    stopBufferSource();
    stopMedia();
    mode = want;
    position = pos;
    if (mode === 'buffer') {
      rate = 1;
      playing = wasPlaying;
      if (wasPlaying) makeSource(pos);
    } else {
      playing = wasPlaying;
      ensureMedia(pos);
    }
  }

  function currentSec() {
    if (mode === 'media' && media && media.readyState >= 1) return media.currentTime;
    return mode === 'buffer' ? bufferTime() : position;
  }

  /* ======================= source / décodage ======================= */
  function resetMedia() {
    stopMedia();
    if (media) {
      try { media.removeAttribute('src'); media.load(); } catch (e) {}
    }
    if (mediaUrl) {
      try { URL.revokeObjectURL(mediaUrl); } catch (e) {}
      mediaUrl = '';
    }
  }

  async function setSource(blob) {
    stopBufferSource();
    resetMedia();
    playing = false;
    buffer = null;
    sourceBlob = null;
    readyState = 0;
    position = 0;
    mode = 'buffer';
    rate = 1;
    if (!blob) return false;

    const c = getContext();
    if (!c) {
      console.warn('[audio] AudioContext du synthé indisponible');
      return false;
    }
    try {
      const data = blob instanceof ArrayBuffer ? blob : await blob.arrayBuffer();
      const decoded = await c.decodeAudioData(data);
      buffer = decoded;
      sourceBlob = blob;
      readyState = 4;
      fire('loadedmetadata');
      fire('canplay');
      /* Une vitesse ≠ 1 peut avoir été demandée avant le décodage. */
      if (Math.abs(desiredSpeed - 1) > 0.005) setSpeed(desiredSpeed);
      return true;
    } catch (e) {
      console.warn('[audio] décodage de la piste embarquée impossible', e);
      buffer = null;
      sourceBlob = null;
      readyState = 0;
      return false;
    }
  }

  /* ======================= façade « média » ====================== */
  function play() {
    const c = getContext();
    if (!c || !buffer) return Promise.reject(new Error('piste audio non décodée'));
    if (mode === 'media') {
      playing = true;
      ensureMedia(position);
      if (!media) return Promise.reject(new Error('moteur média indisponible'));
      const p = media.play();
      return p && typeof p.then === 'function' ? p : Promise.resolve();
    }
    if (playing) return Promise.resolve();
    if (position >= buffer.duration - 0.001) position = 0;
    makeSource(position);
    return Promise.resolve();
  }

  function pause() {
    if (mode === 'media') {
      if (media && media.readyState >= 1) position = media.currentTime;
      stopMedia();
      playing = false;
      return;
    }
    if (!playing) return;
    position = bufferTime();
    stopBufferSource();
    playing = false;
  }

  const element = {
    get isBufferEngine() { return mode === 'buffer' && readyState === 4; },

    get src() { return readyState === 4 ? 'buffer:embedded' : ''; },
    get readyState() { return readyState; },
    get duration() { return buffer ? buffer.duration : NaN; },
    get paused() {
      if (mode === 'media') return !media || media.paused;
      return !playing;
    },
    get currentTime() { return currentSec(); },
    set currentTime(v) {
      if (!buffer || !isFinite(v)) return;
      const t = Math.max(0, Math.min(buffer.duration, v));
      position = t;
      if (mode === 'media') {
        if (!media) { ensureMedia(t); return; }
        if (media.readyState >= 1) {
          try { media.currentTime = t; } catch (e) { mediaPendingSeek = t; }
        } else mediaPendingSeek = t;
        return;
      }
      if (playing) makeSource(t);
    },
    get playbackRate() {
      if (mode === 'media') return media && isFinite(media.playbackRate) ? media.playbackRate : desiredSpeed;
      return rate;
    },
    set playbackRate(v) {
      const r = Math.max(0.06, Math.min(16, v > 0 ? v : 1));
      if (mode === 'media') {
        desiredSpeed = r;
        if (media) media.playbackRate = r;
        return;
      }
      if (Math.abs(r - rate) < 1e-4) return;
      const was = playing;
      const t = was ? bufferTime() : position;
      rate = r;
      if (was && buffer) makeSource(t);
      else position = t;
    },
    get preservesPitch() { return preservesPitch; },
    set preservesPitch(v) {
      preservesPitch = !!v;
      if (media) media.preservesPitch = preservesPitch;
    },
    get volume() { return volume; },
    set volume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (gain) gain.gain.value = volume;
    },

    setSpeed,
    play,
    pause,
    load() {},
    removeAttribute(name) {
      if (name !== 'src') return;
      stopBufferSource(); resetMedia();
      playing = false; buffer = null; sourceBlob = null; readyState = 0;
      position = 0; mode = 'buffer';
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type);
      if (set) set.delete(fn);
    }
  };

  return {
    setSource,
    element,
    get context() { return getContext(); },
    get isBuffer() { return readyState === 4 && mode === 'buffer'; }
  };
})();
