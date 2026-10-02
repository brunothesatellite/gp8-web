/* ===== Correctif RC-1 : traversées de répétition pilotées par Guitar Pro =====
   BUGMP3 §14

   PROBLÈME. Quand le déroulé alphaTab (`repeatCount`) joue MOINS de
   traversées que Guitar Pro n'en a enregistrées dans ses points de synchro,
   la marche saute des passages qui existent pourtant dans l'enregistrement.
   Le pont audio doit alors couvrir un long écart d'audio avec une courte
   plage de partition : la pente du segment sort du clamp [0,5 ; 2] et
   `playbackSpeed` est plaqué à 0,50-0,69× pendant plusieurs secondes
   (« [mix] tempo hors plage »). C'est la régression `c7609e6` : la
   suppression de `fixAlternateEndings` a fait tomber Slayer de 148/148 à
   140/148 points GPIF couverts.

   POURQUOI PAS L'ANCIEN HEURISTIQUE. `fixAlternateEndings` relevait
   `repeatCount` jusqu'à la plus haute alternance MAXIMALE lue dans les
   masques (`maxEnd`). Exacte sur Slayer, elle est FAUSSE sur AC/DC (même
   forme de notation, lecture attendue différente : 2 passes, validées par
   l'utilisateur) et elle détruisait Renaud (119 → 61 mesures). Deviner la
   partition dans les masques est donc sans issue.

   PRINCIPE. On demande la réponse à Guitar Pro lui-même : ses points de
   synchro portent le couple (mesure, occurrence), c'est-à-dire la liste
   exacte des traversées que l'enregistrement contient. On relève
   `repeatCount` au MINIMUM qui couvre ces clés, puis on n'accepte un
   relèvement QUE si aucune des trois métriques du pont ne se dégrade :
     1. clés GPIF manquantes          → doit DIMINUER (c'est l'objet) ;
     2. pentes hors du clamp [0,5 ; 2] → ne doit pas AUGMENTER (sinon on
        invente un nouveau « MIDI à 0,5× ») ;
     3. sauts re-ancrés (pente > 3)    → ne doit pas AUGMENTER (chaque saut =
        un recadrage sec en lecture).
   Tout groupe sans clé manquante, tout relèvement sans effet (cas H1 d'AC/DC
   où la numérotation de GP ne colle pas) est laissé intact. Mesuré sur les 14
   échantillons (harnais) : Slayer 8 → 0 clé manquante et 1 → 0 pente hors
   clamp, Blink 9 → 0, Offspring 15 → 9, AC/DC 16 → 12, AUCUN fichier
   dégradé — l'ancien fix, lui, totalisait 130 manquantes (pire que rien).

   Le déroulé réel n'est PAS dupliqué : `_playThroughSong` appelle
   `generateMasterBar(bar, …, occurence)` à chaque mesure jouée, on s'y branche
   pour lire les occurrences sur le vif (`install`). Le fichier est volontaire
   autonome (aucun accès DOM) pour être aussi exécutable sous Node par les
   outils de contrôle. */
'use strict';
(function (global) {

  /* index de mesure → dernière occurrence jouée, rempli par install() */
  const walkMaxOcc = new Map();
  let installed = false;

  /* Clés GPIF de Guitar Pro : "mesure.occurrence". Un même couple peut revenir
     plusieurs fois (tempo en cours de mesure) : on déduplique pour ne compter
     qu'une seule clé. */
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

  /* Les trois métriques du pont, sur une seule passe generateSyncPoints :
       nc     clés GPIF manquantes (le déroulé ne joue pas ce qu GP enregistré),
       danger segments dont la pente sort du clamp [0,5 ; 2] → MIDI plaqué à
              0,5× pendant plusieurs secondes (« [mix] tempo hors plage ») ;
       jumps  segments à pente > 3, re-ancrés : un recadrage sec en lecture.
     Lignes de tri et d'écrasement des temps synthé identiques à celles du
     pont livré. Exige l'enveloppe posée (install) : c'est elle qui alimente
     walkMaxOcc. Renvoie null si l'observatoire est absent. */
  function metricsOf(score, MFG, gpKeys) {
    if (!installed || !MFG || typeof MFG.generateSyncPoints !== 'function') return null;
    const pts = MFG.generateSyncPoints(score) || [];
    let nc = 0;
    for (const k of gpKeys) {
      const d = k.lastIndexOf('.');
      const seen = walkMaxOcc.get(Number(k.slice(0, d)));
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
    let danger = 0, jumps = 0;
    for (let i = 0; i < ded.length - 1; i++) {
      const dt = ded[i + 1].synthTime - ded[i].synthTime;
      if (dt <= 0) continue;
      const sl = (ded[i + 1].syncTime - ded[i].syncTime) / dt;
      if ((sl > 2 && sl <= 3) || (sl >= 1 / 3 && sl < 0.5)) danger++;  // hors clamp
      if (sl > 3) jumps++;                                             // re-ancré
    }
    return { nc, danger, jumps };
  }

  /* Métriques publiques (diagnostic/console et outils de contrôle). */
  function metrics(score, MFG) {
    return metricsOf(score, MFG, gpKeysOf(score));
  }

  /* Enveloppe `MidiFileGenerator._playThroughSong` — le seul point par lequel
     alphaTab parcourt la chanson (génération MIDI, points de synchro ET table
     de tempo modifié s'y réunissent). On y fait deux choses, toutes deux
     LIMITÉES À LA DURÉE DE L'APPEL :
       · `normalize(score)` (fins multiples, voir player.js) est appliqué puis
         restitué : le rendu, la recherche et l'export voient le score
         d'origine ;
       · l'argument `generateMasterBar` est doublé d'un enregistreur qui note,
         pour chaque mesure JOUÉE, l'occurrence la plus haute atteinte.
     Renvoie 'installed' | 'already' | 'failed'. */
  function install(MFG, normalize, trace) {
    try {
      const orig = MFG && MFG._playThroughSong;
      if (typeof orig !== 'function') return 'failed';
      if (orig.__gp8Oracle) return 'already';
      const wrap = function (score, syncPoints, createNewSyncPoints,
                             generateMasterBar, generateTracks, finish) {
        const restore = typeof normalize === 'function' ? normalize(score) : null;
        walkMaxOcc.clear();                    // une passe = un état de marche
        const record = function (bar, previousMasterBar, currentTick,
                                 currentTempo, occurence) {
          if (bar && typeof occurence === 'number') {
            const seen = walkMaxOcc.get(bar.index);
            if (seen === undefined || occurence > seen) walkMaxOcc.set(bar.index, occurence);
          }
          return generateMasterBar ? generateMasterBar.apply(this, arguments) : undefined;
        };
        try {
          return orig.call(this, score, syncPoints, createNewSyncPoints,
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
      if (trace) trace('oracle', 'enveloppe _playThroughSong impossible : ' + e.message);
      return 'failed';
    }
  }

  /* Relève `repeatCount` là où Guitar Pro prouve qu'il manque des traversées.
     À appeler une fois par score, APRÈS fixEmptyAnacrusis et AVANT la
     génération MIDI. Renvoie le nombre de groupes relevés (0 = rien à faire,
     y compris si l'enveloppe n'est pas posée : on ne devine jamais). */
  function raise(score, MFG, trace) {
    try {
      if (!installed) return 0;
      const mbs = score && score.masterBars;
      if (!mbs || !mbs.length) return 0;
      if (!MFG || typeof MFG.generateSyncPoints !== 'function') return 0;

      /* ---- 1. clés GPIF de Guitar Pro (« mesure.occurrence ») ---- */
      const gpKeys = gpKeysOf(score);
      if (!gpKeys.size) return 0;          // .gp sans points GPIF : rien à faire

      /* ---- 2. métriques du pont (une passe generateSyncPoints par appel) ---- */
      const measure = () => metricsOf(score, MFG, gpKeys);

      let cur = measure();
      if (!walkMaxOcc.size) return 0;   // observatoire absent : on ne devine pas
      if (!cur.nc) return 0;            // toutes les clés GPIF sont couvertes
      const nc0 = cur.nc;

      /* mesures dont AU MOINS UNE clé GPIF manque : seuls les groupes qui les
         contiennent peuvent gagner quelque chose (la règle 1 rejette les
         autres), ce qui évite de re-passer le score pour rien. */
      const missBars = new Set();
      for (const k of gpKeys) {
        const d = k.lastIndexOf('.');
        const b = Number(k.slice(0, d));
        const seen = walkMaxOcc.get(b);
        if (seen === undefined || seen < Number(k.slice(d + 1))) missBars.add(b);
      }

      /* ---- 3. groupes à fermeture UNIQUE : les groupes à fins multiples
              sont déjà pilotés par normalizeMultiClosingRepeats et ne doivent
              pas être touchés une seconde fois ---- */
      const groups = [], seenGroups = new Set();
      for (const mb of mbs) {
        if (!mb.isRepeatEnd) continue;
        const g = mb.repeatGroup;
        if (!g || !g.isClosed || !g.closings || g.closings.length !== 1) continue;
        if (seenGroups.has(g)) continue;
        seenGroups.add(g);
        groups.push(g);
      }

      let raised = 0;
      for (const g of groups) {
        if (cur.nc === 0) break;                // plus rien à couvrir
        const members = (g.masterBars && g.masterBars.length)
          ? g.masterBars
          : mbs.filter(b => b.repeatGroup === g);
        if (!members.some(b => missBars.has(b.index))) continue;

        const closing = g.closings[0];
        const saved = closing.repeatCount;
        let best = null, bestRc = saved;
        for (let cnt = saved + 1; cnt <= saved + 4; cnt++) {
          closing.repeatCount = cnt;
          const m = measure();
          if (m.nc < cur.nc && m.danger <= cur.danger && m.jumps <= cur.jumps &&
              (!best || m.nc < best.nc)) {
            best = m; bestRc = cnt;
          }
          if (best && best.nc === 0 && best.danger === 0) break;
        }
        if (best) {
          closing.repeatCount = bestRc;         // retenu : prouvé, jamais de perte
          cur = best;
          raised++;
        } else {
          closing.repeatCount = saved;          // rejeté : sans effet ou nuisible
        }
      }

      if (raised && trace) {
        trace('oracle', `${raised} groupe(s) de répétition relevé(s) d'après ` +
          `les points GPIF — clés manquantes ${nc0} → ${cur.nc}, ` +
          `pentes hors clamp ${cur.danger}, sauts ${cur.jumps}`);
      }
      return raised;
    } catch (e) {
      if (trace) trace('oracle', 'échec : ' + e.message);
      return 0;
    }
  }

  global.RepeatOracle = { install, raise, metrics, walkMaxOcc };
})(typeof window !== 'undefined' ? window : globalThis);
