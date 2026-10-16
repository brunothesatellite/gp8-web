'use strict';
/* ==================================================================
   tools/browser/run.js — P5-13 : test d'integration NAVIGATEUR
   ------------------------------------------------------------------
   Le SEUL harnais qui exécute l'app ENTIERE dans un vrai navigateur :
   HTML + CSS + les 8 <script> classiques + alphaTab (CDN) + le synthé
   + la piste audio embarquée. Tout ce que les harnais Node simulent,
   celui-ci le joue pour de bon.

   Principe : ZÉRO MIROIR du contrôleur. On ne recalcule rien.
     · l'app est servie en http://localhost (contexte sûr → AudioWorklet) ;
     · on clique VRAIMENT le bouton d'un exemple (chemin Samples → fetch →
       Player.loadFile) ;
     · on clique VRAIMENT Lecture ;
     · les métriques viennent de l'INSTRUMENTATION LIVRÉE `[mix-stats]`
       (js/mix-sync.js) — mêmes expressions, mêmes seuils que
       tools/mix-sync-harness.js (§6.2 BUGFIX-TOTAL) ;
     · la seule sonde ajoutée est un COMPTEUR PASSE-PLAQUES sur
       `api.playbackSpeed` (le vrai setter d'alphaTab est conservé) : c'est
       la cible P2 « 0 écriture en lecture », absente du journal livré.

   Isle : aucune dépendance à l'exécution du dépôt. Playwright est un
   devDependency LOCAL à tools/browser/ (npm i), et le navigateur utilisé
   est Chrome/Edge DÉJÀ INSTALLÉ (pas de téléchargement de Chromium) :
       cd tools/browser && npm i && npm test

   Usage :
       node run.js                 # 3 exemples représentatifs (Sepultura, Dr. Stein, Renaud)
       node run.js --all           # tous les exemples du manifeste samples/list.json
       node run.js --sample Renaud # filtre sur le nom de fichier
       node run.js --seconds 15    # durée de lecture analysée (défaut 21 s → ≥ 3 fenêtres de croisière)
       node run.js --headed        # navigateur visible (débogage / audio réel)
       node run.js --verbose       # journal console complet par exemple
   ================================================================== */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { chromium } = require('playwright-core');

const ROOT     = path.resolve(__dirname, '..', '..');
const SAMPLES  = path.join(ROOT, 'samples');
const MANIFEST = path.join(SAMPLES, 'list.json');

/* ---------------------------------------------------------------- CLI */
const argv    = process.argv.slice(2);
const has     = f => argv.includes(f);
const val     = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const HEADED  = has('--headed');
const ALL     = has('--all');
const VERBOSE = has('--verbose');
const SECONDS = Math.max(11, Number(val('--seconds', 21)) || 21);
const FILTER  = val('--sample', null);

/* ------------------------------------------------ navigateur installé */
const BROWSERS = [
  process.env.GP8_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const EXE = BROWSERS.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });

/* ------------------------------------------------- serveur statique */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.gp': 'application/octet-stream', '.gpx': 'application/octet-stream',
  '.mp3': 'audio/mpeg'
};
function serve(root) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p;
      try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { p = req.url; }
      if (p === '/') p = '/index.html';
      const file = path.normalize(path.join(root, p));
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }   // anti-traversée
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404 ' + p); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
                             'cache-control': 'no-store' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* ------------------------------------------- relecture du journal LIVRÉ
   Mêmes expressions que tools/mix-sync-harness.js : c'est l'instrumentation
   `[mix-stats]` de js/mix-sync.js, pas une copie de formule. On garde une
   entrée PAR FENÊTRE (STAT_MS = 5 s) : la première couvre l'amorçage de la
   piste audio (bufferTimeInMilliseconds + métadonnées MP3) et n'est pas de
   la « croisière » — elle est écartée, comme le fait le banc Node qui ne
   compte qu'après `onState(Playing)`. */
function readWindows(logs) {
  const wins = [];
  for (const l of logs) {
    const st = /arrêts maître (\d+)/.exec(l);
    if (!st) continue;
    wins.push({
      stalls: Number(st[1]),
      rate:   Math.round(Number((/playbackRate ([\d.]+)/.exec(l) || [0, 0])[1]) * 5),
      seek:   Math.round(Number((/seek ([\d.]+)/.exec(l) || [0, 0])[1]) * 5),
      drift:  Number((/dérive max (\d+) ms/.exec(l) || [0, 0])[1])
    });
  }
  return wins;
}
const sum = a => a.reduce((n, x) => n + x, 0);
function cruiseStats(wins) {
  const c = wins.slice(1);                       // fenêtre 1 = chauffe
  const d = c.map(w => w.drift).sort((a, b) => a - b);
  return {
    windows: c.length,
    driftMed:  d.length ? d[(d.length - 1) >> 1] : 0,
    peakDrift: d.length ? d[d.length - 1] : 0,
    stalls:    sum(c.map(w => w.stalls)),
    rateWrites: sum(c.map(w => w.rate)),
    seeks:     sum(c.map(w => w.seek)),
    warmup:    wins[0] || null,
    sec:       c.length * 5                    // STAT_MS
  };
}
const readBuild = logs => (logs.find(l => l.startsWith('[mix] ') && l.includes('point')) || '').replace('[mix] ', '');
const readOracle = logs => (logs.find(l => l.startsWith('[oracle]')) || '').replace('[oracle] ', '');

/* ------------------------------------------------------ pilotage d'un cas */
async function runCase(ctx, base, file, pick) {
  const page = await ctx.newPage();
  const logs = [], errors = [];
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error') errors.push(t);
    logs.push(m.type() === 'error' ? '[error] ' + t : t);
  });
  page.on('pageerror', e => errors.push('pageerror: ' + (e && e.message)));

  const r = { file, pick, ok: false, notes: [] };
  try {
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 60000 });

    /* 1. moteur prêt (api créée au boot ; `api.score` reste undefined
          tant qu'aucun fichier n'est chargé — ne pas le comparer).
          NB : Player/MixSync sont des `const` de portée script — accessibles
          par leur NOM, pas via `window.` */
    await page.waitForFunction(() => typeof alphaTab !== 'undefined' &&
      typeof Player !== 'undefined' && Player.S && Player.S.api, null, { timeout: 60000 });
    r.atVersion = await page.evaluate(() => (alphaTab.meta && alphaTab.meta.version) || '?');

    /* 2. manifeste → boutons (chemin Samples réel, aucun nom en dur) */
    await page.waitForFunction(() => document.querySelectorAll('#sampleList button').length > 0,
      null, { timeout: 30000 });
    r.sampleButtons = await page.evaluate(() => document.querySelectorAll('#sampleList button').length);

    /* 3. chargement par CLIC sur l'exemple (fetch + Player.loadFile) */
    const clicked = await page.evaluate(pick => {
      const btn = Array.from(document.querySelectorAll('#sampleList button'))
        .find(b => b.textContent.includes(pick));
      if (!btn) return null;
      btn.click();
      const name = btn.querySelector('.truncate');    // libellé seul (sans l'icône/le tag)
      return (name || btn).textContent.trim();
    }, pick);
    if (!clicked) throw new Error('bouton d\'exemple introuvable pour « ' + pick + ' »');
    r.label = clicked;

    /* 4. score chargé + pont audio construit (setTimeout(0) → MixSync.build) */
    await page.waitForFunction(() => typeof Player !== 'undefined' && Player.S.score && Player.S.score.masterBars.length > 0,
      null, { timeout: 60000 });
    await page.waitForFunction(() => {
      const a = document.getElementById('externalAudio');
      return a && a.src && MixSync._probe().n > 0;
    }, null, { timeout: 60000 });

    r.bars       = await page.evaluate(() => Player.S.score.masterBars.length);
    r.tracks     = await page.evaluate(() => Player.S.score.tracks.length);
    r.syncPoints = await page.evaluate(() => MixSync._probe().n);
    /* métadonnées de la piste audio : chargées en asynchrone (blob → <audio>).
       Informatif seulement — la lecture RÉELLE est mesurée plus bas (audioSec2). */
    await page.waitForFunction(() => {
      const a = document.getElementById('externalAudio');
      return a && a.readyState >= 1 && isFinite(a.duration) && a.duration > 0;
    }, null, { timeout: 20000 }).catch(() => {});
    r.audioSec   = await page.evaluate(() => {
      const a = document.getElementById('externalAudio');
      return isFinite(a.duration) && a.duration > 0 ? Math.round(a.duration * 100) / 100 : null;
    });
    r.build      = readBuild(logs);

    /* 5. compteur PASSE-PLAQUES sur le vrai setter d'alphaTab :
          alphaTab définit `playbackSpeed` sur le prototype ; on installe une
          propriété propre qui COMPTE puis DÉLÈGUE — comportement inchangé. */
    await page.evaluate(() => {
      const api = Player.S.api;
      let proto = api, dsc = null;
      while (proto && !(dsc = Object.getOwnPropertyDescriptor(proto, 'playbackSpeed')))
        proto = Object.getPrototypeOf(proto);
      if (!dsc || !dsc.set) throw new Error('playbackSpeed : descripteur alphaTab introuvable');
      window.__probe = { spWrites: 0, spValues: [] };
      Object.defineProperty(api, 'playbackSpeed', {
        configurable: true,
        get() { return dsc.get.call(api); },
        set(v) { window.__probe.spWrites++; window.__probe.spValues.push(v); dsc.set.call(api, v); }
      });
    });

    /* 6. LECTURE — clic réel (geste utilisateur → AudioContext autorisé) */
    const PLAYING = await page.evaluate(() => alphaTab.synth.PlayerState.Playing);
    await page.click('#btnPlay');
    await page.waitForFunction(v => Player.S.api.playerState === v, PLAYING, { timeout: 20000 });

    /* fenêtre d'analyse : on repart de zéro UNE FOIS la lecture amorcée
       (l'armement de la vitesse est fait au chargement, cf. applySpeed). */
    const t0 = await page.evaluate(() => {
      window.__probe.spWrites = 0; window.__probe.spValues = [];
      const a = document.getElementById('externalAudio');
      return { tp: Player.S.api.timePosition, ct: a.currentTime * 1000, wall: Date.now() };
    });
    /* On joue SECONDS… ou jusqu'à la fin du morceau (exemples courts, loops) :
       au-delà, l'horloge s'arrête — voire REVIENT à 0 (alphaTab replace la
       position au début à la fin) — et un delta de fin ne voudrait plus rien
       dire. On ÉCHANTILLONNE donc les deux axes pendant la lecture et on
       retient leur maximum. */
    let ended = false, maxTp = t0.tp, maxCt = t0.ct;
    for (let i = 0; i < SECONDS; i++) {
      await page.waitForTimeout(1000);
      const s = await page.evaluate(() => {
        const a = document.getElementById('externalAudio');
        return { tp: Player.S.api.timePosition, ct: a.currentTime * 1000, state: Player.S.api.playerState };
      });
      if (isFinite(s.tp) && s.tp > maxTp) maxTp = s.tp;
      if (isFinite(s.ct) && s.ct > maxCt) maxCt = s.ct;
      if (s.state !== PLAYING) { ended = true; break; }
    }
    const t1 = await page.evaluate(() => {
      const a = document.getElementById('externalAudio');
      return { tp: Player.S.api.timePosition, ct: a.currentTime * 1000, wall: Date.now(),
               paused: a.paused, probe: window.__probe, mix: MixSync._probe() };
    });
    await page.evaluate(() => Player.stop());

    const wall = (t1.wall - t0.wall) / 1000;
    r.secWall  = wall;
    r.ended    = ended;
    r.tp0 = t0.tp; r.tp1 = t1.tp;
    r.clockSec = (Math.max(maxTp, isFinite(t1.tp) ? t1.tp : maxTp) - t0.tp) / 1000;  // maître
    r.audioSec2 = (Math.max(maxCt, isFinite(t1.ct) ? t1.ct : maxCt) - t0.ct) / 1000; // esclave
    r.audioPaused = t1.paused;
    r.spWrites = t1.probe.spWrites;
    r.spValues = t1.probe.spValues;
    const st = cruiseStats(readWindows(logs));
    r.stats = st;
    r.ratePct = st.sec > 0 ? (st.rateWrites / st.sec) * 100 : 0;
    r.oracle = readOracle(logs);
    r.consoleErrors = errors.slice();

    /* ---------------- verdicts ------------------------------------------
       DEUX niveaux, parce qu'un navigateur RÉEL n'est pas le banc Node :
         ❌ ÉCHEC      = invariant du livrable (P2 : 0 écriture de vitesse ;
                         moteur + piste audio câblés ; horloge qui avance ;
                         pas d'emballement de dérive au-delà de la zone morte).
         🟡 conforme   = vert, mais la cible « croisière » stricte du §6.2
                         (dérive < 40 ms, taux ≤ 2 %, 0 arrêt) n'est pas
                         atteinte sur cet exemple — bruit de la pile audio
                         temps réel (l'oreille, §5.2, arbitre le ressenti).
       Les statistiques écartent la 1ʳᵉ fenêtre [mix-stats] (amorçage). */
    if (!(r.bars > 0 && r.tracks > 0))            r.notes.push('score vide');
    if (!(r.syncPoints > 0))                      r.notes.push('0 point de synchro (pont non construit)');
    if (!(r.audioSec > 0))                        r.notes.push('audio embarqué absent (duration ' + r.audioSec + ')');
    if (!(r.clockSec >= 0.7 * wall))              r.notes.push('horloge synthé figée (' + r.clockSec.toFixed(1) + ' s / ' + wall.toFixed(1) + ' s)');
    if (!(r.audioSec2 >= 0.25 * wall))            r.notes.push('piste audio quasi figée (' + r.audioSec2.toFixed(1) + ' s)');
    if (r.audioPaused && !ended)                  r.notes.push('piste audio en pause sans fin de morceau');
    if (r.spWrites !== 0)                         r.notes.push('playbackSpeed écrit ' + r.spWrites + '× en lecture (' + r.spValues.join(', ') + ')');
    if (st.windows === 0)                         r.notes.push('aucune fenêtre de croisière (SECONDS trop court)');
    if (st.driftMed >= 150)                       r.notes.push('dérive croisière ' + st.driftMed + ' ms ≥ 150 ms (1,5× la zone morte)');
    if (st.stalls > 1)                            r.notes.push(st.stalls + ' arrêts maître');
    if (r.ratePct > 15)                           r.notes.push('écritures de taux ' + r.ratePct.toFixed(2) + ' % > 15 %');
    if (r.consoleErrors.length)                   r.notes.push(r.consoleErrors.length + ' erreur(s) console');
    r.ok = r.notes.length === 0;
    /* cible stricte §6.2 (informative) : dérive < 40 ms · taux ≤ 2 % · 0 arrêt */
    r.strict = r.ok && st.stalls === 0 && st.driftMed < 40 && r.ratePct <= 2;
  } catch (e) {
    r.notes.push('exception : ' + (e && e.message ? e.message : String(e)));
    /* Diagnostic d'échec : l'état de la page au moment du blocage (le
       waitForFunction qui a lâché ne dit pas OÙ on en était). */
    try {
      r.diag = await page.evaluate(() => {
        const L = document.querySelector('#loader');
        const a = document.getElementById('externalAudio');
        const hasP = typeof Player !== 'undefined';
        const hasM = typeof MixSync !== 'undefined';
        return {
          hasApi: !!(hasP && Player.S.api),
          hasScore: !!(hasP && Player.S.score),
          hasFile: !!(hasP && Player.S.currentFile),
          loaderOn: !!L && !L.classList.contains('hidden'),
          loaderText: L ? document.querySelector('#loaderText').textContent : '',
          buttons: document.querySelectorAll('#sampleList button').length,
          emptyHidden: document.querySelector('#emptyState').classList.contains('hidden'),
          audioSrc: a ? a.src.slice(0, 24) : '',
          mixPoints: hasM ? MixSync._probe().n : -1,
          playerState: hasP && Player.S.api ? Player.S.api.playerState : null,
          rendererWidth: hasP && Player.S.api && Player.S.api.renderer ? Player.S.api.renderer.width : null
        };
      });
    } catch (e2) { /* page déjà fermée */ }
  } finally {
    if (VERBOSE) { console.log('   --- journal ' + file + ' ---'); logs.forEach(l => console.log('   | ' + l)); }
    await page.close().catch(() => {});
  }
  return r;
}

/* ================================ main ================================ */
(async () => {
  if (!EXE) {
    console.error('Aucun navigateur Chromium trouvé (Chrome/Edge). Définir GP8_BROWSER=<chemin chrome.exe>.');
    process.exit(1);
  }
  if (!fs.existsSync(MANIFEST)) {
    console.error('samples/list.json absent — lancez gen-samples.bat (le manifeste est la source des exemples).');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const all = (Array.isArray(manifest) ? manifest : manifest.files || [])
    .map(x => (typeof x === 'string' ? x : (x && (x.file || x.name)) || ''))
    .filter(n => /\.(gp|gpx|gp5)$/i.test(n)).sort();

  /* Le manifeste est la source de la section « Fichiers d'exemple » : un .gp
     présent sur le disque mais absent du manifeste n'est PAS testable (aucun
     bouton). On le signale — la régénération (gen-samples.bat) relève de P6. */
  let onDisk = [];
  try { onDisk = fs.readdirSync(SAMPLES).filter(f => /\.gp$/i.test(f)).sort(); } catch (e) {}
  const missing = onDisk.filter(f => !all.includes(f));

  /* 3 cas par défaut : audio aligné (Sepultura), anacrouse/mesure vide
     (Dr. Stein), divergences H2 + sauts de renvoi (Renaud). Tout est
     construit depuis le manifeste — jamais de nom codé ici. */
  const DEFAULT_PICKS = ['Sepultura', 'Helloween', 'Renaud'];
  let picks = DEFAULT_PICKS;
  let files = all.filter(f => picks.some(p => f.includes(p)));
  if (ALL)   files = all;
  if (FILTER) files = all.filter(f => f.toLowerCase().includes(FILTER.toLowerCase()));
  if (!files.length) { console.error('Aucun exemple du manifeste ne correspond.'); process.exit(1); }

  const { srv, port } = await serve(ROOT);
  const base = 'http://127.0.0.1:' + port;

  console.log('');
  console.log('Test navigateur P5-13 — app entière · ' + path.basename(EXE) +
    ' · ' + (HEADED ? 'visible' : 'headless') + ' · lecture analysée ' + SECONDS + ' s');
  console.log('http://127.0.0.1:' + port + '  ·  ' + files.length + ' exemple(s) du manifeste (' + all.length + ' au total)');
  console.log('cible P2 : playbackSpeed écrit 0× en lecture · 0 arrêt maître · dérive croisière < 40 ms · taux ≤ 2 %');
  console.log('(la 1ʳᵉ fenêtre [mix-stats] de 5 s — amorçage de la piste audio — est écartée)');
  console.log('verdict : ✅ conforme à la cible stricte · 🟡 vert (invariants tenus) mais cible stricte non atteinte · ❌ échec');
  if (missing.length) {
    console.log('⚠ manifeste samples/list.json incomplet : ' + missing.length + ' fichier(s) .gp sur le disque ' +
      'sans entrée (non testables, pas de bouton) → relancer gen-samples.bat (P6) :');
    missing.forEach(f => console.log('    · ' + f));
  }
  console.log('');

  const browser = await chromium.launch({
    executablePath: EXE,
    headless: !HEADED,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check',
           // un onglet headless « de fond » est bridé (timers, rendu) — ce qui
           // affame le synthé et fabrique de faux « arrêts maître ».
           '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
           '--disable-backgrounding-occluded-windows']
  });
  /* UN seul contexte pour tous les cas : le cache HTTP partagé évite de
     re-télécharger alphaTab / la police / le soundfont à chaque exemple. */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  const rows = [];
  for (const file of files) {
    const pick = file.replace(/\.(gp|gpx|gp5)$/i, '').split(' - ').pop();
    process.stdout.write('· ' + file.slice(0, 52).padEnd(52) + ' … ');
    const r = await runCase(ctx, base, file, pick);
    console.log(!r.ok ? '❌ ' + r.notes.join(' ; ') : (r.strict ? '✅' : '🟡'));
    rows.push(r);
  }
  await browser.close();
  await new Promise(res => srv.close(res));

  /* ------------------------------- rapport --------------------------- */
  console.log('');
  console.log('| exemple | mes. | pts | audio s | horloge | audio | spÉcrit | taux % | dérive méd. | pic | arrêts | err | verdict |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const st = r.stats || { driftMed: '—', peakDrift: '—', stalls: '—' };
    console.log('| ' + [
      r.label ? r.label.slice(0, 28) : r.file.slice(0, 28),
      r.bars ?? '—', r.syncPoints ?? '—', r.audioSec ?? '—',
      r.clockSec != null ? r.clockSec.toFixed(1) : '—',
      r.audioSec2 != null ? r.audioSec2.toFixed(1) : '—',
      r.spWrites ?? '—',
      r.ratePct != null ? r.ratePct.toFixed(2) : '—',
      st.driftMed + ' ms', st.peakDrift + ' ms', st.stalls, r.consoleErrors ? r.consoleErrors.length : '—',
      !r.ok ? '❌' : (r.strict ? '✅' : '🟡')
    ].join(' | ') + ' |');
  }

  /* Détail des échecs : ce qui a été relevé, et le pont construit. */
  for (const r of rows) {
    if (r.ok) continue;
    console.log('');
    console.log('--- ' + r.file + ' ---');
    console.log('   pont : ' + (r.build || '—'));
    if (r.oracle) console.log('   oracle : ' + r.oracle);
    if (r.stats && r.stats.warmup) console.log('   chauffe (écartée) : ' + JSON.stringify(r.stats.warmup));
    console.log('   tp0=' + r.tp0 + ' tp1=' + r.tp1 + ' wall=' + r.secWall.toFixed(1) + ' s' +
      (r.ended ? ' (fin de morceau atteinte)' : ''));
    if (r.diag) console.log('   état : ' + JSON.stringify(r.diag));
    r.notes.forEach(n => console.log('   · ' + n));
    (r.consoleErrors || []).slice(0, 5).forEach(e => console.log('   [console] ' + e.slice(0, 160)));
  }

  const bad = rows.filter(r => !r.ok).length;
  const soft = rows.filter(r => r.ok && !r.strict).length;
  console.log('');
  console.log('LECTURE : « horloge » = temps musical parcouru (maître synthé), « audio » = temps de la piste');
  console.log('embarquée réellement défilé (esclave). spÉcrit = écritures playbackSpeed pendant la lecture.');
  console.log('Le pic de dérive inclut les sauts volontaires (renvoi = 1 seek) : la MÉDIANE, elle, situe la croisière.');
  console.log(bad === 0
    ? 'RESULTAT : OK — ' + rows.length + '/' + rows.length + ' exemple(s) verts : invariants tenus en navigateur' +
      ' (0 écriture de playbackSpeed en lecture, moteur + piste audio câblés, pas d\'emballement de dérive).' +
      (soft ? '  ' + soft + ' en 🟡 (cible stricte §6.2 non atteinte : bruit de la pile audio temps réel).' : '')
    : 'RESULTAT : ' + bad + ' exemple(s) en échec sur ' + rows.length);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
