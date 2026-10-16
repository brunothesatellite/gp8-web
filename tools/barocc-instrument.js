/* ==================================================================
   tools/barocc-instrument.js — INSTRUMENTATION RC-1 (BUGFIX-TOTAL P3)
   ------------------------------------------------------------------
   Objet : Trancher, PREUVES À L'APPUI, entre les deux hypothèses du résidu
   RC-1 (`barOccurence` de Guitar Pro ≠ occurrences d'alphaTab) :

     H1 — APPARIEMENT : la numérotation de GP est simplement DÉCALÉE.
          Pour une mesure donnée, l'ensemble des occurrences GP est
          l'ensemble des occurrences JOUÉES translaté d'une constante
          (`G = { w + s : w ∈ W }`, s ≠ 0). Correctif possible : décaler
          `syncPointValue.barOccurence` de ces seuls points.

     H2 — DONNÉE GP : GP référence une ou des TRAVERSÉES que le déroulé
          d'alphaTab ne joue PAS (|G| > |W|), ou une mesure jamais jouée.
          Aucun décalage ne peut couvrir ces clés : c'est le .gp qui
          décrit un enregistrement plus long que la partition lue. Rien à
          corriger côté webapp (à documenter / remonter en amont).

   RÉSULTAT (16/10/2026, code livré) : 72 clés manquantes, toutes H2, sauf
   4 mesures H1 sur Renaud (8, 9, 11, 42) que la garde REFUSE — les couvrir
   ajouterait 6 sauts (7 → 13), car les mesures voisines restent ancrées sur
   une autre passe : le décalage y serait une devinette, pas une preuve.
   Conclusion : résidu = donnée GP (BUGFIX-TOTAL §11.7), conforme à la clause
   de sortie de la DoD #5.

   MÉTHODE (aucun miroir : tout vient du code livré)
     · `js/repeat-oracle.js` est REQUIS et INSTALLÉ (comme dans l'app) ;
       `RO.metrics()` déclenche une passe `generateSyncPoints` réelle et
       remplit `walkMaxOcc` (occurrence MAXIMALE jouée par mesure) — les
       occurrences jouées étant contiguës à partir de 0, l'ensemble joué
       vaut {0 … walkMaxOcc} ;
     · les clés GPIF sont lues sur le score chargé (`masterBars[i].syncPoints`,
       `syncPointValue.barOccurence` / `millisecondOffset`) — la donnée
       brute de Guitar Pro, telle qu'alphaTab la lit ;
     · `fixEmptyAnacrusis` et `RepeatOracle.raise` sont appliqués AVANT,
       exactement comme `js/player.js` à `scoreLoaded` : on instrumente
       donc l'état RÉELLEMENT joué, sans le modifier une fois de plus.

   Sortie : un tableau par fichier + le détail des mesures à clé
   manquante (GP vs joué, décalage, offsets audio). Sortie 0 si les
   comptes restent sous la référence (non-régression) et que CHAQUE clé
   manquante reçoit un verdict, 1 sinon.

   Usage :  node tools/barocc-instrument.js
            node tools/barocc-instrument.js --detail ACDC Renaud
   ================================================================== */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const VENDOR  = path.join(__dirname, 'vendor', 'alphaTab.js');

if (!fs.existsSync(VENDOR)) {
  console.log('VENDOR manquant : tools/vendor/alphaTab.js (voir tools/sync-audit.js)');
  process.exit(1);
}
const at  = require(VENDOR);
const MFG = at.midi.MidiFileGenerator;

/* ---- fonctions LIVRÉES (extraites de player.js) + module livré ------ */
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fonction introuvable dans player.js : ' + name);
  const start = src.indexOf('{', i);
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('fonction non terminée : ' + name);
}
const playerSrc = fs.readFileSync(path.join(ROOT, 'js', 'player.js'), 'utf8');
const fixEmptyAnacrusis = new Function(
  extractFn(playerSrc, 'fixEmptyAnacrusis') + '; return fixEmptyAnacrusis;')();
const normalizeMultiClosingRepeats = new Function(
  extractFn(playerSrc, 'normalizeMultiClosingRepeats') +
  '; return normalizeMultiClosingRepeats;')();

require(path.join(ROOT, 'js', 'repeat-oracle.js'));
const RO = globalThis.RepeatOracle;
if (!RO) throw new Error('RepeatOracle non exposé par js/repeat-oracle.js');
const etat = RO.install(MFG, normalizeMultiClosingRepeats, null);
if (etat !== 'installed' && etat !== 'already') { console.error('oracle : ' + etat); process.exit(1); }

/* ---- signature d'une mesure : clés GPIF et offsets audio ----------- */
/* Renvoie { keys: [{occ, ms, ratio}], set: [occ…] } pour une mesure. Les
   points de synchro GPIF d'une même occurrence (tempo en cours de mesure)
   sont regroupés : `ms` = offset du PREMIER point, `all` = tous. */
function gpKeysOfBar(mb) {
  const map = new Map();
  const sps = (mb && mb.syncPoints) || [];
  for (const sp of sps) {
    const v = sp && sp.syncPointValue;
    if (!v || typeof v.barOccurence !== 'number' || v.barOccurence < 0) continue;
    if (!map.has(v.barOccurence)) map.set(v.barOccurence, []);
    map.get(v.barOccurence).push({
      ms: isFinite(v.millisecondOffset) ? v.millisecondOffset : NaN,
      ratio: isFinite(sp.ratioPosition) ? sp.ratioPosition : NaN
    });
  }
  const occ = [...map.keys()].sort((a, b) => a - b);
  return {
    occ,
    ms: o => { const l = map.get(o); return l && isFinite(l[0].ms) ? l[0].ms : NaN; },
    end: o => { const l = map.get(o); if (!l || !l.length) return NaN;
                const last = l[l.length - 1]; return isFinite(last.ms) ? last.ms : NaN; }
  };
}

/* ---- verdict d'une mesure dont des clés manquent ------------------- */
/* H1 : l'ensemble GP est EXACTEMENT l'ensemble joué translaté (même
   cardinalité) → simple renumérotation, réparable.
   H2 : sinon (traversée absente, ou mesure jamais jouée) → donnée GP.
   `W` = ensemble des occurrences jouées {0 … maxOcc}. */
function verdict(G, W) {
  if (!W.length) return { h: 'H2', why: 'mesure jamais jouée par le déroulé' };
  const shift = G[0] - W[0];                       // W[0] = 0, donc shift = G[0]
  const translated = G.map(g => g - shift);
  const same = translated.length === W.length &&
               translated.every((v, i) => v === W[i]);
  if (same && shift !== 0) {
    return { h: 'H1', why: 'numérotation GP décalée de ' + (shift > 0 ? '+' : '') + shift };
  }
  const extra = G.filter(g => !W.includes(g));
  return { h: 'H2',
           why: (G.length > W.length
                 ? 'GP enregistre ' + G.length + ' traversée(s), le déroulé en joue ' + W.length
                 : 'numérotation incompatible (non translatée)')
                + (extra.length ? ' · clés hors marche : ' + extra.join(',') : '') };
}

/* ---- référence de non-régression (état P2 + oracle, 16/10/2026) ----
   Ces nombres sont les clés manquantes MESURÉES sur le code livré. Le
   critère P3 est 0 ; tant qu'il n'est pas atteint, on exige au moins de
   ne pas faire pire (même logique que tools/repeat-check.js). */
const REF_MISSING = {
  'ACDC':          12,
  'Renaud':        55,
  'The Offspring':  5
};
const SIG = f => f.replace(/\.gp$/i, '').slice(0, 30);

/* ---- options ------------------------------------------------------- */
const argv = process.argv.slice(2);
let detail = null;
const di = argv.indexOf('--detail');
if (di >= 0) detail = argv[di + 1] || '';
const files = fs.readdirSync(SAMPLES).filter(f => /\.gp$/i.test(f)).sort();

console.log('');
console.log('INSTRUMENTATION RC-1 (barOccurence GP ↔ occurrences jouées) — code livré');
console.log('');
const hdr = ['fichier', 'clés GPIF', 'manquantes', 'H1 décalage', 'H2 donnée', 'conclu'];
console.log('| ' + hdr.join(' | ') + ' |');
console.log('|' + hdr.map(() => '---').join('|') + '|');

let bad = 0, totMissing = 0, totH1 = 0, totH2 = 0, nFileH1 = 0;
const details = [];

for (const f of files) {
  const label = SIG(f);
  try {
    const raw = fs.readFileSync(path.join(SAMPLES, f));
    const score = at.importer.ScoreLoader.loadScoreFromBytes(
      new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)),
      new at.Settings());
    fixEmptyAnacrusis(score);
    RO.raise(score, MFG, null);                    // chemin livré (player.js)
    RO.metrics(score, MFG);                        // passe réelle → walkMaxOcc
    const report = RO.lastReport();                // ce que l'oracle a fait (P3)
    const h1Det = report ? report.h1Detected : 0;
    const h1App = report ? report.h1Applied : 0;
    const h1Rej = report ? report.h1Rejected : 0;
    const h1Bars = new Set(report ? (report.h1Bars || []) : []);

    const mbs = score.masterBars;
    let nKeys = 0, nMissing = 0, nH2 = 0, uninstrumented = 0;
    const rows = [];

    for (let b = 0; b < mbs.length; b++) {
      const gp = gpKeysOfBar(mbs[b]);
      if (!gp.occ.length) continue;
      nKeys += gp.occ.length;
      const maxOcc = RO.walkMaxOcc.get(b);
      const W = maxOcc === undefined ? [] : Array.from({ length: maxOcc + 1 }, (_, i) => i);
      const missing = gp.occ.filter(o => !W.includes(o));
      if (!missing.length) continue;

      const v = verdict(gp.occ, W);
      nMissing += missing.length;
      nH2++;
      if (!W.length) uninstrumented++;
      rows.push({
        b, gp: gp.occ, W, missing, h: v.h, why: v.why,
        refused: h1Bars.has(b),
        ms: missing.map(o => Math.round(gp.ms(o)))
      });
    }

    totMissing += nMissing; totH2 += nH2; totH1 += h1Det;
    if (h1Det) nFileH1++;

    /* non-régression : au pire l'état de référence, et jamais de clé
       manquante SANS verdict (toutes sont classées par construction). */
    const ref = REF_MISSING[label];
    let note = '';
    if (ref !== undefined && nMissing > ref) { note = ' ⚠ > réf ' + ref; bad++; }
    if (ref !== undefined && nMissing < ref) note = ' ↓ réf ' + ref;

    console.log('| ' + [
      label, nKeys, nMissing,
      h1Det ? (h1App + '/' + h1Det + ' appliquée(s)' + (h1Rej ? ', ' + h1Rej + ' refusée(s)' : '')) : '—',
      nH2 || '—', 'oui'
    ].join(' | ') + ' |' + note);

    details.push({ label, rows, nMissing, nH2, h1Det, h1App, h1Rej });
  } catch (e) {
    bad++;
    console.error('ECHEC ' + label + ' : ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  }
}

/* ---- détail des mesures à clé manquante ---------------------------- */
const showDetail = l => !detail || l.indexOf(detail) === 0;
for (const d of details) {
  if (!d.rows.length || !showDetail(d.label)) continue;
  console.log('');
  console.log('· ' + d.label + ' — ' + d.nMissing + ' clé(s) manquante(s)');
  for (const r of d.rows) {
    console.log('    mes ' + String(r.b).padStart(3) +
      ' · GP occ [' + r.gp.join(',') + ']' +
      ' · joué [' + (r.W.length ? '0…' + r.W[r.W.length - 1] : '—') + ']' +
      ' · manque [' + r.missing.join(',') + ']' +
      ' · audio ms [' + r.ms.join(',') + ']' +
      ' · ' + (r.refused ? 'H1 (refusée par la garde : introduirait des sauts)' : r.h + ' — ' + r.why));
  }
}

console.log('');
console.log('clés GPIF manquantes (total) : ' + totMissing);
console.log('verdicts : ' + totMissing + ' clé(s) manquante(s) réparties sur ' + totH2 +
  ' mesure(s) H2 (donnée GP)' + (totH1 ? ' · ' + totH1 + ' mesure(s) H1 DÉTECTÉE(S)' : ''));
console.log('fichiers portant au moins une mesure H1 : ' + nFileH1 +
  ' (l\'oracle les réassigne SI la garde l\'accepte — voir colonne « H1 décalage »)');
console.log('');
console.log('LECTURE :');
console.log(' · H1 = l\'ensemble des occurrences GP est EXACTEMENT l\'ensemble joué translaté :');
console.log('   un décalage de `barOccurence` sur les seuls points concernés suffit. L\'oracle le');
console.log('   TENTE (js/repeat-oracle.js) et ne le CONSERVE que si les clés manquantes baissent');
console.log('   sans ajouter de pente hors clamp, de saut re-ancré ni de segment d\'audio reculant.');
console.log(' · H2 = GP décrit des traversées que le déroulé ne joue pas (ou une mesure jamais');
console.log('   jouée) : AUCUN décalage ne les couvre — donnée du .gp, documentée (BUGFIX-TOTAL');
console.log('   §11.7) et non corrigée côté webapp (cf. précédent BUGMP3 §12.2).');
process.exit(bad === 0 ? 0 : 1);
