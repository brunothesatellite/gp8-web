/* ===== Correctif RC-1 / P1 : plan de lecture piloté par les points GPIF =====
   cf. ANALYSE-AUDIO-SYNC-2026-11-26.md §5.1 (P1)

   PROBLÈME. `MidiPlaybackController` d'alphaTab ne joue pas toujours les mêmes
   traversées que l'enregistrement : numérotation `barOccurence` de Guitar Pro
   décalée (H1), voltes multi-fins, reprises imbriquées, D.S./D.C., passages
   supplémentaires dans l'audio (H2). Le pont audio devait alors couvrir des
   écarts avec des pentes énormes, ou sauter des sections : d'où les « sauts »
   et les accélérations/ralentissements.

   SOLUTION P1. Pour un score AVEC piste audio embarquée, on ne laisse plus le
   contrôleur décider seul du déroulé. Le module construit un PLAN DE LECTURE :

     1. un parcours structurel générique (reprises, fins alternatives, D.C.,
        D.S., Coda/Fine) produit la séquence de notation P avec les mêmes
        numéros d'occurrence que `_playThroughSong` ;
     2. on liste les passes GPIF G, triées par temps audio (chaque passe =
        un couple mesure/occurrence GP avec ses points) ;
     3. si P couvre TOUTES les clés GPIF, le plan EST P : chaque groupe GPIF
        est rattaché à la passe de même (mesure, occurrence). Aucun LCS, aucune
        réécriture d'occurrence, donc aucune mesure étirée ;
     4. sinon (audio avec passes supplémentaires, ou parcours non concluant),
        on retombe sur l'appariement LCS historique, qui insère les passes
        GPIF manquantes et conserve toutes les passes de notation.

   Résultat : le cas nominal (structure GPIF = structure de partition) est
   exact ; les cas divergents gardent le comportement de secours.

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

  /* ============ PARCOURS DE PARTITION GÉNÉRIQUE =========
     Le contrôleur alphaTab abandonne les reprises internes et les directions
     après un D.C./D.S. (state 1) et ne distingue pas un « To Coda » destiné à
     un D.S. ultérieur. Ce parcours reprend les reprises, les fins alternatives
     et les directions, mais continue le traitement NORMAL des reprises après
     un saut, et n'arme le Coda/Fine que pour un saut explicitement « al Coda /
     al Fine ». Aucun nom de fichier ni numéro de mesure n'est codé ici. */
  const DIR = {
    TargetFine: 0, TargetSegno: 1, TargetSegnoSegno: 2, TargetCoda: 3, TargetDoubleCoda: 4,
    JumpDaCapo: 5, JumpDaCapoAlCoda: 6, JumpDaCapoAlDoubleCoda: 7, JumpDaCapoAlFine: 8,
    JumpDalSegno: 9, JumpDalSegnoAlCoda: 10, JumpDalSegnoAlDoubleCoda: 11, JumpDalSegnoAlFine: 12,
    JumpDalSegnoSegno: 13, JumpDalSegnoSegnoAlCoda: 14, JumpDalSegnoSegnoAlDoubleCoda: 15,
    JumpDalSegnoSegnoAlFine: 16, JumpDaCoda: 17, JumpDaDoubleCoda: 18
  };

  class RepeatState {
    constructor(group, opening) {
      this.group = group;
      this.opening = opening;
      const closings = (group.closings || []).slice().sort((a, b) => a.index - b.index);
      group.closings = closings;
      this.iterations = closings.map(() => 0);
      this.closingIndex = 0;
    }
  }

  class ScoreWalk {
    constructor(score) {
      this.score = score;
      this.repeatStack = [];
      this.groupsOnStack = new Set();
      this.previousAlternateEndings = 0;
      this.index = 0;
      this.currentTick = 0;
      this.shouldPlay = true;
      this.afterJump = false;
      this.codaArmed = false;
      this.fineArmed = false;
      this.jumpOrigin = -1;
    }
    get finished() { return this.index >= this.score.masterBars.length; }
    resetRepeats() {
      this.repeatStack.length = 0;
      this.groupsOnStack.clear();
      this.previousAlternateEndings = 0;
    }
    processCurrent() {
      const mb = this.score.masterBars[this.index];
      let alt = mb.alternateEndings;
      if (alt === 0) alt = this.previousAlternateEndings;
      const rg = mb.repeatGroup;
      if (rg && rg.opening === mb && rg.isClosed) {
        if (!this.groupsOnStack.has(rg)) {
          this.repeatStack.push(new RepeatState(rg, mb));
          this.groupsOnStack.add(rg);
          this.previousAlternateEndings = 0;
          alt = mb.alternateEndings;
        }
      }
      if (!this.repeatStack.length || alt === 0) this.shouldPlay = true;
      else {
        const rep = this.repeatStack[this.repeatStack.length - 1];
        const iteration = rep.iterations[rep.closingIndex] || 0;
        this.previousAlternateEndings = alt;
        this.shouldPlay = (alt & (1 << iteration)) !== 0;
      }
      if (this.shouldPlay) this.currentTick += mb.calculateDuration();
    }
    findTarget(toFind, from, backwardsFirst) {
      const forward = () => {
        for (let i = from; i < this.score.masterBars.length; i++) {
          const d = this.score.masterBars[i].directions;
          if (d && d.has(toFind)) return i;
        }
        return -1;
      };
      const backward = () => {
        for (let i = from; i >= 0; i--) {
          const d = this.score.masterBars[i].directions;
          if (d && d.has(toFind)) return i;
        }
        return -1;
      };
      if (backwardsFirst) {
        const b = backward();
        return b >= 0 ? b : forward();
      }
      const f = forward();
      return f >= 0 ? f : backward();
    }
    handleJump(dirs) {
      if (this.afterJump && this.jumpOrigin === this.index) return false;
      const daCapo = dirs.has(DIR.JumpDaCapo) || dirs.has(DIR.JumpDaCapoAlCoda) ||
        dirs.has(DIR.JumpDaCapoAlDoubleCoda) || dirs.has(DIR.JumpDaCapoAlFine);
      const dalSegno = dirs.has(DIR.JumpDalSegno) || dirs.has(DIR.JumpDalSegnoAlCoda) ||
        dirs.has(DIR.JumpDalSegnoAlDoubleCoda) || dirs.has(DIR.JumpDalSegnoAlFine);
      const dalSegnoSegno = dirs.has(DIR.JumpDalSegnoSegno) || dirs.has(DIR.JumpDalSegnoSegnoAlCoda) ||
        dirs.has(DIR.JumpDalSegnoSegnoAlDoubleCoda) || dirs.has(DIR.JumpDalSegnoSegnoAlFine);
      if (!daCapo && !dalSegno && !dalSegnoSegno) return false;
      let target = 0;
      if (!daCapo) {
        const segno = dalSegnoSegno ? DIR.TargetSegnoSegno : DIR.TargetSegno;
        target = this.findTarget(segno, this.index, true);
        if (target < 0) return false;
      }
      const origin = this.index;
      this.codaArmed = dirs.has(DIR.JumpDaCapoAlCoda) || dirs.has(DIR.JumpDaCapoAlDoubleCoda) ||
        dirs.has(DIR.JumpDalSegnoAlCoda) || dirs.has(DIR.JumpDalSegnoAlDoubleCoda) ||
        dirs.has(DIR.JumpDalSegnoSegnoAlCoda) || dirs.has(DIR.JumpDalSegnoSegnoAlDoubleCoda);
      this.fineArmed = dirs.has(DIR.JumpDaCapoAlFine) || dirs.has(DIR.JumpDalSegnoAlFine) ||
        dirs.has(DIR.JumpDalSegnoSegnoAlFine);
      this.jumpOrigin = origin;
      this.afterJump = true;
      this.index = target;
      this.resetRepeats();
      return true;
    }
    moveNext() {
      const mb = this.score.masterBars[this.index];
      const dirs = mb.directions;
      if (dirs && dirs.size) {
        if (this.afterJump) {
          if (this.codaArmed && (dirs.has(DIR.JumpDaCoda) || dirs.has(DIR.JumpDaDoubleCoda))) {
            const target = this.findTarget(dirs.has(DIR.JumpDaDoubleCoda) ? DIR.TargetDoubleCoda : DIR.TargetCoda,
              this.index, false);
            if (target >= 0) {
              this.index = target;
              this.afterJump = false;
              this.codaArmed = false;
              this.fineArmed = false;
              this.jumpOrigin = -1;
              this.resetRepeats();
              return;
            }
          }
          if (this.fineArmed && dirs.has(DIR.TargetFine)) {
            this.index = this.score.masterBars.length;
            return;
          }
          /* Un nouveau saut reste possible après un D.C. (ex. D.S. al Coda
             plus loin) ; le saut qui nous a amenés ici n'est pas rejoué. */
          if (this.handleJump(dirs)) return;
        } else if (this.handleJump(dirs)) return;
      }
      this.moveNormal();
    }
    moveNormal() {
      const mb = this.score.masterBars[this.index];
      const count = (mb.repeatCount || 0) - 1;
      if (this.repeatStack.length && count > 0) {
        const rep = this.repeatStack[this.repeatStack.length - 1];
        const iter = rep.iterations[rep.closingIndex] || 0;
        if (iter < count) {
          this.index = rep.opening.index;
          rep.iterations[rep.closingIndex] = iter + 1;
          for (let i = 0; i < rep.closingIndex; i++) rep.iterations[i] = 0;
          rep.closingIndex = 0;
          this.previousAlternateEndings = 0;
        } else if (rep.closingIndex < rep.group.closings.length - 1) {
          rep.closingIndex++;
          this.index++;
        } else {
          this.repeatStack.pop();
          this.groupsOnStack.delete(rep.group);
          this.index++;
        }
      } else this.index++;
    }
  }

  /* Parcours générique, borné pour éviter une boucle de directions.
     L'occurrence est globale par mesure, exactement comme le compteur
     `barOccurence` de `_playThroughSong` et comme les clés GPIF. */
  function captureWalk(score) {
    const restore = typeof _normalize === 'function' ? _normalize(score) : null;
    try {
      const walk = new ScoreWalk(score);
      const out = [];
      const occ = new Map();
      const max = score.masterBars.length * 16 + 128;
      while (!walk.finished && out.length <= max) {
        const bar = score.masterBars[walk.index];
        walk.processCurrent();
        if (walk.shouldPlay) {
          const o = (occ.has(bar.index) ? occ.get(bar.index) : -1) + 1;
          occ.set(bar.index, o);
          out.push({ bar: bar.index, occ: o });
        }
        walk.moveNext();
      }
      if (out.length && out.length <= max) return out;
      if (_trace) _trace('oracle', 'parcours générique hors borne (' + out.length + ')');
    } catch (e) {
      if (_trace) _trace('oracle', 'parcours générique impossible : ' + e.message);
    } finally {
      if (restore) restore();
    }
    return null;
  }

  /* Séquence historique alphaTab (référence de secours). */
  function captureAlpha(score) {
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

  /* Choisit, pour le fichier courant, la séquence qui couvre le mieux les
     ancres GPIF. Le parcours générique est retenu s'il est sain et s'il
     apparie plus d'ancres que la séquence alphaTab ; sinon on garde alphaTab.
     Aucun nom de fichier ni numéro de mesure n'intervient. */
  function notationFor(score, G) {
    const max = score.masterBars.length * 16 + 128;
    const evaluate = (P) => {
      if (!P || !P.length || P.length > max) return null;
      const pairs = lcsPairs(G, P);
      const planLen = G.length + P.length - pairs.length;
      if (planLen > max) return null;
      return { P, lcs: pairs.length, planLen };
    };
    const alpha = evaluate(captureAlpha(score));
    const walk = evaluate(captureWalk(score));
    if (walk && (!alpha || walk.lcs > alpha.lcs)) return walk.P;
    return alpha ? alpha.P : (walk ? walk.P : captureAlpha(score));
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

  /* Affinage temporel des appariements LCS. Le LCS ne connaît que l'indice de
     mesure : quand les ancres GPIF sont espacées, il peut apparier une ancre à
     une occurrence trop tôt, et le pré-cuit étire cette passe sur plusieurs
     mesures. On choisit, pour chaque ancre appariée, l'occurrence de notation
     de MÊME mesure qui minimise l'écart entre l'écart audio et l'écart de
     notation (durée médiane locale d'une mesure). Programmation dynamique
     bornée : +4 mesures au plus, pénalité de déviation, ordre strict. */
  function refinePairs(G, P, pairs) {
    const K = pairs.length;
    if (K < 2) return pairs;

    const ratioAt = (k) => {
      if (k < 0 || k + 1 >= K) return null;
      const bars = pairs[k + 1][1] - pairs[k][1];
      const dA = G[pairs[k + 1][0]].ms - G[pairs[k][0]].ms;
      return (bars > 0 && dA > 0) ? dA / bars : null;
    };
    const median = (a) => {
      if (!a.length) return null;
      const s = a.slice().sort((x, y) => x - y);
      return s[Math.floor(s.length / 2)];
    };
    const globalB = median(pairs.map((_, k) => ratioAt(k)).filter(v => v !== null));
    if (!isFinite(globalB) || globalB <= 0) return pairs;

    const MAX_AHEAD = 4;
    const CAND = pairs.map(([g, lcP], k) => {
      const list = [lcP];
      for (let p = lcP + 1; p < P.length && p <= lcP + MAX_AHEAD; p++) {
        if (P[p].bar === G[g].bar) list.push(p);
      }
      /* La première ancre reste sur son appariement LCS : elle sert d'ancrage
         au début de la séquence. */
      return k === 0 ? [lcP] : list;
    });

    const localB = (k) => {
      const rs = [];
      for (let j = Math.max(0, k - 3); j <= Math.min(K - 2, k + 3); j++) {
        const v = ratioAt(j);
        if (v !== null) rs.push(v);
      }
      return median(rs) || globalB;
    };

    const back = [];
    let prevP = CAND[0].slice();
    let prevCost = CAND[0].map(() => 0);
    back.push(CAND[0].map(() => -1));

    for (let k = 1; k < K; k++) {
      const B = localB(k - 1);
      const costs = [], backs = [];
      for (const p of CAND[k]) {
        let best = Infinity, bestPrev = -1;
        for (let pi = 0; pi < prevP.length; pi++) {
          const pp = prevP[pi];
          if (p <= pp) continue;
          const dA = G[pairs[k][0]].ms - G[pairs[k - 1][0]].ms;
          if (!(dA > 0)) continue;
          const expected = Math.min(8, dA / (B > 0 ? B : globalB));
          const bars = p - pp;
          const err = (bars - expected) * (bars - expected);
          const dev = 0.5 * Math.abs(p - pairs[k][1]);
          const c = prevCost[pi] + err + dev;
          if (c < best) { best = c; bestPrev = pi; }
        }
        costs.push(best);
        backs.push(bestPrev);
      }
      if (costs.every(c => !isFinite(c))) return pairs; // pas de suite valide
      back.push(backs);
      prevP = CAND[k].slice();
      prevCost = costs;
    }

    let bi = 0;
    for (let i = 1; i < prevCost.length; i++) if (prevCost[i] < prevCost[bi]) bi = i;
    if (!isFinite(prevCost[bi])) return pairs;
    const chosen = new Array(K);
    chosen[K - 1] = CAND[K - 1][bi];
    let ci = bi;
    for (let k = K - 1; k > 0; k--) {
      ci = back[k][ci];
      if (ci < 0) return pairs;
      chosen[k - 1] = CAND[k - 1][ci];
    }
    return pairs.map(([g], k) => [g, chosen[k]]);
  }

  /* Plan exact : le parcours structurel couvre toutes les ancres GPIF avec
     les bons numéros d'occurrence. Aucune heuristique d'appariement : le plan
     garde toutes les passes du parcours et rattache chaque groupe GPIF à la
     passe de même (mesure, occurrence). Renvoie null si une ancre manque,
     pour laisser la voie historique (LCS) décider. */
  function exactWalkPlan(score, G, P) {
    if (!P || !P.length) return null;
    const byKey = new Map();
    for (let i = 0; i < P.length; i++) {
      const k = P[i].bar + '.' + P[i].occ;
      if (!byKey.has(k)) byKey.set(k, i);
    }
    if (byKey.size < G.length) return null;
    const gpAt = new Map();
    for (const g of G) {
      const i = byKey.get(g.bar + '.' + g.occ);
      if (i === undefined) return null;
      gpAt.set(i, g);
    }

    const plan = P.map((p, i) => ({
      bar: score.masterBars[p.bar],
      gp: gpAt.get(i) || null,
      occ: p.occ
    }));

    /* Les points GPIF sont déjà numérotés avec l'occurrence du parcours ;
       on réécrit quand même pour que la pré-cuisson et le direct voient la
       même valeur, comme dans la voie historique. */
    for (const [i, g] of gpAt) {
      for (const sp of g.points) {
        if (sp.syncPointValue) sp.syncPointValue.barOccurence = P[i].occ;
      }
    }

    return {
      plan, G, P, pairs: [],
      inserted: 0,
      matched: gpAt.size,
      notation: P.length,
      notationKept: P.length,
      notationDropped: 0,
      mode: 'walk'
    };
  }

  /* Voie de secours : toutes les passes GPIF dans l'ordre audio, plus TOUTES
     les passes de notation dans l'ordre du contrôleur. Utilisée seulement quand
     le parcours structurel ne couvre pas exactement les ancres. Une passe de
     notation n'est jamais supprimée sous prétexte que sa mesure a déjà un point
     GPIF : l'appariement LCS peut avoir consommé ce point pour une autre passe,
     et la passe restante serait alors fusionnée avec la suivante. C'est ce
     fusionnement qui faisait étirer une mesure sur deux (tempo ÷ 2). */
  function buildPlan(score) {
    const G = gpGroupsOf(score);
    if (!G.length) return null;

    /* Voie générique exacte : le parcours structurel produit déjà les mêmes
       couples (mesure, occurrence) que les ancres GPIF. Dans ce cas le plan
       EST le parcours, sans LCS ni réécriture d'occurrence : chaque ancre
       tombe sur la passe qu'elle désigne réellement. */
    const exact = exactWalkPlan(score, G, captureWalk(score));
    if (exact) return exact;

    const P = notationFor(score, G);
    if (!P.length) return null;

    const pairs = refinePairs(G, P, lcsPairs(G, P));
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
      notationDropped,
      mode: 'lcs'
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
        mode: plan.mode || 'plan',
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

  /* Vrai si le parcours structurel couvre exactement toutes les ancres. */
  function walkCoversAll(G, P) {
    if (!P || !P.length) return false;
    const keys = new Set();
    for (const p of P) keys.add(p.bar + '.' + p.occ);
    for (const g of G) if (!keys.has(g.bar + '.' + g.occ)) return false;
    return true;
  }

  function notationOf(score) {
    const G = gpGroupsOf(score);
    if (!G.length) return captureAlpha(score);
    const walk = captureWalk(score);
    if (walkCoversAll(G, walk)) return walk;
    return notationFor(score, G);
  }

  global.RepeatOracle = {
    install, raise, metrics, walkMaxOcc, h1ShiftsOf, lastReport, notationOf,
    get walkSeq() { return walkSeq; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
