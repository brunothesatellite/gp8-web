'use strict';
/* ==================================================================
   tools/sync-audit.js — audit de la synchro audio (hors navigateur)
   ------------------------------------------------------------------
   Reproduit, de façon DÉTERMINISTE et sans navigateur, la boucle de
   calage de js/mix-sync.js sur chaque samples/*.gp, et compare :

     · LEGACY  = contrôleur d'avant correctif (audioMsFor sans dédoublon-
                 ni ni gestion de saut, rate = vitesse × correction seule)
     · NEW     = contrôleur actif dans js/mix-sync.js (dédoublonnage,
                 sauts re-ancrés sur le bloc destination, rate = vitesse
                 × pente locale × correction)

   Les deux variantes rejouent le MÊME pont (alphaTab generateSyncPoints)
   et la MÊME horloge maîtresse ; seuls diffèrent la table et la formule
   de rate. On mesure alors : recadrages durs, retours en arrière, écritures
   de playbackRate, dérive pic, et le « burst » de seeks (max de seeks dans
   1,5 s) — l'indicateur direct d'un BALAYAGE de discontinuité.

   ⚠ Les constantes et formules ci-dessous sont le MIROIR de
     js/mix-sync.js. En cas de modification de l'une, modifier l'autre.

   Usage :  node tools/sync-audit.js             (tous les samples)
            node tools/sync-audit.js --gp <fich>  (un seul .gp)
            node tools/sync-audit.js --dt 25      (pas de simulation, ms)
   ================================================================== */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const vm   = require('vm');

const ROOT    = path.resolve(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const VENDOR  = path.join(__dirname, 'vendor', 'alphaTab.js');
const AT_URL  = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.8.4/dist/alphaTab.js';

/* --- constantes MIROIR de js/mix-sync.js (garder en phase !) -------- */
const HOLD_MS = 400, SOFT_MS = 25, NUDGE = 0.10, GAIN = 2000;
const CONTROL_MS = 250, DEADBAND_MS = 50, WRITE_MS = 400, RATE_EPS = 0.01;
const JUMP_SLOPE = 3.0, SLOPE_MIN = 0.5, SLOPE_MAX = 2.0;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ============================ ZIP minimal ========================== */
/* Lit une entrée précise (Content/score.gpif) d'un conteneur .gp/zip
   via l'annuaire central + inflateRawSync — aucun npm.               */
function extractEntry(buf, wanted) {
  // EOCD (0x06054b50) : cherché depuis la fin
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD introuvable');
  const count  = buf.readUInt16LE(eocd + 10);
  const cdOff  = buf.readUInt32LE(eocd + 16);

  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('annuaire central corrompu');
    const method   = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen  = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen   = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name     = buf.toString('utf8', p + 46, p + 46 + nameLen);

    if (name === wanted) {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen= buf.readUInt16LE(localOff + 28);
      const dataOff  = localOff + 30 + lNameLen + lExtraLen;
      const raw      = buf.slice(dataOff, dataOff + compSize);
      return method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return null;
}

/* ========================= alphaTab en Node ======================== */
function ensureAlphaTab(cb) {
  if (fs.existsSync(VENDOR)) return cb();
  process.stdout.write('téléchargement de alphaTab 1.8.4 (une seule fois)… ');
  require('https').get(AT_URL, res => {
    if (res.statusCode !== 200) { console.error('HTTP ' + res.statusCode); process.exit(1); }
    const out = fs.createWriteStream(VENDOR);
    res.pipe(out);
    out.on('finish', () => out.close(() => { console.log('ok'); cb(); }));
  }).on('error', e => { console.error('réseau : ' + e.message); process.exit(1); });
}

function loadAlphaTab() {
  try {
    return require(VENDOR);
  } catch (e) {
    const code = fs.readFileSync(VENDOR, 'utf8');
    const sandbox = { module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout };
    sandbox.self = sandbox; sandbox.window = sandbox; sandbox.globalThis = sandbox;
    sandbox.global = sandbox; sandbox.navigator = { userAgent: 'node' };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'alphaTab.js' });
    return sandbox.module.exports && Object.keys(sandbox.module.exports).length
      ? sandbox.module.exports : sandbox.alphaTab;
  }
}

/* ================== ponts audio (les 2 variantes) ================== */

/* --- analyse des segments (MIROIR de analyzeSegments) : NEW uniquement */
function analyzeSegments(points) {
  const dedup = [];
  for (const p of points) {
    while (dedup.length && p.t <= dedup[dedup.length - 1].t) dedup.pop();
    dedup.push(p);
  }
  points = dedup;
  const n = points.length;
  let nJump = 0, nOff = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i], q = points[i + 1];
    if (!q) { p.jump = false; p.slope = 1; p.rawSlope = 1; continue; }
    const dt = q.t - p.t, da = q.a - p.a;
    p.rawSlope = dt > 0 ? da / dt : 1;
    p.jump = (da < 0) || (p.rawSlope < 1 / JUMP_SLOPE) || (p.rawSlope > JUMP_SLOPE);
    p.slope = clamp(p.rawSlope, SLOPE_MIN, SLOPE_MAX);
    if (p.jump) nJump++;
    else if (p.rawSlope < SLOPE_MIN || p.rawSlope > SLOPE_MAX) nOff++;
  }
  for (let i = n - 1; i >= 0; i--) {
    if (!points[i].jump) continue;
    points[i].slope = (i + 1 < n) ? points[i + 1].slope : 1;
  }
  return { points, nJump, nOff };
}

function makeBridge(rawPoints, mode) {
  let points, nJump = 0, nOff = 0;
  if (mode === 'new') {
    const r = analyzeSegments(rawPoints.map(p => ({ t: p.t, a: p.a })));
    points = r.points; nJump = r.nJump; nOff = r.nOff;
  } else {
    points = rawPoints.map(p => ({ t: p.t, a: p.a })).sort((x, y) => x.t - y.t);
  }
  const n0 = points.length;

  /* audioMsFor — MIROIR de js/mix-sync.js (branche saut = NEW seulement) */
  function audioMs(t) {
    const n = points.length;
    if (n === 0) return t;
    if (n === 1) return points[0].a + (t - points[0].t);
    if (t <= points[0].t) {
      const p = points[0], q = points[1], dt = q.t - p.t;
      if (mode === 'new' && p.jump) return q.a + (t - q.t) * p.slope;
      return p.a + (dt > 0 ? (t - p.t) * (q.a - p.a) / dt : t - p.t);
    }
    if (t >= points[n - 1].t) {
      const p = points[n - 1], q = points[n - 2], dt = p.t - q.t;
      if (mode === 'new' && q.jump) return p.a + (t - p.t) * q.slope;
      return p.a + (dt > 0 ? (t - p.t) * (p.a - q.a) / dt : t - p.t);
    }
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (points[mid].t <= t) lo = mid; else hi = mid - 1;
    }
    const p = points[lo], q = points[lo + 1], dt = q.t - p.t;
    if (mode === 'new' && p.jump) return q.a + (t - q.t) * p.slope;
    return p.a + (q.a - p.a) * (dt > 0 ? (t - p.t) / dt : 0);
  }

  /* targetSec — NEW borne à 0 ; LEGACY renvoie null si ms < 0 */
  function targetSec(t) {
    const ms = audioMs(t);
    if (mode === 'new') return isFinite(ms) ? Math.max(0, ms) / 1000 : null;
    return isFinite(ms) && ms >= 0 ? ms / 1000 : null;
  }

  /* slopeAt — MIROIR ; LEGACY n'utilise pas de pente (toujours 1) */
  function slopeAt(t) {
    if (mode !== 'new') return 1;
    const n = points.length;
    if (n < 2) return 1;
    if (t <= points[0].t) return points[0].slope;
    if (t >= points[n - 1].t) return points[n - 2].slope;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (points[mid].t <= t) lo = mid; else hi = mid - 1;
    }
    return points[lo].slope;
  }

  return { audioMs, targetSec, slopeAt, n: n0, nJump, nOff };
}

/* ====================== simulation pas à pas ======================= */
function maxBurst(times, win) {
  let best = 0, j = 0;
  for (let i = 0; i < times.length; i++) {
    while (times[i] - times[j] > win) j++;
    if (i - j + 1 > best) best = i - j + 1;
  }
  return best;
}

function simulate(bridge, lastT, dt, jumpAt) {
  const st = {
    now: 0, masterMs: 0, audioTime: 0, audioRate: 1,
    lastControl: -1e9, lastWrite: -1e9,
    peakDrift: 0, nSeek: 0, nBack: 0, nRate: 0,
    totalBackMs: 0, maxBackMs: 0, seekTimes: [],
    nJumpSeek: 0, nGlitch: 0
  };
  st.audioTime = Math.max(0, bridge.audioMs(0) / 1000);   // resync() initial

  while (st.masterMs < lastT) {
    st.now += dt;
    st.masterMs += dt;
    st.audioTime += st.audioRate * dt / 1000;

    if (st.now - st.lastControl < CONTROL_MS) continue;
    st.lastControl = st.now;

    const target = bridge.targetSec(st.masterMs);
    if (target == null) continue;

    const drift = (st.audioTime - target) * 1000;
    if (Math.abs(drift) > st.peakDrift) st.peakDrift = Math.abs(drift);

    if (Math.abs(drift) > HOLD_MS) {
      const before = st.audioTime;
      st.audioTime = target;
      st.audioRate = 1 * bridge.slopeAt(st.masterMs);     // setRate(sp) NEW
      st.nSeek++;
      // intentionnel si on traverse une discontinuité ; sinon = glitch (dérive)
      if (jumpAt && jumpAt(st.masterMs)) st.nJumpSeek++; else st.nGlitch++;
      if (target < before - 1e-6) {
        st.nBack++;
        const back = (before - target) * 1000;
        st.totalBackMs += back;
        if (back > st.maxBackMs) st.maxBackMs = back;
      }
      st.seekTimes.push(st.now);
      continue;
    }
    if (Math.abs(drift) < DEADBAND_MS) continue;
    if (st.now - st.lastWrite < WRITE_MS) continue;

    const slope = bridge.slopeAt(st.masterMs);
    const r = Math.max(0.06, 1 * slope * (1 - clamp(drift / GAIN, -NUDGE, NUDGE)));
    if (Math.abs(st.audioRate - r) > RATE_EPS) {
      st.audioRate = r; st.lastWrite = st.now; st.nRate++;
    }
  }

  const minutes = lastT / 1000 / 60;
  return {
    n: bridge.n, nJump: bridge.nJump, nOff: bridge.nOff,
    seeks: st.nSeek, back: st.nBack, rate: st.nRate,
    peak: Math.round(st.peakDrift), burst: maxBurst(st.seekTimes, 1500),
    maxBack: Math.round(st.maxBackMs), perMin: st.nSeek / minutes,
    jumpSeek: st.nJumpSeek, glitch: st.nGlitch
  };
}

/* map : un instant maître est-il dans une discontinuité (NEW) ? On élargit
   la fenêtre pour absorber le décalage de décision (CONTROL_MS). */
function buildJumpAt(raw) {
  const { points } = analyzeSegments(raw.map(p => ({ t: p.t, a: p.a })));
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i].jump) segs.push([points[i].t - CONTROL_MS, points[i + 1].t]);
  }
  return t => segs.some(([a, b]) => t >= a && t <= b);
}

/* ============================== main =============================== */
function runOne(at, gpPath) {
  const bytes = new Uint8Array(fs.readFileSync(gpPath));
  const score = at.importer.ScoreLoader.loadScoreFromBytes(bytes, new at.Settings());
  const gen   = at.midi.MidiFileGenerator.generateSyncPoints(score) || [];
  const raw   = gen.filter(p => p && isFinite(p.synthTime) && isFinite(p.syncTime))
                   .map(p => ({ t: p.synthTime, a: p.syncTime }))
                   .sort((x, y) => x.t - y.t);
  const lastT = raw.length ? raw[raw.length - 1].t : 0;

  // contrôle croisé : nombre de points de synchro BRUTS dans le GPIF
  let rawCount = null;
  try {
    const gpif = extractEntry(Buffer.from(bytes), 'Content/score.gpif');
    if (gpif) {
      const xml = gpif.toString('utf8');
      rawCount = (xml.match(/<Type>SyncPoint<\/Type>/g) || []).length;
    }
  } catch (e) { /* GPIF inaccessible : contrôle croisé ignoré */ }

  const jumpAt = buildJumpAt(raw);
  return { name: path.basename(gpPath, '.gp'), lastT, rawCount,
           gen: raw.length,
           legacy: simulate(makeBridge(raw, 'legacy'), lastT, SIM_DT, jumpAt),
           neu:    simulate(makeBridge(raw, 'new'),    lastT, SIM_DT, jumpAt), jumps: jumpInfo(raw) };
}

/* --debug : liste les segments de saut détectés (diagnostic) --------- */
function jumpInfo(raw) {
  const { points } = analyzeSegments(raw.map(p => ({ t: p.t, a: p.a })));
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i], q = points[i + 1];
    if (!p.jump) continue;
    out.push(`#${i} t ${Math.round(p.t)}→${Math.round(q.t)}ms · Δt ${Math.round(q.t - p.t)} · ` +
             `Δa ${Math.round(q.a - p.a)} · pente ${p.rawSlope.toFixed(2)}`);
  }
  return out;
}

const argv = process.argv.slice(2);
let SIM_DT = 25;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dt') SIM_DT = Math.max(1, Number(argv[i + 1]) || 25);
}
const onlyGp = (argv.includes('--gp')) ? path.resolve(argv[argv.indexOf('--gp') + 1]) : null;

ensureAlphaTab(() => {
  let at;
  try { at = loadAlphaTab(); }
  catch (e) { console.error('alphaTab injonctable : ' + e.message); process.exit(1); }
  if (!at || !at.midi || !at.midi.MidiFileGenerator) {
    console.error('alphaTab chargé mais MidiFileGenerator absent'); process.exit(1);
  }

  const files = onlyGp
    ? [onlyGp]
    : fs.readdirSync(SAMPLES).filter(f => /\.gp$/i.test(f)).map(f => path.join(SAMPLES, f));

  console.log('');
  console.log('Audit de synchro — pas ' + SIM_DT + ' ms · ' + files.length + ' fichier(s)');
  console.log('Métriques : recad. = seeks durs · arrière = reculs · glitch = dérive dans un bloc');
  console.log('           continu (le vrai saccade) · sauts = seeks volontés aux discontinuités');
  console.log('           · burst = max seeks dans 1,5 s · maxArr = plus grand recul');
  console.log('');

  const rows = [];
  for (const f of files) {
    try {
      rows.push(runOne(at, f));
    } catch (e) {
      console.error('ECHEC ' + path.basename(f) + ' : ' + (e && e.message ? e.message : e));
    }
  }

  /* --- tableau --- */
  const hdr = ['fichier', 'gen/brut', 'VARIANT', 'recad.', 'arrière', 'glitch', 'sauts', 'burst', 'maxArr'];
  const lines = [];
  lines.push('| ' + hdr.join(' | ') + ' |');
  lines.push('|' + hdr.map(() => '---').join('|') + '|');
  for (const r of rows) {
    const lost = (r.rawCount != null && r.gen < r.rawCount) ? ' ⚠' : '';
    const gp = r.gen + '/' + (r.rawCount == null ? '?' : r.rawCount) + lost;
    lines.push('| ' + [r.name, gp, 'LEGACY',
      r.legacy.seeks, r.legacy.back, r.legacy.glitch, r.legacy.jumpSeek, r.legacy.burst, r.legacy.maxBack].join(' | ') + ' |');
    lines.push('| ' + ['', '', 'NEW',
      r.neu.seeks, r.neu.back, r.neu.glitch, r.neu.jumpSeek, r.neu.burst, r.neu.maxBack].join(' | ') + ' |');
  }
  console.log(lines.join('\n'));

  if (argv.includes('--debug')) {
    console.log('');
    console.log('--- segments de saut détectés (NEW) ---');
    for (const r of rows) {
      if (!r.jumps || !r.jumps.length) continue;
      console.log(r.name + ' :');
      r.jumps.forEach(j => console.log('   ' + j));
    }
  }

  /* --- synthèse avant/après --- */
  console.log('');
  let s = { lSeek: 0, nSeek: 0, lBack: 0, nBack: 0, lGlitch: 0, nGlitch: 0, lBurst: 0, nBurst: 0, nJumps: 0, nOff: 0 };
  for (const r of rows) {
    s.lSeek += r.legacy.seeks; s.nSeek += r.neu.seeks;
    s.lBack += r.legacy.back;  s.nBack += r.neu.back;
    s.lGlitch += r.legacy.glitch; s.nGlitch += r.neu.glitch;
    s.lBurst = Math.max(s.lBurst, r.legacy.burst); s.nBurst = Math.max(s.nBurst, r.neu.burst);
    s.nJumps += r.neu.nJump; s.nOff += r.neu.nOff;
  }
  console.log('recadrages durs (total) : LEGACY ' + s.lSeek + '  →  NEW ' + s.nSeek);
  console.log('  dont RETOURS arrière  : LEGACY ' + s.lBack + '  →  NEW ' + s.nBack);
  console.log('  dont GLITCHS (dérive) : LEGACY ' + s.lGlitch + '  →  NEW ' + s.nGlitch + '   ← le vrai « ça saccade »');
  console.log('  dont sauts (volontés) : ~1 par discontinuité (re-ancrage propre)');
  console.log('pire burst (1,5 s)      : LEGACY ' + s.lBurst + '  →  NEW ' + s.nBurst);
  console.log('sauts détectés (NEW)    : ' + s.nJumps + '  · pentes hors plage : ' + s.nOff);
  console.log('');
  console.log('LECTURE : « glitch » = seek de dérive dans un bloc continu (ce qu\'on entend');
  console.log('saccader). « sauts » = seeks VOLONTÉS à une discontinuité (DS al Coda,');
  console.log('répétition) — 1 par saut = comportement CORRECT. Un « maxArr » élevé sur un');
  console.log('fichier à répétitions est la TAILLE du saut voulu, pas un raté.');
});
