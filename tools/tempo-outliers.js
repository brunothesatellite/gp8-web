'use strict';
/* ==================================================================
   tools/tempo-outliers.js — DIAGNOSTIC des durées pré-cuites anormales
   ------------------------------------------------------------------
   Pour chaque mesure jouée plusieurs fois, compare la durée pré-cuite de
   chaque occurrence à la médiane de la mesure. Un écart > 40 % signale :
     · soit un appariement d'ancre GPIF trop tôt/tard (tempo étiré) ;
     · soit un vrai changement de tempo de l'audio (à confirmer à l'oreille).

   Ce n'est PAS un test bloquant : certaines mesures ont réellement un tempo
   différent selon la section. Il sert à consigner et reproduire les points
   restant à analyser (voir RESTE-A-ANALYSER.md).

   Usage :
     node tools/tempo-outliers.js
     node tools/tempo-outliers.js --gp "samples/....gp"
     node tools/tempo-outliers.js --all       (toutes les occurrences)
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

const argv = process.argv.slice(2);
const SHOW_ALL = argv.includes('--all');
const JSON_OUT = argv.includes('--json');
const gi = argv.indexOf('--gp');
const files = gi >= 0
  ? [path.resolve(argv[gi + 1])]
  : fs.readdirSync(SAMPLES).filter(f => /\.gp$/i.test(f)).sort().map(f => path.join(SAMPLES, f));

if (!JSON_OUT) {
  console.log('');
  console.log('DURÉES PRÉ-CUITES ANORMALES — occurrences d\'une même mesure');
  console.log('ratio = durée de l\'occurrence / médiane de la mesure ; |ratio-1| > 0,4');
  console.log('Un ratio anormal peut être un vrai changement de tempo de l\'audio.');
  console.log('');
}

let totalBars = 0, totalOut = 0;
const exceptions = {};
const fileStats = {};
for (const file of files) {
  let score;
  try { score = loadScore(file); } catch (e) { console.log('ECHEC ' + path.basename(file) + ' : ' + e.message); continue; }
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

  const byBar = new Map();
  plan.forEach((p, i) => {
    const pre = timeAtTick(tl, p.start);
    const dur = timeAtTick(tl, p.end) - pre;
    const b = p.masterBar.index;
    if (!byBar.has(b)) byBar.set(b, []);
    byBar.get(b).push({ i, pre, dur, audio: MixSync.audioMsFor(pre) });
  });

  let fileBars = 0, fileOut = 0;
  const lines = [];
  for (const [b, entries] of [...byBar.entries()].sort((x, y) => x[0] - y[0])) {
    if (entries.length < 2) continue;
    const ds = entries.map(e => e.dur).sort((a, c) => a - c);
    const med = ds[Math.floor(ds.length / 2)];
    if (!(med > 0)) continue;
    const out = entries
      .map(e => ({ ...e, ratio: e.dur / med }))
      .filter(e => e.ratio > 1.4 || e.ratio < 0.7);
    if (!out.length) continue;
    fileBars++;
    fileOut += out.length;
    totalBars++;
    totalOut += out.length;
    const base = path.basename(file).replace(/\.gp$/, '');
    const reason = 'tempo réel, saut structurel ou point à confirmer';
    exceptions[base + '|M.' + (b + 1)] = reason;
    const shown = SHOW_ALL ? out : out.slice(0, 5);
    lines.push('  M.' + (b + 1) + ' (' + entries.length + ' occ., médiane ' + Math.round(med) + ' ms) : ' +
      shown.map(e => 'plan#' + e.i + ' @' + (e.audio / 1000).toFixed(2) + 's ' +
        Math.round(e.dur) + 'ms ×' + e.ratio.toFixed(2)).join(' · ') +
      (out.length > shown.length ? ' · +' + (out.length - shown.length) : ''));
  }
  fileStats[path.basename(file).replace(/\.gp$/, '')] = { measures: fileBars, occurrences: fileOut };
  if (!JSON_OUT && lines.length) {
    console.log(path.basename(file).replace(/\.gp$/, ''));
    console.log(lines.join('\n'));
    console.log('');
  }
}
if (JSON_OUT) {
  console.log(JSON.stringify({
    generated: new Date().toISOString(),
    threshold: 'ratio > 1.4 ou < 0.7',
    note: 'Anomalies de durée détectées : tempo réel, saut structurel ou point à confirmer. Le contrôle strict applique un budget global, sans liste par morceau.',
    count: totalBars,
    occurrences: totalOut,
    files: fileStats,
    exceptions
  }, null, 2));
} else {
  console.log('Total : ' + totalBars + ' mesure(s) avec occurrence anormale, ' + totalOut + ' occurrence(s).');
  console.log('Pour approfondir : vérifier les ancres GPIF autour du timestamp, puis si le tempo audio est réellement différent.');
}
