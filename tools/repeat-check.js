/* ==================================================================
   Contrôles de non-régression du CORRECTIF RC-1 (BUGMP3 §14)
   ------------------------------------------------------------------
   Exécute le VRAI code du dépôt :
     · js/repeat-oracle.js  (module livré, requis tel quel) ;
     · fixEmptyAnacrusis() et normalizeMultiClosingRepeats(), EXTRAITES
       de js/player.js (aucune copie : ce qui est testé est ce qui tourne).
   Déroule, pour chaque samples/*.gp, le chemin de scoreLoaded :
     fixEmptyAnacrusis → RepeatOracle.raise → métriques du pont.

   Vérifie :
     A. tout échantillon porte bien un audio embarqué AU MOMENT de
        scoreLoaded (sinon la condition de player.js neutraliserait le
        correctif en silence) ;
     B. AUCUNE des trois métriques ne se dégrade (clés GPIF manquantes,
        pentes hors clamp [0,5 ; 2], sauts re-ancrés) ;
     C. les gains attendus sont retrouvés (reference, valeurs en CLÉS
        GPIF UNIQUES — un même couple mesure/occurrence peut porter
        plusieurs points, ils ne comptent qu'une fois) ;
     D. `raise` est idempotent (un second appel ne lève rien).

   Usage :  node tools/repeat-check.js     (14 échantillons, ~10 s)
   Sortie : 0 = conforme, 1 = anomalie (testable en CI).
   ================================================================== */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const VENDOR  = path.join(__dirname, 'vendor', 'alphaTab.js');

if (!fs.existsSync(VENDOR)) {
  console.log("VENDOR manquant : tools/vendor/alphaTab.js (voir tools/sync-audit.js, qui le telecharge)");
  process.exit(1);
}
const at = require(VENDOR);

/* ---- deux fonctions LIVRÉES dans js/player.js (pas de copie ici) ---- */
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

/* ---- le module livré ---- */
require(path.join(ROOT, 'js', 'repeat-oracle.js'));
const RO = globalThis.RepeatOracle;
if (!RO) throw new Error('RepeatOracle non expose par js/repeat-oracle.js');

const MFG = at.midi.MidiFileGenerator;
const etat = RO.install(MFG, normalizeMultiClosingRepeats, null);
console.log('RepeatOracle.install → ' + etat);
if (etat !== 'installed' && etat !== 'already') process.exit(1);

function load(f) {
  const b = fs.readFileSync(path.join(SAMPLES, f));
  return at.importer.ScoreLoader.loadScoreFromBytes(
    new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), new at.Settings());
}
const fmt = m => m ? `${m.nc} / ${m.danger} / ${m.jumps}` : '(null)';

/* Gains attendus, en clés uniques (avant → après). Fichier absent de cette
   table : seule la non-régression (B) est exigée de lui. */
const REF = {
  'ACDC':          { before: [16, 2, 4], after: [12, 2, 3] },
  'Blink':         { before: [7,  0, 3], after: [0,  0, 2] },
  'Slayer':        { before: [8,  1, 0], after: [0,  0, 0] },
  'The Offspring': { before: [8,  0, 2], after: [5,  0, 1] }
};

const files = fs.readdirSync(SAMPLES).filter(f => /\.gp$/i.test(f)).sort();
console.log('fichier'.padEnd(38) + '| audio | AVANT (manq/clamp/saut) | APRÈS                     | levés');
console.log('-'.repeat(110));

let bad = 0, sansAudio = 0, avant = 0, apres = 0;
for (const f of files) {
  const label = f.replace(/\.gp$/i, '').slice(0, 36);
  try {
    const score = load(f);
    fixEmptyAnacrusis(score);

    const audio = !!(score.backingTrack && score.backingTrack.rawAudioFile);
    if (!audio) sansAudio++;

    const b = RO.metrics(score, MFG);
    const n = RO.raise(score, MFG, null);
    const a = RO.metrics(score, MFG);
    avant += b.nc; apres += a.nc;

    /* B. aucune régression */
    if (!(a.nc <= b.nc && a.danger <= b.danger && a.jumps <= b.jumps)) {
      console.log('      ✗ RÉGRESSION ' + label); bad++;
    }
    /* D. idempotence */
    if (RO.raise(score, MFG, null) !== 0) {
      console.log('      ✗ second raise a relevé des groupes : ' + label); bad++;
    }
    /* C. gains de référence */
    let note = '';
    for (const k of Object.keys(REF)) {
      if (label.indexOf(k) !== 0) continue;
      const r = REF[k];
      const okB = [b.nc, b.danger, b.jumps].every((v, i) => v === r.before[i]);
      const okA = [a.nc, a.danger, a.jumps].every((v, i) => v === r.after[i]);
      note = okB && okA ? '  ref=ok' : '  ref≠ (' + (okB ? '' : 'avant ' + r.before.join('/') + ' ') +
                                      (okA ? '' : 'après ' + r.after.join('/')) + ')';
      if (!okB || !okA) bad++;
    }
    console.log(label.padEnd(38) + '| ' + (audio ? ' oui ' : ' NON ') + ' | ' +
      fmt(b).padEnd(23) + '| ' + fmt(a).padEnd(25) + '| ' + String(n).padStart(4) + note);
  } catch (e) {
    bad++;
    console.error('ECHEC ' + f + ' : ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | '));
  }
}
console.log('-'.repeat(110));
console.log('clés GPIF manquantes : AVANT ' + avant + ' → APRÈS ' + apres);
console.log('audio embarqué a scoreLoaded : ' + (files.length - sansAudio) + '/' + files.length);
console.log(bad === 0
  ? 'RESULTAT : OK — aucune régression, gains conformes a la reference'
  : 'RESULTAT : ' + bad + ' ANOMALIE(S)');
process.exit(bad === 0 ? 0 : 1);
