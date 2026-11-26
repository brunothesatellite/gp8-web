'use strict';
/* ==================================================================
   tools/browser/p1-check.js — P1 : plan GPIF + synchro des seeks tardifs
   ------------------------------------------------------------------
   Vérifie dans Chrome réel, sur des zones où le déroulé alphaTab divergeait
   de Guitar Pro, que :

     1. `gotoBar()` place l'audio sur le PREMIER point GPIF de la mesure ;
     2. la lecture continue ensuite sans erreur console ;
     3. l'audio avance réellement (pas de seek bloqué).

   Cas couverts : AC/DC M.30, Mr. Moustache M.27, Renaud M.38.
   Hors tools/test-all.js (Playwright requis). Usage :
       cd tools/browser && npm run test:p1
   ================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.gp': 'application/octet-stream', '.mp3': 'audio/mpeg'
};
const BROWSERS = [
  process.env.GP8_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const EXE = BROWSERS.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });

function serve(root) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p;
      try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { p = req.url; }
      if (p === '/') p = '/index.html';
      const file = path.resolve(path.join(root, p));
      if (!file.startsWith(path.resolve(root))) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404).end('404'); return; }
        res.writeHead(200, {
          'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-store'
        });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

const CASES = [
  { sample: 'ACDC', bar: 29, bars: 43, label: 'AC/DC M.30' },        // index 29 = M.30
  { sample: 'Mr. Moustache', bar: 26, bars: 45, label: 'Mr. Moustache M.27' },
  { sample: 'Mr. Moustache', bar: 31, bars: 45, label: 'Mr. Moustache M.32 (D.S.)' },
  { sample: 'Renaud', bar: 37, bars: 50, label: 'Renaud M.38' }
];

(async () => {
  if (!EXE) { console.error('Aucun navigateur Chromium trouvé (GP8_BROWSER).'); process.exit(1); }
  const { srv, port } = await serve(ROOT);
  const browser = await chromium.launch({
    executablePath: EXE, headless: true,
    args: ['--autoplay-policy=no-user-gesture-required',
           '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  let failed = 0;
  const check = (ok, label, detail) => {
    console.log((ok ? '  ✅ ' : '  ❌ ') + label + (detail ? ' — ' + detail : ''));
    if (!ok) failed++;
  };

  try {
    await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => typeof Player !== 'undefined' && Player.S.api, null, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('#sampleList button').length > 0, null, { timeout: 30000 });

    for (const c of CASES) {
      const loaded = await page.evaluate(arg => {
        const f = Player.S.currentFile;
        return !!(f && f.name && f.name.includes(arg[0]) &&
          Player.S.score && Player.S.score.masterBars.length === arg[1]);
      }, [c.sample, c.bars]);
      if (!loaded) {
        await page.evaluate(sample => {
          const b = Array.from(document.querySelectorAll('#sampleList button'))
            .find(x => x.textContent.includes(sample));
          if (!b) throw new Error('sample introuvable : ' + sample);
          b.click();
        }, c.sample);
        await page.waitForFunction(arg => {
          const sample = arg[0], bars = arg[1];
          const f = Player.S.currentFile;
          return f && f.name && f.name.includes(sample) &&
            Player.S.score && Player.S.score.masterBars.length === bars &&
            MixSync._probe().n > 0;
        }, [c.sample, c.bars], { timeout: 60000 });
      }
      await page.waitForFunction(() => {
        const a = AudioSync.element;
        return a && a.readyState >= 1 && isFinite(a.duration) && a.duration > 0;
      }, null, { timeout: 30000 }).catch(() => {});

      const r = await page.evaluate(bar => {
        const st = Player.S;
        const mbs = st.score.masterBars;
        const gps = (mbs[bar].syncPoints || [])
          .map(s => s.syncPointValue.millisecondOffset)
          .filter(isFinite).sort((a, b) => a - b);
        st.currentBar = 0;
        Player.gotoBar(bar);
        return { expected: gps.length ? gps[0] / 1000 : null, perf: Player.perfStartOfBar(bar) };
      }, c.bar);
      await page.waitForTimeout(800);
      const a = await page.evaluate(() => {
        const el = AudioSync.element;
        return { ct: el.currentTime, target: MixSync._probe().target, label: document.querySelector('#barLabel').textContent };
      });
      check(r.expected != null, c.label + ' : point GPIF disponible', r.expected == null ? 'aucun' : r.expected.toFixed(3) + ' s');
      if (r.expected != null) {
        check(Math.abs(a.ct - r.expected) < 0.15, c.label + ' : audio sur le GPIF',
          'ct=' + a.ct.toFixed(3) + 's gp=' + r.expected.toFixed(3) + 's');
        check(Math.abs(a.target - r.expected) < 0.15, c.label + ' : cible du pont',
          'cible=' + a.target.toFixed(3) + 's');
      }
      check(/M\./.test(a.label), c.label + ' : libellé mesure', a.label);

      await page.click('#btnPlay');
      await page.waitForTimeout(3000);
      const play = await page.evaluate(() => {
        const el = AudioSync.element;
        return { state: Player.S.api.playerState, ct: el.currentTime, paused: el.paused };
      });
      check(play.state === 1 && !play.paused && play.ct > 0.5, c.label + ' : lecture continue',
        'state=' + play.state + ' ct=' + play.ct.toFixed(2) + 's');
      await page.evaluate(() => Player.stop());
      await page.waitForTimeout(250);
    }

    check(errors.length === 0, 'aucune erreur console', errors.slice(0, 3).join(' | '));
  } catch (e) {
    failed++;
    console.error('  ❌ exception : ' + (e && e.message ? e.message : e));
  } finally {
    await browser.close();
    await new Promise(r => srv.close(r));
  }

  console.log('');
  console.log(failed === 0 ? 'RESULTAT P1 : OK' : 'RESULTAT P1 : ' + failed + ' échec(s)');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
