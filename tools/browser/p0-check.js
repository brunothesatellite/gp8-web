'use strict';
/* ==================================================================
   tools/browser/p0-check.js — P0 : ticks partition→performance, seeks/loop
   ------------------------------------------------------------------
   Vérifie dans un Chrome réel, sur le sample « Mr. Moustache » (45 mesures,
   reprises/voltes), les invariants P0 :

     1. `Player.perfStartOfBar(26)` ≠ `masterBars[26].start` (la traduction
        partition→performance est indispensable) ;
     2. `Player.gotoBar(26)` positionne `api.tickPosition` sur le tick
        performance et l'audio sur `MixSync._probe().target` (±150 ms) ;
     3. `Player.setLoopRange(11,12)` produit une plage en ticks performance
        (`perfStartOfBar(11)` → `perfEndOfBar(12)`) et les listes A/B
        affichent bien 12/13.

   Ce test est volontairement HORS de tools/test-all.js (il exige
   playwright-core et un navigateur installé). Usage :
       cd tools/browser && npm run test:p0
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
      if (!b) throw new Error('sample Mr. Moustache introuvable');
      b.click();
    });
    await page.waitForFunction(() => Player.S.score && MixSync._probe().n > 0, null, { timeout: 60000 });
    await page.waitForFunction(() => {
      const a = AudioSync.element;
      return a && a.readyState >= 1 && isFinite(a.duration) && a.duration > 0;
    }, null, { timeout: 30000 }).catch(() => {});

    const seek = await page.evaluate(() => {
      const st = Player.S;
      const scoreStart = st.score.masterBars[26].start;
      const perf = Player.perfStartOfBar(26);
      st.currentBar = 0;
      Player.gotoBar(26);
      return { scoreStart, perf, tick: st.api.tickPosition, label: document.querySelector('#barLabel').textContent };
    });
    check(seek.perf !== seek.scoreStart, 'M.27 : tick performance ≠ tick partition',
      seek.scoreStart + ' → ' + seek.perf);
    check(seek.tick === seek.perf, 'gotoBar écrit le tick performance', String(seek.tick));
    check(/M\.\s*27\//.test(seek.label), 'libellé M.27', seek.label);

    await page.waitForTimeout(700);
    const audio = await page.evaluate(() => {
      const a = AudioSync.element;
      const p = MixSync._probe();
      return { ct: a.currentTime, target: p.target, label: document.querySelector('#barLabel').textContent };
    });
    check(Math.abs(audio.ct - audio.target) < 0.15, 'audio recalé sur la cible (±150 ms)',
      'ct=' + audio.ct.toFixed(3) + 's cible=' + audio.target.toFixed(3) + 's');
    check(/M\.\s*27\//.test(audio.label), 'libellé M.27 après seek', audio.label);

    const loop = await page.evaluate(() => {
      const es = Player.perfStartOfBar(11), ee = Player.perfEndOfBar(12);
      Player.setLoopRange(11, 12);
      return { es, ee };
    });
    await page.waitForTimeout(700);
    const loopState = await page.evaluate(() => ({
      range: Player.S.api.playbackRange,
      startSel: document.querySelector('#loopStart').value,
      endSel: document.querySelector('#loopEnd').value
    }));
    check(!!loopState.range && loopState.range.startTick === loop.es && loopState.range.endTick === loop.ee,
      'boucle A/B en ticks performance',
      JSON.stringify(loopState.range) + ' attendu ' + loop.es + '→' + loop.ee);
    check(loopState.startSel === '11' && loopState.endSel === '12', 'listes A/B = 12 et 13',
      loopState.startSel + '/' + loopState.endSel);

    check(errors.length === 0, 'aucune erreur console', errors.slice(0, 2).join(' | '));
  } catch (e) {
    failed++;
    console.error('  ❌ exception : ' + (e && e.message ? e.message : e));
  } finally {
    await browser.close();
    await new Promise(r => srv.close(r));
  }

  console.log('');
  console.log(failed === 0 ? 'RESULTAT P0 : OK' : 'RESULTAT P0 : ' + failed + ' échec(s)');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
