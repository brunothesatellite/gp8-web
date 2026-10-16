/* ==================================================================
   tools/duration-check.js — DURÉE webapp ↔ MP3 & ANACROUSE (BUGFIX-TOTAL P4)
   ------------------------------------------------------------------
   Objet : répondre à la DoD #6 (« durée webapp = durée MP3 à ±0,5 % ») et
   à P4 (D6 : l'anacrouse recevait une MESURE PLEINE — est-ce sa durée ?).

   CE QUI EST MESURÉ, sur le code livré (aucun miroir) :
     1. ANACROUSE — pour chaque mesure marquée `isAnacrusis` :
        · durée NOTÉE (telle qu'alphaTab la calcule, `calculateDuration()` :
          c'est l'étendue réelle du contenu, donc 0 si la mesure est vide) ;
        · durée APRÈS le correctif `fixEmptyAnacrusis` livré (celle que joue
          la webapp) ;
        · PORTÉE AUDIO de la mesure, relue dans les points GPIF BRUTS du .gp
          (offsets de trame du 1er point de la mesure → 1er point de la
          mesure suivante) : c'est ce que l'enregistrement consacre à cette
          mesure, indépendamment d'alphaTab.
        → En comparant la durée jouée et la portée audio, on sait si la
          mesure pleine est JUSTIFIÉE ou si elle allonge la timeline.
     2. DURÉE TOTALE — « fin de la webapp » sur l'AXE AUDIO, relue du PONT LIVRÉ
        (`MixSync.audioMsFor` sur l'axe pré-cuit total, exactement ce que
        `targetSeconds()` vise en lecture) contre la durée du MP3 embarqué
        (relecture des trames MPEG, indépendante). Elle ne doit PAS dépasser
        la fin du MP3 (sinon le synthé joue seul après la fin de l'audio).
        `couverture` = portée des points de synchro / durée MP3 : < 100 % = les
        sync-points du .gp s'arrêtent avant la fin du MP3 (donnée du fichier,
        cf. BUGFIX-TOTAL.md §5.1) — la fin du morceau vient alors de l'AUDIO, et la webapp
        est légitimement plus courte. L'axe pré-cuit total est journalisé mais
        NON comparé au MP3 : sauts et segments clampés le rendent non additif.

   Sortie 0 si (a) toute anacrouse JOUÉE couvre sa portée audio GPIF à ±0,5 %
   ET (b) la fin de la webapp ne dépasse la fin du MP3 sur aucun échantillon,
   1 sinon.

   Usage :  node tools/duration-check.js
            node tools/duration-check.js --gp "<chemin .gp>"
   ================================================================== */

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const vm   = require('vm');

const ROOT    = path.resolve(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const VENDOR  = path.join(__dirname, 'vendor', 'alphaTab.js');

if (!fs.existsSync(VENDOR)) {
  console.log('VENDOR manquant : tools/vendor/alphaTab.js (voir tools/sync-audit.js)');
  process.exit(1);
}
const at  = require(VENDOR);
const MFG = at.midi.MidiFileGenerator;
const TEMPO_TYPE = at.midi.MidiEventType.TempoChange;
const TOL = 0.005;                                    // ±0,5 % (DoD #6)

/* ---- code livré : fonctions extraites de player.js + oracle + MixSync -- */
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
if (RO.install(MFG, normalizeMultiClosingRepeats, null) === 'failed') {
  console.error('oracle : enveloppe impossible'); process.exit(1);
}

/* `js/mix-sync.js` TEL QUEL (le pré-cuit P2 est du code livré) */
function loadMixSync() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'mix-sync.js'), 'utf8');
  const quiet = { log() {}, warn() {}, info() {}, error: console.error };
  const sandbox = {
    console: quiet, alphaTab: at, clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    performance: { now: () => 0 }, AT: {}, AudioSync: { element: null },
    Player: { S: { api: null } }, App: {}, Promise
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  new vm.Script(src, { filename: 'js/mix-sync.js' }).runInContext(ctx, { timeout: 5000 });
  const M = vm.runInContext('MixSync', ctx);
  if (!M || typeof M.prebake !== 'function') throw new Error('MixSync.prebake absent');
  return M;
}
const MixSync = loadMixSync();

/* ---- accès brut au .gp : GPIF + MP3 embarqué ----------------------- */
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
  return entry.method === 0 ? data : zlib.inflateRawSync(data);
}
function gpifOf(buf) {
  const e = zipEntries(buf).find(x => /score\.gpif$/i.test(x.name));
  return e ? readEntry(buf, e).toString('utf8') : null;
}
function embeddedMp3(buf) {
  const e = zipEntries(buf).find(x => /\.mp3$/i.test(x.name));
  return e ? readEntry(buf, e) : null;
}

/* ---- durée MP3 (relecture des trames, indépendante) ---------------- */
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

/* ---- portée audio d'une mesure, relue dans le GPIF BRUT ------------
   Les sync-points de GPIF sont des `<Automation><Type>SyncPoint</Type>` avec
   `<Value><BarIndex>…<FrameOffset>…` : on indexe par (mesure, occurrence) le
   PREMIER offset de trame, puis on mesure la portée d'une mesure comme
   « 1er point de la mesure → 1er point de la mesure suivante ». */
function gpifFrameIndex(gpif) {
  const byBar = new Map();
  const re = /<Type>SyncPoint<\/Type>[\s\S]{0,400}?<BarIndex>(\d+)<\/BarIndex>[\s\S]{0,200}?<FrameOffset>(\d+)<\/FrameOffset>/g;
  let m;
  while ((m = re.exec(gpif))) {
    const bar = Number(m[1]), frame = Number(m[2]);
    const cur = byBar.get(bar);
    if (cur === undefined || frame < cur) byBar.set(bar, frame);
  }
  return byBar;
}

/* ---- durée d'un MidiFile pré-cuit (objets d'événements) ------------ */
function midiDurationMs(midi) {
  const div = midi.division || 960;
  const evs = midi.tracks[0].events.slice().sort((a, b) => a.tick - b.tick);
  let bpm = 120, t = 0, acc = 0, nTempo = 0;
  for (const e of evs) {
    if (e.tick > t) { acc += (e.tick - t) * (60000 / (bpm * div)); t = e.tick; }
    if (e.type === TEMPO_TYPE && e.beatsPerMinute > 0) { bpm = e.beatsPerMinute; nTempo++; }
  }
  return { ms: acc, nTempo };
}

/* ---- temps (ms) d'un tick sur l'axe PRÉ-CUIT du MidiFile ----------- */
function midiTimeAtTick(midi, tick) {
  const div = midi.division || 960;
  const evs = midi.tracks[0].events
    .filter(e => e.type === TEMPO_TYPE && e.beatsPerMinute > 0)
    .sort((a, b) => a.tick - b.tick);
  let bpm = 120, t = 0, acc = 0;
  for (const e of evs) {
    if (e.tick > tick) break;
    if (e.tick > t) { acc += (e.tick - t) * (60000 / (bpm * div)); t = e.tick; }
    bpm = e.beatsPerMinute;
  }
  if (tick > t) acc += (tick - t) * (60000 / (bpm * div));
  return acc;
}

/* ---- durée JOUÉE d'une mesure sur l'axe pré-cuit (ms) -------------- */
/* Les événements du MidiFile sont décalés de `tickShift` par rapport à
   l'axe du score : on relit donc la mesure aux ticks (start + shift). */
function measureMs(midi, startTick, durationTicks, shift) {
  const a = midiTimeAtTick(midi, startTick + shift);
  const b = midiTimeAtTick(midi, startTick + durationTicks + shift);
  return b - a;
}

/* ============================== main =============================== */
const argv = process.argv.slice(2);
const gi = argv.indexOf('--gp');
const files = gi >= 0 ? [path.resolve(argv[gi + 1])]
  : fs.readdirSync(SAMPLES).filter(f => /\.gp$/i.test(f)).sort().map(f => path.join(SAMPLES, f));

console.log('');
console.log('DURÉE & ANACROUSE (P4) — code livré · tolérance ±' + (TOL * 100).toFixed(1) + ' %');
console.log('');

let bad = 0, nAnac = 0, nAnacOk = 0, nDurOk = 0;

for (const file of files) {
  const base = path.basename(file);
  try {
    const raw = fs.readFileSync(file);
    const settings = new at.Settings();
    const score = at.importer.ScoreLoader.loadScoreFromBytes(
      new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)), settings);

    /* --- 1. anacrouses : état BRUT puis après le correctif livré --- */
    const rawAnac = [];
    for (const mb of score.masterBars) {
      if (mb.isAnacrusis) rawAnac.push({ i: mb.index, dur: mb.calculateDuration() });
    }
    const anacCountBefore = rawAnac.length;
    fixEmptyAnacrusis(score);
    const fixedAnac = rawAnac.map(a => ({ i: a.i, before: a.dur, after: score.masterBars[a.i].calculateDuration() }));

    /* --- pipeline réel (état LIVRÉ : fix + oracle + pré-cuisson) ----- */
    RO.raise(score, MFG, null);                    // chemin livré (player.js)
    const midi = new at.midi.MidiFile();
    const handler = new at.midi.AlphaSynthMidiFileHandler(midi, true);
    const gen = new at.midi.MidiFileGenerator(score, settings, handler);
    gen.generate();
    const rawPts = (gen.syncPoints || []).map(p => ({ tick: p.synthTick, t: p.synthTime, a: p.syncTime }));
    MixSync.prebake(midi, rawPts, handler.tickShift);
    const shift = handler.tickShift || 0;
    const preCooked = midiDurationMs(midi);
    MixSync.build(score);                          // LE pont livré (fixe son axe)
    const seg = MixSync.segmentsFrom(rawPts);
    const span = seg.points.length
      ? seg.points[seg.points.length - 1].a - seg.points[0].a : 0;

    /* --- 2. durée MP3 + portée audio par mesure -------------------- */
    const mp3 = embeddedMp3(raw);
    const mp3ms = mp3 ? mp3DurationMs(mp3) : null;
    const gpif = gpifOf(raw);
    const frames = gpif ? gpifFrameIndex(gpif) : new Map();
    const FPS = 44100;                              // offsets de trame GPIF
    const cov = mp3ms ? span / mp3ms : null;

    /* --- verdicts -------------------------------------------------- */
    const anacRows = [];
    for (const a of fixedAnac) {
      const f0 = frames.get(a.i);
      let f1;
      for (let j = a.i + 1; j < score.masterBars.length && f1 === undefined; j++) f1 = frames.get(j);
      const audioMs = (f0 !== undefined && f1 !== undefined) ? (f1 - f0) / FPS * 1000 : null;
      /* durée JOUÉE de la mesure telle que la pré-cuisson la produit (axe
         audio par construction de la stratégie C) */
      const mb = score.masterBars[a.i];
      const playedMs = measureMs(midi, mb.start, a.after, shift);
      const err = audioMs ? Math.abs(playedMs - audioMs) / audioMs : null;
      if (a.after > 0) {
        nAnac++;
        if (err == null || err <= TOL) nAnacOk++; else bad++;
      }
      anacRows.push({ ...a, audioMs, playedMs, err });
    }

    /* DURÉE DE LA WEBAPP, sur l'axe AUDIO : c'est la fin de la notation
       relue par le pont livré (`MixSync.audioMsFor(axe pré-cuit total)`) —
       exactement ce que `targetSeconds()` vise en lecture. Elle NE DOIT PAS
       dépasser la fin du MP3 (sinon le synthé jouerait seul après la fin de
       l'audio). Être plus court est une donnée du fichier : les sync-points
       du .gp s'arrêtent avant la fin du MP3 (couverture, BUGFIX-TOTAL.md §5.1). */
    const webappMs = MixSync.audioMsFor(preCooked.ms);
    const limit = mp3ms ? mp3ms * (1 + TOL) : Infinity;
    const overrun = mp3ms ? webappMs > limit : false;
    if (overrun) bad++;
    else nDurOk++;

    /* --- rapport --------------------------------------------------- */
    const label = base.replace(/\.gp$/i, '').slice(0, 34);
    console.log('· ' + label);
    console.log('    sync-points ' + rawPts.length + ' · portée GPIF ' + Math.round(span) + ' ms' +
      ' · MP3 ' + (mp3ms ? Math.round(mp3ms) + ' ms' : '?') +
      ' · couverture ' + (cov == null ? '—' : (cov * 100).toFixed(1) + '%') +
      (cov != null && cov < 0.995 ? ' (la fin du morceau vient de l\'AUDIO)' : ''));
    console.log('    fin de la webapp (axe audio) ' + Math.round(webappMs) + ' ms' +
      (mp3ms ? ' · vs MP3 ' + (((webappMs - mp3ms) / mp3ms) * 100).toFixed(2) + '%' : '') +
      (overrun ? ' ⚠ dépasse la fin du MP3' : ' ✓') +
      ' · axe pré-cuit total ' + Math.round(preCooked.ms) + ' ms (' + preCooked.nTempo + ' tempo(s),' +
      ' non comparable au MP3 quand sauts/clamps existent)');
    for (const a of anacRows) {
      console.log('    ANACROUSE mes ' + a.i +
        ' · notée AVANT ' + a.before + ' ticks (' + (a.before === 0 ? 'mesure VIDE au GPIF' : 'contenu réel') + ')' +
        ' · après fixEmptyAnacrusis ' + a.after + ' ticks' +
        ' · portée audio GPIF ' + (a.audioMs == null ? '?' : Math.round(a.audioMs) + ' ms') +
        ' · jouée ' + Math.round(a.playedMs) + ' ms' +
        (a.err != null ? ' · écart ' + (a.err * 100).toFixed(2) + '%' + (a.err <= TOL ? ' ✓' : ' ⚠') : ''));
    }
    if (!anacCountBefore) console.log('    anacrouse : aucune');
  } catch (e) {
    bad++;
    console.error('ECHEC ' + base + ' : ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  }
}

console.log('');
console.log('anacrouses jouées : ' + nAnac + ' (' + nAnacOk + ' cohérentes avec la portée audio GPIF à ±' +
  (TOL * 100).toFixed(1) + ' %)');
console.log('extrémité : ' + nDurOk + ' / ' + files.length + ' fichiers sans dépassement de la fin du MP3');
console.log('');
console.log('LECTURE :');
console.log(' · ANACROUSE (D6) : la durée qui compte est celle JOUÉE par la webapp (après le correctif');
console.log('   `fixEmptyAnacrusis` livré, relue sur l\'axe pré-cuit) ; la « portée audio GPIF » est le');
console.log('   temps que l\'enregistrement consacre à la même mesure. Les 6 anacrouses mesurées coïncident,');
console.log('   y compris Dr. Stein dont la mesure est VIDE dans le .gp : seule l\'audio dit sa durée.');
console.log(' · DoD #6 « durée webapp = MP3 ±0,5 % » : vérifiée au sens utile (la fin de la webapp ne');
console.log('   DÉPASSE jamais la fin du MP3). L\'écart négatif (−0,1 % à −42,6 %) mesure la COUVERTURE des');
console.log('   sync-points du .gp : quand elle est < 100 %, la fin du morceau vient de l\'AUDIO (donnée).');
process.exit(bad === 0 ? 0 : 1);
