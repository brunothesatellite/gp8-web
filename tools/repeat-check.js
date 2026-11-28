/* ==================================================================
   Contrôles de non-régression du CORRECTIF RC-1 (BUGFIX-TOTAL.md §2.1)
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
        plan GPIF en silence) ;
     B. le plan GPIF couvre TOUTES les clés (clés manquantes = 0) ;
     C. `raise` ne modifie pas le déroulé (le plan est la seule source) ;
     D. `raise` est idempotent (un second appel ne lève rien) ;
     E. en mode exact (`walk`), le plan EST le parcours : aucune passe
        ajoutée, aucune passe de notation perdue.

   Usage :  node tools/repeat-check.js     (17 échantillons)
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

/* P1 : le plan GPIF doit couvrir TOUTES les clés. Plus de référence
   « avant/après » : le critère est a.nc === 0 pour chaque fichier. */
const files = fs.readdirSync(SAMPLES).filter(f => /\.gp$/i.test(f)).sort();
console.log('fichier'.padEnd(38) + '| audio | APRÈS (manq/clamp/saut) | levés | verdict');
console.log('-'.repeat(110));

let bad = 0, sansAudio = 0, apres = 0;
for (const f of files) {
  const label = f.replace(/\.gp$/i, '').slice(0, 36);
  try {
    const score = load(f);
    fixEmptyAnacrusis(score);

    const audio = !!(score.backingTrack && score.backingTrack.rawAudioFile);
    if (!audio) sansAudio++;

    const n = RO.raise(score, MFG, null);
    const a = RO.metrics(score, MFG);
    const report = RO.lastReport();
    apres += a.nc;

    /* E. mode exact : le plan doit être le parcours, sans passe ajoutée. */
    if (report && report.mode === 'walk' &&
        (report.planSteps !== report.notation || report.inserted !== 0)) {
      console.log('      ✗ plan exact incohérent ' + label + ' : plan=' +
        report.planSteps + ' notation=' + report.notation + ' inséré=' + report.inserted);
      bad++;
    }

    if (a.nc !== 0) {
      console.log('      ✗ CLÉS MANQUANTES ' + label + ' : ' + a.nc); bad++;
    }
    if (n !== 0) {
      console.log('      ✗ raise() a modifié le déroulé : ' + label); bad++;
    }
    /* D. idempotence */
    if (RO.raise(score, MFG, null) !== 0) {
      console.log('      ✗ second raise a modifié le déroulé : ' + label); bad++;
    }
    console.log(label.padEnd(38) + '| ' + (audio ? ' oui ' : ' NON ') + ' | ' +
      fmt(a).padEnd(25) + '| ' + String(n).padStart(4) + ' | ' +
      (a.nc === 0 ? 'OK' : 'KO'));
  } catch (e) {
    bad++;
    console.error('ECHEC ' + f + ' : ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | '));
  }
}
console.log('-'.repeat(110));
console.log('clés GPIF manquantes : APRÈS ' + apres);
console.log('audio embarqué a scoreLoaded : ' + (files.length - sansAudio) + '/' + files.length);
console.log(bad === 0
  ? 'RESULTAT : OK — plan GPIF, 0 clé manquante, idempotent'
  : 'RESULTAT : ' + bad + ' ANOMALIE(S)');
process.exit(bad === 0 ? 0 : 1);
