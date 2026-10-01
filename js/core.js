

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
    /* Aucune liste d'exemple en dur dans le code : en http, la section
       « Fichiers d'exemple » n'est remplie QUE par le scan dynamique de
       `samples/` (voir buildSamples). Pas de scan → pas de section. */
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

