'use strict';
/* ==================================================================
   tools/tempo-strict-check.js — P1.5 : non-régression des durées répétées
   ------------------------------------------------------------------
   `tempo-outliers.js` liste les occurrences d'une même mesure dont la durée
   pré-cuite dévie de plus de 40 % de la médiane. Certaines déviations sont
   des tempos réels ou des arrangements (half-time, intro, etc.) : on ne fige
   plus une liste d'exceptions par morceau. On contrôle un BUDGET GLOBAL et un
   plafond par fichier, volontairement au-dessus du niveau courant mais très
   en-dessous de l'ancien comportement.

   Niveau courant v1.4.0 (traversée exacte + secours LCS) : 28 mesures / 37 occurrences.
   Ancien niveau (v1.3.2) : 53 mesures / 87 occurrences.

   Usage : node tools/tempo-strict-check.js
   ================================================================== */

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TOOL = path.join(__dirname, 'tempo-outliers.js');

const BUDGET = {
  measures: 35,
  occurrences: 50,
  perFileMeasures: 12,
  perFileOccurrences: 16
};

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
if (!actual || typeof actual.count !== 'number') {
  console.error('ECHEC : sortie tempo-outliers sans compteurs.');
  process.exit(1);
}

const failures = [];
if (actual.count > BUDGET.measures) {
  failures.push('mesures anormales ' + actual.count + ' > budget ' + BUDGET.measures);
}
if (actual.occurrences > BUDGET.occurrences) {
  failures.push('occurrences anormales ' + actual.occurrences + ' > budget ' + BUDGET.occurrences);
}
const files = actual.files || {};
for (const [name, st] of Object.entries(files)) {
  if (st.measures > BUDGET.perFileMeasures) {
    failures.push(name + ' : ' + st.measures + ' mesures > plafond ' + BUDGET.perFileMeasures);
  }
  if (st.occurrences > BUDGET.perFileOccurrences) {
    failures.push(name + ' : ' + st.occurrences + ' occurrences > plafond ' + BUDGET.perFileOccurrences);
  }
}

console.log('');
console.log('DURÉES RÉPÉTÉES — contrôle strict par budget global');
console.log('audit : ' + actual.count + ' mesure(s) / ' + actual.occurrences + ' occurrence(s) · ' +
  'budget : ' + BUDGET.measures + ' / ' + BUDGET.occurrences +
  ' · plafond par fichier : ' + BUDGET.perFileMeasures + ' / ' + BUDGET.perFileOccurrences);
if (failures.length) {
  console.log('  ❌ budget dépassé :');
  for (const f of failures) console.log('    - ' + f);
  console.log('');
  console.log('RESULTAT P1.5 : ECHEC');
  process.exit(1);
}
console.log('  ✅ budget global respecté');
console.log('');
console.log('RESULTAT P1.5 : OK');
