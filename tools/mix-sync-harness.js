'use strict';
/* ==================================================================
   tools/mix-sync-harness.js — banc d'essai du CONTRÔLEUR RÉEL (BUGFIX D8)
   ------------------------------------------------------------------
   Les autres harnais (sync-audit, tempo-correct-sim) sont des MIROIRS :
   ils RECOPIENT les constantes et formules de js/mix-sync.js. Une dérive
   silencieuse y est donc invisible. Celui-ci charge js/mix-sync.js TEL
   QUEL dans un contexte `vm` (stubs AudioSync / Player.S.api / alphaTab =
   vendor / clamp / App / performance) puis PILOTE la boucle :

       build(score) → start() → onState(Playing)
       puis, pas à pas :  onPosition()  (comme playerPositionChanged)

   L'axe maître (api.timePosition) avance de 1 ms par ms ; le `<audio>`
   avance de son playbackRate ; `performance.now()` est l'horloge factice.
   La ré-échelle destructrice d'alphaTab est reproduite fidèlement :
   `set playbackSpeed` fait `timePosition *= ancien/nouveau`
   (AlphaSynth.updatePlaybackSpeed, vendor l.39849).

   Compté sur le code RÉEL :
     · tempoWrites  = écritures `api.playbackSpeed` (= 1 coupure synthé : RC-2)
     · rateWrites   = écritures `audio.playbackRate` (RC-3, saccades)
     · seekWrites   = écritures `audio.currentTime` (recadrages)
     · peakDrift    = dérive pic relue dans `[mix-stats]` (instrumentation LIVRÉE)
     · stalls       = arrêts maître (même source)

   Le score est reconstruit par le chemin LIVRÉ :
       fixEmptyAnacrusis → RepeatOracle.raise → MixSync.build
   (fixEmptyAnacrusis / normalizeMultiClosingRepeats EXTRAITES de player.js,
   oracle REQUIS depuis le dépôt : aucune copie.)

   Sortie : tableau + rappel « REF » (comptes de tempo-correct-sim /
   sync-audit) ; sortie 1 si un compte réel s'écarte de REF de plus de 2 %.

   Usage :  node tools/mix-sync-harness.js
            node tools/mix-sync-harness.js --gp <fich>   (un seul .gp)
            node tools/mix-sync-harness.js --dt 25        (pas de simulation, ms)
            node tools/mix-sync-harness.js --verbose      (journal complet)
   ================================================================== */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT    = path.resolve(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const VENDOR  = path.join(__dirname, 'vendor', 'alphaTab.js');

if (!fs.existsSync(VENDOR)) {
  console.log('VENDOR manquant : tools/vendor/alphaTab.js (voir tools/sync-audit.js)');
  process.exit(1);
}
const at = require(VENDOR);

/* ---- fonctions LIVRÉES (extraites de player.js, aucune copie) ------- */
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

/* ---- module LIVRÉ : js/repeat-oracle.js ---------------------------- */
require(path.join(ROOT, 'js', 'repeat-oracle.js'));
const RO = globalThis.RepeatOracle;
if (!RO) throw new Error('RepeatOracle non exposé par js/repeat-oracle.js');
const MFG = at.midi.MidiFileGenerator;
const etat = RO.install(MFG, normalizeMultiClosingRepeats, null);
if (etat !== 'installed' && etat !== 'already') {
  console.error('RepeatOracle.install → ' + etat); process.exit(1);
}

/* ---- le CONTRÔLEUR, lu tel quel ------------------------------------ */
const MIX_SYNC_SRC = fs.readFileSync(path.join(ROOT, 'js', 'mix-sync.js'), 'utf8');
if (MIX_SYNC_SRC.indexOf('function applyTempo') < 0) {
  throw new Error('js/mix-sync.js inattendu : applyTempo absent (fichier non livré ?)');
}

/* ============================ le banc ============================== */
function makeBench() {
  const sim  = { now: 0 };
  const c    = { tempo: 0, rate: 0, seek: 0, play: 0, pause: 0 };
  const logs = [];
  const PLAYING = 1;

  /* <audio> factice : currentTime/playbackRate instrumentés */
  const audio = {
    src: 'blob:harness', readyState: 4, preservesPitch: false,
    paused: true, _ct: 0, _rate: 1,
    get currentTime() { return this._ct; },
    set currentTime(v) {
      if (!isFinite(v)) return;
      if (Math.abs(v - this._ct) > 1e-9) { c.seek++; this._ct = v; }
    },
    get playbackRate() { return this._rate; },
    set playbackRate(v) { if (v !== this._rate) { c.rate++; this._rate = v; } },
    play()  { c.play++;  this.paused = false; return Promise.resolve(); },
    pause() { c.pause++; this.paused = true; },
    load()  {}
  };

  /* api synthé factice : reproduit AlphaSynth.playbackSpeed/timePosition */
  const api = {
    playbackRange: null, _tp: 0, _sp: 1,
    get timePosition() { return this._tp; },
    set timePosition(v) { this._tp = v; },
    get playbackSpeed() { return this._sp; },
    set playbackSpeed(v) {
      const lo = (at.SynthConstants && at.SynthConstants.MinPlaybackSpeed) || 0.125;
      const hi = (at.SynthConstants && at.SynthConstants.MaxPlaybackSpeed) || 8;
      v = Math.min(hi, Math.max(lo, v));
      const old = this._sp;
      c.tempo++;
      this._sp = v;
      this._tp = this._tp * (old / v);   // vendor l.39849 : re-échelle destructive
    }
  };

  const consoleStub = {
    log:  (...a) => { logs.push(a.join(' ')); },
    warn: (...a) => { logs.push('[warn] ' + a.join(' ')); },
    error:(...a) => { logs.push('[error] ' + a.join(' ')); },
    info: () => {}, debug: () => {}, trace: () => {}
  };

  const sandbox = {
    console: consoleStub,
    performance: { now: () => sim.now },
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    alphaTab: at,
    AT: { PlayerState: { Playing: PLAYING } },
    AudioSync: { element: audio },
    Player: { S: { api } },
    App: { toast() {} },
    Promise
  };
  const ctx = vm.createContext(sandbox);
  new vm.Script(MIX_SYNC_SRC, { filename: 'js/mix-sync.js' })
    .runInContext(ctx, { timeout: 5000 });
  const MixSync = vm.runInContext('MixSync', ctx);
  if (!MixSync || typeof MixSync.build !== 'function' || typeof MixSync.onPosition !== 'function') {
    throw new Error('MixSync non chargé depuis js/mix-sync.js');
  }
  return { MixSync, sim, c, logs, audio, api, PLAYING };
}

/* ---- pilotage : avance les DEUX axes puis appelle onPosition -------
   On s'arrête à la FIN DU MORCEAU (sinon la dérive explose après la
   dernière note : plus rien à caler). Durée réelle = ∫ pente·d(musical)
   ≈ lastT × penteMoy = lastT / tempoScale, avec tempoScale LIVRÉ par
   `MixSync.info` (1/penteMoy) — pas un miroir, la valeur du module. */
function drive(bench, score, dt, lastT) {
  const { MixSync, sim, c, audio, api, PLAYING } = bench;
  const tempo0 = c.tempo;
  MixSync.build(score);
  const ts = (MixSync.info && MixSync.info.tempoScale) || 1;
  const capMs = Math.min(900000, Math.round(lastT / (ts > 0 ? ts : 1)) + 3000);
  MixSync.start();
  MixSync.onState(PLAYING);              // resync + a.play()

  let steps = 0;
  while (sim.now < capMs && steps < 5e6) {
    api._tp += dt;                              // axe réel : 1 ms / ms
    audio._ct += audio._rate * dt / 1000;       // <audio> suit son playbackRate
    sim.now += dt;
    MixSync.onPosition();                       // == playerPositionChanged
    steps++;
  }
  return { steps, capMs, tempoWrites: c.tempo - tempo0 };
}

/* ---- relecture de l'instrumentation LIVRÉE `[mix-stats]` -----------
   `dérive max` est le pic PAR FENÊTRE de 5 s. Le pic global INCLUT les
   sauts volontaires (une discontinuité de répétition = un gros écart
   instantané, recadré par UN seek) : c'est pourquoi on rapporte aussi la
   MÉDIANE des pics de fenêtre = la dérive « de croisière », seule
   significative quand la partition a des renvois. */
function readStats(logs) {
  let stalls = 0, winRate = 0, winSeek = 0;
  const winDrift = [];
  for (const l of logs) {
    const m = /dérive max (\d+) ms/.exec(l);
    if (m) winDrift.push(Number(m[1]));
    const st = /arrêts maître (\d+)/.exec(l);
    if (st) stalls += Number(st[1]);
    const rt = /playbackRate ([\d.]+) écriture\/s/.exec(l);
    if (rt) winRate += Math.round(Number(rt[1]) * 5);   // fenêtre = STAT_MS = 5 s
    const sk = /seek ([\d.]+)\/s/.exec(l);
    if (sk) winSeek += Math.round(Number(sk[1]) * 5);
  }
  const sorted = winDrift.slice().sort((a, b) => a - b);
  const peakDrift = sorted.length ? sorted[sorted.length - 1] : 0;
  const driftMed  = sorted.length ? sorted[(sorted.length - 1) >> 1] : 0;
  return { peakDrift, driftMed, stalls, winRate, winSeek };
}
function readBuildNote(logs) {
  const l = logs.find(x => x.indexOf('[mix] ') === 0 && x.indexOf('point') >= 0) || '';
  const pts = /^\[mix\] (\d+) point/.exec(l);
  const jumps = /(\d+) saut\(s\)/.exec(l);
  const off = /(\d+) pente\(s\) hors plage/.exec(l);
  return { note: l.replace('[mix] ', ''), points: pts ? Number(pts[1]) : null,
           jumps: jumps ? Number(jumps[1]) : 0, off: off ? Number(off[1]) : 0 };
}

/* ---- REF : comptes attendus (tempo-correct-sim / sync-audit NEW) --- */
const REF = {
  'ACDC (1979 - Highway to Hell) - Highway to Hell.gp': 9,
  'Blink 182 (1999 - Enema Of The State) - All the Small Things v2.gp': 41,
  'Europe (1986 - The Final Countdown) - The Final Countdown v3.gp': 1,
  'F-Zero X (1998) - Goal BGM.gp': 5,
  'Helloween (1988 - Keeper of the Seven Keys - Part II) - Dr. Stein.gp': 23,
  'Igorrr (2025 - Amen) - Blastbeat Falafel.gp': 2,
  'Igorrr (2025 - Amen) - Headbutt.gp': 2,
  'Iron Maiden (1992 - Fear of the Dark) - Fear of the Dark.gp': 47,
  'Led Zeppelin (1970 - Led Zeppelin III) - Immigrant Song.gp': 8,
  'Metallica (1984 - Ride the Lightning) - For Whom the Bell Tolls v4.gp': 32,
  'Renaud (1983 - Morgane de toi) - Morgane de toi (amoureux de toi).gp': 10,
  'Sepultura (1993 - Chaos A.D.) - Amen.gp': 55,
  'Slayer (1985 - Hell Awaits) - Hell Awaits.gp': 33,
  'The Offspring (1994 - Smash) - Self Esteem.gp': 137
};

/* ============================== main =============================== */
const argv = process.argv.slice(2);
let DT = 25;
for (let i = 0; i < argv.length; i++) if (argv[i] === '--dt') DT = Math.max(1, Number(argv[i + 1]) || 25);
const VERBOSE = argv.includes('--verbose');
const onlyGp = argv.includes('--gp') ? path.resolve(argv[argv.indexOf('--gp') + 1]) : null;

function loadScore(file) {
  const b = fs.readFileSync(file);
  const bytes = new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const score = at.importer.ScoreLoader.loadScoreFromBytes(bytes, new at.Settings());
  fixEmptyAnacrusis(score);
  RO.raise(score, MFG, null);
  return score;
}

const files = onlyGp
  ? [onlyGp]
  : fs.readdirSync(SAMPLES).filter(f => /\.gp$/i.test(f)).sort().map(f => path.join(SAMPLES, f));

console.log('');
console.log('Banc du contrôleur RÉEL — js/mix-sync.js exécuté tel quel · pas ' + DT + ' ms · ' + files.length + ' fichier(s)');
console.log('tempoWrites = écritures playbackSpeed (1 = 1 coupure synthé) · rateWrites = écritures playbackRate');
console.log('dérive croisière = MÉDIANE des pics de fenêtre · pic = max (inclut les sauts volontaires)');
console.log('');

const hdr = ['fichier', 'points', 'saut', 'tempoWrites', 'REF', 'écart', 'rateWrites', 'seekWrites', 'dérive croisière', 'pic', 'stalls', 'simSec'];
const lines = ['| ' + hdr.join(' | ') + ' |', '|' + hdr.map(() => '---').join('|') + '|'];

let bad = 0, totalTempo = 0, totalRef = 0, totalRate = 0, totalSeek = 0, worstDrift = 0, worstMed = 0;

for (const file of files) {
  const base = path.basename(file);
  try {
    const score = loadScore(file);
    const bench = makeBench();
    const lastT = (() => {
      const pts = at.midi.MidiFileGenerator.generateSyncPoints(score) || [];
      let m = 0; for (const p of pts) if (isFinite(p.synthTime) && p.synthTime > m) m = p.synthTime;
      return m;
    })();
    const r = drive(bench, score, DT, lastT);
    const bn = readBuildNote(bench.logs);
    const st = readStats(bench.logs);

    /* Écart par fichier : INFORMATIF. Le critère de sortie est GLOBAL (±2 %
       sur le total, cf. BUGFIX-TOTAL P0) : pour des comptes de 1 à 5, un
       écart absolu d'une écriture n'est pas significatif (le harnais réel
       intègre l'horloge musicale à 25 ms et subit la ré-échelle destructive,
       que le miroir `simulate` ne reproduit pas à l'identique). */
    const ref = REF[base];
    let ecart = '—';
    if (ref != null) {
      const d = Math.abs(r.tempoWrites - ref) / Math.max(1, ref);
      ecart = (d * 100).toFixed(1) + '%';
      if (d > 0.02 && Math.abs(r.tempoWrites - ref) > 1) ecart += ' ⚠';
      totalRef += ref;
    }
    totalTempo += r.tempoWrites;
    totalRate += bench.c.rate;
    totalSeek += bench.c.seek;
    worstDrift = Math.max(worstDrift, st.peakDrift);
    worstMed   = Math.max(worstMed, st.driftMed);

    if (VERBOSE) {
      console.log('--- ' + base + ' ---');
      console.log('   ' + bn.note);
      bench.logs.forEach(l => console.log('   | ' + l));
    }

    lines.push('| ' + [
      base.replace(/\.gp$/, '').slice(0, 34),
      bn.points == null ? '?' : bn.points,
      bn.jumps,
      r.tempoWrites,
      ref == null ? '—' : ref,
      ecart,
      bench.c.rate,
      bench.c.seek,
      st.driftMed + ' ms',
      st.peakDrift + ' ms',
      st.stalls,
      (r.steps * DT / 1000).toFixed(0)
    ].join(' | ') + ' |');
  } catch (e) {
    bad++;
    console.error('ECHEC ' + base + ' : ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  }
}

console.log(lines.join('\n'));
console.log('');
const gap = totalRef ? Math.abs(totalTempo - totalRef) / totalRef : 0;
if (totalRef && gap > 0.02) bad++;
console.log('tempoWrites (total) : ' + totalTempo + (totalRef ? '   REF ' + totalRef : '') +
            (totalRef ? '   écart ' + (gap * 100).toFixed(2) + '%' + (gap > 0.02 ? ' ⚠ > 2 %' : ' ✓') : ''));
console.log('rateWrites  (total) : ' + totalRate + '   seekWrites (total) : ' + totalSeek);
console.log('dérive croisière (pire) : ' + worstMed + ' ms   (médiane des pics de fenêtre)');
console.log('dérive pic (pire)       : ' + worstDrift + ' ms   (max, sauts volontaires inclus)');
console.log('');
console.log('LECTURE : tempoWrites = 0 est la CIBLE après P2 (tempo pré-cuit) ; avant, c\'est');
console.log('le nombre de coupures du synthé. Écart REF > 2 % = le contrôleur réel s\'écarte');
console.log('des harnais-miroirs → un des deux ment, à investiguer avant toute décision.');
console.log('La « dérive croisière » est le seul indicateur de décalage PERMANENT ; le pic,');
console.log('lui, vaut la TAILLE d\'un saut de renvoi (recadré par un seul seek).');
process.exit(bad === 0 ? 0 : 1);
