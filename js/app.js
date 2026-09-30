

  /* ==================================================================
     GP8 PLAYER — SPA ( html / css / js )
     ------------------------------------------------------------------
     1. CONFIG
     2. AUDIO SYNC  (<audio> caché + IExternalMediaHandler)
     3. EMBEDDED AUDIO (bonus JSZip)
     4. MIX SYNC    (synthé maître + <audio> esclave)
     5. PLAYER (wrapper alphaTab)
     6. APP (UI, DnD, raccourcis)
     ================================================================== */
  'use strict';

  /* ========================= 1. CONFIG ============================ */
  const AT_VERSION = '1.8.4';
  const AT_CDN     = `https://cdn.jsdelivr.net/npm/@coderline/alphatab@${AT_VERSION}/dist`;

  const CFG = {
    alphatab: {
      core: {
        // ⚠ SLASH FINAL OBLIGATOIRE : alphaTab construit les URLs des polices par
        // simple CONCATÉNATION (`${fontDirectory}Bravura.woff2`). Sans "/", l'URL
        // devient ".../dist/fontBravura.woff2" (404) → Bravura ne se charge jamais
        // → `uiFacade.canRender === false` → `render()` différé indéfiniment
        // → aucun `renderFinished` et partition restée vide.
        fontDirectory: `${AT_CDN}/font/`,
        scriptFile:    `${AT_CDN}/alphaTab.js`,
        useWorkers:    true,
        logLevel:      'warning'
      },
      display: {
        scale: 1,
        staveProfile: 'scoreTab'
      },
      player: {
        playerMode: 'enabledAutomatic',          // auto → audio embarqué sinon synthé
        soundFont:  `${AT_CDN}/soundfont/sonivox.sf3`,
        scrollElement: '#viewport',
        scrollMode: 'offscreen',
        enableCursor: true,
        enableAnimatedBeatCursor: true,
        enableElementHighlighting: true,
        enableUserInteraction: true,             // drag = sélection de zone de boucle
        bufferTimeInMilliseconds: 800
      }
    },
    samples: [
      { label: 'Sepultura — Amen',                    file: 'Sepultura (1993 - Chaos A.D.) - Amen.gp' },
      { label: 'Iron Maiden — Fear of the Dark',      file: 'Iron Maiden (1992 - Fear of the Dark) - Fear of the Dark.gp' },
      { label: 'Slayer — Hell Awaits',                file: 'Slayer (1985 - Hell Awaits) - Hell Awaits.gp' },
      { label: 'Helloween — Dr. Stein',               file: 'Helloween (1988 - Keeper of the Seven Keys - Part II) - Dr. Stein.gp' },
      { label: 'Renaud — Morgane de toi',             file: 'Renaud (1983 - Morgane de toi) - Morgane de toi (amoureux de toi).gp' },
      { label: 'F-Zero X — Goal BGM',                 file: 'F-Zero X (1998) - Goal BGM.gp' }
    ]
  };

  /* Référenceurs d'API alphaTab.
     ATTENTION : l'arbre d'export n'est pas homogène !
       - alphaTab.PlayerMode        → top-level   ✔  (aliasé dans AT)
       - alphaTab.synth.PlayerState → namespace   ✔  (alphaTab.PlayerState est undefined !)
       - alphaTab.synth.PlaybackRange → namespace ✔
     Un accès à une classe inexistante lève "Cannot read properties of
     undefined" et, si ça arrive pendant renderScore(), casse le chargement. */
  const _AT = (typeof alphaTab !== 'undefined') ? alphaTab : {};
  const AT = {
    PlayerState:   (_AT.synth && _AT.synth.PlayerState)   || _AT.PlayerState,
    PlayerMode:    _AT.PlayerMode,
    PlaybackRange: (_AT.synth && _AT.synth.PlaybackRange) || _AT.PlaybackRange
  };

  /* Enveloppe protectrice : une exception dans un handler d'événement
     alphaTab remonte dans api.load() et annule le chargement du score. */
  const safe = fn => (...args) => { try { fn(...args); } catch (e) { console.error('[handler]', e); } };

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmtTime = ms => {
    if (!isFinite(ms) || ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  /* ================== 2. AUDIO SYNC (<audio> caché) ================ */
  /*
   *  Rôle : héberger un lecteur audio HTML5 "maison" et le brancher sur le
   *  moteur alphaTab via l'interface `IExternalMediaHandler`.
   *
   *  Quand `settings.player.playerMode = 'enabledExternalMedia'` :
   *    - alphaTab ne génère AUCUN son, il utilise uniquement notre audio
   *      comme axe temporel ("time axis")
   *    - alphaTab appelle  handler.seekTo()/play()/pause()  pour piloter l'audio
   *    - nous, on lui renvoie la position via output.updatePosition(ms)
   */
  const AudioSync = (() => {
    const audio = $('#externalAudio');
    let output = null;          // ExternalMediaSynthOutput d'alphaTab
    let url   = null;           // objectURL en cours

    /* ---- Handler attendu par alphaTab (IExternalMediaHandler) ---- */
    const handler = {
      get backingTrackDuration() { return (isFinite(audio.duration) ? audio.duration : 0) * 1000; },
      get playbackRate()         { return audio.playbackRate; },
      set playbackRate(v)        { audio.playbackRate = v; },
      get masterVolume()         { return audio.volume; },
      set masterVolume(v)        { audio.volume = clamp(v, 0, 1); },
      seekTo(timeMs)             { try { audio.currentTime = timeMs / 1000; } catch (e) {} },
      play()                     { audio.play().catch(() => {}); },
      pause()                    { audio.pause(); }
    };

    /* ---- Pousse la position audio vers alphaTab ------------------- */
    function pushPosition() {
      if (!output || typeof output.updatePosition !== 'function') return;
      output.updatePosition(audio.currentTime * 1000);
    }

    /* ---- Branchement / débranchement ------------------------------ */
    function attach(out)   { output = out; output.handler = handler; }
    function detach()      { if (output) { try { output.handler = undefined; } catch (e) {} } output = null; }

    function setSource(src) {
      if (url) URL.revokeObjectURL(url);
      url = src || null;
      if (url) {
        audio.src = url;
        audio.load();
      } else {
        // ne JAMAIS faire `audio.src = ''` : le navigateur resolverait
        // l'URL du document comme source média.
        audio.removeAttribute('src');
        try { audio.load(); } catch (e) {}
      }
    }

    /* ---- Synchronisation (le cœur, volontairement commenté) --------
     *
     *  CAS 1 — Piloté par alphaTab (cas de la maquette) :
     *  alphaTab est maître du temps. Il nous appelle en seekTo(), on notifie
     *  simplement les changements de position pour que l'UI reste cohérente.
     *  Aucune correction de dérive n'est nécessaire.
     *
     *  CAS 2 — "Horloge double" (audio audible + synthé MIDI muet) :
     *  si tu veux entendre l'enregistrement tout en faisant définer le curseur
     *  alphaTab, il faut surveiller la dérive et recaler l'audio :
     *
     *      function monitorDrift(api) {
     *        const drift = Math.abs(api.timePosition - audio.currentTime * 1000);
     *        if (drift > 300) {                        // seuil 300 ms
     *          audio.currentTime = api.timePosition / 1000;
     *        }
     *      }
     *      // appelé depuis api.playerPositionChanged (throttle ~250 ms)
     *
     *  CAS 3 — Recherche par tick (placeholder) :
     *
     *      function seekAudioToTick(api, tick) {
     *        // 1. convertir tick → ms via api.tickCache / syncPoints
     *      // 2. audio.currentTime = ms / 1000
     *        // 3. api.tickPosition = tick      // recaler le curseur de partition
     *      }
     */
    function syncToPlayer(/* api, tick */) {
      // Placeholder CAS 3 — volontairement vide (voir commentaire ci-dessus).
      pushPosition();
    }

    function init() {
      audio.addEventListener('timeupdate', pushPosition);
      audio.addEventListener('seeked',      pushPosition);
      audio.addEventListener('ended',      pushPosition);
    }

    return { init, handler, attach, detach, setSource, pushPosition, syncToPlayer, element: audio };
  })();

  /* ============== 3. EMBEDDED AUDIO (bonus JSZip) ================= */
  /*
   *  Un fichier .gp (GP7/8) est une archive ZIP. On y trouve notamment :
   *
   *    VERSION
   *    meta.json
   *    Content/
   *      score.gpif                 ← la partition (XML)
   *      BinaryStylesheet
   *      LayoutConfiguration / PartConfiguration
   *      Preferences.json
   *      ScoreViews/*.gpsv
   *      Stylesheets/*.gpss
   *      Assets/<GUID>.mp3          ← ★ L'AUDIO EMBARQUÉ
   *
   *  NOTE : alphaTab extrait DÉJÀ ce mp3 à l'import (Gp7To8Importer →
   *  GpifParser.loadAsset) et le place dans `score.backingTrack.rawAudioFile`.
   *  Le module ci-dessous sert :
   *    - à inspecter l'archive (bouton "Analyser"),
   *    - à extraire l'audio soi-même si on veut le piloter via notre <audio>
   *      (mode "Média externe"), sans dépendre d'alphaTab.
   */
  const EmbeddedAudio = (() => {
    const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;

    /* Inspection : liste les entrées audio du zip ------------------- */
    async function probe(file) {
      if (typeof JSZip === 'undefined') throw new Error('JSZip indisponible (CDN ?)');
      const zip = await JSZip.loadAsync(file);
      const audioEntries = [];
      const otherEntries  = [];
      for (const name of Object.keys(zip.files)) {
        const entry = zip.files[name];
        if (entry.dir) continue;
        const meta = { name, size: 0 };
        if (AUDIO_RE.test(name)) {
          // On lit uniquement la taille : on inflate l'entrée demandée
          const data = await entry.async('uint8array');
          meta.size = data.byteLength;
          meta.data  = data;
          audioEntries.push(meta);
        } else {
          otherEntries.push(name);
        }
      }
      return { audioEntries, otherEntries };
    }

    /* Extraction → Blob utilisable par <audio src=objectURL> -------- */
    async function extract(file) {
      const { audioEntries } = await probe(file);
      if (!audioEntries.length) return null;
      const a = audioEntries[0];
      const mime = a.name.endsWith('.wav') ? 'audio/wav'
                : a.name.endsWith('.ogg') ? 'audio/ogg'
                : 'audio/mpeg';
      return { blob: new Blob([a.data], { type: mime }), name: a.name, size: a.size, entries: audioEntries };
    }

    /* Repli : si alphaTab a déjà extrait le fichier ----------------- */
    function fromScore(score) {
      const raw = score && score.backingTrack && score.backingTrack.rawAudioFile;
      if (!raw) return null;
      return new Blob([raw], { type: 'audio/mpeg' });
    }

    return { probe, extract, fromScore };
  })();

  /* ==================== 4. MIX SYNC ============================== */
  /*
   *  Mode « Mix » : la piste audio embarquée ET le MIDI jouent EN MÊME TEMPS.
   *
   *  Principe — alphaTab reste MAÎTRE DU TEMPS (playerMode = synthesizer) :
   *    ✔ métronome, volumes MIDI, mute/solo, boucle A→B, curseur, highlighting
   *    ✔ lecture/pause/stop/seek pilotent les DEUX flux
   *  Notre balise <audio> joue en ESCLAVE du synthé.
   *
   *  Pont temporel — on réutilise l'algorithme exact d'alphaTab, exposé
   *  publiquement :
   *
   *      alphaTab.midi.MidiFileGenerator.generateSyncPoints(score)
   *        → BackingTrackSyncPoint[] { synthTick, synthTime, syncTime }
   *
   *  C'est LA MÊME table qu'alphaTab utilise en mode « piste audio »
   *  (MidiFileSequencer.mainTimePositionToBackingTrack) : interpolation
   *  linéaire entre deux points de sync, extrapolation sur le dernier
   *  segment. Comme on joue le MÊME fichier audio brut, l'axe temporel est
   *  identique à celui d'alphaTab → pas de dérive d'origine.
   *
   *  Correction en cours de lecture :
   *    |dérive| > 400 ms  → recale immédiat (seek)
   *    25 ms < |dérive|   → ajustement fin de playbackRate (±10 %)
   *  `preservesPitch` étant actif par défaut, ces micro-variations de
   *  vitesse ne transposent PAS le son.
   */
  const MixSync = (() => {
    const HOLD_MS = 400;   // dérive au-delà de laquelle on recale d'un coup
    const SOFT_MS = 25;    // en pause, on recale au-delà de 25 ms
    const NUDGE   = 0.10;  // marge max de correction de vitesse (±10 %)
    const GAIN    = 2000;  // ms : vise une remise à zéro en ~2 s

    let points  = [];      // [{ t: synthTime, a: syncTime }] trié par t
    let bias    = 0;       // décalage constant éventuel (calage manuel)
    let playing = false;
    let active  = false;
    let speed   = 1;
    let note    = '';

    const el = () => AudioSync.element;

    /* ---- construction du pont synthé → audio ---- */
    function build(score) {
      points = [];
      note   = '';
      if (!score) { note = 'aucun score'; return 0; }
      try {
        const gen = (typeof alphaTab !== 'undefined')
          && alphaTab.midi && alphaTab.midi.MidiFileGenerator;
        if (!gen || typeof gen.generateSyncPoints !== 'function') {
          note = 'MidiFileGenerator indisponible dans ce build';
          console.warn('[mix]', note);
          return 0;
        }
        points = (gen.generateSyncPoints(score) || [])
          .filter(p => p && isFinite(p.synthTime) && isFinite(p.syncTime))
          .map(p => ({ t: p.synthTime, a: p.syncTime }))
          .sort((x, y) => x.t - y.t);
        note = points.length
          ? points.length + ' point(s) de synchro'
          : 'aucun point de synchro → axe temporel linéaire';
      } catch (e) {
        console.warn('[mix] generateSyncPoints', e);
        note   = 'erreur de synchro : ' + (e && e.message ? e.message : e);
        points = [];
      }
      console.log('[mix] ' + note);
      return points.length;
    }

    /* ---- synthTime (ms) → position audio (ms) ---- */
    function audioMsFor(t) {
      const n = points.length;
      if (n === 0) return t + bias;
      if (n === 1) return points[0].a + (t - points[0].t) + bias;

      if (t <= points[0].t) {                       // avant le 1er point
        const p = points[0], q = points[1], dt = q.t - p.t;
        return p.a + (dt > 0 ? (t - p.t) * (q.a - p.a) / dt : t - p.t) + bias;
      }
      if (t >= points[n - 1].t) {                   // après le dernier point
        const p = points[n - 1], q = points[n - 2], dt = p.t - q.t;
        return p.a + (dt > 0 ? (t - p.t) * (p.a - q.a) / dt : t - p.t) + bias;
      }

      let lo = 0, hi = n - 1;                       // recherche dichotomique
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (points[mid].t <= t) lo = mid; else hi = mid - 1;
      }
      const p = points[lo], q = points[lo + 1], dt = q.t - p.t;
      return p.a + (q.a - p.a) * (dt > 0 ? (t - p.t) / dt : 0) + bias;
    }

    /* vitesse réellement appliquée par alphaTab (source de vérité) */
    function curSpeed() {
      const a = Player.S.api;
      return (a && a.playbackSpeed > 0) ? a.playbackSpeed : speed;
    }

    /* ---- cible (secondes) sur l'axe audio ---- */
    function targetSeconds() {
      const api = Player.S.api;
      if (!api) return null;
      // alphaTab multiplie par playbackSpeed avant d'interpoler
      const ms = audioMsFor(api.timePosition * curSpeed());
      return isFinite(ms) && ms >= 0 ? ms / 1000 : null;
    }

    function seekTo(sec) {
      const a = el();
      if (!a || sec == null) return;
      try {
        if (Math.abs(a.currentTime - sec) > 0.02) a.currentTime = sec;
      } catch (e) { /* metadata pas encore disponibles */ }
    }

    /* recalage immédiat (seek utilisateur, boucle A→B, changement de source) */
    function resync() {
      if (!active) return;
      seekTo(targetSeconds());
    }

    /* ---- boucle de correction (à chaque playerPositionChanged) ---- */
    function onPosition() {
      if (!active) return;
      const a = el();
      if (!a || !a.src) return;
      const target = targetSeconds();
      if (target == null) return;

      if (!playing) {                                // en pause : simple recadrage
        if (Math.abs(a.currentTime - target) * 1000 > SOFT_MS) seekTo(target);
        return;
      }
      if (a.readyState < 3) return;                  // pas de données : inutile d'ajuster

      const drift = (a.currentTime - target) * 1000; // > 0 : l'audio est en avance
      const sp    = curSpeed();
      if (Math.abs(drift) > HOLD_MS) {
        seekTo(target);
        setRate(sp);
        return;
      }
      const r = Math.max(0.06, sp * (1 - clamp(drift / GAIN, -NUDGE, NUDGE)));
      if (Math.abs(a.playbackRate - r) > 0.004) a.playbackRate = r;
    }

    /* ---- état de lecture ---- */
    function onState(state) {
      const a = el();
      const isPlaying = state != null
        && !!AT.PlayerState && state === AT.PlayerState.Playing;
      playing = isPlaying && active;
      if (!a) return;
      if (!active) { try { a.pause(); } catch (e) {} a.playbackRate = 1; return; }

      setRate(curSpeed());
      if (playing) {
        resync();                                     // on cale AVANT de démarrer
        const p = a.play();
        if (p && typeof p.catch === 'function') {
          p.catch(e => {
            console.warn('[mix] audio.play()', e);
            if (e && e.name === 'NotAllowedError') {
              App.toast('Le navigateur a bloqué l\'audio — relancez la lecture.', 'error');
            }
          });
        }
      } else {
        try { a.pause(); } catch (e) {}
      }
    }

    function setRate(v) {
      speed = v > 0 ? v : 1;
      const a = el();
      if (!a) return;
      try { a.preservesPitch = true; } catch (e) {}
      a.playbackRate = clamp(speed, 0.06, 16);
    }

    /* ---- cycle de vie ---- */
    function start()   { active = true; playing = false; setRate(speed); }
    function stop()    {
      active = false; playing = false;
      const a = el();
      if (a) { try { a.pause(); } catch (e) {} a.playbackRate = 1; }
    }
    function suspend() {                              // nouveau score chargé
      playing = false;
      const a = el();
      if (a) { try { a.pause(); } catch (e) {} }
    }

    return {
      build, onPosition, onState, resync, setRate,
      start, stop, suspend,
      get active() { return active; },
      get info()   { return { points: points.length, note: note, bias: bias }; }
    };
  })();

  /* ======================= 5. PLAYER ============================== */
  const Player = (() => {
    const S = {
      api: null,
      score: null,
      currentFile: null,
      source: 'mix',
      midiVolume: 0.85,
      audioVolume: 1.0,
      metronomeVolume: 0.6,
      metronomeOn: false,
      loopOn: false,
      currentBar: 0,
      externalReady: false,
      externalBlobUrl: null
    };

    /* -------- Initialisation alphaTab -------- */
    function init(container) {
      S.api = new alphaTab.AlphaTabApi(container, CFG.alphatab);
      wireEvents();
      return S.api;
    }

    function wireEvents() {
      const api = S.api;

      api.scoreLoaded.on(score => safe(() => {
        S.score = score;
        MixSync.suspend();
        if (S.source === 'mix') {
          MixSync.build(score);   // pont synthTime → syncTime
          ensureMixAudio();       // branche le <audio> (async, sans toast)
        }
        App.onScoreLoaded(score);
        applyVolumes();
        refreshModeDependentUI();
      })());

      api.error.on(err => safe(() => {
        console.error('[alphaTab]', err);
        App.toast('Erreur alphaTab : ' + (err && err.message ? err.message : err), 'error');
        App.loader(false);
      })());

      // `renderFinished` = un rendu partiel ; `postRenderFinished` = rendu complet
      // (c'est lui qu'on attend pour révéler la partition).
      api.renderFinished.on(() => safe(() => App.loader(false))());
      api.postRenderFinished.on(() => safe(() => App.loader(false))());

      /* --- position / progression + calage de l'audio (mode Mix) --- */
      api.playerPositionChanged.on(e => safe(() => {
        App.updatePosition(e);
        MixSync.onPosition();
      })());

      /* --- mesure courante --- */
      api.playedBeatChanged.on(beat => safe(() => {
        const mb = beat && beat.voice && beat.voice.bar ? beat.voice.bar.masterBar : null;
        if (mb) {
          S.currentBar = mb.index;
          $('#barLabel').textContent = `M. ${mb.index + 1}/${S.score ? S.score.masterBars.length : '?'}`;
        }
      })());

      /* --- état lecture --- */
      api.playerStateChanged.on(e => safe(() => {
        const playing = e.state === AT.PlayerState.Playing;
        $('#icPlay').classList.toggle('hidden', playing);
        $('#icPause').classList.toggle('hidden', !playing);
        App.syncPlayBadge(playing);
        MixSync.onState(e.state);
      })());

      /* --- fin de morceau --- */
      api.playerFinished.on(() => safe(() => {
        $('#icPlay').classList.remove('hidden');
        $('#icPause').classList.add('hidden');
        App.syncPlayBadge(false);
        MixSync.onState(null);
      })());

      /* --- zone de boucle (souris ou code) --- */
      api.playbackRangeChanged.on(range => safe(() => App.onPlaybackRange(range))());
    }

    /* -------- Chargement d'un fichier -------- */
    async function loadFile(file, label) {
      App.loader(true, `Analyse de « ${label || file.name} »…`);
      App.armLoaderWatchdog(label || file.name);
      // On révèle #scoreArea AVANT le render pour qu'alphaTab mesure
      // immédiatement sa largeur réelle (l'état vide est un overlay absolu,
      // il n'influence pas cette mesure).
      App.hideEmptyState();
      try {
        const buffer = await file.arrayBuffer();
        S.currentFile = file;
        // La source choisie fixe le mode AVANT le load : sinon alphaTab résout
        // `enabledAutomatic` → piste audio, et le synthé MIDI est coupé.
        S.api.settings.player.playerMode = modeFor(S.source);
        // [-1] = toutes les pistes (comportement Guitar Pro par défaut)
        const ok = S.api.load(new Uint8Array(buffer), [-1]);
        if (!ok) throw new Error('Format non reconnu');
      } catch (e) {
        console.error(e);
        App.showEmptyState();
        App.toast('Impossible de charger ce fichier : ' + e.message, 'error');
        App.loader(false);
      }
    }

    /* -------- Transport -------- */
    const play      = () => { if (S.api) S.api.play(); };
    const pause     = () => { if (S.api) S.api.pause(); };
    const toggle    = () => { if (S.api) S.api.playPause(); };
    const stop      = () => { if (S.api) { S.api.stop(); S.api.tickPosition = 0; MixSync.resync(); } };

    function seekRatio(r) {
      if (!S.api) return;
      const range = S.api.playbackRange;
      const from  = range ? range.startTick : 0;
      const to    = range ? range.endTick   : S.api.endTick;
      if (to <= from) return;
      S.api.tickPosition = Math.round(from + (to - from) * clamp(r, 0, 1));
      AudioSync.pushPosition();
      MixSync.resync();
    }

    function gotoBar(delta) {
      if (!S.score) return;
      const count = S.score.masterBars.length;
      const next  = clamp(S.currentBar + delta, 0, count - 1);
      S.api.tickPosition = S.score.masterBars[next].start;
      S.currentBar = next;
      $('#barLabel').textContent = `M. ${next + 1}/${count}`;
      MixSync.resync();
    }

    /* -------- Métronome --------
     *  Le métronome natif d'alphaTab est un événement MIDI : il n'existe
     *  donc QUAND le synthé est actif (pas en mode piste audio). */
    function setMetronome(on) {
      S.metronomeOn = !!on;
      S.api.metronomeVolume = S.metronomeOn ? S.metronomeVolume : 0;
      App.syncMetronome(S.metronomeOn, isSynthMode());
    }
    function setMetronomeVolume(v) {
      S.metronomeVolume = clamp(v, 0, 1);
      if (S.metronomeOn) S.api.metronomeVolume = S.metronomeVolume;
    }

    /* -------- Volumes (routés selon la source active) -------- */
    function setMidiVolume(v)   { S.midiVolume   = clamp(v, 0, 1); applyVolumes(); }
    function setAudioVolume(v)  { S.audioVolume  = clamp(v, 0, 1); applyVolumes(); }

    function isSynthMode() {
      return S.api && S.api.actualPlayerMode === AT.PlayerMode.EnabledSynthesizer;
    }

    function applyVolumes() {
      if (!S.api) return;
      const mode = S.api.actualPlayerMode;
      const usesAudio =
        mode === AT.PlayerMode.EnabledBackingTrack ||
        mode === AT.PlayerMode.EnabledExternalMedia;

      // masterVolume pilote le synthé ; en mode Mix il pilote le MIDI seul
      S.api.masterVolume = usesAudio ? S.audioVolume : S.midiVolume;
      if (mode !== AT.PlayerMode.EnabledExternalMedia) {
        AudioSync.element.volume = S.audioVolume;   // notre <audio> reste cohérent
      }
      App.updateSourceBadge(mode, usesAudio, S.source);
    }

    /* Source demandée → playerMode alphaTab */
    function modeFor(source) {
      if (source === 'synth' || source === 'mix') return AT.PlayerMode.EnabledSynthesizer;
      if (source === 'external') return AT.PlayerMode.EnabledExternalMedia;
      return AT.PlayerMode.EnabledAutomatic;
    }

    /* -------- Source : auto / synthé / MIX / média externe -------- */
    async function setSource(source) {
      if (!S.api) return;
      const prev   = S.source;
      const revert = () => { $('#sourceSelect').value = prev; S.source = prev; };

      const target = modeFor(source);

      // 1. extraire l'audio embarqué AVANT toute bascule de mode
      if (source === 'external' || source === 'mix') {
        if (!S.score) {
          App.toast('Chargez d\'abord un fichier Guitar Pro.', 'error');
          revert(); return;
        }
        const ok = await prepareExternalAudio();
        if (!ok) { revert(); return; }
      }

      // 2. couper proprement ce qui tournait encore
      AudioSync.detach();
      MixSync.stop();
      S.source = source;

      // 3. bascule de mode (alphaTab recrée le player si nécessaire)
      S.api.settings.player.playerMode = target;
      S.api.updateSettings();

      // 4. rebrancher
      if (source === 'external') {
        try {
          AudioSync.attach(S.api.player.output);
          S.api.masterVolume = S.audioVolume;
        } catch (e) { console.warn(e); }
      } else if (source === 'mix') {
        MixSync.build(S.score);      // pont synthTime → syncTime
        MixSync.start();             // <audio> actif, en esclave
        MixSync.onState(S.api.playerState);
      }

      applyVolumes();
      refreshModeDependentUI();
      App.toast('Source : ' + $('#sourceSelect').selectedOptions[0].textContent, 'info');
    }

    /* Récupère le blob audio embarqué (sans le brancher).
       `quiet` = pas de toast (usage automatique au chargement d'un score). */
    async function getEmbeddedBlob(quiet) {
      let blob = null;
      // 3a. ce qu'alphaTab a déjà extrait du .gp
      if (S.score) blob = EmbeddedAudio.fromScore(S.score);
      // 3b. sinon on ouvre soi-même le zip avec JSZip (bonus)
      if (!blob && S.currentFile && typeof JSZip !== 'undefined') {
        if (!quiet) App.loader(true, 'Extraction de l\'audio embarqué (JSZip)…');
        try {
          const res = await EmbeddedAudio.extract(S.currentFile);
          if (res) blob = res.blob;
        } catch (e) { console.warn('JSZip', e); }
        if (!quiet) App.loader(false);
      }
      if (!blob && !quiet) App.toast('Aucun audio embarqué détecté dans ce fichier.', 'error');
      return blob;
    }

    async function prepareExternalAudio(quiet) {
      const blob = await getEmbeddedBlob(quiet);
      if (!blob) { AudioSync.setSource(null); return false; }
      if (S.externalBlobUrl) URL.revokeObjectURL(S.externalBlobUrl);
      S.externalBlobUrl = URL.createObjectURL(blob);
      AudioSync.setSource(S.externalBlobUrl);
      return true;
    }

    /* Mode Mix : on branche l'audio dès qu'un score est chargé. */
    function ensureMixAudio() {
      return prepareExternalAudio(true).then(ok => {
        if (ok) { MixSync.start(); MixSync.onState(S.api && S.api.playerState); }
        return ok;
      }).catch(() => false);
    }

    /* -------- Pistes -------- */
    function showTrack(index) {
      if (!S.score) return;
      const tracks = index === 'all' ? S.score.tracks.slice() : [S.score.tracks[index]];
      S.api.renderTracks(tracks);
    }
    function setTrackMute(track, mute)  { S.api.changeTrackMute([track], mute); }
    function setTrackSolo(track, solo)  { S.api.changeTrackSolo([track], solo); }
    function resetChannels() {
      if (!S.api.player) return;
      S.api.player.resetChannelStates();
      App.refreshTrackMuteStates();
    }

    /* -------- Boucle -------- */
    function toggleLoop() {
      S.loopOn = !S.loopOn;
      S.api.isLooping = S.loopOn;
      App.syncLoop(S.loopOn);
    }

    function setLoopRange(startIdx, endIdx) {
      if (!S.score || startIdx < 0 || endIdx < 0) return;
      const bars = S.score.masterBars;
      const a = Math.min(startIdx, endIdx), b = Math.max(startIdx, endIdx);
      const range = new (AT.PlaybackRange || Object)();
      range.startTick = bars[a].start;
      range.endTick   = (b + 1 < bars.length) ? bars[b + 1].start : S.api.endTick;
      S.api.playbackRange = range;
      S.api.isLooping = true;
      S.loopOn = true;
      App.syncLoop(true);
      App.toast(`Boucle mesures ${a + 1} → ${b + 1}`, 'info');
    }

    function clearLoopRange() {
      if (!S.api) return;
      S.api.playbackRange = null;
      S.api.clearPlaybackRangeHighlight();
      App.onPlaybackRange(null);
    }

    /* -------- Affichage -------- */
    function setLayout(mode) {
      S.api.settings.display.layoutMode = mode;
      S.api.updateSettings();
      S.api.render();
    }
    function setScrollMode(mode) {
      S.api.settings.player.scrollMode = mode;
      S.api.updateSettings();
    }
    function setSpeed(pct) { S.api.playbackSpeed = pct; MixSync.setRate(pct); }

    function refreshModeDependentUI() {
      App.syncMetronome(S.metronomeOn, isSynthMode());
      applyVolumes();
    }

    return {
      S, init, loadFile,
      play, pause, toggle, stop, seekRatio, gotoBar,
      setMetronome, setMetronomeVolume,
      setMidiVolume, setAudioVolume, setSource,
      showTrack, setTrackMute, setTrackSolo, resetChannels,
      toggleLoop, setLoopRange, clearLoopRange,
      setLayout, setScrollMode, setSpeed, applyVolumes, isSynthMode
    };
  })();

  /* ========================= 6. APP =============================== */
  const App = (() => {
    let dragging = false;
    let scrubbing = false;
    const mqDesktop = window.matchMedia('(min-width: 768px)');

    /* ---------- toasts ---------- */
    function toast(msg, type = 'info') {
      const colors = {
        info:  'border-sky-500/40 text-sky-200',
        error: 'border-rose-500/50 text-rose-200',
        ok:    'border-emerald-500/40 text-emerald-200'
      };
      const el = document.createElement('div');
      el.className = `rounded-xl border bg-slate-900/95 px-4 py-2.5 text-sm shadow-xl backdrop-blur ${colors[type] || colors.info} opacity-0 transition-opacity duration-200`;
      el.textContent = msg;
      $('#toastBox').appendChild(el);
      requestAnimationFrame(() => el.classList.remove('opacity-true'));
      el.classList.add('opacity-100');
      setTimeout(() => { el.classList.remove('opacity-100'); setTimeout(() => el.remove(), 250); }, 3200);
    }

    /* ---------- loader / empty state ---------- */
    let loaderOn  = false;
    let loaderTmr = null;

    function loader(on, text) {
      loaderOn = !!on;
      $('#loader').classList.toggle('hidden', !on);
      if (text) $('#loaderText').textContent = text;
      if (loaderTmr) { clearTimeout(loaderTmr); loaderTmr = null; }
    }

    /* Garde-fou : alphaTab ne déclenche `renderFinished` que si le rendu a
       réellement lieu. Or il diffère TANT QUE les polices (Bravura) ne sont pas
       chargées → un simple 404 sur fontDirectory laisse le loader bloqué à vie.
       On laisse 12 s, puis on relève et on diagnostique. */
    function armLoaderWatchdog(label) {
      if (loaderTmr) clearTimeout(loaderTmr);
      loaderTmr = setTimeout(() => {
        loaderTmr = null;
        if (!loaderOn) return;
        loaderOn = false;
        $('#loader').classList.add('hidden');
        const api = Player.S.api;
        const fontsOk = !!(api && api.uiFacade && api.uiFacade.canRender);
        toast(fontsOk
          ? `Rendu anormalement lent (${label}).`
          : 'Polices de notation (Bravura) introuvables → rendu bloqué. Vérifiez core.fontDirectory (slash final) et le CDN.',
          'error');
      }, 12000);
    }

    function hideEmptyState() {
      // #scoreArea n'est JAMAIS masqué : alphaTab mesure sa largeur au render.
      $('#emptyState').classList.add('hidden');
    }
    function showEmptyState() {
      $('#emptyState').classList.remove('hidden');
    }

    /* ---------- samples ---------- */
    function buildSamples() {
      const box = $('#sampleList');
      box.innerHTML = '';
      CFG.samples.forEach(s => {
        const b = document.createElement('button');
        b.className = 'group flex w-full items-center gap-3 rounded-lg border border-white/5 bg-slate-800/50 px-3 py-2 text-left transition hover:border-sky-500/50 hover:bg-slate-800';
        b.innerHTML = `<span class="text-sky-400 opacity-70 group-hover:opacity-100">▶</span>
                       <span class="truncate text-[13px] text-slate-300">${s.label}</span>
                       <span class="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-slate-600">gp</span>`;
        b.onclick = () => loadSample(s);
        box.appendChild(b);
      });
    }

    async function loadSample(s) {
      loader(true, `Téléchargement de « ${s.label} »…`);
      try {
        const res  = await fetch(encodeURI('samples/' + s.file));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const file = new File([blob], s.file, { type: 'application/octet-stream' });
        loader(false);
        Player.loadFile(file, s.label);
      } catch (e) {
        console.error(e);
        loader(false);
        toast('Chargement impossible en file:// — utilisez un serveur local (Live Server).', 'error');
      }
    }

    /* ---------- score loaded : remplir les UI ---------- */
    function onScoreLoaded(score) {
      // titre
      const title = [score.title, score.artist].filter(Boolean).join(' — ') || 'Sans titre';
      $('#drawerScoreTitle').textContent = title;
      document.title = `${title} · GP8 Player`;

      // sélecteur de pistes
      const sel = $('#trackSelect');
      sel.innerHTML = '';
      const optAll = document.createElement('option');
      optAll.value = 'all';
      optAll.textContent = `Toutes les pistes (${score.tracks.length})`;
      sel.appendChild(optAll);
      score.tracks.forEach(t => {
        const o = document.createElement('option');
        o.value = String(t.index);
        o.textContent = `${t.index + 1}. ${t.name || 'Piste ' + (t.index + 1)}`;
        sel.appendChild(o);
      });
      sel.value = 'all';
      sel.disabled = false;

      // boucle A/B
      fillBarSelect($('#loopStart'), score.masterBars.length);
      fillBarSelect($('#loopEnd'),   score.masterBars.length);
      $('#loopStart').disabled = $('#loopEnd').disabled = false;
      $('#btnApplyLoop').disabled = $('#btnClearLoop').disabled = false;
      $('#loopStart').value = '0';
      $('#loopEnd').value   = String(Math.max(0, Math.min(7, score.masterBars.length - 1)));

      // drawer
      buildTrackList(score);

      // boutons
      ['#btnPlay', '#btnStop', '#btnPrev', '#btnNext', '#btnMetronome', '#btnLoop']
        .forEach(id => $(id).disabled = false);

      Player.S.currentBar = 0;
      $('#barLabel').textContent = `M. 1/${score.masterBars.length}`;
      toast(`« ${title} » chargé — ${score.tracks.length} piste(s), ${score.masterBars.length} mesures`, 'ok');

      // badge : la source + la présence d'un audio sont posées par
      // updateSourceBadge() appelé juste après via applyVolumes().
    }

    function fillBarSelect(sel, count) {
      sel.innerHTML = '';
      for (let i = 0; i < count; i++) {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `Mesure ${i + 1}`;
        sel.appendChild(o);
      }
    }

    function buildTrackList(score) {
      const list = $('#trackList');
      list.innerHTML = '';
      score.tracks.forEach(t => {
        const row = document.createElement('div');
        row.className = 'mb-1.5 flex items-center gap-2 rounded-xl border border-white/5 bg-slate-800/60 px-3 py-2.5';
        row.dataset.trackIndex = String(t.index);
        row.innerHTML = `
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
                style="background:${hexColor(t.color)}; color:#0b1220">${t.index + 1}</span>
          <button class="flex-1 truncate text-left text-[13px] text-slate-200 hover:text-sky-300"
                  title="Afficher cette piste">${escapeHtml(t.name || 'Piste ' + (t.index + 1))}</button>
          <button class="btn-ctl h-7 min-w-7 text-[10px] font-bold btn-mute" title="Mute">M</button>
          <button class="btn-ctl h-7 min-w-7 text-[10px] font-bold btn-solo" title="Solo">S</button>`;

        row.querySelector('button').onclick = () => {
          $('#trackSelect').value = String(t.index);
          Player.showTrack(t.index);
          closeDrawer();
        };
        row.querySelector('.btn-mute').onclick = e => {
          const on = !e.currentTarget.classList.contains('is-on');
          e.currentTarget.classList.toggle('is-on', on);
          Player.setTrackMute(t, on);
        };
        row.querySelector('.btn-solo').onclick = e => {
          const on = !e.currentTarget.classList.contains('is-on');
          e.currentTarget.classList.toggle('is-on', on);
          Player.setTrackSolo(t, on);
        };
        list.appendChild(row);
      });
    }

    function refreshTrackMuteStates() {
      $$('.btn-mute, .btn-solo', $('#trackList')).forEach(b => b.classList.remove('is-on'));
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }
    function hexColor(c) {
      if (!c) return '#38bdf8';
      try { return `rgba(${c.r | 0},${c.g | 0},${c.b | 0},.85)`; } catch (e) { return '#38bdf8'; }
    }

    /* ---------- position ---------- */
    function updatePosition(e) {
      if (scrubbing) return;
      const range = Player.S.api.playbackRange;
      const from  = range ? range.startTick : 0;
      const to    = range ? range.endTick   : e.endTick;
      const tick  = clamp(e.currentTick, from, to);
      const ratio = to > from ? (tick - from) / (to - from) : 0;

      const p = $('#progress');
      p.value = String(Math.round(ratio * 1000));
      paintRange(p);

      $('#timeLabel').textContent = `${fmtTime(e.currentTime)} / ${fmtTime(e.endTime)}`;
    }

    /* ---------- badges ---------- */
    function syncPlayBadge(playing) {
      $('#btnPlay').classList.toggle('is-on', playing);
    }
    function syncMetronome(on, synthActive) {
      const b = $('#btnMetronome');
      b.classList.toggle('is-on', !!on);
      b.disabled = !synthActive;
      b.title = synthActive ? 'Métronome (M)' : 'Métronome indisponible en mode piste audio';
    }
    function syncLoop(on) {
      $('#btnLoop').classList.toggle('is-on', !!on);
    }
    function onPlaybackRange(range) {
      const has = !!range;
      $('#btnClearLoop').disabled = !has;
      if (has) {
        $('#loopStart').value = String(barIndexAt(range.startTick));
        $('#loopEnd').value   = String(Math.max(0, barIndexAt(range.endTick) - 1));
      }
    }
    function barIndexAt(tick) {
      const bars = Player.S.score ? Player.S.score.masterBars : [];
      for (let i = bars.length - 1; i >= 0; i--) if (bars[i].start <= tick) return i;
      return 0;
    }

    function updateSourceBadge(mode, usesAudio, source) {
      const badge = $('#sourceBadge');
      const hint  = $('#volHint');

      if (source === 'mix') {
        badge.textContent = 'Source : Mix (MIDI + audio)';
        badge.className = 'rounded-full px-2 py-0.5 text-[10px] font-semibold border border-sky-500/40 bg-sky-500/10 text-sky-300';
        hint.textContent = 'Le synthé MIDI est maître du temps (métronome, mute/solo, boucle, curseur) ; la piste audio embarquée est recadrée en continu pour rester calée dessus. « MIDI » = synthé, « Audio » = piste.';
      } else if (mode === AT.PlayerMode.EnabledBackingTrack) {
        badge.textContent = 'Source : audio embarqué';
        hint.textContent = 'La piste audio intégrée est active → le curseur MIDI et le métronome sont désactivés. Le slider « Audio » pilote le volume.';
      } else if (mode === AT.PlayerMode.EnabledExternalMedia) {
        badge.textContent = 'Source : <audio> externe';
        hint.textContent = 'Notre balise <audio> pilote le temps. Le synthé MIDI est muet → slider « Audio » actif.';
      } else if (mode === AT.PlayerMode.EnabledSynthesizer) {
        badge.textContent = 'Source : synthé MIDI';
        hint.textContent = 'Synthèse MIDI (soundfont) → métronome, volumes par piste et boucle actifs. Slider « MIDI » actif.';
      } else {
        badge.textContent = 'Source : —';
        hint.textContent = '—';
      }

      // info complémentaire : le fichier contient-il une piste audio ?
      const score = Player.S.score;
      if (score) {
        const hasAudio = !!(score.backingTrack && score.backingTrack.rawAudioFile);
        badge.textContent += hasAudio ? ' · audio ✓' : ' · pas d\'audio';
      }
    }

    /* ---------- range painting (progression lue à l'œil) ---------- */
    function paintRange(input) {
      const min = +input.min || 0, max = +input.max || 100;
      const pct = ((+input.value - min) / (max - min)) * 100;
      input.style.setProperty('--pct', pct + '%');
    }
    function paintAllRanges() {
      $$('input[type=range]').forEach(paintRange);
    }

    /* ---------- drawer ---------- */
    function openDrawer() {
      $('#drawer').classList.remove('translate-x-full');
      $('#drawerBackdrop').classList.remove('hidden');
    }
    function closeDrawer() {
      $('#drawer').classList.add('translate-x-full');
      $('#drawerBackdrop').classList.add('hidden');
    }

    /* ---------- drag & drop ---------- */
    function wireDnD() {
      let depth = 0;
      window.addEventListener('dragenter', e => {
        e.preventDefault(); depth++;
        $('#dropOverlay').classList.remove('hidden');
        $('#dropOverlay').classList.add('flex');
      });
      window.addEventListener('dragover', e => e.preventDefault());
      window.addEventListener('dragleave', e => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) hideDropOverlay();
      });
      window.addEventListener('drop', e => {
        e.preventDefault(); depth = 0; hideDropOverlay();
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) Player.loadFile(f, f.name);
      });
      function hideDropOverlay() {
        $('#dropOverlay').classList.add('hidden');
        $('#dropOverlay').classList.remove('flex');
      }
    }

    /* ---------- raccourcis clavier ---------- */
    function wireShortcuts() {
      document.addEventListener('keydown', e => {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
        if (!Player.S.api || !Player.S.score) return;

        switch (e.key) {
          case ' ': e.preventDefault(); Player.toggle(); break;
          case 'm': case 'M': Player.setMetronome(!Player.S.metronomeOn); break;
          case 'l': case 'L': Player.toggleLoop(); break;
          case 'ArrowLeft':  e.preventDefault(); Player.gotoBar(e.shiftKey ? -4 : -1); break;
          case 'ArrowRight': e.preventDefault(); Player.gotoBar(e.shiftKey ?  4 :  1); break;
          case 'Escape': closeDrawer(); break;
        }
      });
    }

    /* ---------- responsive : layout ---------- */
    function applyResponsiveLayout() {
      if (!Player.S.api || !Player.S.score) return;
      // le layout par défaut suit la largeur d'écran ; on laisse le choix manuel ensuite
      const wanted = mqDesktop.matches ? 'horizontal' : 'page';
      if (Player.S.api.settings.display.layoutMode !== wanted && !layoutTouched) {
        $('#layoutSelect').value = wanted;
        Player.setLayout(wanted);
      }
    }
    let layoutTouched = false;

    /* ---------- wiring ---------- */
    function wireUI() {
      // fichier
      $('#fileInput').addEventListener('change', e => {
        const f = e.target.files && e.target.files[0];
        if (f) Player.loadFile(f, f.name);
        e.target.value = '';
      });

      // transport
      $('#btnPlay').onclick       = () => Player.toggle();
      $('#btnStop').onclick       = () => Player.stop();
      $('#btnPrev').onclick       = () => Player.gotoBar(-1);
      $('#btnNext').onclick       = () => Player.gotoBar(1);
      $('#btnMetronome').onclick  = () => Player.setMetronome(!Player.S.metronomeOn);
      $('#btnLoop').onclick       = () => Player.toggleLoop();

      // panneau avancé (mobile)
      $('#btnMore').onclick = () => document.body.classList.toggle('adv-open');

      // progression : scrub
      const p = $('#progress');
      p.addEventListener('pointerdown', () => scrubbing = true);
      p.addEventListener('input',  () => paintRange(p));
      p.addEventListener('change', () => { Player.seekRatio(+p.value / 1000); scrubbing = false; });
      p.addEventListener('pointerup',   () => scrubbing = false);

      // pistes
      $('#trackSelect').onchange = e => {
        const v = e.target.value;
        Player.showTrack(v === 'all' ? 'all' : Number(v));
      };

      // volumes / vitesse
      $('#volMidi').addEventListener('input', e => {
        paintRange(e.target); $('#volMidiVal').textContent = e.target.value;
        Player.setMidiVolume(+e.target.value / 100);
      });
      $('#volAudio').addEventListener('input', e => {
        paintRange(e.target); $('#volAudioVal').textContent = e.target.value;
        Player.setAudioVolume(+e.target.value / 100);
      });
      $('#volClick').addEventListener('input', e => {
        paintRange(e.target); $('#volClickVal').textContent = e.target.value;
        Player.setMetronomeVolume(+e.target.value / 100);
      });
      $('#speed').addEventListener('input', e => {
        paintRange(e.target); $('#speedVal').textContent = e.target.value + '%';
        Player.setSpeed(+e.target.value / 100);
      });

      // source
      $('#sourceSelect').onchange = e => Player.setSource(e.target.value);

      // boucle A/B
      $('#btnApplyLoop').onclick = () => Player.setLoopRange(+$('#loopStart').value, +$('#loopEnd').value);
      $('#btnClearLoop').onclick = () => Player.clearLoopRange();

      // affichage
      $('#layoutSelect').onchange = e => { layoutTouched = true; Player.setLayout(e.target.value); };
      $('#scrollSelect').onchange = e => Player.setScrollMode(e.target.value);

      // drawer : bouton "liste des pistes" ajouté à côté du select
      $('#drawerClose').onclick   = closeDrawer;
      $('#drawerBackdrop').onclick = closeDrawer;
      $('#btnAllTracks').onclick  = () => { $('#trackSelect').value = 'all'; Player.showTrack('all'); };
      $('#btnResetChannels').onclick = () => Player.resetChannels();

      // afficher le drawer depuis le select (icône liste ajoutée dynamiquement)
      const listBtn = document.createElement('button');
      listBtn.className = 'btn-ctl';
      listBtn.title = 'Toutes les pistes (liste)';
      listBtn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>';
      listBtn.onclick = openDrawer;
      $('#trackSelect').insertAdjacentElement('afterend', listBtn);

      // responsive
      mqDesktop.addEventListener('change', applyResponsiveLayout);
    }

    /* ---------- boot ---------- */
    function boot() {
      if (typeof alphaTab === 'undefined') {
        document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">Impossible de charger alphaTab (CDN injoignable).</div>';
        return;
      }
      AudioSync.init();
      buildSamples();
      wireUI();
      wireDnD();
      wireShortcuts();
      paintAllRanges();

      Player.init($('#scoreArea'));
      applyResponsiveLayout();

      console.log('%cGP8 Player%c alphaTab ' + (alphaTab.meta && alphaTab.meta.version || '1.8.4'),
        'background:#0ea5e9;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold', 'color:#64748b');
    }

    return {
      boot, toast, loader, armLoaderWatchdog, hideEmptyState, showEmptyState,
      onScoreLoaded, updatePosition,
      syncPlayBadge, syncMetronome, syncLoop, onPlaybackRange, updateSourceBadge,
      refreshTrackMuteStates, openDrawer, closeDrawer
    };
  })();

  document.addEventListener('DOMContentLoaded', App.boot);
