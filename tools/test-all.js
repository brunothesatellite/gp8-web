'use strict';
/* ==================================================================
   tools/test-all.js — SUITE UNIQUE (BUGFIX-TOTAL P5, étape 12)
   ------------------------------------------------------------------
   Exécute TOUS les harnais du dossier `tools/` — chacun lance le CODE
   LIVRÉ (jamais un miroir) — et sort 0 seulement si TOUT passe. Chaque
   harnais porte déjà son propre critère de sortie ; ici on agrège.

   Prérequis : `tools/vendor/alphaTab.js` (version épinglée). Aucune
   dépendance npm : le dépôt reste sans dépendance à l'exécution.

   Usage :
     node tools/test-all.js            # tableau récapitulatif
     node tools/test-all.js --verbose  # + la sortie complète de chaque harnais
   ================================================================== */

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const VERBOSE = process.argv.includes('--verbose');

/* Ordre : du moins coûteux au plus coûteux (duration-check régénère
   chaque .gp deux fois : génération + pont livré). */
const SUITE = [
  ['load-smoke',          "ordre des <script>, bindings, App.boot / Samples.build"],
  ['repeat-check',        "renvois : clés GPIF manquantes, non-régression de l'oracle"],
  ['barocc-instrument',   "RC-1 (P3) : clés manquantes classées H1/H2, sous référence"],
  ['tempo-correct-sim',   "loi « protège » sur playbackRate (modèle PRÉ-P2, référence)"],
  ['sync-audit',          "chemin livré : recadrages / glitchs / sauts par fichier"],
  ['tempo-prebake-spike', "pré-cuisson livrée : fidélité par segment < 0,5 %"],
  ['mix-sync-harness',    "contrôleur RÉEL : tempoWrites = 0, dérive < 40 ms"],
  ['duration-check',      "P4 : anacrouse ↔ portée audio GPIF, fin de webapp ≤ MP3"]
];

if (!fs.existsSync(path.join(__dirname, 'vendor', 'alphaTab.js'))) {
  console.error('VENDOR manquant : tools/vendor/alphaTab.js (voir tools/sync-audit.js).');
  process.exit(1);
}

const rows = [];
let bad = 0;

for (const [name, what] of SUITE) {
  const file = path.join(__dirname, name + '.js');
  if (!fs.existsSync(file)) {
    rows.push({ name, what, ok: false, ms: 0, out: 'fichier absent : ' + file });
    bad++;
    continue;
  }
  const t0 = Date.now();
  const r  = spawnSync(process.execPath, [file], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
  const ms  = Date.now() - t0;
  const out = ((r.stdout || '') + (r.stderr || '')).trimEnd();
  const ok  = r.status === 0;
  if (!ok) bad++;
  rows.push({ name, what, ok, ms, out, status: r.status });
}

console.log('');
console.log('| harnais | exécute | verdict | durée |');
console.log('|---|---|---|---|');
for (const r of rows) {
  console.log('| `' + r.name + '` | ' + r.what + ' | ' + (r.ok ? '✅' : '❌') + ' | ' +
              (r.ms >= 1000 ? (r.ms / 1000).toFixed(1) + ' s' : r.ms + ' ms') + ' |');
}

/* En cas d'échec, on montre la fin de la sortie du/des harnais fautifs :
   c'est là que se trouve le détail (ligne RESULTAT, compteur, exception). */
for (const r of rows) {
  if (r.ok) continue;
  console.log('');
  console.log('--- ' + r.name + (r.status != null ? ' (exit ' + r.status + ')' : '') + ' ---');
  console.log(r.out.split(/\r?\n/).slice(-20).join('\n'));
}

if (VERBOSE) {
  for (const r of rows) {
    console.log('');
    console.log('=== ' + r.name + ' ===');
    console.log(r.out);
  }
}

console.log('');
/* Le harnais NAVIGATEUR (P5-13) est volontairement HORS de cette suite : il
   exige `npm i` (playwright-core) et sort du « dépôt sans dépendance à
   l'exécution ». Il se lance à part, depuis tools/browser/. */
console.log('Harnais navigateur (P5-13), à part : cd tools/browser && npm i && npm test');
console.log(bad === 0
  ? 'RESULTAT : OK — ' + rows.length + '/' + rows.length + ' harnais verts'
  : 'RESULTAT : ' + bad + ' harnais en échec sur ' + rows.length);
process.exit(bad === 0 ? 0 : 1);
