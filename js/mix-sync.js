/* ==================================================================
   GP8 PLAYER — js/mix-sync.js
   4. MIX SYNC — Synthé alphaTab (maître du temps) + <audio> (esclave).
   ------------------------------------------------------------------
   Chargé en <script classique> par index.html, dans l'ordre de l'ancien
   app.js monolithique. Le partage se fait par les bindings lexicographiques
   globaux (CFG, AT, $, safe, Player, App…), PAS par des imports : un module
   ES est impossible ici car l'application doit s'ouvrir depuis file://.
   ================================================================== */
'use strict';
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
   *  Correction en cours de lecture — loi RÉELLE (cf. constantes plus bas) :
   *    |dérive| > 400 ms          → recale immédiat (seek)
   *    100 ms ≤ |dérive| ≤ 400 ms → ajustement de playbackRate, au plus UNE
   *                                 écriture toutes les 1500 ms (±10 %)
   *    |dérive| < 100 ms          → ZONE MORTE : loi « protège » (remise au
   *                                 neutre si elle rapproche du taux natif,
   *                                 sinon silence) — arbitrée par
   *                                 tools/tempo-correct-sim.js.
   *  `preservesPitch` étant actif par défaut, ces micro-variations de
   *  vitesse ne transposent PAS le son.
   *
   *  TEMPO PRÉ-CUIT (stratégie C, BUGFIX-TOTAL P2) : le tempo de
   *  l'enregistrement n'est PLUS appliqué par `playbackSpeed` en lecture
   *  (chaque écriture re-échelle la position du synthé et le COUPE le temps
   *  d'un seek — AlphaSynth.updatePlaybackSpeed → mainSeek). Il est ÉCRIT
   *  DANS LE MidiFile par `prebake()`, appelée par player.js juste après la
   *  génération : le synthé joue donc la partition au tempo de
   *  l'enregistrement avec `playbackSpeed = userSpeed` CONSTANT.
   *
   *  Conséquence sur le PONT : l'axe interne du synthé n'est plus l'axe
   *  PARTITION mais l'axe PRÉ-CUIT, dont les durées de segment valent celles
   *  de l'audio. `segmentsFrom()` — LA table partagée par prebake et par le
   *  pont — expose donc `points[i].t` = axe pré-cuit et `points[i].a` = axe
   *  audio ; `audioMsFor` s'y applique inchangé. La pente locale reste
   *  d(audio)/d(pré-cuit) : 1,0 partout sauf segments clampés et sauts.
   */
  const MixSync = (() => {
    const HOLD_MS = 400;   // dérive au-delà de laquelle on recale d'un coup
    const SOFT_MS = 25;    // en pause, on recale au-delà de 25 ms
    const NUDGE   = 0.10;  // marge max de correction de vitesse (±10 %)
    const GAIN    = 2000;  // ms : vise une remise à zéro en ~2 s

    /* --- cadence de la boucle de correction -------------------------
       alphaTab remonte `positionChanged` ~344 fois/s : le worklet poste
       `samplesPlayed` à CHAQUE quantum de 128 frames (44100/128), sans
       agrégation — worklet → main (alphaTab.js l.41552) → worker
       (l.33818) → `positionChanged` (l.40171) → main (l.50064) → nous.
       Exécuter la correction à cette cadence écrivait `playbackRate` sur
       un <audio> en cours de lecture des dizaines de fois par seconde
       (reconfiguration de la chaîne média → saccades), et tiendrait le
       thread principal occupé alors qu'il se trouve SUR le chemin
       d'approvisionnement du synthé (sampleRequest : worklet → main →
       worker), d'où les pistes MIDI également en retard.            */
    const CONTROL_MS = 250;  // la boucle ne s'exécute qu'au plus 4 fois/s
    const DEADBAND_MS = 100; // sous cette dérive, on ne touche à rien
    const WRITE_MS   = 1500; // écart minimal entre deux écritures de vitesse
    const RATE_EPS   = 0.03; // seuil d'écriture (3 %) : bruit ignoré
    const STALL_RATIO = 0.5; // maître en avance < 50 % du réel = à l'arrêt
    const STAT_MS    = 5000; // périodicité du rapport d'instrumentation

    /* --- discontinuités + pente locale (correctif BUGMP3) -------------
       Un segment [p → q] est un SAUT (discontinuité à re-ancrer) quand l'axe
       audio fait un mouvement impossible pour un tempo : il RECULE (Δa < 0)
       ou bondit hors de toute plage musicale (pente hors [1/JUMP_SLOPE,
       JUMP_SLOPE]). Ces segments ne doivent JAMAIS être balayés par
       l'interpolation : on les re-ancre sur le bloc destination (cf. build +
       audioMsFor) → un seul seek par discontinuité. Un simple écart de tempo
       — même fort — reste géré par la pente locale (da/dt), qui pilote
       playbackRate : le mp3 converge vers le tempo du MIDI au lieu de sécuer
       dans les limites de ±10 %.                                           */
    const JUMP_SLOPE = 3.0;  // au-delà : téléport audio, pas un tempo
    const SLOPE_MIN  = 0.5;  // clamp de la pente locale → rate plancher
    const SLOPE_MAX  = 2.0;  // clamp de la pente locale → rate plafond

    /* --- horloge musicale ---------------------------------------------
       ANCHOR_TOL_MS : tolérance du détecteur de saut d'horloge (seek,
       stop, boucle, re-échelle d'alphaTab). Le tempo GP, lui, n'est plus
       écrit en lecture : voir `prebake` (stratégie C). */
    const ANCHOR_TOL_MS = 30;

    let points  = [];      // [{ t: axe PRÉ-CUIT, a: axe audio, jump, slope, rawSlope, tick }] trié par t
    let nJump   = 0;       // nb de segments de saut (discontinuités)
    let nOff    = 0;       // nb de segments à pente hors plage
    let avgSlope = 1;      // pente moyenne (audio / partition)
    let tempoScale = 1;    // 1/avgSlope = durée audio / durée partition (journal + repli)
    let bias    = 0;       // décalage constant éventuel (calage manuel)
    let playing = false;
    let active  = false;
    let leadIn  = false;   // pré-roll : notation AVANT l'audio (1er syncTime < 0)
    let speed   = 1;
    let note    = '';

    let userSpeed = 1;     // vitesse utilisateur (seule écriture de playbackSpeed)
    let musMs   = 0;       // HORLOGE MUSICALE : ∫ playbackSpeed·dt = axe PRÉ-CUIT
    let musRef  = -1;      // dernier api.timePosition vu (détection de saut/seek)
    let musWall = 0;       // dernier instant réel (performance.now) de l'horloge

    /* état de la boucle + instrumentations (rapportées toutes les STAT_MS) */
    let lastControl = 0, lastWrite = 0, lastMaster = -1;
    let nCall = 0, msHandler = 0, nRate = 0, nSeek = 0, nStall = 0;
    let peakDrift = 0, statWin0 = 0;

    const el = () => AudioSync.element;

    /* remise à zéro des compteurs (nouveau flux / nouveau score) */
    function resetStats() {
      lastControl = 0; lastWrite = 0; lastMaster = -1;
      nCall = 0; msHandler = 0; nRate = 0; nSeek = 0; nStall = 0;
      peakDrift = 0; statWin0 = 0;
    }

    /* ---- table de segments PARTAGÉE (pont + pré-cuisson) --------------
       Entrée : points de synchro BRUTS [{ tick, t, a }] — `t` = temps
       PARTITION (ms), `a` = temps AUDIO (ms), `tick` = tick MIDI.
       Sortie : { points, nJump, nOff, avgSlope } où `points[i]` porte :
         · t        axe PRÉ-CUIT (les durées que la pré-cuisson produira) ;
         · a        axe audio ;
         · rawNot   d(audio)/d(partition) BRUT ;
         · notSlope d(audio)/d(partition) CLAMPÉ [SLOPE_MIN, SLOPE_MAX]
                    (saut → pente du bloc destination) — c'est CE facteur
                    que `prebake` écrit dans le MidiFile ;
         · rawSlope d(audio)/d(PRÉ-CUIT) BRUT ;
         · slope    d(audio)/d(pré-cuit) CLAMPÉ (saut → bloc destination)
                    — c'est la pente que le pont applique au playbackRate ;
         · jump     segment de discontinuité audio.
       Dédoublonnage : `t` identiques → on garde le DERNIER (sémantique
       d'alphaTab : `while (next.synthTime <= t) i++`). Un segment est un
       SAUT si l'axe audio recule (Δa < 0) ou sort de [1/JUMP_SLOPE,
       JUMP_SLOPE] — mouvement impossible pour un tempo. */
    function segmentsFrom(raw) {
      const pts = [];
      for (const p of (raw || [])) {
        if (!p || !isFinite(p.t) || !isFinite(p.a)) continue;
        pts.push({ tick: isFinite(p.tick) ? p.tick : 0, tNot: p.t, a: p.a });
      }
      pts.sort((x, y) => x.tNot - y.tNot);

      const points = [];
      for (const p of pts) {
        while (points.length && p.tNot <= points[points.length - 1].tNot) points.pop();
        points.push(p);
      }
      const n = points.length;
      let nJump = 0, nOff = 0;

      // 1. sauts + pentes partition (brute, puis clampée)
      for (let i = 0; i < n; i++) {
        const p = points[i], q = points[i + 1];
        if (!q) { p.rawNot = 1; p.notSlope = 1; p.jump = false; continue; }
        const dt = q.tNot - p.tNot, da = q.a - p.a;
        p.rawNot = dt > 0 ? da / dt : 1;
        p.jump = (da < 0) || (p.rawNot < 1 / JUMP_SLOPE) || (p.rawNot > JUMP_SLOPE);
        p.notSlope = clamp(p.rawNot, SLOPE_MIN, SLOPE_MAX);
        if (p.jump) nJump++;
        else if (p.rawNot < SLOPE_MIN || p.rawNot > SLOPE_MAX) nOff++;
      }
      // 2. saut → pente du bloc destination (parcours inverse : chaîne les
      //    sauts consécutifs proprement).
      for (let i = n - 1; i >= 0; i--) {
        if (points[i].jump) points[i].notSlope = (i + 1 < n) ? points[i + 1].notSlope : 1;
      }
      // 3. axe PRÉ-CUIT : B0 = temps partition du 1er point (avant lui le
      //    MIDI joue au tempo natif, donc l'axe pré-cuit = l'axe partition) ;
      //    B_{i+1} = B_i + dNot · notSlope. Puis pente sur l'axe pré-cuit.
      let sDa = 0, sDt = 0;
      let B = n ? points[0].tNot : 0;
      for (let i = 0; i < n; i++) {
        const p = points[i], q = points[i + 1];
        p.t = B;
        p.rawSlope = p.rawNot / (p.notSlope > 0 ? p.notSlope : 1);
        p.slope = clamp(p.rawSlope, SLOPE_MIN, SLOPE_MAX);
        if (q) {
          const dt = q.tNot - p.tNot;
          if (dt > 0) {
            B += dt * p.notSlope;
            if (!p.jump) { sDa += (q.a - p.a); sDt += dt; }
          }
        }
      }
      for (let i = n - 1; i >= 0; i--) {
        if (points[i].jump) points[i].slope = (i + 1 < n) ? points[i + 1].slope : 1;
      }
      for (const p of points) p.speed = p.slope > 0 ? 1 / p.slope : 1;

      // Pente MOYENNE = rapport partition/audio (hors sauts) → tempoScale =
      // durée audio / durée partition. Sert de repli et de journal.
      const avgSlope = sDt > 0 ? sDa / sDt : 1;
      return { points, nJump, nOff, avgSlope };
    }

    /* ---- construction du pont pré-cuit → audio ---- */
    function build(score) {
      points = [];
      note   = '';
      resetStats();
      if (!score) { note = 'aucun score'; return 0; }
      try {
        const gen = (typeof alphaTab !== 'undefined')
          && alphaTab.midi && alphaTab.midi.MidiFileGenerator;
        if (!gen || typeof gen.generateSyncPoints !== 'function') {
          note = 'MidiFileGenerator indisponible dans ce build';
          console.warn('[mix]', note);
          return 0;
        }
        const raw = (gen.generateSyncPoints(score) || [])
          .map(p => ({ tick: p.synthTick, t: p.synthTime, a: p.syncTime }));
        const seg = segmentsFrom(raw);   // LA table partagée avec prebake
        points = seg.points; nJump = seg.nJump; nOff = seg.nOff; avgSlope = seg.avgSlope;
        tempoScale = (isFinite(avgSlope) && avgSlope > 0) ? 1 / avgSlope : 1;
        musRef = -1;                     // nouvelle table → horloge ré-ancrée
        note = points.length
          ? points.length + ' point(s) de synchro'
            + (nJump ? ' · ' + nJump + ' saut(s)' : '')
            + (nOff ? ' · ' + nOff + ' pente(s) hors plage' : '')
          : 'aucun point de synchro → axe temporel linéaire';

        // alerte : signale les segments que le rate ne PEUT pas suivre, plutôt
        // que de saccader silencieusement (les sauts sont déjà gérés).
        if (nJump || nOff) {
          const bad = [];
          for (let i = 0; i < points.length && bad.length < 3; i++) {
            const p = points[i];
            if (p.jump) bad.push('#' + i + ' saut');
            else if (p.rawNot < SLOPE_MIN || p.rawNot > SLOPE_MAX) {
              bad.push('#' + i + ' pente ' + p.rawNot.toFixed(2));
            }
          }
          const total = nJump + nOff;
          console.warn(
            '[mix] tempo hors plage — ' + nJump + ' saut(s), ' + nOff +
            ' pente(s) hors [' + SLOPE_MIN + ', ' + SLOPE_MAX + ']' +
            (bad.length ? ' · ' + bad.join(' · ') : '') +
            (total > 3 ? ' · et ' + (total - 3) + ' autre(s)' : '')
          );
        }
      } catch (e) {
        console.warn('[mix] generateSyncPoints', e);
        note   = 'erreur de synchro : ' + (e && e.message ? e.message : e);
        points = [];
      }
      console.log('[mix] ' + note);
      return points.length;
    }

    /* ---- PRÉ-CUISSON du tempo dans le MidiFile (stratégie C) -----------
       Appelée par player.js juste après `MidiFileGenerator.generate()` :
       on RÉÉCRIT les `TempoChangeEvent` du fichier généré aux ticks des
       points de synchro, avec `tempoNatif / notSlope` — la règle de SEGMENT
       ci-dessus, LA MÊME que le pont. Le lecteur live applique alors la
       partition au tempo de l'enregistrement, segment par segment, avec
       `playbackSpeed` CONSTANT : plus aucune coupure du synthé (RC-2/RC-3).

       On retire TOUS les tempos natifs puis on repose un tempo par point de
       synchro : à l'intérieur d'un segment, l'axe est donc celui de la
       pré-cuisson (mêmes durées que l'audio), et `segmentsFrom().points[].t`
       le décrit exactement. Renvoie le nombre de tempos écrits. */
    function prebake(midiFile, raw, tickShift) {
      try {
        if (!midiFile || !midiFile.tracks || !midiFile.tracks.length) return 0;
        const midi = (typeof alphaTab !== 'undefined') && alphaTab.midi;
        if (!midi || typeof midi.TempoChangeEvent !== 'function') return 0;
        const TT = (midi.MidiEventType && midi.MidiEventType.TempoChange) || 81;
        const seg = segmentsFrom(raw);
        if (!seg.points.length) return 0;
        const shift = isFinite(tickShift) ? tickShift : 0;

        // 1. tempos NATIFS (avant suppression) : référence de tempo du segment
        const native = [];
        for (const tr of midiFile.tracks) {
          for (const e of tr.events) if (e.type === TT && e.beatsPerMinute > 0) native.push(e);
        }
        native.sort((a, b) => a.tick - b.tick);
        const nativeAt = (tick) => {
          let b = 120;
          for (const e of native) { if (e.tick <= tick) b = e.beatsPerMinute; else break; }
          return b;
        };

        // 2. on retire tous les tempos : la pré-cuisson pilote l'axe entier
        for (const tr of midiFile.tracks) tr.events = tr.events.filter(e => e.type !== TT);

        // 3. un tempo pré-cuit par point de synchro
        let n = 0;
        for (const p of seg.points) {
          const tick = p.tick + shift;
          const bpm = nativeAt(tick) / (p.notSlope > 0 ? p.notSlope : 1);
          if (!(bpm > 0) || !isFinite(bpm)) continue;
          const ev = new midi.TempoChangeEvent(tick, 0);
          ev.beatsPerMinute = bpm;
          midiFile.addEvent(ev);
          n++;
        }
        return n;
      } catch (e) {
        console.warn('[mix] pré-cuisson du tempo', e);
        return 0;
      }
    }

    /* ---- axe PRÉ-CUIT (ms) → position audio (ms) ---- */
    function audioMsFor(t) {
      const n = points.length;
      if (n === 0) return t + bias;
      if (n === 1) return points[0].a + (t - points[0].t) + bias;

      if (t <= points[0].t) {                       // avant le 1er point
        const p = points[0], q = points[1], dt = q.t - p.t;
        if (p.jump) return q.a + (t - q.t) * p.slope + bias;   // re-ancré
        return p.a + (dt > 0 ? (t - p.t) * (q.a - p.a) / dt : t - p.t) + bias;
      }
      if (t >= points[n - 1].t) {                   // après le dernier point
        const p = points[n - 1], q = points[n - 2], dt = p.t - q.t;
        if (q.jump) return p.a + (t - p.t) * q.slope + bias;   // re-ancré
        return p.a + (dt > 0 ? (t - p.t) * (p.a - q.a) / dt : t - p.t) + bias;
      }

      let lo = 0, hi = n - 1;                       // recherche dichotomique
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (points[mid].t <= t) lo = mid; else hi = mid - 1;
      }
      const p = points[lo], q = points[lo + 1], dt = q.t - p.t;
      /* Segment de saut (discontinuité) : on NE balaye PAS p.a → q.a sur Δt.
         On se re-ancre sur le bloc destination : la cible saute à l'entrée du
         segment (un SEUL seek) puis rejoint q.a en q.t avec la pente du bloc
         destination, et se poursuit sans couture dans le bloc suivant. */
      if (p.jump) return q.a + (t - q.t) * p.slope + bias;
      return p.a + (q.a - p.a) * (dt > 0 ? (t - p.t) / dt : 0) + bias;
    }

    /* pente locale d(audio)/d(pré-cuit) du segment contenant t — c'est le
       facteur qui multiplie playbackRate pour que l'audio suive le pont. Avec
       le tempo pré-cuit, elle vaut 1,0 partout SAUF les segments clampés et les
       sauts : l'audio reste donc à ~1,0× natif. Elle est clampée à
       [SLOPE_MIN, SLOPE_MAX] ; hors de cette plage le rate ne peut plus suivre,
       la dérive résiduelle est rattrapée par les seeks (HOLD_MS). */
    function slopeAt(t) {
      const n = points.length;
      if (n < 2) return 1;
      if (t <= points[0].t) return points[0].slope;
      if (t >= points[n - 1].t) return points[n - 2].slope;
      let lo = 0, hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (points[mid].t <= t) lo = mid; else hi = mid - 1;
      }
      return points[lo].slope;
    }

    /* ---- HORLOGE MUSICALE : ∫ playbackSpeed·dt ----
       api.timePosition est un axe REEL (1 ms/ms de temps wall) qu'alphaTab
       re-echelonne a chaque changement de vitesse (timePosition *= old/new).
       `timePosition × playbackSpeed` EST l'axe interne du synthé (donc l'axe
       PRÉ-CUIT) ; on integre tout de meme ∫ sp·dt a la cadence des evenements
       (~344/s : precision <1 ms entre deux frontieres) car cela reste exact
       quand la vitesse change, et sur saut detecte (seek, stop, boucle,
       re-echelonnement vendor) on RE-ANCRE plutot que d'integrer un trou :
       le re-echelonnement conservant la position musicale, l'ancre `real × sp`
       retrouve exactement musMs. */
    function advanceMusicalClock(api, now) {
      const real = api.timePosition || 0;
      const sp = curSpeed();
      if (musRef < 0) {                       // premiere passe / nouvelle table
        musMs = real * sp; musRef = real; musWall = now;
        return musMs;
      }
      let dw = now - musWall; if (dw < 0) dw = 0;
      musMs += dw * sp;
      // sur l'axe reel, timePosition avance de ~1 ms par ms wall ; un ecart
      // superieur a la tolerance = repositionnement (seek/stop/boucle/rescale).
      if (Math.abs(real - musRef - dw) > ANCHOR_TOL_MS + dw * 0.5) musMs = real * sp;
      musRef = real; musWall = now;
      return musMs;
    }

    /* vitesse utilisateur : SEUL écrivain de `playbackSpeed` (chargement et
       geste humain). Le tempo GP n'est plus appliqué ici — il est pré-cuit
       dans le MIDI (`prebake`). On n'écrit que si la valeur change, pour ne
       pas couper le synthé pour rien (AlphaSynth.updatePlaybackSpeed → seek). */
    function setUserSpeed(v) {
      userSpeed = v > 0 ? v : 1;
      const api = Player.S.api;
      if (!api) return;
      if (Math.abs((api.playbackSpeed > 0 ? api.playbackSpeed : 1) - userSpeed) > 1e-6) {
        api.playbackSpeed = userSpeed;         // re-échelle la position : on ré-ancre
        musRef = -1;
      }
      setRate(userSpeed);
    }

    /* vitesse réellement appliquée par alphaTab (source de vérité) */
    function curSpeed() {
      const a = Player.S.api;
      return (a && a.playbackSpeed > 0) ? a.playbackSpeed : speed;
    }

    /* pente locale courante du pont — sur l'axe PRÉ-CUIT intégré (≈ 1,0). */
    function slopeNow() {
      return slopeAt(musMs);
    }

    /* ---- cible (secondes) sur l'axe audio ---- */
    function targetSeconds() {
      // musMs = axe PRÉ-CUIT (∫ sp·dt). Le pont y applique l'axe audio.
      // La cible peut être NÉGATIVE : la notation démarre parfois AVANT le
      // début du fichier audio (1er point de synchro à syncTime < 0 — ACDC
      // −1014 ms, Blink −565 ms). C'est le PRÉ-ROLL, géré par correct() ;
      // on ne le borne PAS ici (un clamp masquerait le pré-roll et laisserait
      // un résidu permanent).
      const ms = audioMsFor(musMs);
      return isFinite(ms) ? ms / 1000 : null;
    }

    function seekTo(sec) {
      const a = el();
      if (!a || sec == null) return;
      if (sec < 0) sec = 0;                          // l'audio ne connaît pas le négatif
      try {
        if (Math.abs(a.currentTime - sec) > 0.02) a.currentTime = sec;
      } catch (e) { /* metadata pas encore disponibles */ }
    }

    /* recalage immédiat (seek utilisateur, boucle A→B, changement de source) */
    function resync() {
      if (!active) return;
      const api = Player.S.api;
      if (api) { musMs = (api.timePosition || 0) * curSpeed(); musRef = -1; }
      leadIn = false;
      seekTo(targetSeconds());
    }

    /* ---- boucle de correction ----
       `playerPositionChanged` arrive ~344 fois/s (cf. CONTROL_MS plus haut) :
       on compte CHAQUE appel (pour mesurer la tempête) mais on ne décide
       qu'au plus toutes les CONTROL_MS. */
    function onPosition() {
      const t0 = performance.now();
      try { correct(); } finally {
        nCall++;
        msHandler += performance.now() - t0;
      }
    }

    /* rapport d'instrumentation : une ligne toutes les STAT_MS de lecture */
    function reportStats(now) {
      if (!statWin0) { statWin0 = now; return; }
      if (now - statWin0 < STAT_MS) return;
      const s = (now - statWin0) / 1000;
      console.log(
        `[mix-stats] ${Math.round(nCall / s)} évén/s` +
        ` · playbackRate ${(nRate / s).toFixed(2)} écriture/s` +
        ` · seek ${(nSeek / s).toFixed(2)}/s` +
        ` · arrêts maître ${nStall}` +
        ` · dérive max ${Math.round(peakDrift)} ms` +
        ` · handler ${nCall ? (msHandler / nCall).toFixed(2) : '0'} ms` +
        ` (${Math.round(msHandler / s)} ms/s sur le main thread)`
      );
      nCall = 0; msHandler = 0; nRate = 0; nSeek = 0; nStall = 0; peakDrift = 0;
      statWin0 = now;
    }

    function correct() {
      if (!active || counting) return;
      const api = Player.S.api;
      const a = el();
      if (!api || !a || !a.src) return;

      const now = performance.now();
      advanceMusicalClock(api, now);           // axe PRÉ-CUIT du pont (∫ sp·dt)
      const target = targetSeconds();
      if (target == null) return;

      /* PRÉ-ROLL — la notation démarre AVANT le fichier audio (1er point de
         synchro à syncTime < 0 : ACDC −1014 ms, Blink −565 ms). Tant que la
         cible est négative, l'audio n'a RIEN à jouer : on le tient à 0, à
         l'arrêt. Le laisser avancer puis le recaler par un seek laissait un
         résidu permanent (l'écart entre le point de recale et la fin du
         pré-roll) — c'est le défaut que le clamp `Math.max(0, …)` masquait. */
      if (target < 0) {
        leadIn = true;
        if (a.currentTime > 0.02) seekTo(0);
        if (playing && !a.paused) { try { a.pause(); } catch (e) {} }
        return;
      }
      if (leadIn) {                                  // sortie de pré-roll : PILE
        leadIn = false;
        seekTo(target);
        if (playing) {
          const p = a.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
        return;
      }

      if (!playing) {                                // en pause : simple recadrage
        if (now - lastControl < CONTROL_MS) return;
        lastControl = now;
        if (Math.abs(a.currentTime - target) * 1000 > SOFT_MS) seekTo(target);
        return;
      }
      if (a.readyState < 3) return;                  // pas de données : inutile d'ajuster
      reportStats(now);                              // rapport : uniquement en lecture
      if (now - lastControl < CONTROL_MS) return;    // ← la cadence imposée ici
      const dt = now - lastControl;
      lastControl = now;

      const drift = (a.currentTime - target) * 1000; // > 0 : l'audio est en avance
      if (Math.abs(drift) > peakDrift) peakDrift = Math.abs(drift);

      /* Horloge maître à l'arrêt ? `AlphaSynth._onSamplesPlayed` fait
         `if (sampleCount === 0) return;` (alphaTab l.40094) : quand le synthé
         manque d'échantillons, SON horloge s'arrête pendant que notre
         <audio>, lui, continue. Ralentir l'audio à ce moment-là
         transformerait une panne d'un instant en ralentissement audible suivi
         d'une resynchronisation sèche (cercle vicieux « ça ralentit et ça
         saccade »). Tant que le maître est à l'arrêt : aucune correction.
         Un maître qui recule (stop, aller à une mesure, boucle) n'est PAS un
         arrêt : on recale alors simplement la référence. */
      const master = api.timePosition || 0;
      const dMaster = master - lastMaster;
      const stalled = lastMaster >= 0
        && master >= lastMaster
        && dMaster < dt * STALL_RATIO;
      lastMaster = master;
      if (stalled) { nStall++; return; }

      const sp = curSpeed();
      const slope = slopeNow();                       // pente locale (clampée)
      if (Math.abs(drift) > HOLD_MS) {                // recadrage franc
        seekTo(target);
        setRate(sp);                                  // réapplique vitesse × pente
        nSeek++;
        return;
      }
      if (Math.abs(drift) < DEADBAND_MS) {            // zone morte
        /* Loi « protège » (arbitrée par tools/tempo-correct-sim.js) : on
           REVIENT au taux neutre sp × pente — mais SEULEMENT si le neutre
           RAPPROCHE l'audio de son taux natif pour la vitesse demandée
           (|neutre − sp| ≤ |taux − sp|). Sinon on se tait. Sans cette remise
           au neutre, une correction passée (playbackRate ≠ neutre) resterait
           appliquée en permanence et étirerait l'audio sans raison. */
        const neutral = clamp(sp * slope, 0.06, 16);
        if (now - lastWrite >= WRITE_MS
            && Math.abs(neutral - sp) <= Math.abs(a.playbackRate - sp)
            && Math.abs(a.playbackRate - neutral) > RATE_EPS) {
          a.playbackRate = neutral;
          lastWrite = now;
          nRate++;
        }
        return;
      }
      if (now - lastWrite < WRITE_MS) return;         // pas d'écriture rapprochée
      // rate = vitesse × pente locale × micro-correction de dérive (±NUDGE).
      // La pente fait converger le mp3 vers le tempo du MIDI ; la correction
      // finit le calage. preservesPitch évite toute transposition.
      const r = Math.max(0.06, sp * slope * (1 - clamp(drift / GAIN, -NUDGE, NUDGE)));
      if (Math.abs(a.playbackRate - r) > RATE_EPS) {  // seuil large : le bruit est ignoré
        a.playbackRate = r;
        lastWrite = now;
        nRate++;
      }
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
      if (playing && !counting) {
        resync();                                     // on cale AVANT de démarrer
        const t = targetSeconds();
        if (t != null && t < 0) {                     // pré-roll : rien à jouer
          leadIn = true;
          try { a.pause(); } catch (e) {}
        } else {
          const p = a.play();
          if (p && typeof p.catch === 'function') {
            p.catch(e => {
              console.warn('[mix] audio.play()', e);
              if (e && e.name === 'NotAllowedError') {
                App.toast('Le navigateur a bloqué l\'audio — relancez la lecture.', 'error');
              }
            });
          }
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
      // vitesse utilisateur × pente locale du pont : l'audio suit le tempo noté
      a.playbackRate = clamp(speed * slopeNow(), 0.06, 16);
    }

    /* ---- cycle de vie ---- */
    function start()   { active = true; playing = false; leadIn = false; resetStats(); musRef = -1; setRate(speed); }
    function stop()    {
      active = false; playing = false; leadIn = false;
      const a = el();
      if (a) { try { a.pause(); } catch (e) {} a.playbackRate = 1; }
    }
    function suspend() {                              // nouveau score chargé
      playing = false; leadIn = false;
      const a = el();
      if (a) { try { a.pause(); } catch (e) {} }
    }

    /* ---- gel pendant le compte à rebours ----
       `AlphaSynth.play()` fait `updateTimePosition(0, true)` au démarrage
       du count-in (alphaTab l.39963) : le maître rapporte donc une
       position ≈ 0 pendant les 4 temps. Sans ce gel, `onState(Playing)`
       démarre la piste audio immédiatement (elle joue derrière le
       décompte) et `correct()` finirait par la recaler… sur le début du
       fichier. On fige tout, puis on reprend avec un resync à la fin. */
    let counting = false;
    function setCountIn(on) {
      if (counting === !!on) return;
      counting = !!on;
      const a = el();
      if (counting) { if (a) { try { a.pause(); } catch (e) {} } return; }
      if (active && playing && a) {                      // fin du décompte
        resync();
        const t = targetSeconds();
        if (t != null && t < 0) {                        // pré-roll : rien à jouer
          leadIn = true;
          try { a.pause(); } catch (e) {}
        } else {
          const p = a.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      }
    }

    return {
      build, prebake, segmentsFrom,
      onPosition, onState, resync, setRate, setCountIn,
      start, stop, suspend,
      setUserSpeed,
      /* sonde de banc (jamais utilisée par l'app) : état interne courant */
      _probe: () => ({ musMs: musMs, target: targetSeconds(), slope: slopeNow(), speed: curSpeed(), n: points.length, p0t: points.length ? points[0].t : 0, p0a: points.length ? points[0].a : 0, p0s: points.length ? points[0].slope : 0 }),
      get active() { return active; },
      get info()   { return { points: points.length, note: note, bias: bias,
                              tempoScale: tempoScale, userSpeed: userSpeed }; },
      get tempoScale() { return tempoScale; }
    };
  })();

