/* ===== Correctif RC-1 / P1 : plan de lecture piloté par les points GPIF =====
   cf. ANALYSE-AUDIO-SYNC-2026-11-26.md §5.1 (P1)

   PROBLÈME. `MidiPlaybackController` d'alphaTab ne joue pas toujours les mêmes
   traversées que l'enregistrement : numérotation `barOccurence` de Guitar Pro
   décalée (H1), voltes multi-fins, reprises imbriquées, D.S./D.C., passages
   supplémentaires dans l'audio (H2). Le pont audio devait alors couvrir des
   écarts avec des pentes énormes, ou sauter des sections : d'où les « sauts »
   et les accélérations/ralentissements.

   SOLUTION P1. Pour un score AVEC piste audio embarquée, on ne laisse plus le
   contrôleur décider seul du déroulé. On construit un PLAN DE LECTURE :

     1. on capture la séquence de notation P (barres réellement jouées par le
        contrôleur, occurrences comprises) ;
     2. on liste les passes GPIF G, triées par temps audio (chaque passe =
        un couple mesure/occurrence GP avec ses points) ;
     3. on apparie G et P par LCS sur l'INDICE DE MESURE (les numéros
        d'occurrence GP ne sont pas une identité fiable) ;
     4. on produit un plan qui contient TOUTES les passes GPIF dans l'ordre
        audio, en insérant les mesures de notation sans point GPIF entre les
        ancres. Chaque passe GPIF est réécrite avec l'occurrence réelle du
        plan (`syncPointValue.barOccurence`), donc `generateSyncPoints` et la
        pré-cuisson la voient exactement une fois.
     5. le MIDI est généré en parcourant ce plan : mêmes callbacks que le
        générateur alphaTab (`generateMasterBar`, `generateTracks`,
        `_processBarTime`), donc tempos, changements de signature et points de
        synchro restent générés par le code vendor.

   Résultat : plus de clé GPIF perdue par un compteur d'occurrence, plus de
   D.S./volta interprété à l'envers. Les morceaux sans audio gardent le
   déroulé alphaTab d'origine (wrapper `normalize` + `_playThroughSong`).

   Le module reste autonome (aucun DOM), exécutable sous Node par les outils.
   ================================================================== */
'use strict';
(function (global) {

  const QUARTER = 960;                 // MidiUtils.QuarterTime (alphaTab)
  const planCache = new WeakMap();

  let installed = false;
  let _MFG = null;
  let _rawPlay = null;
  let _normalize = null;
  let _trace = null;
  let report = null;

  /* index de mesure → dernière occurrence jouée (compatibilité outils) */
  const walkMaxOcc = new Map();
  /* séquence complète des passes jouées : { bar, occ, tick } */
  let walkSeq = [];

  function hasAudio(score) {
    return !!(score && score.backingTrack && score.backingTrack.rawAudioFile);
  }

  /* Clés GPIF de Guitar Pro : "mesure.occurrence". */
  function gpKeysOf(score) {
    const keys = new Set();
    const mbs = score && score.masterBars;
    if (!mbs) return keys;
    for (let i = 0; i < mbs.length; i++) {
      const sps = mbs[i].syncPoints;
      if (!sps || !sps.length) continue;
      for (const sp of sps) {
        const v = sp && sp.syncPointValue;
        if (!v || typeof v.barOccurence !== 'number' || v.barOccurence < 0) continue;
        keys.add(i + '.' + v.barOccurence);
      }
    }
    return keys;
  }

  /* Groupes de points GPIF par passe (mesure, occurrence GP), triés par
     premier offset audio. Plusieurs points d'une même passe (tempo en cours
     de mesure) restent groupés. */
  function gpGroupsOf(score) {
    const map = new Map();
    const mbs = score && score.masterBars;
    if (!mbs) return [];
    for (let i = 0; i < mbs.length; i++) {
      for (const sp of mbs[i].syncPoints || []) {
        const v = sp && sp.syncPointValue;
        if (!v || typeof v.barOccurence !== 'number' || v.barOccurence < 0) continue;
        if (!isFinite(v.millisecondOffset)) continue;
        const key = i + '.' + v.barOccurence;
        if (!map.has(key)) map.set(key, {
          bar: i, occ: v.barOccurence, ms: v.millisecondOffset, points: []
        });
        const g = map.get(key);
        g.points.push(sp);
        if (v.millisecondOffset < g.ms) g.ms = v.millisecondOffset;
      }
    }
    return [...map.values()].sort((a, b) => a.ms - b.ms);
  }

  /* Séquence de notation P, avec la normalisation des fins multiples. On
     utilise le `_playThroughSong` BRUT (pas notre wrapper) pour éviter toute
     récursion ; le plan ne dépend pas des repeatCount ensuite. */
  function captureNotation(score) {
    const out = [];
    const restore = typeof _normalize === 'function' ? _normalize(score) : null;
    try {
      _rawPlay.call(_MFG, score, [], false,
        (bar, previous, tick, tempo, occ) => {
          if (bar && typeof bar.index === 'number') out.push({ bar: bar.index, occ });
        }, () => {}, () => {});
    } finally {
      if (restore) restore();
    }
    return out;
  }

  /* LCS sur l'INDICE DE MESURE. On ignore volontairement les numéros
     d'occurrence GP : c'est eux qui divergent entre GP et alphaTab. */
  function lcsPairs(G, P) {
    const n = G.length, m = P.length;
    if (!n || !m) return [];
    const dp = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = G[i].bar === P[j].bar
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const pairs = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (G[i].bar === P[j].bar) { pairs.push([i, j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return pairs;
  }

  /* Construit le plan : toutes les passes GPIF dans l'ordre audio, plus TOUTES
     les passes de notation dans l'ordre du contrôleur. Une passe de notation
     n'est jamais supprimée sous prétexte que sa mesure a déjà un point GPIF :
     l'appariement LCS peut avoir consommé ce point pour une autre passe, et
     la passe restante serait alors fusionnée avec la suivante. C'est ce
     fusionnement qui faisait étirer une mesure sur deux (tempo ÷ 2). */
  function buildPlan(score) {
    const G = gpGroupsOf(score);
    if (!G.length) return null;
    const P = captureNotation(score);
    if (!P.length) return null;

    const pairs = lcsPairs(G, P);
    const matchP = new Map(pairs.map(([g, p]) => [g, p]));
    const plan = [];
    let pPtr = 0;
    let plainCount = 0;

    /* Passe de notation sans ancre GPIF : intro, pont, ou passe non appariée
       par le LCS. Elle est indispensable pour que le pré-cuit garde le tempo
       naturel (une mesure = une durée de mesure, pas deux). */
    const pushPlain = (e) => {
      plan.push({ bar: score.masterBars[e.bar], gp: null });
      plainCount++;
    };

    for (let g = 0; g < G.length; g++) {
      const p = matchP.get(g);
      if (p !== undefined) {
        while (pPtr < p) pushPlain(P[pPtr++]);
        plan.push({ bar: score.masterBars[P[p].bar], gp: G[g] });
        pPtr = p + 1;
      } else {
        /* Passe GPIF absente de la notation : on l'insère à sa place audio. */
        plan.push({ bar: score.masterBars[G[g].bar], gp: G[g] });
      }
    }

    /* Toute la séquence de notation restante doit figurer dans le plan :
       sinon les passes non ancrées sont fusionnées dans une seule barre et le
       pré-cuit ralentit/accélère cette barre pour couvrir plusieurs mesures. */
    while (pPtr < P.length) pushPlain(P[pPtr++]);

    /* Pas de mesures après la dernière ancre : la fin de l'audio est le
       dernier point GPIF ; ajouter du MIDI après ne ferait que déborder. */

    /* Occurrences RÉELLES du plan + réécriture des points GPIF. */
    const occ = new Map();
    for (const step of plan) {
      const b = step.bar.index;
      const o = (occ.get(b) === undefined ? -1 : occ.get(b)) + 1;
      occ.set(b, o);
      step.occ = o;
      if (step.gp) {
        for (const sp of step.gp.points) {
          if (sp.syncPointValue) sp.syncPointValue.barOccurence = o;
        }
      }
    }

    /* Contrôle de couverture : chaque passe de notation doit être dans le plan
       (appariée à un point GPIF, ou insérée en clair). `notationDropped` doit
       rester à 0 ; il était > 0 avant le correctif (mesures fusionnées). */
    const notationKept = plainCount + pairs.length;
    const notationDropped = Math.max(0, P.length - notationKept);

    return {
      plan, G, P, pairs,
      inserted: plainCount,
      matched: plan.length - plainCount,
      notation: P.length,
      notationKept,
      notationDropped
    };
  }

  function ensurePlan(score) {
    if (!hasAudio(score)) return null;
    if (!_MFG || typeof _rawPlay !== 'function') return null;
    if (planCache.has(score)) return planCache.get(score);
    let plan = null;
    try { plan = buildPlan(score); }
    catch (e) {
      if (_trace) _trace('oracle', 'plan de lecture impossible : ' + e.message);
      plan = null;
    }
    planCache.set(score, plan);
    return plan;
  }

  /* Parcours du plan avec les MÊMES callbacks que `_playThroughSong`. */
  function playPlan(score, planObj, syncPoints, createNewSyncPoints,
                    generateMasterBar, generateTracks, finish) {
    const context = {
      synthTick: 0,
      synthTime: 0,
      currentTempo: score.tempo,
      syncPoints: syncPoints || [],
      createNewSyncPoints: !!createNewSyncPoints,
      automationToSyncPoint: new Map()
    };
    walkMaxOcc.clear();
    walkSeq = [];
    let previous = null;
    let lastOcc = 0;

    for (const step of planObj.plan) {
      const bar = step.bar;
      const currentTick = context.synthTick;
      const occ = step.occ;
      lastOcc = occ;

      if (generateMasterBar) {
        generateMasterBar(bar, previous, currentTick, context.currentTempo, occ);
      }
      if (generateTracks) {
        const tempo = (bar.tempoAutomations && bar.tempoAutomations.length)
          ? bar.tempoAutomations[0].value
          : context.currentTempo;
        generateTracks(bar.index, currentTick, tempo);
      }

      context.synthTick = currentTick;
      _MFG._processBarTime(bar, occ, context);

      const seen = walkMaxOcc.get(bar.index);
      if (seen === undefined || occ > seen) walkMaxOcc.set(bar.index, occ);
      walkSeq.push({ bar: bar.index, occ, tick: currentTick });
      previous = bar;
    }

    /* Point de fin, même logique que MidiFileGenerator._playThroughSong. */
    const sp = context.syncPoints;
    if (sp.length) {
      const last = sp[sp.length - 1];
      const remainingTicks = context.synthTick - last.synthTick;
      if (remainingTicks > 0) {
        const bp = {};
        bp.masterBarIndex = previous ? previous.index : 0;
        bp.masterBarOccurence = lastOcc;
        bp.synthTick = context.synthTick;
        bp.synthBpm = context.currentTempo;
        if (createNewSyncPoints) {
          bp.syncBpm = last.synthBpm;
          bp.synthBpm = last.synthBpm;
        } else if (sp.length === 1) {
          bp.syncBpm = last.synthBpm;
        } else {
          bp.syncBpm = sp[sp.length - 2].syncBpm;
        }
        const synthBpm = last.synthBpm > 0 ? last.synthBpm : 120;
        const syncBpm = bp.syncBpm > 0 ? bp.syncBpm : synthBpm;
        bp.synthTime = last.synthTime + remainingTicks * 60000 / (synthBpm * QUARTER);
        bp.syncTime = last.syncTime + remainingTicks * 60000 / (syncBpm * QUARTER);
        if (!createNewSyncPoints && typeof last.updateSyncBpm === 'function') {
          last.updateSyncBpm(bp.synthTime, bp.syncTime);
        }
        sp.push(bp);
      }
    }

    if (finish) finish(context.synthTick);
    return context;
  }

  /* Enveloppe posée sur MidiFileGenerator._playThroughSong. Pour un score
     avec audio : plan P1. Pour un score sans audio : comportement alphaTab
     d'origine + normalisation des fins multiples (aucun changement). */
  function install(MFG, normalize, trace) {
    try {
      const orig = MFG && MFG._playThroughSong;
      if (typeof orig !== 'function') return 'failed';
      if (orig.__gp8Oracle) return 'already';
      _MFG = MFG;
      _rawPlay = orig;
      _normalize = typeof normalize === 'function' ? normalize : null;
      _trace = typeof trace === 'function' ? trace : null;

      const wrap = function (score, syncPoints, createNewSyncPoints,
                             generateMasterBar, generateTracks, finish) {
        const plan = ensurePlan(score);
        if (plan) {
          return playPlan(score, plan, syncPoints, createNewSyncPoints,
                          generateMasterBar, generateTracks, finish);
        }

        /* --- chemin historique : score sans audio --- */
        const restore = _normalize ? _normalize(score) : null;
        walkMaxOcc.clear();
        walkSeq = [];
        const record = function (bar, previousMasterBar, currentTick, currentTempo, occurence) {
          if (bar && typeof occurence === 'number') {
            const seen = walkMaxOcc.get(bar.index);
            if (seen === undefined || occurence > seen) walkMaxOcc.set(bar.index, occurence);
            walkSeq.push({ bar: bar.index, occ: occurence, tick: currentTick });
          }
          return generateMasterBar ? generateMasterBar.apply(this, arguments) : undefined;
        };
        try {
          return _rawPlay.call(this, score, syncPoints, createNewSyncPoints,
                               record, generateTracks, finish);
        } finally {
          if (restore) restore();
        }
      };
      wrap.__gp8Oracle = true;
      MFG._playThroughSong = wrap;
      installed = true;
      return 'installed';
    } catch (e) {
      if (typeof trace === 'function') trace('oracle', 'enveloppe impossible : ' + e.message);
      return 'failed';
    }
  }

  /* Les trois métriques du pont (conservées pour les outils). */
  function metricsOf(score, MFG, gpKeys) {
    if (!installed || !MFG || typeof MFG.generateSyncPoints !== 'function') return null;
    const pts = MFG.generateSyncPoints(score) || [];
    let nc = 0;
    for (const k of gpKeys) {
      const d = k.lastIndexOf('.');
      const b = Number(k.slice(0, d));
      const seen = walkMaxOcc.get(b);
      if (seen === undefined || seen < Number(k.slice(d + 1))) nc++;
    }
    const seq = [];
    for (const p of pts) {
      if (p && isFinite(p.synthTime) && isFinite(p.syncTime)) seq.push(p);
    }
    seq.sort((a, b) => a.synthTime - b.synthTime);
    const ded = [];
    for (const p of seq) {
      while (ded.length && p.synthTime <= ded[ded.length - 1].synthTime) ded.pop();
      ded.push(p);
    }
    let danger = 0, jumps = 0, back = 0;
    for (let i = 0; i < ded.length - 1; i++) {
      const dt = ded[i + 1].synthTime - ded[i].synthTime;
      if (dt <= 0) continue;
      const sl = (ded[i + 1].syncTime - ded[i].syncTime) / dt;
      if ((sl > 2 && sl <= 3) || (sl >= 1 / 3 && sl < 0.5)) danger++;
      if (sl > 3) jumps++;
      if (sl < 0) back++;
    }
    return { nc, danger, jumps, back };
  }

  function metrics(score, MFG) {
    return metricsOf(score, MFG, gpKeysOf(score));
  }

  /* Ancienne API H1 : plus utilisée (le plan réassigne toutes les passes).
     Conservée pour les outils qui l'appellent. */
  function h1ShiftsOf() { return new Map(); }

  /* À appeler une fois par score, APRÈS fixEmptyAnacrusis et AVANT la
     génération MIDI. Construit le plan (si audio) ; ne modifie pas les
     repeatCount. Renvoie 0 (aucun relèvement heuristique nécessaire). */
  function raise(score, MFG, trace) {
    report = null;
    try {
      const plan = ensurePlan(score);
      if (!plan) return 0;
      report = {
        mode: 'plan',
        gpGroups: plan.G.length,
        planSteps: plan.plan.length,
        inserted: plan.inserted,
        matched: plan.matched,
        notation: plan.notation,
        notationKept: plan.notationKept,
        notationDropped: plan.notationDropped,
        ncBefore: 0, ncAfter: 0,
        dangerBefore: 0, dangerAfter: 0,
        jumpsBefore: 0, jumpsAfter: 0,
        backBefore: 0, backAfter: 0,
        h1Detected: 0, h1Applied: 0, h1Rejected: 0, h1Keys: 0, h1Bars: []
      };
      if (trace) {
        trace('oracle', 'plan GPIF : ' + plan.G.length + ' passe(s), ' +
          plan.plan.length + ' mesure(s) jouée(s), ' +
          plan.inserted + ' mesure(s) de notation intercalée(s), ' +
          plan.notationDropped + ' perdue(s)');
      }
      return 0;
    } catch (e) {
      if (trace) trace('oracle', 'échec plan : ' + e.message);
      return 0;
    }
  }

  function lastReport() { return report; }

  global.RepeatOracle = {
    install, raise, metrics, walkMaxOcc, h1ShiftsOf, lastReport,
    get walkSeq() { return walkSeq; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
