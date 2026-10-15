'use strict';
/* ==================================================================
   tools/tempo-prebake-spike.js — SPIKE stratégie C (BUGFIX-TOTAL P1)
   ------------------------------------------------------------------
   Décision go/no-go : peut-on écrire le TEMPO MODIFIÉ directement dans
   le MidiFile, pour que la lecture se fasse à `playbackSpeed = 1,0` —
   donc SANS jamais couper le synthé (RC-2) ni osciller (RC-3) ?

   On construit, hors navigateur, exactement ce que ferait P2 :

     NATIF     : `new MidiFile()` + `AlphaSynthMidiFileHandler` +
                 `MidiFileGenerator.generate()` (tempo de la partition).
     VARIANTE A : on réécrit les `TempoChangeEvent` aux ticks des points de
                  synchro avec le `syncBpm` BRUT calculé par alphaTab
                  (`BackingTrackSyncPoint.updateSyncBpm`) — c'est le
                  prototype littéral du plan.
     VARIANTE B : même chose, mais avec la règle de SEGMENT de js/mix-sync.js
                  (détection de saut, clamp de pente, pente du bloc
                  destination) — le tempo effectivement appliqué aujourd'hui
                  via `playbackSpeed`, mais PRÉ-CUIT.

   Mesures : durée totale (objets d'événements ET relecture du binaire SMF),
   BPM minimal (un `syncBpm` brut peut tomber sous 3,58 tr/min — que le SMF
   tronque sur 3 octets), et, pour B, l'écart par segment continu entre la
   durée MIDI et la durée audio visée.

   Usage :  node tools/tempo-prebake-spike.js
            node tools/tempo-prebake-spike.js --gp <fich>
   ================================================================== */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const VENDOR  = path.join(__dirname, 'vendor', 'alphaTab.js');

if (!fs.existsSync(VENDOR)) {
  console.log('VENDOR manquant : tools/vendor/alphaTab.js (voir tools/sync-audit.js)');
  process.exit(1);
}
const at  = require(VENDOR);
const MFG = at.midi.MidiFileGenerator;
const TEMPO_TYPE = at.midi.MidiEventType.TempoChange;   // 81
const SMF_MIN_BPM = 60000000 / 0xFFFFFF;                // ≈ 3,576 tr/min (limite SMF)

/* ---- fonctions LIVRÉES (extraites de player.js) + oracle ----------- */
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
if (!RO) throw new Error('RepeatOracle non exposé par js/repeat-oracle.js');
const etat = RO.install(MFG, normalizeMultiClosingRepeats, null);
if (etat !== 'installed' && etat !== 'already') { console.error('oracle: ' + etat); process.exit(1); }

/* ============================ ZIP minimal ========================== */
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD introuvable');
  const count = buf.readUInt16LE(eocd + 10);
  let o = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let k = 0; k < count; k++) {
    const nl = buf.readUInt16LE(o + 28), el = buf.readUInt16LE(o + 30), cl = buf.readUInt16LE(o + 32);
    out.push({ name: buf.toString('utf8', o + 46, o + 46 + nl), method: buf.readUInt16LE(o + 10),
               csize: buf.readUInt32LE(o + 20), lho: buf.readUInt32LE(o + 42) });
    o += 46 + nl + el + cl;
  }
  return out;
}
function readEntry(buf, entry) {
  const nl = buf.readUInt16LE(entry.lho + 26), el = buf.readUInt16LE(entry.lho + 28);
  const start = entry.lho + 30 + nl + el, data = buf.slice(start, start + entry.csize);
  return entry.method === 0 ? data : require('zlib').inflateRawSync(data);
}
function embeddedMp3(buf) {
  const e = zipEntries(buf).find(x => /\.mp3$/i.test(x.name));
  return e ? readEntry(buf, e) : null;
}

/* ======================= durée d'un MP3 (trames) =================== */
const BITRATE = {
  '1-1': [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448],
  '1-2': [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],
  '1-3': [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],
  '2-1': [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],
  '2-2': [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
  '2-3': [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160]
};
const SRATE = { 1: [44100,48000,32000], 2: [22050,24000,16000], 2.5: [11025,12000,8000] };
function mp3DurationMs(buf) {
  let p = 0;
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    p = 10 + size;
  }
  let ms = 0;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xFF || (buf[p + 1] & 0xE0) !== 0xE0) { p++; continue; }
    const b1 = buf[p + 1], verBits = (b1 >> 3) & 0x03, layerBits = (b1 >> 1) & 0x03, b2 = buf[p + 2];
    const brIdx = (b2 >> 4) & 0x0F, srIdx = (b2 >> 2) & 0x03, pad = (b2 >> 1) & 0x01;
    if (verBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) { p++; continue; }
    const version = verBits === 3 ? 1 : (verBits === 2 ? 2 : 2.5), layer = 4 - layerBits;
    const bitrate = (BITRATE[(version === 2.5 ? '2' : String(version)) + '-' + layer] || [])[brIdx];
    const srate = SRATE[version][srIdx];
    if (!bitrate || !srate) { p++; continue; }
    const spf = layer === 1 ? 384 : (layer === 2 ? 1152 : (version === 1 ? 1152 : 576));
    const frameLen = layer === 1 ? (Math.floor(12 * bitrate * 1000 / srate) + pad) * 4
                                 : Math.floor(spf / 8 * bitrate * 1000 / srate) + pad;
    if (frameLen <= 4) { p++; continue; }
    ms += spf / srate * 1000;
    p += frameLen;
  }
  return ms;
}

/* ======================= construction des MIDI ===================== */
/* `smf1Mode = true` : uniquement pour pouvoir SÉRIALISER (toBinary) et relire
   les octets — le lecteur live consomme les objets d'événements directement,
   mais carte de tempo et tick de fin (donc DURÉE) sont identiques en SMF1. */
function buildNativeMidi(score, settings) {
  const midi = new at.midi.MidiFile();
  const handler = new at.midi.AlphaSynthMidiFileHandler(midi, true);
  const gen = new at.midi.MidiFileGenerator(score, settings, handler);
  gen.generate();
  return { midi, handler, gen };
}
function stripTempos(midi) {
  for (const tr of midi.tracks) tr.events = tr.events.filter(e => e.type !== TEMPO_TYPE);
}
function addTempo(midi, tick, bpm) {
  const ev = new at.midi.TempoChangeEvent(tick, 0);
  ev.beatsPerMinute = bpm;
  midi.addEvent(ev);
}

/* ---- VARIANTE A : syncBpm BRUT (prototype littéral du plan) -------- */
function bakeRaw(midi, handler, syncPoints) {
  stripTempos(midi);
  let n = 0, minBpm = Infinity, nBad = 0;
  for (const sp of syncPoints) {
    if (!(sp.syncBpm > 0)) { nBad++; continue; }
    addTempo(midi, sp.synthTick + handler.tickShift, sp.syncBpm);
    n++; if (sp.syncBpm < minBpm) minBpm = sp.syncBpm;
  }
  return { n, minBpm, nBad };
}

/* ---- règle de SEGMENT de js/mix-sync.js (analyzeSegments, l.166-199) --
   MIROIR assumé (spike exploratoire ; P2 factorisera cette analyse pour
   que mix-sync et la génération partagent LA MÊME table).               */
const JUMP_SLOPE = 3.0, SLOPE_MIN = 0.5, SLOPE_MAX = 2.0;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function analyzeSegments(pts) {
  const dedup = [];
  for (const p of pts) { while (dedup.length && p.t <= dedup[dedup.length - 1].t) dedup.pop(); dedup.push(p); }
  const n = dedup.length;
  for (let i = 0; i < n; i++) {
    const p = dedup[i], q = dedup[i + 1];
    if (!q) { p.jump = false; p.slope = 1; p.rawSlope = 1; continue; }
    const dt = q.t - p.t, da = q.a - p.a;
    p.rawSlope = dt > 0 ? da / dt : 1;
    p.jump = (da < 0) || (p.rawSlope < 1 / JUMP_SLOPE) || (p.rawSlope > JUMP_SLOPE);
    p.slope = clamp(p.rawSlope, SLOPE_MIN, SLOPE_MAX);
  }
  for (let i = n - 1; i >= 0; i--) if (dedup[i].jump) dedup[i].slope = (i + 1 < n) ? dedup[i + 1].slope : 1;
  for (const p of dedup) p.speed = p.slope > 0 ? 1 / p.slope : 1;
  return dedup;
}
function tempoLookup(midi) {
  const evs = midi.tracks[0].events.filter(e => e.type === TEMPO_TYPE).sort((a, b) => a.tick - b.tick);
  return tick => { let b = 120; for (const e of evs) { if (e.tick <= tick && e.beatsPerMinute > 0) b = e.beatsPerMinute; else if (e.tick > tick) break; } return b; };
}

/* ---- VARIANTE B : règle de segment mix-sync, pré-cuite -------------- */
function bakeMixRule(midi, handler, gen) {
  const sp = gen.syncPoints || [];
  const nativeAt = tempoLookup(midi);
  const segs = analyzeSegments(sp.map(s => ({ t: s.synthTime, a: s.syncTime, tick: s.synthTick })));
  stripTempos(midi);
  let minBpm = Infinity, nBad = 0;
  for (const s of segs) {
    const bpm = nativeAt(s.tick + handler.tickShift) * s.speed;
    if (!(bpm > 0)) { nBad++; continue; }
    addTempo(midi, s.tick + handler.tickShift, bpm);
    if (bpm < minBpm) minBpm = bpm;
  }
  /* Fidélité de la pré-cuisson : sur les segments CONTINUS **non clampés**
     (pente brute dans [0,5 ; 2]), la durée MIDI pré-cuite doit égaler la
     durée audio visée. On exclut les segments clampés : leur écart est la
     limite VOLONTAIRE de mix-sync (même clamp aujourd'hui), pas un défaut
     de la pré-cuisson. */
  let worst = 0, nCont = 0, nClamp = 0;
  for (let i = 0; i < segs.length - 1; i++) {
    const p = segs[i], q = segs[i + 1];
    if (p.jump) continue;
    const dSync = q.a - p.a;
    if (!(dSync > 0)) continue;
    if (p.rawSlope < SLOPE_MIN || p.rawSlope > SLOPE_MAX) { nClamp++; continue; }
    const bpm = nativeAt(p.tick + handler.tickShift) * p.speed;
    const dur = (q.tick - p.tick) * (60000 / (bpm * (midi.division || 960)));
    const err = Math.abs(dur - dSync) / dSync;
    if (err > worst) worst = err;
    nCont++;
  }
  return { n: segs.length, minBpm, nBad, worst, nCont, nClamp,
           nJump: segs.filter(s => s.jump).length };
}

/* ---- durée par les OBJETS d'événements ----------------------------- */
function midiDurationMs(midi) {
  const div = midi.division || 960;
  const evs = midi.tracks[0].events.slice().sort((a, b) => a.tick - b.tick);
  let bpm = 120, t = 0, acc = 0, nTempo = 0, minBpm = Infinity;
  for (const e of evs) {
    if (e.tick > t) { acc += (e.tick - t) * (60000 / (bpm * div)); t = e.tick; }
    if (e.type === TEMPO_TYPE && e.beatsPerMinute > 0) { bpm = e.beatsPerMinute; nTempo++; if (bpm < minBpm) minBpm = bpm; }
  }
  return { ms: acc, nTempo, minBpm };
}

/* ---- durée par RELECTURE INDÉPENDANTE du binaire SMF --------------- */
function smfDurationMs(bytes) {
  const b = Buffer.from(bytes); let p = 0;
  const u32 = () => { const v = b.readUInt32BE(p); p += 4; return v; };
  const u16 = () => { const v = b.readUInt16BE(p); p += 2; return v; };
  if (b.toString('ascii', p, p + 4) !== 'MThd') throw new Error('SMF: MThd absent');
  p += 4; const hlen = u32(); u16(); u16(); const division = u16(); p += hlen - 6;
  if (b.toString('ascii', p, p + 4) !== 'MTrk') throw new Error('SMF: MTrk absent');
  p += 4; const tlen = u32(); const end = p + tlen;
  let bpm = 120, acc = 0, running = 0;
  const varlen = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; };
  while (p < end) {
    const delta = varlen();
    acc += delta * (60000 / (bpm * division));
    let st = b[p];
    if (st & 0x80) { p++; if (st < 0xF0) running = st; } else st = running;
    if (st === 0xFF) {
      const type = b[p++], len = varlen();
      if (type === 0x51 && len === 3) { const usq = (b[p] << 16) | (b[p + 1] << 8) | b[p + 2]; if (usq > 0) bpm = 60000000 / usq; }
      p += len;
    } else if (st === 0xF0 || st === 0xF7) { p += varlen(); }
    else { const hi = st & 0xF0; p += (hi === 0xC0 || hi === 0xD0) ? 1 : 2; }
  }
  return acc;
}

/* ============================== main =============================== */
const argv = process.argv.slice(2);
const onlyGp = argv.includes('--gp') ? path.resolve(argv[argv.indexOf('--gp') + 1]) : null;
const files = onlyGp ? [onlyGp]
  : fs.readdirSync(SAMPLES).filter(f => /\.gp$/i.test(f)).sort().map(f => path.join(SAMPLES, f));

console.log('');
console.log('SPIKE stratégie C — tempo PRÉ-CUIT · ' + files.length + ' fichier(s) · SMF min ' + SMF_MIN_BPM.toFixed(2) + ' tr/min');
console.log('');

const hdr = ['fichier', 'pts', 'saut', 'natif', 'A: pré-cuit brut', 'B: pré-cuit règle mix', 'B: écart segments', 'portée GPIF', 'MP3', 'couverture'];
const lines = ['| ' + hdr.join(' | ') + ' |', '|' + hdr.map(() => '---').join('|') + '|'];
let okB = 0, total = 0, okCover = 0;

for (const file of files) {
  const base = path.basename(file);
  try {
    const raw = fs.readFileSync(file);
    const bytes = new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const settings = new at.Settings();
    const score = at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
    fixEmptyAnacrusis(score); RO.raise(score, MFG, null);

    /* NATIF */
    let m = buildNativeMidi(score, settings);
    const native = midiDurationMs(m.midi);
    const sp = m.gen.syncPoints || [];

    /* A */
    m = buildNativeMidi(score, settings);
    const A = bakeRaw(m.midi, m.handler, m.gen.syncPoints);
    const durA = midiDurationMs(m.midi);

    /* B */
    m = buildNativeMidi(score, settings);
    const B = bakeMixRule(m.midi, m.handler, m.gen);
    const durB = midiDurationMs(m.midi);
    const binB = smfDurationMs(m.midi.toBinary());

    const firstSync = sp.length ? sp[0].syncTime : 0;
    const lastSync = sp.length ? sp[sp.length - 1].syncTime : 0;
    const span = lastSync - firstSync;
    const mp3ms = embeddedMp3(raw) ? mp3DurationMs(embeddedMp3(raw)) : null;
    const cov = mp3ms ? span / mp3ms : null;

    total++;
    if (B.worst < 0.005) okB++;
    if (cov != null && cov > 0.99) okCover++;

    lines.push('| ' + [
      base.replace(/\.gp$/, '').slice(0, 30),
      sp.length, B.nJump,
      Math.round(native.ms) + ' ms',
      Math.round(durA.ms) + ' ms · min ' + (isFinite(A.minBpm) ? A.minBpm.toFixed(1) : '—') + (A.nBad ? ' · ' + A.nBad + '≤0' : ''),
      Math.round(durB.ms) + ' ms · min ' + (isFinite(B.minBpm) ? B.minBpm.toFixed(1) : '—'),
      (B.worst * 100).toFixed(3) + '%' + (B.worst < 0.005 ? ' ✓' : ' ⚠') + ' (' + B.nCont + ' seg' + (B.nClamp ? ', ' + B.nClamp + ' clamp' : '') + ')',
      Math.round(span) + ' ms',
      mp3ms ? Math.round(mp3ms) + ' ms' : '?',
      cov == null ? '—' : (cov * 100).toFixed(1) + '%' + (cov > 0.99 ? ' ✓' : ' ⚠')
    ].join(' | ') + ' |');

    console.log('   · ' + base.replace(/\.gp$/, '').slice(0, 32).padEnd(33) +
      ' binaire B ' + Math.round(binB) + ' ms vs objets ' + Math.round(durB.ms) + ' ms · minBpm B ' + B.minBpm.toFixed(1));
  } catch (e) {
    console.error('ECHEC ' + base + ' : ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
    total++;
  }
}

console.log('');
console.log(lines.join('\n'));
console.log('');
console.log('B (règle mix-sync) : écart par segment CONTINU NON clampé < 0,5 % sur ' + okB + ' / ' + total);
console.log('couverture de la portée GPIF sur le MP3 complet (> 99 %)  : ' + okCover + ' / ' + total);
console.log('');
console.log('LECTURE :');
console.log(' · A (syncBpm brut) peut descendre SOUS ' + SMF_MIN_BPM.toFixed(2) + ' tr/min sur les segments de');
console.log('   discontinuité (recul/bond audio) : ce n\'est pas un tempo, c\'est un SAUT — inutilisable');
console.log('   tel quel (et tronqué à la sérialisation SMF 3 octets).');
console.log(' · B applique la règle de js/mix-sync.js (saut → pente du bloc destination, clamp [0,5;2]) :');
console.log('   chaque segment CONTINU NON clampé dure exactement la durée audio visée → playbackSpeed');
console.log('   peut rester 1,0. Les segments « clamp » gardent l\'écart VOLONTAIRE de mix-sync, que le');
console.log('   correcteur de dérive absorbe — identique à aujourd\'hui, mais SANS les coupures du synthé.');
console.log(' · Couverture < 100 % = les sync-points du .gp s\'arrêtent avant la fin du MP3 (donnée du fichier).');
process.exit(okB >= 13 ? 0 : 1);
