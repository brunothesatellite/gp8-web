'use strict';
/* ==================================================================
   tools/sync-coherence.js — AUDIT de cohérence de la synchro (2026-11-26)
   ------------------------------------------------------------------
   Cet audit ne teste PAS le contrôleur en boucle fermée (comme
   mix-sync-harness) : il vérifie la COHÉRENCE de la carte de synchro
   elle-même, c'est-à-dire ce que le contrôleur est obligé de suivre.

   Pour chaque samples/*.gp, on exécute le chemin LIVRÉ :
       fixEmptyAnacrusis → RepeatOracle.raise → MixSync.build
       → MidiFileGenerator.generate → MixSync.prebake
   puis on confronte :

     1. les clés GPIF (« mesure.occurrence ») au déroulé réel
        (`RepeatOracle.walkMaxOcc`) — clés manquantes ;
     1 bis. la séquence de notation brute P à la séquence du plan : P doit
        être une sous-séquence du plan. Une passe perdue fusionne deux
        mesures et fait étirer le tempo par le pré-cuit (÷ 2) ;
     2. l'axe « pré-cuit » de la table du pont (`points[].t`, calculé par
        segmentsFrom) au temps RÉEL du MidiFile pré-cuit au même tick —
        l'écart est ce que le contrôleur devra corriger en lecture ;
     3. les segments de la table : sauts, pentes hors [0.5 ; 2], et saut
        de fin (outro) qui couperait la fin de l'audio ;
     4. la correspondance tick de MESURE (masterBar.start, axe partition)
        ↔ tick de PERFORMANCE (`tickCache.getMasterBarStart`, axe MIDI) :
        c'est cette correspondance qu'utilisent gotoBar()/setLoopRange().

   Sortie : tableau lisible. `--strict` transforme les constats critiques
   en code de sortie 1 (cible après correctif). Par défaut, code 0 : cet
   audit est un DIAGNOSTIC, pas encore un test de non-régression branché
   dans tools/test-all.js.

   Usage :
     node tools/sync-coherence.js
     node tools/sync-coherence.js --gp "<fichier .gp>"
     node tools/sync-coherence.js --strict
   ================================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const VENDOR = path.join(__dirname, 'vendor', 'alphaTab.js');
if (!fs.existsSync(VENDOR)) {
  console.error('VENDOR manquant : tools/vendor/alphaTab.js');
  process.exit(1);
}
const at = require(VENDOR);
const MFG = at.midi.MidiFileGenerator;
const TEMPO = at.midi.MidiEventType.TempoChange;
const JUMP_SLOPE = 3.0;
const SLOPE_MIN = 0.2;
const SLOPE_MAX = 12.0;

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

/* Séquence de notation brute, AVANT l'installation du plan : c'est la
   référence à couvrir. On garde la méthode d'origine pour ne pas dépendre
   des métriques internes de l'oracle. */
const RAW_PLAY = MFG._playThroughSong;
function notationRaw(score) {
  const out = [];
  const restore = normalizeMultiClosingRepeats(score);
  try {
    RAW_PLAY.call(MFG, score, [], false,
      (bar) => { if (bar && typeof bar.index === 'number') out.push(bar.index); },
      () => {}, () => {});
  } finally {
    if (restore) restore();
  }
  return out;
}
/* Longueur de la plus longue sous-séquence commune : P doit être une
   sous-séquence du plan (toutes les passes de notation, dans l'ordre). */
function lcsLength(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return 0;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp[0][0];
}

require(path.join(ROOT, 'js', 'repeat-oracle.js'));
const RO = globalThis.RepeatOracle;
if (!RO) throw new Error('RepeatOracle absent');
if (RO.install(MFG, normalizeMultiClosingRepeats, null) === 'failed') {
  throw new Error('RepeatOracle.install a échoué');
}

/* P doit être la même séquence que celle utilisée par le plan (parcours
   générique ou alphaTab, selon le choix interne de RepeatOracle). */
function notationOf(score) {
  return typeof RO.notationOf === 'function' ? RO.notationOf(score) : notationRaw(score);
}

/* js/mix-sync.js exécuté tel quel (table + pré-cuisson livrées) */
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
  const M = vm.runInContext('MixSync', ctx);
  if (!M || typeof M.segmentsFrom !== 'function' || typeof M.prebake !== 'function') {
    throw new Error('MixSync.segmentsFrom/prebake absents');
  }
  return M;
}
const MixSync = loadMixSync();

/* ---- temps d'un tick sur la carte de tempo d'un MidiFile ---------- */
function midiTimeline(midi) {
  const div = midi.division || 960;
  const evs = [];
  for (const tr of midi.tracks) for (const e of tr.events) {
    if (e.type === TEMPO && e.beatsPerMinute > 0) evs.push({ tick: e.tick, bpm: e.beatsPerMinute });
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
  for (const tr of midi.tracks) for (const e of tr.events) if (e.tick > endTick) endTick = e.tick;
  if (endTick > tick) {
    const t1 = t + (endTick - tick) * 60000 / (bpm * div);
    seg.push({ t0: t, tick0: tick, tick1: endTick, bpm, t1 });
    t = t1;
  }
  return { seg, division: div, endTick, endTime: t, tempos: evs };
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

function analyze(file) {
  const score = loadScore(file);
  fixEmptyAnacrusis(score);
  const notation = notationOf(score).map(p => (typeof p === 'number' ? p : p.bar));
  const raised = RO.raise(score, MFG, null);
  const report = RO.lastReport();
  const rawPts = MFG.generateSyncPoints(score) || [];
  const raw = rawPts.map(p => ({ tick: p.synthTick, t: p.synthTime, a: p.syncTime }));
  let gpTotal = 0;
  for (const mb of score.masterBars) gpTotal += (mb.syncPoints || []).length;

  const n = MixSync.build(score);                 // table du pont (état livré)
  const seg = MixSync.segmentsFrom(raw);          // même table, pour l'analyse
  const info = MixSync.info;

  const midi = new at.midi.MidiFile();
  const handler = new at.midi.AlphaSynthMidiFileHandler(midi, true);
  const gen = new MFG(score, new at.Settings(), handler);
  gen.generate();
  const nativeTl = midiTimeline(midi);
  const nTempos = MixSync.prebake(midi, raw, handler.tickShift);
  const preTl = midiTimeline(midi);
  const shift = handler.tickShift || 0;

  /* 1 bis. couverture de la notation par le plan de lecture.
     Le plan peut contenir des passes GPIF supplémentaires (audio seul), mais
     il ne doit JAMAIS perdre une passe de notation : sinon le pré-cuit étire
     la mesure précédente pour couvrir l'audio (tempo ÷ 2). */
  const planBars = gen.tickLookup.masterBars.map(e => e.masterBar.index);
  const notationKept = lcsLength(planBars, notation);
  const notationDropped = Math.max(0, notation.length - notationKept);

  /* 1. clés GPIF uniques (mesure.occurrence) vs déroulé réel */
  const gpKeys = new Set();
  for (let i = 0; i < score.masterBars.length; i++) {
    for (const sp of score.masterBars[i].syncPoints || []) {
      const v = sp.syncPointValue;
      if (v && typeof v.barOccurence === 'number') gpKeys.add(i + '.' + v.barOccurence);
    }
  }
  let missing = 0;
  for (const k of gpKeys) {
    const d = k.lastIndexOf('.');
    const b = Number(k.slice(0, d)), o = Number(k.slice(d + 1));
    const seen = RO.walkMaxOcc.get(b);
    if (seen === undefined || seen < o) missing++;
  }

  /* 2. axe idéal vs temps réel du MIDI pré-cuit */
  let worstAxis = 0, worstPoint = null;
  for (const p of seg.points) {
    const actual = timeAtTick(preTl, p.tick + shift);
    const err = actual - p.t;
    if (Math.abs(err) > Math.abs(worstAxis)) {
      worstAxis = err;
      worstPoint = { tick: p.tick, ideal: p.t, actual, a: p.a };
    }
  }

  /* 3. segments : sauts / hors plage / saut de fin */
  let jumps = 0, off = 0, tailJump = false;
  let backJumps = 0, forwardJumps = 0, tailAudioMs = 0;
  for (let i = 0; i < seg.points.length - 1; i++) {
    const p = seg.points[i], q = seg.points[i + 1];
    const dA = q.a - p.a;
    if (p.jump) {
      jumps++;
      if (dA < 0) backJumps++; else forwardJumps++;
      if (i === seg.points.length - 2 && dA > 500) { tailJump = true; tailAudioMs = dA; }
    } else if (p.rawNot < SLOPE_MIN || p.rawNot > SLOPE_MAX) {
      off++;
    }
  }
  const lastPoint = seg.points.length ? seg.points[seg.points.length - 1] : null;
  const lastRaw = rawPts.length ? rawPts[rawPts.length - 1] : null;

  /* 4. ticks mesure (partition) ↔ ticks performance */
  let barMapDiff = 0;
  const barMap = [];
  for (const mb of score.masterBars) {
    const perf = gen.tickLookup.getMasterBarStart(mb);
    const played = perf > 0 || (mb.index === 0 && score.masterBars.length > 0);
    if (!played) continue;
    if (perf !== mb.start) {
      barMapDiff++;
      if (barMap.length < 4) barMap.push({ bar: mb.index + 1, score: mb.start, perf });
    }
  }

  return {
    file, base: path.basename(file), bars: score.masterBars.length,
    tracks: score.tracks.length, gpTotal, gpKeys: gpKeys.size, raw: rawPts.length,
    planSteps: planBars.length, notation: notation.length, notationDropped,
    bridge: n, missing, raised, report,
    nTempos, bpm0: preTl.tempos.length ? preTl.tempos[0].bpm : null,
    nativeEnd: nativeTl.endTime, preEnd: preTl.endTime,
    lastAudio: lastRaw ? lastRaw.syncTime : 0,
    worstAxis, worstPoint, jumps, off, backJumps, forwardJumps, tailJump, tailAudioMs,
    barMapDiff, barMap, lastT: lastPoint ? lastPoint.t : 0,
    lastA: lastPoint ? lastPoint.a : 0, tempoScale: info.tempoScale
  };
}

/* ============================== main =============================== */
const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const gi = argv.indexOf('--gp');
const files = gi >= 0 ? [path.resolve(argv[gi + 1])]
  : fs.readdirSync(SAMPLES).filter(f => /\.gp$/i.test(f)).sort().map(f => path.join(SAMPLES, f));

console.log('');
console.log('AUDIT DE COHÉRENCE DE SYNCHRO — chemin livré · ' + files.length + ' fichier(s)');
console.log('axe = écart table du pont ↔ MidiFile pré-cuit (ce que le contrôleur doit rattraper)');
console.log('manq = clés GPIF non couvertes · sauts = discontinuités · tail = saut de fin');
console.log('barMap = mesures où la traduction partition→performance est nécessaire (P0.1)');
console.log('');

const rows = [];
for (const f of files) {
  try { rows.push(analyze(f)); }
  catch (e) { console.error('ECHEC ' + path.basename(f) + ' : ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }
}

const hdr = ['fichier', 'mes', 'GPIF', 'gén.', 'plan', 'P', 'perd', 'clés', 'manq', 'levés', 'BPM0', 'natif', 'précuit', 'audio fin', 'axe', 'sauts', 'dont av/ar', 'hors', 'tail', 'barMap'];
console.log('| ' + hdr.join(' | ') + ' |');
console.log('|' + hdr.map(() => '---').join('|') + '|');
for (const r of rows) {
  console.log('| ' + [
    r.base.replace(/\.gp$/, '').slice(0, 40), r.bars, r.gpTotal, r.raw,
    r.planSteps, r.notation, r.notationDropped,
    r.gpKeys, r.missing,
    r.raised, r.bpm0 ? r.bpm0.toFixed(1) : 'ABS',
    (r.nativeEnd / 1000).toFixed(1) + 's', (r.preEnd / 1000).toFixed(1) + 's',
    (r.lastAudio / 1000).toFixed(2) + 's', Math.round(r.worstAxis) + ' ms',
    r.jumps, r.forwardJumps + '/' + r.backJumps, r.off,
    r.tailJump ? '+' + Math.round(r.tailAudioMs) + 'ms' : '—',
    r.barMapDiff
  ].join(' | ') + ' |');
}

/* détail des points de mesure qui divergent (pour gotoBar / boucles) */
const mapRows = rows.filter(r => r.barMapDiff > 0);
if (mapRows.length) {
  console.log('');
  console.log('TICKS PARTITION ≠ PERFORMANCE (échantillon) :');
  for (const r of mapRows) {
    console.log('  ' + r.base.replace(/\.gp$/, '').slice(0, 42) + ' : ' +
      r.barMap.map(b => 'M.' + b.bar + ' ' + b.score + '→' + b.perf).join(' · ') +
      (r.barMapDiff > 4 ? ' · … ' + (r.barMapDiff - 4) + ' autre(s)' : ''));
  }
}

/* résumé */
const nMissing = rows.reduce((n, r) => n + r.missing, 0);
const nAxis = rows.filter(r => Math.abs(r.worstAxis) > 5).length;
const nTail = rows.filter(r => r.tailJump).length;
const nDropped = rows.reduce((n, r) => n + r.notationDropped, 0);
const nMap = rows.filter(r => r.barMapDiff > 0).length;
console.log('');
console.log('clés GPIF manquantes (total) : ' + nMissing + ' sur ' + rows.length + ' fichier(s)');
console.log('passes de notation perdues  : ' + nDropped + ' sur ' + rows.length + ' fichier(s)');
console.log('axe > 5 ms                 : ' + nAxis + ' fichier(s)');
console.log('saut de fin (outro)        : ' + nTail + ' fichier(s)');
console.log('mesures avec traduction partition→performance : ' + nMap + ' fichier(s)  (attendu : ce n\'est plus un défaut depuis P0.1)');
console.log('');
console.log('LECTURE : les clés manquantes, les passes de notation perdues, l\'axe et');
console.log('les sauts de fin sont les causes racines mesurées des sauts/ralentissements.');
console.log('`--strict` est la cible P1 (0 clé, 0 notation perdue, 0 axe, 0 tail).');
console.log('La traduction partition→performance est faite par js/player.js');
console.log('(perfStartOfBar) ; le plan GPIF par js/repeat-oracle.js.');
console.log('Audit de non-régression P1, hors tools/test-all.js :');
console.log('  node tools/sync-coherence.js --strict');

if (STRICT) {
  const bad = nMissing + nDropped + nAxis + nTail;
  process.exit(bad === 0 ? 0 : 1);
}
process.exit(0);
