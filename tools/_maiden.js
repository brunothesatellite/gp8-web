'use strict';
/* Analyse Iron Maiden : slope locale par segment vs tempoScale GLOBAL. */
const fs = require('fs');
const path = require('path');
const at = require(path.join(__dirname, 'vendor', 'alphaTab.js'));
const GP = path.join(path.resolve(__dirname, '..'), 'samples', 'Iron Maiden (1992 - Fear of the Dark) - Fear of the Dark.gp');
const s = at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(fs.readFileSync(GP)), new at.Settings());
let pts = (at.midi.MidiFileGenerator.generateSyncPoints(s) || [])
  .filter(p => isFinite(p.synthTime) && isFinite(p.syncTime))
  .map(p => ({ t: p.synthTime, a: p.syncTime }))
  .sort((x, y) => x.t - y.t);
const d = []; for (const p of pts) { while (d.length && p.t <= d[d.length - 1].t) d.pop(); d.push(p); } pts = d;
let sda = 0, sdt = 0; const segs = [];
for (let i = 0; i < pts.length - 1; i++) {
  const dt = pts[i + 1].t - pts[i].t, da = pts[i + 1].a - pts[i].a;
  const sl = dt > 0 ? da / dt : 1;
  const jump = da < 0 || sl < 1 / 3 || sl > 3;
  if (!jump && dt > 0) { sda += da; sdt += dt; }
  segs.push({ t0: pts[i].t, dt, sl, jump });
}
const avg = sda / sdt, ts = 1 / avg;
console.log('nPoints = ' + pts.length + '  duree synth = ' + (pts[pts.length - 1].t / 1000).toFixed(1) + 's');
console.log('avgSlope = ' + avg.toFixed(3) + '  -> tempoScale GLOBAL = ' + ts.toFixed(3) + ' (MIDI ' + ((ts - 1) * 100).toFixed(1) + '% plus rapide que la notation, PARTOUT)');
console.log('\n20 premiers segments : debut s / pente / vitesse GP (1/slope)');
segs.slice(0, 20).forEach(g => console.log('  ' + (g.t0 / 1000).toFixed(1).padStart(6) + 's  dt ' + String(Math.round(g.dt)).padStart(6) + '  slope ' + g.sl.toFixed(3) + '  1/slope ' + (1 / g.sl).toFixed(3) + (g.jump ? '  SAUT' : '')));
const early = segs.slice(0, 10).filter(g => !g.jump && g.dt > 500);
if (early.length) {
  const w = early.reduce((x, g) => x + g.sl * g.dt, 0) / early.reduce((x, g) => x + g.dt, 0);
  console.log('\npente moyenne debut = ' + w.toFixed(3) + ' -> vitesse GP au debut = ' + (1 / w).toFixed(3) + ' ; la webapp impose ' + ts.toFixed(3) + ' -> erreur ' + ((ts * w - 1) * 100).toFixed(1) + '% au debut');
}
// profil global : mediane + quartiles des pentes retenues
const ok = segs.filter(g => !g.jump && g.dt > 200).map(g => g.sl).sort((x, y) => x - y);
const q = f => ok[Math.min(ok.length - 1, Math.floor(f * ok.length))];
console.log('quartiles des pentes : Q1 ' + q(0.25).toFixed(3) + '  med ' + q(0.5).toFixed(3) + '  Q3 ' + q(0.75).toFixed(3) + '  min ' + ok[0].toFixed(3) + '  max ' + ok[ok.length - 1].toFixed(3));
console.log('\n10 segments les plus LONGS :');
segs.filter(g => !g.jump).sort((a, b) => b.dt - a.dt).slice(0, 10).forEach(g => console.log('  a ' + (g.t0 / 1000).toFixed(1) + 's  dt ' + String(Math.round(g.dt / 1000)) + 's  slope ' + g.sl.toFixed(3)));
// automations de tempo du fichier (le tempo note bouge-t-il ?)
const autos = [];
for (const mb of s.masterBars) for (const a of (mb.tempoChanges || [])) autos.push({ t: (mb.tickPosition / s.ticksPerBeat() * 60000 / mb.calculateDuration() * (mb.duration || 0)) , bpm: a.value, t2: a.autoBezier ? -1 : -1, tick: mb.tickPosition });
console.log('\nchangements de tempo notes : ' + autos.map(a => Math.round(a.tick) + 't=' + a.bpm).join(', '));
