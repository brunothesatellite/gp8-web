'use strict';
/* ==================================================================
   tools/tempo-strict-check.js — P1.5 : non-régression des durées répétées
   ------------------------------------------------------------------
   `tempo-outliers.js` liste les occurrences d'une même mesure dont la durée
   pré-cuite dévie de plus de 40 % de la médiane. Certaines déviations sont
   des tempos réels ou des points déjà consignés (RESTE-A-ANALYSER.md) : ils
   sont dans `tools/tempo-exceptions.json`.

   Ce test rejoue l'audit et échoue si une mesure devient anormale SANS être
   dans la liste d'exceptions. Une exception devenue inutile est signalée mais
   n'échoue pas.

   Usage : node tools/tempo-strict-check.js
   ================================================================== */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TOOL = path.join(__dirname, 'tempo-outliers.js');
const BASELINE = path.join(__dirname, 'tempo-exceptions.json');

let baseline;
try {
  baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
} catch (e) {
  console.error('ECHEC lecture ' + BASELINE + ' : ' + e.message);
  process.exit(1);
}
if (!baseline || !baseline.exceptions) {
  console.error('ECHEC : ' + BASELINE + ' ne contient pas "exceptions".');
  process.exit(1);
}

let actual;
try {
  const out = execFileSync(process.execPath, [TOOL, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180000
  });
  actual = JSON.parse(out);
} catch (e) {
  console.error('ECHEC exécution tempo-outliers --json : ' + (e && e.message ? e.message : e));
  if (e && e.stdout) console.error(String(e.stdout).slice(0, 2000));
  process.exit(1);
}
if (!actual || !actual.exceptions) {
  console.error('ECHEC : sortie tempo-outliers sans "exceptions".');
  process.exit(1);
}

const baseKeys = new Set(Object.keys(baseline.exceptions));
const actKeys = new Set(Object.keys(actual.exceptions));
const unexpected = [...actKeys].filter(k => !baseKeys.has(k)).sort();
const stale = [...baseKeys].filter(k => !actKeys.has(k)).sort();

console.log('');
console.log('DURÉES RÉPÉTÉES — contrôle strict avec exceptions');
console.log('baseline : ' + baseKeys.size + ' exception(s) · audit : ' +
  actual.count + ' mesure(s) / ' + actual.occurrences + ' occurrence(s)');
if (stale.length) {
  console.log('  ⚠ exception(s) devenue(s) inutile(s) : ' + stale.length +
    ' (à nettoyer, non bloquant)');
  for (const k of stale.slice(0, 5)) console.log('    - ' + k);
}
if (unexpected.length) {
  console.log('  ❌ nouvelle(s) mesure(s) anormale(s) hors exceptions : ' + unexpected.length);
  for (const k of unexpected) console.log('    - ' + k);
  console.log('');
  console.log('RESULTAT P1.5 : ECHEC');
  process.exit(1);
}
console.log('  ✅ aucune nouvelle mesure anormale hors exceptions');
console.log('');
console.log('RESULTAT P1.5 : OK');
