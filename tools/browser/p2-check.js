'use strict';
/* ==================================================================
   tools/browser/p2-check.js — P2 : AudioBufferSourceNode, horloge unique
   ------------------------------------------------------------------
   Vérifie dans Chrome réel :

     1. `AudioSync.element.isBufferEngine` (plus de <audio> maître) ;
     2. dérive de croisière < 20 ms après calibration ;
     3. 0 écriture de `playbackRate` et 0 seek de correction en régime établi ;
     4. vitesse utilisateur ×0,5 / ×1,5 : le taux suit et la dérive reste < 50 ms.

   Hors tools/test-all.js (Playwright requis). Usage :
       cd tools/browser && npm run test:p2
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
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('#sampleList button'))
        .find(x => x.textContent.includes('Mr. Moustache'));
      if (!b) throw new Error('sample introuvable');
      b.click();
    });
    await page.waitForFunction(() => Player.S.score && MixSync._probe().n > 0, null, { timeout: 60000 });
    await page.waitForFunction(() => AudioSync.element.readyState === 4, null, { timeout: 30000 });

    /* compteurs sur la façade AudioSync (pas le DOM <audio>) */
    await page.evaluate(() => {
      const a = AudioSync.element;
      const rd = Object.getOwnPropertyDescriptor(a, 'playbackRate');
      const cd = Object.getOwnPropertyDescriptor(a, 'currentTime');
      window.__p2 = { rates: 0, seeks: 0 };
      Object.defineProperty(a, 'playbackRate', {
        configurable: true,
        get() { return rd.get.call(a); },
        set(v) { window.__p2.rates++; rd.set.call(a, v); }
      });
      Object.defineProperty(a, 'currentTime', {
        configurable: true,
        get() { return cd.get.call(a); },
        set(v) { window.__p2.seeks++; cd.set.call(a, v); }
      });
    });

    await page.click('#btnPlay');
    await page.waitForTimeout(2600);              // laisse la calibration de démarrage
    await page.evaluate(() => { window.__p2.rates = 0; window.__p2.seeks = 0; });
    await page.waitForTimeout(5000);              // régime établi

    const a = await page.evaluate(() => {
      const el = AudioSync.element;
      const p = MixSync._probe();
      return {
        buffer: el.isBufferEngine,
        drift: (el.currentTime - p.target) * 1000,
        bias: p.bias,
        calibrated: p.biasCalibrated,
        rate: el.playbackRate,
        writes: window.__p2
      };
    });
    check(a.buffer === true, 'AudioSync.element = AudioBufferSourceNode');
    check(a.calibrated === true, 'calibration de démarrage effectuée', 'bias=' + a.bias.toFixed(1) + ' ms');
    check(Math.abs(a.drift) < 20, 'dérive de croisière < 20 ms', a.drift.toFixed(1) + ' ms');
    check(a.writes.rates === 0, '0 écriture playbackRate en régime établi', String(a.writes.rates));
    check(a.writes.seeks === 0, '0 seek de correction en régime établi', String(a.writes.seeks));

    for (const v of [0.5, 1.5, 1.0]) {
      await page.evaluate(x => Player.setSpeed(x), v);
      await page.waitForTimeout(2200);
      await page.evaluate(() => { window.__p2.rates = 0; window.__p2.seeks = 0; });
      await page.waitForTimeout(1200);
      const s = await page.evaluate(() => {
        const el = AudioSync.element;
        const p = MixSync._probe();
        return { rate: el.playbackRate, drift: (el.currentTime - p.target) * 1000, writes: window.__p2 };
      });
      check(Math.abs(s.rate - v) < 0.01, 'vitesse ×' + v + ' appliquée au média', 'rate=' + s.rate.toFixed(3));
      check(Math.abs(s.drift) < 50, 'dérive à ×' + v + ' < 50 ms', s.drift.toFixed(1) + ' ms');
    }

    check(errors.length === 0, 'aucune erreur console', errors.slice(0, 3).join(' | '));
    await page.evaluate(() => Player.stop());
  } catch (e) {
    failed++;
    console.error('  ❌ exception : ' + (e && e.message ? e.message : e));
  } finally {
    await browser.close();
    await new Promise(r => srv.close(r));
  }

  console.log('');
  console.log(failed === 0 ? 'RESULTAT P2 : OK' : 'RESULTAT P2 : ' + failed + ' échec(s)');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
