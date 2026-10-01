/* ==================================================================
   GP8 PLAYER â€” js/player.js
   5. PLAYER â€” Wrapper alphaTab : chargement, lecture, mÃ©langeur, boucle, affichage.
   ------------------------------------------------------------------
   ChargÃ© en <script classique> par index.html, dans l'ordre de l'ancien
   app.js monolithique. Le partage se fait par les bindings lexicographiques
   globaux (CFG, AT, $, safe, Player, Appâ€¦), PAS par des imports : un module
   ES est impossible ici car l'application doit s'ouvrir depuis file://.
   ================================================================== */
'use strict';
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
      countInOn: false,
      playing: false,
      loopOn: false,
      loopRange: null,       // plage A→B en cours (modèle local = vérité)
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
        display:  'all',      // 'all' | Set des index AFFICHÉS (jamais vide)
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
      patchVendorClickKeepsLoop();
      wireEvents();
      applyScrollOffsets();
      watchScrollSize();
      return S.api;
    }

    /* -------- Décalage du défilement --------
       Tous les scroll handlers d'alphaTab ciblent `barX + scrollOffsetX`
       (et `cursorX + scrollOffsetX` en Smooth, l.44941/44947) : avec
       l'offset par défaut (0) la mesure courante est calée PILE sur le
       bord gauche du conteneur, et la barre du curseur — quelques pixels —
       tombe en x=0 : elle disparaît. Un offset NÉGATIF arrête le défilement
       plus tôt, la mesure reste visible et décalée vers la droite ; en
       Smooth le curseur devient alors parfaitement fixe (la feuille
       défile sous une tête de lecture immobile). */
    function applyScrollOffsets() {
      const api = S.api;
      if (!api) return;
      const el = $(CFG.scrollElement);
      const w = el ? el.clientWidth  : 0;
      const h = el ? el.clientHeight : 0;
      api.settings.player.scrollOffsetX = w > 0 ? -Math.round(w * 0.30) : 0;
      api.settings.player.scrollOffsetY = h > 0 ? -Math.round(h * 0.15) : 0;
    }

    /* le conteneur change aussi quand le tiroir s'ouvre : ResizeObserver
       plutôt que `resize` (qui ne voit que la fenêtre) */
    let scrollWatchBound = false;
    function watchScrollSize() {
      if (scrollWatchBound) return;
      scrollWatchBound = true;
      const el = $(CFG.scrollElement);
      if (typeof ResizeObserver === 'function' && el) {
        let raf = 0;
        new ResizeObserver(() => {
          if (raf) return;
          raf = requestAnimationFrame(() => { raf = 0; applyScrollOffsets(); });
        }).observe(el);
      } else {
        window.addEventListener('resize', () => applyScrollOffsets());
      }
    }

    /* ---- alphaTab : un clic ne doit PAS effacer la boucle ----
       `_onBeatMouseUp` appelle `applyPlaybackRangeFromHighlight()`
       (alphaTab.js l.47661) à CHAQUE relâcher ; sans sélection étendue,
       celle-ci fait `_selectionStart = void 0` + `playbackRange = null`
       (l.47840-47841) — et le `set playbackRange` worker remet `tickPosition`
       sur le début de plage (l.39880), ce qui annulerait le positionnement.
       Décision produit : la boucle se CONSERVE ; un clic ne sert qu'à se
       positionner. On shunte la méthode sur l'instance : un vrai glisser
       reste du ressort d'alphaTab, un clic simple se contente de bouger. */
    function patchVendorClickKeepsLoop() {
      try {
        const api = S.api;
        const orig = api.applyPlaybackRangeFromHighlight;
        if (typeof orig !== 'function') return;
        api.applyPlaybackRangeFromHighlight = function () {
          const sel = this._selectionStart, end = this._selectionEnd;
          const dragging = !!sel && !!end && sel.beat !== end.beat;
          if (dragging || !S.loopRange) return orig.call(this);
          const tc = this.tickCache;
          if (tc && sel && sel.beat) seekTick(tc.getBeatStart(sel.beat));
        };
      } catch (e) {
        console.warn('[vendor] conservation de la boucle au clic impossible', e);
      }
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
        S.playing = playing;
        $('#icPlay').classList.toggle('hidden', playing);
        $('#icPause').classList.toggle('hidden', !playing);
        App.syncPlayBadge(playing);
        if (!playing) App.hideCountIn();   // stop/pause pendant le décompte
        MixSync.onState(e.state);
      })());

      /* --- fin de morceau ---
         alphaTab déclenche `finished` À CHAQUE fin de passage d'une boucle
         (AlphaSynth.checkForFinish, branche `isLooping` — alphaTab.js
         l.40121-40124), pas seulement en fin de morceau. Traiter ça comme
         une fin couperait la lecture au second passage : MixSync.onState(null)
         mettrait en pause la piste audio embarquée (elle ne sonnerait plus
         qu'à la 1re boucle) et l'icône basculerait sur « lecture » alors que
         tout continue. `isLooping` est vrai exactement dans ce cas-là. */
      api.playerFinished.on(() => safe(() => {
        if (S.api && S.api.isLooping) return;   // fin de passage, pas fin de morceau
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
    const play      = () => {
      if (!S.api) return;
      /* alphaTab ne lance le count-in QUE depuis AlphaSynth.play()
         (l.39959) : un passage de boucle passe par checkForFinish et
         n'y revient jamais → l'overlay ne s'affiche qu'au lancement. */
      const willCountIn = S.countInOn && !S.playing;
      S.api.play();
      if (willCountIn) App.showCountIn(countInBeats(), countInBeatMs());
    };
    const pause     = () => { if (S.api) S.api.pause(); };
    const toggle    = () => { if (S.playing) pause(); else play(); };
    /* alphaTab.stop() pose DÉJÀ le curseur sur `playbackRange.startTick ?? 0`
       (AlphaSynth.stop, l.39999) : forcer `tickPosition = 0` envoyait un
       tick HORS plage A→B. */
    const stop      = () => { if (S.api) { S.api.stop(); MixSync.resync(); } };

    /* -------- Positionnement sûr --------
       alphaTab BORNE la position interne dans la plage A→B (`mainSeek`,
       l.35041-35044) mais rapporte ensuite la valeur BRUTE reçue
       (`set timePosition` → `updateTimePosition`, l.39866-39869). Écrire un
       tick hors plage a donc deux effets :
         1. le curseur rapporté ne correspond plus à la position jouée —
            la désynchro visuelle « le curseur est au début alors que la
            boucle tourne » ;
         2. `_timePosition` (axe réel) diverge de `state.currentTime`
            (axe musical) : le prochain re-claquage recalcule depuis la
            valeur fausse. Un changement de vitesse en est un —
            `updatePlaybackSpeed` fait `timePosition *= old / new`
            (l.39846-39850), soit un `mainSeek` complet — d'où un second
            saut du curseur à ce moment-là.
       On borne donc TOUTES nos écrits exactement comme `mainSeek`, pour que
       son clamp devienne neutre (aucune écriture hors plage => invariant
       réel/musical jamais cassé). */
    function seekTick(tick) {
      if (!S.api || !isFinite(tick)) return;
      const r = S.api.playbackRange;
      let t = Math.round(tick);
      if (r) t = Math.min(Math.max(t, r.startTick), r.endTick);
      S.api.tickPosition = Math.max(0, t);
    }

    function seekRatio(r) {
      if (!S.api) return;
      const range = S.api.playbackRange;
      const from  = range ? range.startTick : 0;
      const to    = range ? range.endTick   : S.api.endTick;
      if (to <= from) return;
      seekTick(from + (to - from) * clamp(r, 0, 1));
      MixSync.resync();
    }

    function gotoBar(delta) {
      if (!S.score) return;
      const count = S.score.masterBars.length;
      const next  = clamp(S.currentBar + delta, 0, count - 1);
      // borné par la plage A→B quand une boucle est armée : alphaTab ferait
      // le clamp de son côté et le curseur affiché partirait ailleurs
      seekTick(S.score.masterBars[next].start);
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
      applyCountInVolume();          // le clic du décompte suit le même fader
    }

    /* -------- Délai de 4 temps (count-in) --------
     *  alphaTab ne déclenche le count-in QUE dans `AlphaSynth.play()`
     *  (l.39959, via `sequencer.startCountIn()`) : un passage de boucle
     *  passe par `checkForFinish` (branche `isLooping`, l.40121) et n'y
     *  touche JAMAIS — le délai est donc bien appliqué au lancement
     *  uniquement, jamais à chaque boucle. On ne fait que brancher le
     *  réglage `countInVolume`, qui est INDEPENDANT de `metronomeVolume`
     *  (l.39829) : le décompte sonne même le métronome éteint, et se tait
     *  dès qu'on force 0. */
    function setCountIn(on) {
      S.countInOn = !!on;
      applyCountInVolume();
      App.syncCountIn(S.countInOn, isSynthMode());
    }
    function applyCountInVolume() {
      if (!S.api) return;
      S.api.countInVolume = S.countInOn ? S.metronomeVolume : 0;
    }
    /* base du compte à rebours visuel : alphaTab génère le count-in avec
     * `tempoChanges[0].tempo` (l.35368) et le nombre de temps de la
     * signature (l.35130), puis le joue au `playbackSpeed` courant. */
    function countInBeats() {
      const mb = S.score && S.score.masterBars[0];
      return (mb && mb.timeSignatureNumerator > 0) ? mb.timeSignatureNumerator : 4;
    }
    function countInBeatMs() {
      const bpm = S.score && isFinite(S.score.tempo) && S.score.tempo > 0 ? S.score.tempo : 120;
      const sp  = S.api && isFinite(S.api.playbackSpeed) && S.api.playbackSpeed > 0 ? S.api.playbackSpeed : 1;
      return 60000 / (bpm * sp);
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

    /* --- AFFICHAGE : indépendant de l'ÉCOUTE ---
       Masquer une piste ne la met PAS en mute : alphaTab génère le MIDI de
       toutes les pistes (`loadMidiForScore`), `renderTracks()` ne fait que
       choisir celles qu'on DESSINE. D'où le choix de deux modèles séparés.

       `display` vaut 'all' (défaut) ou un Set d'index visibles. Il ne passe
       JAMAIS à vide : `renderTracks([])` est un no-op chez alphaTab (l.45831
       teste `tracks.length > 0`), l'écran resterait donc affiché à l'ancien
       contenu pendant que le modèle dirait « rien ». On garde au minimum une
       piste visible — c'est aussi la contrainte d'alphaTab. */
    function isDisplayed(idx) {
      const d = S.mix ? S.mix.display : 'all';
      return d === 'all' || (d instanceof Set && d.has(idx));
    }
    function displayedTracks() {
      if (!S.score || !S.mix) return [];
      if (S.mix.display === 'all') return S.score.tracks.slice();
      return S.score.tracks.filter(t => S.mix.display.has(t.index));
    }
    function applyDisplay() {
      const tracks = displayedTracks();
      if (!tracks.length || !S.api) return;      // jamais renderTracks([])
      S.api.renderTracks(tracks);                // re-dessin, MIDI intact
      App.refreshMixStates();                    // réallume les yeux allumés
    }

    /* « Tout afficher » (bouton du tiroir) — ou isolation d'une piste.
       Invariant du modèle : `display` est TOUJOURS 'all' ou un Set, jamais
       un nombre brut (sinon isDisplayed() ne saurait plus le lire). */
    function showTrack(index) {
      if (!S.score || !S.mix) return;
      if (index !== 'all' && !S.score.tracks[index]) return;
      S.mix.display = index === 'all' ? 'all' : new Set([index]);
      applyDisplay();
    }

    /* Oeil d'une ligne : bascule CETTE piste sans toucher aux autres.
       → 1 piste, plusieurs, ou toutes : le modèle accepte tout. */
    function toggleDisplay(idx) {
      const m = S.mix;
      if (!S.score || !m || !S.score.tracks[idx]) return;

      let set;
      // `'all'` ET toute valeur inattendue = tout affiché (jamais de crash)
      if (!(m.display instanceof Set)) {
        set = new Set(S.score.tracks.map(t => t.index));
        set.delete(idx);
      } else {
        set = new Set(m.display);                // copie : on ne mutle pas
        if (set.has(idx)) set.delete(idx); else set.add(idx);
      }

      if (set.size === 0) {                      // on n'affiche jamais « rien »
        App.toast('Une piste au minimum doit rester affichée.', 'info');
        return;
      }
      // forme canonique : tout affiché == 'all' (évite deux états identiques)
      m.display = set.size === S.score.tracks.length ? 'all' : set;
      applyDisplay();
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

    /* -------- Boucle --------
       État DOUBLE et INDÉPENDANT :
         S.loopRange → la plage A→B (modèle local, source de vérité)
         S.loopOn    → l'icône « boucle A→B (L) » = alphaTab.isLooping
       Décocher L conserve la plage ET son surlignage : la lecture se fait
       alors une seule fois dedans.                                    */
    function setLoopOn(on) {
      S.loopOn = !!on;
      if (S.api) S.api.isLooping = !!on;
      App.syncLoop(!!on);
    }

    function toggleLoop() { setLoopOn(!S.loopOn); }

    function setLoopRange(startIdx, endIdx) {
      if (!S.score || !S.api || startIdx < 0 || endIdx < 0) return;
      const bars = S.score.masterBars;
      const a = Math.min(startIdx, endIdx), b = Math.max(startIdx, endIdx);
      const range = new (AT.PlaybackRange || Object)();
      range.startTick = bars[a].start;
      range.endTick   = (b + 1 < bars.length) ? bars[b + 1].start : S.api.endTick;
      S.api.playbackRange = range;   // → playbackRangeChanged (asynchrone)
      setLoopOn(true);               // B2 : l'icône L s'allume tout de suite
      App.toast(`Boucle mesures ${a + 1} → ${b + 1}`, 'info');
    }

    function clearLoopRange() {
      if (!S.api) return;
      S.loopRange = null;            // AVANT, sinon l'événement `null` ci-dessous
      S.api.playbackRange = null;    // serait interprété comme un clic à la souris
      S.api.clearPlaybackRangeHighlight();
      /* alphaTab ne vide PAS _selectionStart/_selectionEnd ici (l.47877) :
         sans ça, le surlignage réapparaîtrait au prochain re-render. */
      try { S.api._selectionStart = void 0; S.api._selectionEnd = void 0; } catch (e) {}
      setLoopOn(false);
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
      App.syncCountIn(S.countInOn, isSynthMode());
      applyVolumes();
    }

    return {
      S, init, loadFile,
      play, pause, toggle, stop, seekRatio, gotoBar,
      setMetronome, setMetronomeVolume, setCountIn,
      setMasterVolume, setAudioVolume,
      // mélangeur : tout part du modèle S.mix
      showTrack, toggleDisplay, isDisplayed, toggleTrackMute, toggleTrackSolo, setTrackVolume,
      toggleAudioMute, toggleAudioSolo, resetMix, applyMix,
      toggleLoop, setLoopOn, setLoopRange, clearLoopRange,
      setLayout, setScrollMode, setSpeed, applyVolumes, isSynthMode,
      flushPerf
    };
  })();

