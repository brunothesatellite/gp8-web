

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
        // TOUJOURS le synthé. C'est lui qui porte le métronome, les niveaux
        // par piste, le mute/solo et l'horloge maîtresse. L'audio embarqué
        // est joué par NOTRE <audio> recadré sur lui (MixSync) : alphaTab ne
        // le joue pas en mode synthé (`AlphaSynth.loadBackingTrack` = no-op).
        // ⚠ `enabledAutomatic` résoudrait en EnabledBackingTrack pour un .gp
        //   avec audio → alphaTab COUPERAIT le synthé (plus de MIDI ni de
        //   métronome). Le choix de source a donc été supprimé de l'UI.
        playerMode: 'enabledSynthesizer',
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

  /* Les réglages "enum" d'alphaTab sont des ENTIERS au runtime :
       LayoutMode.Page = 0, .Horizontal = 1, .Parchment = 2
       ScrollMode.Off  = 0, .Continuous = 1, .OffScreen = 2, .Smooth = 3

     Seul le CHEMIN DE CONSTRUCTION convertit les chaînes : `new AlphaTabApi(el,
     {...})` passe par `JsonConverter.jsObjectToSettings()` → `JsonHelper.parseEnum()`.
     Une affectation directe (`api.settings.display.layoutMode = 'horizontal'`)
     laisse la STRING en place, et `Environment.getLayoutEngineFactory()` fait :

         if (!layoutMode || !Environment.layoutEngines.has(layoutMode))
           return ...LayoutEngineFactory.get(LayoutMode.Page);   // ← Page silencieux !

     → le select disait "Horizontal" pendant que la partition restait en Page.
       D'où ce convertisseur, à appeler sur TOUTE affectation d'un réglage enum. */
  function enumId(enumObj, name) {
    if (!enumObj || name === null || name === undefined) return name;
    if (typeof name === 'number') return name;
    const key = Object.keys(enumObj)
      .filter(k => !/^\d+$/.test(k))                       // exclut le reverse-mapping
      .find(k => k.toLowerCase() === String(name).toLowerCase());
    return key !== undefined ? enumObj[key] : name;
  }
  const layoutId  = v => enumId(_AT.LayoutMode,  v);
  const scrollId  = v => enumId(_AT.ScrollMode,  v);

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
   *  Rôle : héberger le lecteur HTML5 de la piste audio embarquée, jouée en
   *  ESCLAVE du synthé alphaTab (cf. MixSync) — alphaTab reste maître du
   *  temps, on ne fait que coller notre <audio> dessus.
   *
   *  Le mode `enabledExternalMedia` d'alphaTab (IExternalMediaHandler) n'est
   *  plus utilisé : le choix de source a été retiré de l'UI et le mode de
   *  lecture est fixé à `enabledSynthesizer`.
   */
  const AudioSync = (() => {
    const audio = $('#externalAudio');
    let url = null;            // objectURL en cours

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

    /* ---- Synchronisation ----
     *  alphaTab est maître du temps : MixSync (module 4) est l'unique
     *  mécanisme de calage entre le synthé et notre <audio> ci-dessus. */
    return { setSource, element: audio };
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
      master: 0.85,        // Master (synthé MIDI)
      audioVolume: 1.0,    // fader « Audio Track »
      metronomeVolume: 0.6,
      metronomeOn: false,
      loopOn: false,
      currentBar: 0,
      externalReady: false,
      externalBlobUrl: null,
      mix: null,           // modèle du mélangeur (source de vérité)
      perf: null           // chronomètre de chargement (journal console)
    };

    /* -------- Modèle du mélangeur --------
     *  Une SEULE structure pilote l'affichage ET l'écoute. Le DOM du tiroir
     *  n'est qu'un reflet (App.refreshMixStates()) : aucune décision n'est
     *  prise à partir d'une classe CSS. */
    function createMix() {
      S.mix = {
        display:  'all',      // 'all'  | index de la seule piste affichée
        solo:     null,       // null   | index de piste | 'audio'  → UN seul
        muted:    new Set(),  // index des pistes en mute
        vol:      new Map(),  // index -> niveau 0..1.5
        audioMute: false
      };
    }

    /* -------- Initialisation alphaTab -------- */
    /* ======== TRACE DE CHARGEMENT (diagnostic) =====================
       `renderFinished` peut ne JAMAIS arriver sans qu'aucune erreur ne
       soit levée : le layout d'une grande partition est asynchrone
       (worker) et alphaTab ne prévient pas entre le moment où il reçoit
       la partition et celui où il a fini d'agencer la dernière mesure.
       Ces lignes horodatées (t0 = appel de loadFile) montrent OU le
       chargement s'arrête :
         +at scoreLoaded        → analyse du .gp terminée
         +at midiLoaded         → génération MIDI terminée
         +at preRender          → le worker a reçu l'ordre d'agencer
         +at partialLayout #n   → n systèmes agencés (la progression)
         +at renderFinished     → agencement complet
       Sans `preRender` : le message n'est jamais parti (largeur 0).
       Avec `preRender` mais sans suite : le layout est le coût réel.   */
    function trace(label, extra) {
      const t = S.perf ? Math.round(performance.now() - S.perf.t0) : Math.round(performance.now());
      console.log(`[at +${t}ms] ${label}${extra ? ' · ' + extra : ''}`);
    }
    let nLayout = 0, nPaint = 0;

    /* ================ CORRECTIF VENDOR (alphaTab 1.8.4) =============
       Le bundle CDN contient, dans `AlphaSynthWebWorkerApi` (l.33576) :

           get loadedMidiInfo() { return this.loadedMidiInfo; }

       …le getter s'APPELLE LUI-MÊME → `RangeError: Maximum call stack size
       exceeded`. Et comme `EventEmitterOfT.on()` évalue son fournisseur AU
       MOMENT DE L'ENREGISTREMENT (l.24729), la simple ligne
       `api.midiLoaded.on(…)` faisait exploser `wireEvents()` en son milieu :
       tout ce qui venait après — `error`, `renderFinished`,
       `postRenderFinished`, `partialLayout`, position, mesure, état — n'était
       JAMAIS branché. Le rendu alphaTab, lui, était parfait : d'où une
       partition peinte et un loader qui ne se levait JAMAIS, quel que soit le
       temps d'agencement.

       On répare le getter exactement comme la classe saine d'alphaTab
       (`return this._loadedMidiInfo`, l.39852), y compris si l'instance du
       synthé n'existe pas encore au démarrage (on s'intercale alors sur son
       affectation). Sans jamais lever d'exception : échec → on continue.     */
    function patchVendorMidiInfo(player) {
      if (!player) return;
      const fix = (obj) => {
        if (!obj) return;
        const proto = Object.getPrototypeOf(obj);
        const d = Object.getOwnPropertyDescriptor(proto, 'loadedMidiInfo');
        if (!d || typeof d.get !== 'function') return;
        // On ne touche qu'au getter auto-récursif, pas à celui déjà sain.
        if (Function.prototype.toString.call(d.get).indexOf('return this.loadedMidiInfo;') === -1) return;
        Object.defineProperty(proto, 'loadedMidiInfo', {
          configurable: true,
          enumerable: d.enumerable,
          get() { return this._loadedMidiInfo; }
        });
        console.log('[vendor] getter `loadedMidiInfo` réparé (auto-récursion supprimée)');
      };

      try {
        let inst = player._instance;
        fix(inst);
        // `_instance` est un champ de classe (configurable) : on le remplace
        // par un accesseur qui répare le futur synthé dès qu'il est créé.
        Object.defineProperty(player, '_instance', {
          configurable: true,
          enumerable: true,
          get() { return inst; },
          set(v) { inst = v; fix(v); }
        });
      } catch (e) {
        console.warn('[vendor] réparation de loadedMidiInfo impossible', e);
      }
    }

    function init(container) {
      createMix();                   // modèle de mixage vide, dispo tout de suite
      S.api = new alphaTab.AlphaTabApi(container, CFG.alphatab);
      /* `api.player` renvoie NULL tant que `_player.instance` n'est pas prêt
         (l.46264) : on cible l'objet interne `api._player`, le
         `AlphaSynthWrapper` qui porte réellement `_instance`. */
      patchVendorMidiInfo(S.api._player || S.api.player);
      wireEvents();
      return S.api;
    }

    /* Chaque enregistrement passe par là : si un fournisseur vendor lève au
       moment de l'enregistrement, on l'isole. `EventEmitterOfT.on()` pousse
       l'écouteur AVANT d'évaluer le fournisseur, donc l'événement reste
       branché même quand l'évaluation échoue. */
    function reg(fn) {
      try { fn(); } catch (e) { console.error('[at] enregistrement impossible', e); }
    }

    function wireEvents() {
      const api = S.api;

      api.scoreLoaded.on(score => safe(() => {
        const t0 = performance.now();
        if (S.perf) S.perf.scoreLoaded = Math.round(performance.now() - S.perf.t0);
        nLayout = 0; nPaint = 0;
        trace('scoreLoaded', `${score.tracks.length} pistes · ${score.masterBars.length} mesures`);
        S.score = score;
        createMix();                 // un modèle neuf pour ce score
        MixSync.suspend();
        App.onScoreLoaded(score);    // DOM du tiroir (léger)
        seedMixVolumes();            // niveaux d'origine dans le modèle
        refreshModeDependentUI();    // Master + volume audio
        App.refreshMixStates();      // reflet du modèle (DOM seulement)
        if (S.perf) S.perf.handler = Math.round(performance.now() - t0);

        /* ⚠ PIÈGE DE CHARGEMENT — `_internalRenderTracks()` fait, EN SYNCHRONE
           et dans CET ordre :
               scoreLoaded  →  loadMidiForScore()  →  render()
           donc TOUT ce qu'on fait ici s'exécute AVANT le premier dessin de la
           partition.  On ne garde donc sur le chemin critique que le DOM ; le
           pont audio (1 passe complète du score) et les canaux MIDI partent
           en setTimeout(0), qui ne s'exécute qu'une fois la tâche courante —
           donc le MIDI ET le rendu — entièrement terminés. */
        deferAudioWork(score);
      })());

      /* `loadMidiFile()` recrée l'état des canaux côté worker : on repasse le
         modèle juste après (le moteur ne retient ni mute ni volume par piste).
         NB : `readyForPlayback` (déclenché APRÈS `midiLoaded`) réécrit TOUS
         les volumes à `playbackInfo.volume / 16` — d'où le 2ᵉ réflexe.
         ⚠ Enregistrés plus BAS, une fois le rendu branché : chez alphaTab
         1.8.4 leur fournisseur lit le getter `loadedMidiInfo` défectueux. */

      api.error.on(err => safe(() => {
        console.error('[alphaTab]', err);
        App.toast('Erreur alphaTab : ' + (err && err.message ? err.message : err), 'error');
        App.loader(false);
      })());

      // `renderFinished` = layout+agencement terminés ; `postRenderFinished`
      // = gestionnaires suivants exécutés.
      api.renderFinished.on(e => safe(() => {
        trace('renderFinished', `${e.totalWidth}×${e.totalHeight}px · ${nLayout} partial(s) layouté(s)`);
        App.loader(false); markPaint();
      })());
      api.postRenderFinished.on(() => safe(() => { trace('postRenderFinished'); App.loader(false); markRender(); })());

      /* ---- Révélation PROGRESSIVE + sonde de layout ----
         `enableLazyLoading` est VRAI par défaut : alphaTab ne peint que les
         portions visibles. `renderFinished` n'attend donc que la FIN DU
         LAYOUT, qui est le vrai coût sur une grande partition multi-pistes.
         On se branche sur les événements bas niveau de `api.renderer` pour
         (a) reveals la feuille dès la première portion peinte — le loader ne
         peut plus jamais masquer une partition déjà lisible — et (b) compter
         les partials : si le compteur monte, le layout AVANCE (c'est long,
         pas bloqué) ; s'il reste à 0, le worker n'a rien reçu. */
      const rd = api.renderer;
      if (rd && rd.partialLayoutFinished) {
        rd.partialLayoutFinished.on(() => safe(() => {
          nLayout++;
          if (nLayout === 1 || nLayout % 25 === 0) trace(`partialLayout #${nLayout}`);
          App.loader(false); markPaint();        // du contenu est posé → on révèle
        })());
      }
      if (rd && rd.partialRenderFinished) {
        rd.partialRenderFinished.on(() => safe(() => {
          nPaint++;
          if (nPaint === 1) trace(`partialRender #1 (1ʳᵉ portion peinte)`);
          App.loader(false); markPaint();
        })());
      }
      console.log('[init] hooks renderer :',
        !rd ? 'api.renderer ABSENT'
            : `partialLayout=${!!rd.partialLayoutFinished} partialRender=${!!rd.partialRenderFinished} preRender=${!!rd.preRender}`);
      if (rd && rd.preRender) {
        rd.preRender.on(resize => safe(() => trace('preRender', resize ? 'resize (re-layout complet relancé !)' : 'nouveau rendu')));
      }

      /* --- mixage : on repasse le modèle dès que les canaux existent.
             Enregistrés en DERNIER et isolés par `reg()` : ce sont eux qui,
             chez alphaTab 1.8.4, lisent le getter vendor défectueux.
             ⚠ `api.player` vaut NULL au démarrage (getter conditionné à
             `_player.instance`) : on s'adresse au wrapper `api._player`,
             qui expose `readyForPlayback` quel que soit l'état du synthé.  */
      reg(() => api.midiLoaded.on(() => safe(() => { trace('midiLoaded'); applyMix(); })()));
      const wrapper = api._player || api.player;
      if (wrapper && wrapper.readyForPlayback) {
        reg(() => wrapper.readyForPlayback.on(() => safe(() => { trace('readyForPlayback'); applyMix(); })()));
      }

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
      S.perf = { t0: performance.now(), name: label || file.name, reported: false };
      App.loader(true, `Analyse de « ${label || file.name} »…`);
      App.armLoaderWatchdog(label || file.name);
      // On révèle #scoreArea AVANT le render pour qu'alphaTab mesure
      // immédiatement sa largeur réelle (l'état vide est un overlay absolu,
      // il n'influence pas cette mesure).
      App.hideEmptyState();
      try {
        const buffer = await file.arrayBuffer();
        S.currentFile = file;
        // Le mode de lecture est DÉFINITIF (CFG → enabledSynthesizer) : on ne
        // le touche plus jamais, sinon alphaTab recrée le player et perd la
        // position. `enabledAutomatic` couperait le synthé dès qu'il y a de
        // l'audio embarqué — plus de métronome, ni de mute/solo, ni de volumes.
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

    /* -------- Volumes --------
     *  • Master      → masterVolume du synthé MIDI
     *  • Audio Track → volume de NOTRE <audio> (recadré par MixSync)
     *  • Métronome   → métronome alphaTab (événement MIDI)
     *  Il n'y a plus de « source » à router : le mode de lecture est fixe. */
    function setMasterVolume(v) { S.master = clamp(v, 0, 1); applyVolumes(); }
    function setAudioVolume(v)  { S.audioVolume = clamp(v, 0, 1); applyVolumes(); }

    function isSynthMode() {
      return S.api && S.api.actualPlayerMode === AT.PlayerMode.EnabledSynthesizer;
    }

    function applyVolumes() {
      if (!S.api) return;
      S.api.masterVolume = S.master;
      // L'audio embarqué suit le mute/solo du mélangeur : on coupe le VOLUME
      // (et pas le flux) pour que MixSync continue de piloter la position et
      // de corriger la dérive.
      AudioSync.element.volume = audioAudible() ? S.audioVolume : 0;
    }

    /* ================= MÉLANGEUR =================
     * alphaTab génère le MIDI de TOUTES les pistes du score : `renderTracks()`
     * ne touche qu'à l'affichage, jamais à l'écoute. Le seul levier est donc
     * les canaux (`changeTrackMute` / `changeTrackVolume`) — d'où un modèle
     * central unique d'où dérive TOUT : affichage, mute, solo, niveaux.
     *
     *   • un solo actif → seuls ce solo (piste OU audio) sonne
     *   • sinon         → tout sonne, sauf les pistes en mute
     *
     * ⚠ on ne passe JAMAIS par `changeTrackSolo()` d'alphaTab : son flag
     *   global `_isAnySolo` se superposerait à nos mutes. */
    function trackAudible(idx) {
      const m = S.mix;
      if (m.solo !== null) return m.solo === idx;   // solo unique gagne tout
      return !m.muted.has(idx);
    }
    function audioAudible() {
      const m = S.mix;
      if (!m) return true;
      if (m.solo !== null) return m.solo === 'audio';
      return !m.audioMute;
    }

    /* Le fichier contient-il une piste audio jouable ? */
    function hasEmbeddedAudio(score) {
      return !!(score && score.backingTrack && score.backingTrack.rawAudioFile);
    }

    /* Niveau d'origine de la piste (playbackInfo.volume = 0..16). */
    function defaultTrackVolume(t) {
      const v = t.playbackInfo ? t.playbackInfo.volume / 16 : 1;
      return clamp(isFinite(v) ? v : 1, 0, 1.5);
    }

    /* Remplit le modèle avec les niveaux d'origine SANS toucher aux canaux
       (alphaTab les met déjà à jour lui-même sur `readyForPlayback`). */
    function seedMixVolumes() {
      const m = S.mix;
      if (!m || !S.score) return;
      S.score.tracks.forEach(t => {
        if (!m.vol.has(t.index)) m.vol.set(t.index, defaultTrackVolume(t));
      });
    }

    /* ---- Travaux lourds, DÉPORTÉS après le premier rendu ----
     * `MixSync.build()` refait une passe complète du score
     * (generateSyncPoints) et `ensureMixAudio()` copie le MP3 dans un Blob +
     * l'ouvre dans <audio>. Aucun des deux n'est nécessaire pour AFFICHER la
     * partition : les on met dans un setTimeout(0) planifié depuis
     * `scoreLoaded`, donc exécuté après `loadMidiForScore()` + `render()`.
     * Sans audio embarqué, on n'appelle rien du tout (gain majeur pour .gp5). */
    function deferAudioWork(score) {
      setTimeout(() => {
        if (S.score !== score) return;          // un autre fichier a pris le relais
        const t0 = performance.now();
        if (hasEmbeddedAudio(score)) {
          MixSync.build(score);                 // pont synthTime → syncTime
          ensureMixAudio();                     // branche le <audio> (async, sans toast)
          MixSync.onState(S.api && S.api.playerState);
        }
        applyMix();                             // canaux : mute + volumes non-standard
        if (S.perf) {
          S.perf.deferred = Math.round(performance.now() - t0);
          reportPerf();
        }
      }, 0);
    }

    /* Chronomètre : une seule ligne en console pour savoir OÙ ça coûte. */
    function markPaint() {
      if (!S.perf || S.perf.paint !== undefined) return;
      S.perf.paint = Math.round(performance.now() - S.perf.t0);
    }
    function markRender() {
      if (!S.perf || S.perf.rendered !== undefined) return;
      S.perf.rendered = Math.round(performance.now() - S.perf.t0);
      reportPerf();
    }
    function reportPerf() {
      const p = S.perf;
      if (!p || p.reported) return;
      if (p.rendered === undefined || p.deferred === undefined) return;  // les 2 bouts
      p.reported = true;
      console.log(
        `[perf] « ${p.name} » → scoreLoaded +${p.scoreLoaded} ms ` +
        `(handler mélangeur ${p.handler} ms) · 1ᵉʳ affichage +${p.paint ?? p.rendered} ms · ` +
        `rendu complet +${p.rendered} ms · audio/canaux +${p.deferred} ms`
      );
    }

    /* Synthèse forcée, pour le garde-fou : ce qui MANQUE fait partie du
       diagnostic (un `rendered` indéfini == le worker n'a jamais fini).
       Retourne une phrase courte réutilisable dans un toast. */
    function flushPerf() {
      const p = S.perf;
      if (!p) return 'aucun chargement suivi';
      const msg =
        `scoreLoaded +${p.scoreLoaded ?? '—'} ms · layout ${nLayout} partial(s), ` +
        `${nPaint} peint(es) · agencement complet ${p.rendered === undefined ? 'JAMAIS terminé' : '+' + p.rendered + ' ms'}`;
      if (!p.reported) {
        p.reported = true;
        console.warn(`[perf] « ${p.name} » INCOMPLET → ${msg}`);
      }
      return msg;
    }

    /* Applique le modèle complet en une passe. Idempotent.
       Les appels alphaTab sont GROUPÉS : `changeTrackMute` refait un passage
       complet des tracks à chaque appel (parseTracks → _trackIndexesToTracks),
       on passe donc de 2N appels à 2 + autant de volumes non-standard. */
    function applyMix(forceVolumes) {
      if (!S.api || !S.score || !S.mix) return;
      const m = S.mix;
      const audible = [], silenced = [];
      const customVol = new Map();      // niveau personnalisé → [tracks]

      S.score.tracks.forEach(t => {
        if (!m.vol.has(t.index)) m.vol.set(t.index, defaultTrackVolume(t));
        (trackAudible(t.index) ? audible : silenced).push(t);

        const v = m.vol.get(t.index);
        if (forceVolumes || Math.abs(v - defaultTrackVolume(t)) > 1e-6) {
          let g = customVol.get(v);
          if (!g) { g = []; customVol.set(v, g); }
          g.push(t);
        }
      });

      if (audible.length)  S.api.changeTrackMute(audible, false);
      if (silenced.length) S.api.changeTrackMute(silenced, true);
      customVol.forEach((tracks, v) => S.api.changeTrackVolume(tracks, v));

      applyVolumes();               // Master + volume de l'audio (mute/solo audio)
      App.refreshMixStates();       // reflet DOM du modèle dans le tiroir
    }

    /* -------- Commandes du mélangeur --------
     * Elles modifient le MODÈLE puis rappellent applyMix(). Le DOM ne donne
     * jamais la réplique : il est re peint par refreshMixStates(). */
    function showTrack(index) {
      if (!S.score || !S.mix) return;
      if (index !== 'all' && !S.score.tracks[index]) return;
      S.mix.display = index;
      S.api.renderTracks(
        index === 'all' ? S.score.tracks.slice() : [S.score.tracks[index]]
      );
      App.refreshMixStates();
    }
    function toggleDisplay(idx) {
      showTrack(S.mix.display === idx ? 'all' : idx);
    }
    function toggleTrackMute(idx) {
      const m = S.mix;
      if (m.muted.has(idx)) m.muted.delete(idx); else m.muted.add(idx);
      applyMix();
    }
    function toggleTrackSolo(idx) {
      const m = S.mix;
      m.solo = (m.solo === idx) ? null : idx;   // un seul solo : remplace l'autre
      applyMix();
    }
    function setTrackVolume(idx, v) {
      S.mix.vol.set(idx, clamp(v, 0, 1.5));
      applyMix();
    }
    function toggleAudioMute() {
      S.mix.audioMute = !S.mix.audioMute;
      applyMix();
    }
    function toggleAudioSolo() {
      const m = S.mix;
      m.solo = (m.solo === 'audio') ? null : 'audio';
      applyMix();
    }
    /* Bouton « Réinit. mix » du tiroir : on garde l'affichage, on remet à zéro
       l'écoute (mute / solo / niveaux). */
    function resetMix() {
      const display = S.mix ? S.mix.display : 'all';
      createMix();
      S.mix.display = display;
      seedMixVolumes();
      applyMix(true);   // forceVolumes : TOUS les niveaux reviennent à l'origine
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

    /* -------- Affichage --------
       ⚠ enum → ENTIER : voir enumId(). Affecter 'horizontal' (string) ferait
       retomber silencieusement sur LayoutMode.Page. */
    function setLayout(mode) {
      S.api.settings.display.layoutMode = layoutId(mode);
      S.api.updateSettings();
      S.api.render();
    }
    function setScrollMode(mode) {
      S.api.settings.player.scrollMode = scrollId(mode);
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
      setMasterVolume, setAudioVolume,
      // mélangeur : tout part du modèle S.mix
      showTrack, toggleDisplay, toggleTrackMute, toggleTrackSolo, setTrackVolume,
      toggleAudioMute, toggleAudioSolo, resetMix, applyMix,
      toggleLoop, setLoopRange, clearLoopRange,
      setLayout, setScrollMode, setSpeed, applyVolumes, isSynthMode,
      flushPerf
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

    /* Garde-fou. Depuis que le loader se relève dès la PREMIÈRE portion peinte
       (`renderer.partialRenderFinished`), le voir encore posé après 12 s ne
       veut plus dire « rendu lent » mais « rien n'a été peint » : soit les
       polices (Bravura) n'arrivent pas (404 sur fontDirectory), soit
       alphaTab a sauté le rendu (`renderer.width === 0` → conteneur mesuré
       à 0, donc masqué/hors flux). On le diagnostique plutot qu'on ne
       l'affirme. */
    function armLoaderWatchdog(label) {
      if (loaderTmr) clearTimeout(loaderTmr);
      loaderTmr = setTimeout(() => {
        loaderTmr = null;
        if (!loaderOn) return;
        loaderOn = false;
        $('#loader').classList.add('hidden');
        const api = Player.S.api;
        const fontsOk  = !!(api && api.uiFacade && api.uiFacade.canRender);
        const atWidth  = api && api.renderer ? api.renderer.width : -1;
        const domWidth = $('#scoreArea').offsetWidth;
        console.warn('[watchdog]', { label, fontsOk, atWidth, domWidth });
        const summary = Player.flushPerf();   // ce qui est fait / ce qui manque
        toast(
          !fontsOk
            ? 'Polices de notation (Bravura) introuvables → rendu bloqué. Vérifiez core.fontDirectory (slash final) et le CDN.'
            : (atWidth === 0 || domWidth === 0
                ? `Rendu sauté : conteneur mesuré à ${domWidth}px × ${atWidth}px (élément masqué ?)`
                : `Chargement jamais terminé (${label}) — ${summary}. Détail en console.`),
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

      // le mélangeur ne se remplit qu'une fois le score connu
      $('#btnMixer').disabled = false;

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
      // le reflet du modèle (mute / solo / niveaux) est peint par applyMix(),
      // appelé juste après par Player sur `scoreLoaded`.
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

    /* ---------- mélangeur : construction des lignes ---------- */
    const ICON = {
      eye:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
      mute: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/></svg>',
      solo: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>'
    };

    function mixerRow(key, o) {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-1.5 rounded-lg px-1 py-1.5 transition hover:bg-white/[.04]';
      row.dataset.mix = String(key);
      row.innerHTML = `
        <span class="h-7 w-1.5 shrink-0 rounded-full" style="background:${o.color}"></span>
        <span class="min-w-0 flex-1 truncate text-[12px] leading-tight text-slate-200"
              title="${escapeHtml(o.title)}">${escapeHtml(o.label)}</span>
        ${o.eye ? `<button class="mx-btn" data-act="eye"  title="Isoler cette piste à l'affichage (recliquer : tout afficher)">${ICON.eye}</button>` : ''}
        <button class="mx-btn" data-act="mute" title="Mute : la piste ne sonne pas">${ICON.mute}</button>
        <button class="mx-btn" data-act="solo" title="Solo : seul cela sonne (un seul à la fois)">${ICON.solo}</button>
        <input class="mx-vol" type="range" min="0" max="${o.max || 150}" value="${o.value || 100}" title="Niveau (100 % = niveau d'origine)">`;
      return row;
    }

    function buildTrackList(score) {
      const list = $('#trackList');
      list.innerHTML = '';

      score.tracks.forEach(t => {
        list.appendChild(mixerRow(t.index, {
          color: hexColor(t.color),
          label: `${t.index + 1}. ${t.name || 'Piste ' + (t.index + 1)}`,
          title: t.name || 'Piste ' + (t.index + 1),
          eye: true
        }));
      });

      // ★ ligne « Audio Track » : la piste audio embarquée joue EN PARALLÈLE
      //   du synthé (MixSync la tient calée) — elle a donc son propre M/S.
      //   Max 100 : HTMLMediaElement.volume est borné à [0;1] par le spec.
      if (score.backingTrack && score.backingTrack.rawAudioFile) {
        list.appendChild(mixerRow('audio', {
          color: '#f59e0b',
          label: 'Audio Track',
          title: 'Piste audio embarquée dans le fichier',
          eye: false,
          max: 100,
          value: Math.round(Player.S.audioVolume * 100)
        }));
      }
    }

    /* ---------- mélangeur : reflet du modèle dans le DOM ----------
     *  Le modèle (Player.S.mix) est la seule source de vérité : ici on ne
     *  fait que repeindre les boutons et les faders. */
    function refreshMixStates() {
      const m = Player.S.mix;
      if (!m) return;

      $$('#trackList [data-mix]').forEach(row => {
        const key = row.dataset.mix;
        const audio = key === 'audio';
        const idx = audio ? null : Number(key);

        const eye = row.querySelector('[data-act="eye"]');
        if (eye) eye.classList.toggle('is-on', m.display === 'all' || m.display === idx);

        row.querySelector('[data-act="mute"]').classList.toggle(
          'is-on', audio ? m.audioMute : m.muted.has(idx));
        row.querySelector('[data-act="solo"]').classList.toggle(
          'is-on', m.solo === (audio ? 'audio' : idx));

        const slider = row.querySelector('.mx-vol');
        if (slider) {
          const v = audio ? Player.S.audioVolume : (m.vol.has(idx) ? m.vol.get(idx) : 1);
          const pct = String(Math.round(v * 100));
          if (slider.value !== pct) { slider.value = pct; }
          paintRange(slider);
        }
      });
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

    /* ---------- mélangeur : événements ----------
     *  Délégation sur #trackList : le tiroir reste OUVERT pendant toute
     *  interaction (il ne se ferme que sur ✕ ou Échap). */
    function wireMixer() {
      const list = $('#trackList');

      list.addEventListener('click', e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const row = btn.closest('[data-mix]');
        if (!row) return;
        const key   = row.dataset.mix;
        const audio = key === 'audio';
        const idx   = audio ? null : Number(key);
        const act   = btn.dataset.act;

        if (act === 'eye')       { if (!audio) Player.toggleDisplay(idx); }
        else if (act === 'mute') { if (audio) Player.toggleAudioMute(); else Player.toggleTrackMute(idx); }
        else if (act === 'solo') { if (audio) Player.toggleAudioSolo(); else Player.toggleTrackSolo(idx); }
      });

      list.addEventListener('input', e => {
        const slider = e.target.closest('.mx-vol');
        if (!slider) return;
        paintRange(slider);
        const row = slider.closest('[data-mix]');
        if (!row) return;
        const v = +slider.value / 100;
        if (row.dataset.mix === 'audio') Player.setAudioVolume(v);
        else Player.setTrackVolume(Number(row.dataset.mix), v);
      });
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

    /* ---------- drawer : PART DU FLUX, il ne recouvre rien ----------
     *  Le tiroir est un membre du flex #stage : s'ouvrir l'agrandit et
     *  #viewport se rétracte. Aucun backdrop — la fermeture est manuelle
     *  (✕ ou Échap) et AUCUNE interaction avec le contenu ne le referme. */
    function openDrawer() {
      document.body.classList.add('drawer-open');
      syncDrawerBtn();
      reflowScore();
    }
    function closeDrawer() {
      document.body.classList.remove('drawer-open');
      syncDrawerBtn();
      reflowScore();
    }
    function toggleDrawer() {
      if (document.body.classList.contains('drawer-open')) closeDrawer(); else openDrawer();
    }
    function syncDrawerBtn() {
      const b = $('#btnMixer');
      if (b) b.classList.toggle('is-on', document.body.classList.contains('drawer-open'));
    }
    /* alphaTab re-mesure son conteneur quand la largeur change ; on relance
       le layout à la main au cas où le ResizeObserver ne se déclencherait pas. */
    function reflowScore() {
      setTimeout(() => window.dispatchEvent(new Event('resize')), 90);
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
      const api = Player.S.api;
      if (!api) return;
      // le layout par défaut suit la largeur d'écran ; on laisse le choix manuel ensuite
      const label = mqDesktop.matches ? 'horizontal' : 'page';
      const wanted = layoutId(label);
      if (api.settings.display.layoutMode === wanted || layoutTouched) return;
      $('#layoutSelect').value = label;
      if (Player.S.score) Player.setLayout(wanted);   // → render
      else api.settings.display.layoutMode = wanted;   // avant le 1er score
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

      // mélangeur : ouverture / fermeture manuelle (aucune interaction
      // avec le contenu ne referme le tiroir)
      $('#btnMixer').onclick  = toggleDrawer;
      $('#drawerClose').onclick = closeDrawer;
      $('#btnAllTracks').onclick = () => Player.showTrack('all');
      $('#btnResetMix').onclick  = () => Player.resetMix();
      wireMixer();                       // clics & faders délégués sur #trackList

      // niveaux du tiroir + vitesse
      $('#volMaster').addEventListener('input', e => {
        paintRange(e.target); $('#volMasterVal').textContent = e.target.value;
        Player.setMasterVolume(+e.target.value / 100);
      });
      $('#volClick').addEventListener('input', e => {
        paintRange(e.target); $('#volClickVal').textContent = e.target.value;
        Player.setMetronomeVolume(+e.target.value / 100);
      });
      $('#speed').addEventListener('input', e => {
        paintRange(e.target); $('#speedVal').textContent = e.target.value + '%';
        Player.setSpeed(+e.target.value / 100);
      });

      // boucle A/B
      $('#btnApplyLoop').onclick = () => Player.setLoopRange(+$('#loopStart').value, +$('#loopEnd').value);
      $('#btnClearLoop').onclick = () => Player.clearLoopRange();

      // affichage
      $('#layoutSelect').onchange = e => { layoutTouched = true; Player.setLayout(e.target.value); };
      $('#scrollSelect').onchange = e => Player.setScrollMode(e.target.value);

      // responsive
      mqDesktop.addEventListener('change', applyResponsiveLayout);
    }

    /* ---------- boot ---------- */
    function boot() {
      if (typeof alphaTab === 'undefined') {
        document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">Impossible de charger alphaTab (CDN injoignable).</div>';
        return;
      }
      buildSamples();
      wireUI();
      wireDnD();
      wireShortcuts();
      paintAllRanges();

      /* alphaTab démarre sur LayoutMode.Page alors que la 1ʳᵉ option du select
         est « Horizontal » : sans réglage explicite le select MENT au
         chargement (et applyResponsiveLayout() rendait return, S.score == null).
         On pose donc la valeur RÉELLE avant la création de l'API. */
      const defaultLayout = mqDesktop.matches ? 'horizontal' : 'page';
      CFG.alphatab.display.layoutMode = layoutId(defaultLayout);
      $('#layoutSelect').value = defaultLayout;

      /* Rien ne doit tuer `boot()` en silence : une exception ici coupeait
         `applyResponsiveLayout()` ET l'affichage du diagnostic — l'interface
         « marchait » (DnD déjà câblé plus haut) alors que le moteur était à
         moitié initialisé. */
      try {
        Player.init($('#scoreArea'));
        applyResponsiveLayout();
      } catch (e) {
        console.error('[boot] échec de l’initialisation du moteur', e);
        toast('Échec du démarrage alphaTab : ' + (e && e.message ? e.message : e), 'error');
      }

      console.log('%cGP8 Player%c alphaTab ' + (alphaTab.meta && alphaTab.meta.version || '1.8.4'),
        'background:#0ea5e9;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold', 'color:#64748b');
    }

    return {
      boot, toast, loader, armLoaderWatchdog, hideEmptyState, showEmptyState,
      onScoreLoaded, updatePosition,
      syncPlayBadge, syncMetronome, syncLoop, onPlaybackRange,
      refreshMixStates, openDrawer, closeDrawer
    };
  })();

  document.addEventListener('DOMContentLoaded', App.boot);
