/* ==================================================================
   GP8 PLAYER â€” js/mix-sync.js
   4. MIX SYNC â€” SynthÃ© alphaTab (maÃ®tre du temps) + <audio> (esclave).
   ------------------------------------------------------------------
   ChargÃ© en <script classique> par index.html, dans l'ordre de l'ancien
   app.js monolithique. Le partage se fait par les bindings lexicographiques
   globaux (CFG, AT, $, safe, Player, Appâ€¦), PAS par des imports : un module
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

    let points  = [];      // [{ t, a, jump, slope, rawSlope }] trié par t
    let nJump   = 0;       // nb de segments de saut (discontinuités)
    let nOff    = 0;       // nb de segments à pente hors plage
    let avgSlope = 1;      // pente moyenne (tempo enreg. / partition)
    let tempoScale = 1;    // 1/avgSlope = ModifiedTempo/OriginalTempo
    let bias    = 0;       // décalage constant éventuel (calage manuel)
    let playing = false;
    let active  = false;
    let speed   = 1;
    let note    = '';

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

    /* ---- construction du pont synthé → audio ---- */
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
        points = (gen.generateSyncPoints(score) || [])
          .filter(p => p && isFinite(p.synthTime) && isFinite(p.syncTime))
          .map(p => ({ t: p.synthTime, a: p.syncTime }))
          .sort((x, y) => x.t - y.t);
        analyzeSegments();               // dédoublonne + détecte les sauts + pentes
        note = points.length
          ? points.length + ' point(s) de synchro'
            + (nJump ? ' · ' + nJump + ' saut(s)' : '')
            + (nOff ? ' · ' + nOff + ' pente(s) hors plage' : '')
          : 'aucun point de synchro → axe temporel linéaire';
      } catch (e) {
        console.warn('[mix] generateSyncPoints', e);
        note   = 'erreur de synchro : ' + (e && e.message ? e.message : e);
        points = [];
      }
      console.log('[mix] ' + note);
      return points.length;
    }

    /* ---- analyse des segments : dédoublonnage + sauts + pentes --------
       1. dédoublonne les `t` identiques en gardant le DERNIER — exactement la
          sémantique d'alphaTab (`while (next.synthTime <= t) i++` avance au-
          delà de tous les points de même t). Supprime le saut de démarrage
          quand un fichier a plusieurs points à synthTime = 0 (Dr. Stein).
       2. flague chaque segment [i → i+1] « saut » si l'axe audio fait un
          mouvement impossible pour un tempo : recul (Δa < 0) ou pente hors
          [1/JUMP_SLOPE, JUMP_SLOPE] (vraie discontinuité, à re-ancrer).
       3. calcule la pente locale (da/dt) ; pour un segment de saut, la pente
          devient celle du bloc DESTINATION : l'extrapolation rejoint alors le
          bloc suivant sans discontinuité en q.t, et un seul seek suffit au
          franchissement (voir audioMsFor).                                  */
    function analyzeSegments() {
      nJump = 0; nOff = 0;
      // 1. dédoublonnage : garder le dernier point de chaque t
      const dedup = [];
      for (const p of points) {
        while (dedup.length && p.t <= dedup[dedup.length - 1].t) dedup.pop();
        dedup.push(p);
      }
      points = dedup;

      const n = points.length;
      // 2. sauts + pentes naturelles (clampees)
      for (let i = 0; i < n; i++) {
        const p = points[i], q = points[i + 1];
        if (!q) { p.jump = false; p.slope = 1; p.rawSlope = 1; continue; }
        const dt = q.t - p.t, da = q.a - p.a;
        p.rawSlope = dt > 0 ? da / dt : 1;
        p.jump = (da < 0) || (p.rawSlope < 1 / JUMP_SLOPE) || (p.rawSlope > JUMP_SLOPE);
        p.slope = clamp(p.rawSlope, SLOPE_MIN, SLOPE_MAX);
        if (p.jump) nJump++;
        else if (p.rawSlope < SLOPE_MIN || p.rawSlope > SLOPE_MAX) nOff++;
      }
      // 3. segment de saut → pente du bloc destination (parcours inverse pour
      //    chaîner proprement les sauts consécutifs).
      for (let i = n - 1; i >= 0; i--) {
        if (!points[i].jump) continue;
        points[i].slope = (i + 1 < n) ? points[i + 1].slope : 1;
      }

      // Pente MOYENNE = tempo relatif enregistrement / partition (hors sauts).
      // tempoScale = 1/penteMoy = ModifiedTempo/OriginalTempo : c'est le facteur
      // dont alphaTab accélère le MIDI pour coller à l'enregistrement NATIF.
      // Avec ça le <audio> reste à ~1,0× (pas de ralenti, pas de time-stretch).
      let sDa = 0, sDt = 0;
      for (let i = 0; i < n; i++) {
        const p = points[i], q = points[i + 1];
        if (!q || p.jump) continue;
        const dt = q.t - p.t;
        if (dt > 0) { sDa += (q.a - p.a); sDt += dt; }
      }
      avgSlope = sDt > 0 ? sDa / sDt : 1;
      tempoScale = (isFinite(avgSlope) && avgSlope > 0) ? 1 / avgSlope : 1;

      // alerte : signale les segments que le rate ne PEUT pas suivre, plutôt
      // que de saccader silencieusement (les sauts sont déjà gérés).
      if (nJump || nOff) {
        const bad = [];
        for (let i = 0; i < n && bad.length < 3; i++) {
          const p = points[i];
          if (p.jump) bad.push('#' + i + ' saut');
          else if (p.rawSlope < SLOPE_MIN || p.rawSlope > SLOPE_MAX) {
            bad.push('#' + i + ' pente ' + p.rawSlope.toFixed(2));
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
    }

    /* ---- synthTime (ms) → position audio (ms) ---- */
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

    /* pente locale (da/dt) du segment contenant t — c'est le facteur qui doit
       multiplier playbackRate pour que l'audio suive le tempo du pont. Elle est
       clampee a [SLOPE_MIN, SLOPE_MAX] : hors de cette plage le rate ne peut
       plus suivre, la derive residuelle est rattrapee par les seeks (HOLD_MS). */
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

    /* vitesse réellement appliquée par alphaTab (source de vérité) */
    function curSpeed() {
      const a = Player.S.api;
      return (a && a.playbackSpeed > 0) ? a.playbackSpeed : speed;
    }

    /* pente locale courante du pont (da/dt) — facteur qui multiplie le rate
       pour que l'audio suive le tempo noté au lieu de sécuer sur sa dérive. */
    function slopeNow() {
      const api = Player.S.api;
      if (!api) return 1;
      return slopeAt(api.timePosition * curSpeed());
    }

    /* ---- cible (secondes) sur l'axe audio ---- */
    function targetSeconds() {
      const api = Player.S.api;
      if (!api) return null;
      // alphaTab multiplie par playbackSpeed avant d'interpoler
      const ms = audioMsFor(api.timePosition * curSpeed());
      // On borne à 0 (et non null) : un syncTime négatif (ACDC: -1014 ms) ne
      // doit pas laisser la cible indéfinie et désactiver toute correction.
      return isFinite(ms) ? Math.max(0, ms) / 1000 : null;
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
      const a = el();
      if (!a || !a.src) return;
      const target = targetSeconds();
      if (target == null) return;

      const now = performance.now();

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
      const api = Player.S.api;
      const master = api ? api.timePosition : 0;
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
      if (Math.abs(drift) < DEADBAND_MS) return;      // zone morte : on n'y touche pas
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
      // vitesse utilisateur × pente locale du pont : l'audio suit le tempo noté
      a.playbackRate = clamp(speed * slopeNow(), 0.06, 16);
    }

    /* ---- cycle de vie ---- */
    function start()   { active = true; playing = false; resetStats(); setRate(speed); }
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
        const p = a.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    }

    return {
      build, onPosition, onState, resync, setRate, setCountIn,
      start, stop, suspend,
      get active() { return active; },
      get info()   { return { points: points.length, note: note, bias: bias }; },
      get tempoScale() { return tempoScale; }
    };
  })();

