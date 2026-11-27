'use strict';
/* ==================================================================
   tools/tempo-repeat-check.js — P1.4 : mesures répétées à durée égale
   ------------------------------------------------------------------
   Certaines mesures sont jouées plusieurs fois avec le même tempo musical.
   Le plan GPIF doit leur donner la même durée pré-cuite. Un appariement
   d'ancres trop tôt (LCS par indice de mesure seul) étire la première passe
   et compresse les suivantes.

   Cas de non-régression :
     · Mr. Moustache, M.1-M.3 : 4 passes chacune, même durée dans l'audio.

   Sortie : tableau lisible ; code 1 si une mesure répétée dévie de plus de
   20 % de sa médiane. Branché dans tools/test-all.js.
   ================================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const at = require(path.join(__dirname, 'vendor', 'alphaTab.js'));
const MFG = at.midi.MidiFileGenerator;
const TT = at.midi.MidiEventType.TempoChange;

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
const fixEmptyAnacrusis = new Function(extractFn(playerSrc, 'fixEmptyAnacrusis') + '; return fixEmptyAnacrusis;')();
const normalizeMultiClosingRepeats = new Function(extractFn(playerSrc, 'normalizeMultiClosingRepeats') + '; return normalizeMultiClosingRepeats;')();

require(path.join(ROOT, 'js', 'repeat-oracle.js'));
const RO = globalThis.RepeatOracle;
if (!RO) throw new Error('RepeatOracle absent');
if (RO.install(MFG, normalizeMultiClosingRepeats, null) === 'failed') {
  throw new Error('RepeatOracle.install a échoué');
}

function loadMixSync() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'mix-sync.js'), 'utf8');
  const quiet = { log() {}, warn() {}, info() {}, error: console.error };
  const sandbox = {
    console: quiet, alphaTab: at,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    performance: { now: () => 0 }, AT: {}, AudioSync: { element: null },
    Player: { S: { api: null } }, App: {}, Promise
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  new vm.Script(src, { filename: 'js/mix-sync.js' }).runInContext(ctx, { timeout: 5000 });
  return vm.runInContext('MixSync', ctx);
}
const MixSync = loadMixSync();

function midiTimeline(midi) {
  const div = midi.division || 960;
  const evs = [];
  for (const tr of midi.tracks) for (const e of tr.events) {
    if (e.type === TT && e.beatsPerMinute > 0) evs.push({ tick: e.tick, bpm: e.beatsPerMinute });
  }
  evs.sort((a, b) => a.tick - b.tick);
  const seg = [];
  let bpm = 120, tick = 0, t = 0;
  for (const e of evs) {
    if (e.tick > tick) {
      const t1 = t + (e.tick - tick) * 60000 / (bpm * div);
      seg.push({ t0: t, tick0: tick, tick1: e.tick, bpm, t1 });
      t = t1; tick = e.tick;
    }
    bpm = e.bpm;
  }
  let endTick = 0;
  for (const tr of midi.tracks) for (const e of tr.events) endTick = Math.max(endTick, e.tick);
  if (endTick > tick) {
    const t1 = t + (endTick - tick) * 60000 / (bpm * div);
    seg.push({ t0: t, tick0: tick, tick1: endTick, bpm, t1 });
    t = t1;
  }
  return { seg, division: div, endTime: t };
}
function timeAtTick(tl, tick) {
  for (const s of tl.seg) {
    if (tick <= s.tick1) return s.t0 + (tick - s.tick0) * 60000 / (s.bpm * tl.division);
  }
  return tl.seg.length ? tl.seg[tl.seg.length - 1].t1 : 0;
}
function loadScore(file) {
  const raw = fs.readFileSync(file);
  return at.importer.ScoreLoader.loadScoreFromBytes(
    new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)),
    new at.Settings());
}

const CASES = [
  {
    file: 'Nirvana (1989 - Bleach) - Mr. Moustache.gp',
    bars: [0, 1, 2],
    label: 'Mr. Moustache M.1-M.3'
  }
];
const TOLERANCE = 0.20;

let failed = 0;
console.log('');
console.log('MESURES RÉPÉTÉES — durée pré-cuite par occurrence (tolérance ±' + Math.round(TOLERANCE * 100) + ' %)');
console.log('| cas | mesure | occurrences | durées (ms) | médiane | écart max | verdict |');
console.log('|---|---|---|---|---|---|---|');

for (const c of CASES) {
  const score = loadScore(path.join(SAMPLES, c.file));
  fixEmptyAnacrusis(score);
  RO.raise(score, MFG, null);
  const rawPts = MFG.generateSyncPoints(score) || [];
  const raw = rawPts.map(p => ({ tick: p.synthTick, t: p.synthTime, a: p.syncTime }));
  MixSync.build(score);

  const midi = new at.midi.MidiFile();
  const handler = new at.midi.AlphaSynthMidiFileHandler(midi, true);
  const gen = new MFG(score, new at.Settings(), handler);
  gen.generate();
  MixSync.prebake(midi, raw, handler.tickShift);
  const tl = midiTimeline(midi);
  const plan = gen.tickLookup.masterBars;

  for (const bar of c.bars) {
    const ds = plan
      .filter(p => p.masterBar.index === bar)
      .map(p => timeAtTick(tl, p.end) - timeAtTick(tl, p.start));
    if (ds.length < 2) {
      console.log('| ' + c.label + ' | M.' + (bar + 1) + ' | ' + ds.length + ' | — | — | — | ⚠ <2 |');
      continue;
    }
    const sorted = ds.slice().sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    let maxDev = 0;
    for (const d of ds) maxDev = Math.max(maxDev, Math.abs(d / med - 1));
    const ok = maxDev <= TOLERANCE;
    if (!ok) failed++;
    console.log('| ' + c.label + ' | M.' + (bar + 1) + ' | ' + ds.length + ' | ' +
      ds.map(d => Math.round(d)).join(' · ') + ' | ' + Math.round(med) + ' | ' +
      (maxDev * 100).toFixed(1) + ' % | ' + (ok ? '✅' : '❌') + ' |');
  }
}

console.log('');
if (failed) {
  console.log('RESULTAT P1.4 : ' + failed + ' échec(s) — une mesure répétée n\'a pas la même durée.');
  process.exit(1);
}
console.log('RESULTAT P1.4 : OK — mesures répétées à durée égale.');
