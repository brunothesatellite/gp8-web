'use strict';
/* ==================================================================
   tools/tempo-correct-sim.js — simulation du correcteur de dérive
   ------------------------------------------------------------------
   MIROIR de la boucle de js/mix-sync.js (constantes identiques), sans
   navigateur, pour arbitrer la LOI DE COMMANDE du correcteur (RC-3,
   BUGMP3 §14). Trois lois comparées sur le MÊME pont :

     actuel   code livré : dans la bande morte (|dérive| < 100 ms) on ne
              fait RIEN → le taux biaisé de la dernière écriture (± 5 %)
              reste appliqué au mp3, et la dérive repart dans l'autre sens
              → cycle permanent (une écriture toutes les ~4 s).
     neutre   naïf : dans la bande morte on écrit UNE fois le taux neutre
              sp × pente, puis on se tait. REJETÉ par cette simulation :
              comme `sp` est périmé par TEMPO_EPS, sp × pente peut être
              PLUS ÉLOIGNÉ de 1,0 que le taux en cours → Blink 31 → 45
              écritures, Igorrr « Blastbeat » étirement max 7,7 % → 100 %.
     protege  RETENU : remise au neutre, mais seulement si le neutre
              RAPPROCHE le mp3 du taux natif (|neutre − 1| ≤ |taux − 1|).

   Le pont est reconstruit comme le fait l'application : fixEmptyAnacrusis,
   normalisation des fins multiples et oracle RC-1 (js/repeat-oracle.js,
   requis depuis le dépôt), donc les pentes hors clamp de Slayer ont déjà
     disparu quand on mesure ici.

   Ce que l'on mesure : écritures de playbackRate (nRate), écritures de
   playbackSpeed (nTempo = les coupures du synthé, RC-2, inchangées par
   construction), recadrages (nSeek), et l'ÉTIREMENT TEMPOREL subi par le
   mp3 : max |taux − 1|, moyenne pondérée par le temps, et % du temps au-
   delà de 2 % (seuil au-dessous duquel l'altération de qualité devient
   difficilement audible).

   ⚠ Les constantes et formules ci-dessous sont le MIROIR de
     js/mix-sync.js. En cas de modification de l'une, modifier l'autre.
   ⚠ Ne modélise PAS le pipeline de rendu (coût réel d'une écriture de
     playbackSpeed chez alphaTab = note coupée + buffer vidé, BUGMP3 §14
     RC-2) : les « coupures » sont comptées, pas entendues.

   Usage :  node tools/tempo-correct-sim.js            (tous les samples)
            node tools/tempo-correct-sim.js Stein      (filtre sur le nom)
            node tools/tempo-correct-sim.js --dt 25    (pas de simulation)
   Sortie : 0 = la loi « protège » ne dégrade seeks ni coupures, 1 sinon.
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

/* --- MIROIR js/mix-sync.js (garder en phase !) --------------------- */
const HOLD_MS = 400, NUDGE = 0.10, GAIN = 2000;
const CONTROL_MS = 250, DEADBAND_MS = 100, WRITE_MS = 1500, RATE_EPS = 0.03;
const JUMP_SLOPE = 3.0, SLOPE_MIN = 0.5, SLOPE_MAX = 2.0;
const TEMPO_EPS = 0.04, TEMPO_HOLD_MS = 300;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* --- le chemin de chargement RÉEL du score ------------------------- */
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
const MFG = at.midi.MidiFileGenerator;
const etat = RO.install(MFG, normalizeMultiClosingRepeats, null);
if (etat !== 'installed' && etat !== 'already') { console.log('install: ' + etat); process.exit(1); }

/* --- MIROIR analyse du pont (js/mix-sync.js) ---------------------- */
function analyze(raw) {
  const points = raw.map(p => ({ t: p.t, a: p.a })).sort((x, y) => x.t - y.t);
  const dedup = [];
  for (const p of points) { while (dedup.length && p.t <= dedup[dedup.length - 1].t) dedup.pop(); dedup.push(p); }
  const pts = dedup, n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[i + 1];
    if (!q) { p.jump = false; p.slope = 1; p.rawSlope = 1; continue; }
    const dt = q.t - p.t, da = q.a - p.a;
    p.rawSlope = dt > 0 ? da / dt : 1;
    p.jump = (da < 0) || (p.rawSlope < 1 / JUMP_SLOPE) || (p.rawSlope > JUMP_SLOPE);
    p.slope = clamp(p.rawSlope, SLOPE_MIN, SLOPE_MAX);
  }
  for (let i = n - 1; i >= 0; i--) { if (!pts[i].jump) continue; pts[i].slope = (i + 1 < n) ? pts[i + 1].slope : 1; }
  for (const p of pts) p.speed = p.slope > 0 ? 1 / p.slope : 1;
  return pts;
}
function audioMsFor(pts, t) {
  const n = pts.length;
  if (n === 0) return t;
  if (n === 1) return pts[0].a + (t - pts[0].t);
  if (t <= pts[0].t) { const p = pts[0], q = pts[1], dt = q.t - p.t; if (p.jump) return q.a + (t - q.t) * p.slope; return p.a + (dt > 0 ? (t - p.t) * (q.a - p.a) / dt : t - p.t); }
  if (t >= pts[n - 1].t) { const p = pts[n - 1], q = pts[n - 2], dt = p.t - q.t; if (q.jump) return p.a + (t - p.t) * q.slope; return p.a + (dt > 0 ? (t - p.t) * (p.a - q.a) / dt : t - p.t); }
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid - 1; }
  const p = pts[lo], q = pts[lo + 1], dt = q.t - p.t;
  if (p.jump) return q.a + (t - q.t) * p.slope;
  return p.a + (q.a - p.a) * (dt > 0 ? (t - p.t) / dt : 0);
}
function at_(pts, t, key) {
  const n = pts.length; if (n < 2) return 1;
  if (t <= pts[0].t) return pts[0][key];
  if (t >= pts[n - 1].t) return pts[n - 2][key];
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid - 1; }
  return pts[lo][key];
}

/* --- simulation : la SEULE différence entre lois est la bande morte - */
function simulate(pts, lastT, dt, variant) {
  let musMs = 0;
  let sp = at_(pts, 0, 'speed');
  let rate = sp * at_(pts, 0, 'slope');
  let audio = Math.max(0, audioMsFor(pts, 0)) / 1000;      // secondes
  let now = 0, lastControl = -1e9, lastWrite = -1e9, lastTempoWrite = -1e9;
  let nSeek = 0, nRate = 0, nTempo = 0, nNeutre = 0, peak = 0;
  let sumStretch = 0, sumDt = 0, over2 = 0, maxStretch = 0;
  while (musMs < lastT && now < 1e7) {
    now += dt;
    musMs += dt * sp;                                       // horloge maîtresse
    audio += rate * dt / 1000;
    sumStretch += Math.abs(rate - 1) * dt; sumDt += dt;
    if (Math.abs(rate - 1) > 0.02) over2 += dt;
    if (Math.abs(rate - 1) > maxStretch) maxStretch = Math.abs(rate - 1);
    if (now - lastControl < CONTROL_MS) continue;
    lastControl = now;

    /* applyTempo — commun aux trois lois (RC-2 : 1 écriture = 1 coupure) */
    const want = clamp(at_(pts, musMs, 'speed'), 0.06, 16);
    if (Math.abs(want - sp) >= TEMPO_EPS && now - lastTempoWrite >= TEMPO_HOLD_MS) {
      sp = want; lastTempoWrite = now; nTempo++;
    }

    const target = Math.max(0, audioMsFor(pts, musMs)) / 1000;
    const drift = (audio - target) * 1000;
    if (Math.abs(drift) > peak) peak = Math.abs(drift);

    if (Math.abs(drift) > HOLD_MS) {                         // recadrage dur
      audio = target; rate = sp * at_(pts, musMs, 'slope'); nSeek++;
      continue;
    }

    if (Math.abs(drift) < DEADBAND_MS) {
      if (variant !== 'actuel') {
        const slope = at_(pts, musMs, 'slope');
        const neutral = sp * slope;
        const autorise = variant !== 'protege' ||
          Math.abs(neutral - 1) <= Math.abs(rate - 1);
        if (autorise && now - lastWrite >= WRITE_MS && Math.abs(rate - neutral) > RATE_EPS) {
          rate = neutral; lastWrite = now; nRate++; nNeutre++;
        }
      }
      continue;                                   // ← défaut RC-3 (loi actuelle)
    }

    if (now - lastWrite < WRITE_MS) continue;
    const slope = at_(pts, musMs, 'slope');
    const r = Math.max(0.06, sp * slope * (1 - clamp(drift / GAIN, -NUDGE, NUDGE)));
    if (Math.abs(rate - r) > RATE_EPS) { rate = r; lastWrite = now; nRate++; }
  }
  return {
    nSeek, nRate, nTempo, nNeutre, peak: Math.round(peak),
    stretchMax: maxStretch * 100,
    stretchAvg: (sumStretch / Math.max(1, sumDt)) * 100,
    over2: 100 * over2 / Math.max(1, sumDt)
  };
}

/* --- pilote -------------------------------------------------------- */
const args = process.argv.slice(2);
const dtIdx = args.indexOf('--dt');
const DT = dtIdx >= 0 ? Number(args[dtIdx + 1]) || 10 : 10;
const filtre = args.filter((a, i) => a !== '--dt' && i !== dtIdx + 1 && !a.startsWith('--'));
let files = fs.readdirSync(SAMPLES).filter(f => /\.gp$/i.test(f)).sort();
if (filtre.length) files = files.filter(f => filtre.some(x => f.indexOf(x) >= 0));

console.log('fichier'.padEnd(36) + '| tempo | nRate A->N->P | seek | etir.max A->P | moy A->P | >2% A->P');
console.log('-'.repeat(104));

let tA = 0, tN = 0, tP = 0, tTempo = 0, bad = 0;
for (const f of files) {
  try {
    const b0 = fs.readFileSync(path.join(SAMPLES, f));
    const score = at.importer.ScoreLoader.loadScoreFromBytes(
      new Uint8Array(b0.buffer.slice(b0.byteOffset, b0.byteOffset + b0.byteLength)), new at.Settings());
    fixEmptyAnacrusis(score);
    RO.raise(score, MFG, null);                    // pont APRÈS RC-1
    const gen = (MFG.generateSyncPoints(score) || [])
      .filter(p => p && isFinite(p.synthTime) && isFinite(p.syncTime))
      .map(p => ({ t: p.synthTime, a: p.syncTime }));
    const pts = analyze(gen);
    const lastT = pts.length ? pts[pts.length - 1].t : 0;

    const A = simulate(pts, lastT, DT, 'actuel');
    const N = simulate(pts, lastT, DT, 'neutre');
    const P = simulate(pts, lastT, DT, 'protege');

    /* la loi retenue ne doit JAMAIS coûter un recadrage ni une coupure de plus */
    if (P.nSeek > A.nSeek || P.nTempo !== A.nTempo) {
      console.log('      !! REGRESSION ' + f); bad++;
    }
    tA += A.nRate; tN += N.nRate; tP += P.nRate; tTempo += A.nTempo;
    const pire = P.nRate > A.nRate || P.stretchMax > A.stretchMax + 0.5;
    console.log(
      f.replace(/\.gp$/i, '').slice(0, 34).padEnd(36) + '| ' +
      String(A.nTempo).padStart(5) + ' | ' +
      (A.nRate + '->' + N.nRate + '->' + P.nRate).padStart(13) + ' | ' +
      (A.nSeek + '->' + P.nSeek).padStart(6) + '  | ' +
      (A.stretchMax.toFixed(1) + '->' + P.stretchMax.toFixed(1)).padStart(13) + ' | ' +
      (A.stretchAvg.toFixed(2) + '->' + P.stretchAvg.toFixed(2)).padStart(12) + ' | ' +
      (A.over2.toFixed(0) + '->' + P.over2.toFixed(0) + '%').padStart(10) +
      (pire ? '  x' : '  ok'));
  } catch (e) {
    bad++;
    console.error('ECHEC ' + f + ' : ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | '));
  }
}
console.log('-'.repeat(104));
console.log('écritures de taux TOTALES : actuel ' + tA + ' -> naïf ' + tN + ' -> protège ' + tP +
            '   (coupures playbackSpeed = ' + tTempo + ', inchangées : RC-2)');
console.log(bad === 0
  ? "RESULTAT : OK - la loi « protege » n'ajoute ni recadrage ni coupure"
  : 'RESULTAT : ' + bad + ' ANOMALIE(S)');
process.exit(bad === 0 ? 0 : 1);
