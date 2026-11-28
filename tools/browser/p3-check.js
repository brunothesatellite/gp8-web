'use strict';
/* ==================================================================
   tools/browser/p3-check.js — P3 : curseur des mesures vides répétées
   ------------------------------------------------------------------
   Vérifie dans Chrome réel que, sur une mesure vide répétée (Mony Mony,
   M.2 x12), le curseur :
     1. avance du début à la fin de la mesure au 1er passage ;
     2. REVIENT au début au 2e passage (au lieu de rester collé à la fin) ;
     3. avance au tempo réellement pré-cuit (la 2e mesure est étirée ×2) ;
     4. revient encore au début au 3e passage.

   Défaut d'origine : alphaTab réutilise le même Beat et les mêmes bounds ;
   au début de la reprise, `startBeatX === previousBeatBounds.onNotesX`, donc
   `placeBeatCursor` est sauté et le curseur reste à la fin. De plus, le
   tickLookup gardait le tempo noté, pas le tempo pré-cuit : le curseur
   atteignait la fin trop tôt sur les mesures étirées.

   Usage :
       cd tools/browser && npm run test:p3
   ================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = process.env.GP8_ROOT || path.resolve(__dirname, '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.gp': 'application/octet-stream',
  '.mp3': 'audio/mpeg'
};
function serve(root) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p; try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { p = req.url; }
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
const BROWSERS = [
  process.env.GP8_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const EXE = BROWSERS.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });

const SAMPLE = 'Mony Mony';
const BAR = 1;                    // M.2 (0-based)
const T0 = 15360;                 // 1re occurrence
const T1 = 19200;                 // 2e occurrence (étirée ×2)
const T2 = 23040;                 // 3e occurrence

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
    await page.waitForFunction(() => document.querySelectorAll('#sampleList button').length >= 18, null, { timeout: 30000 });
    await page.evaluate(sample => {
      const b = Array.from(document.querySelectorAll('#sampleList button'))
        .find(x => x.textContent.includes(sample));
      if (!b) throw new Error('sample introuvable : ' + sample);
      b.click();
    }, SAMPLE);
    await page.waitForFunction(() => {
      const f = Player.S.currentFile;
      return f && f.name && f.name.includes('Mony Mony') &&
        Player.S.score && Player.S.score.masterBars.length === 39 &&
        MixSync._probe().n > 0;
    }, null, { timeout: 60000 });
    await page.waitForFunction(() => {
      const a = AudioSync.element;
      return a && a.readyState >= 1 && isFinite(a.duration) && a.duration > 0;
    }, null, { timeout: 30000 }).catch(() => {});

    await page.evaluate(bar => { Player.S.currentBar = 0; Player.gotoBar(bar); }, BAR);
    await page.waitForTimeout(500);
    await page.evaluate(() => Player.play());
    await page.waitForFunction(() => Player.S.api.playerState === 1, null, { timeout: 20000 });

    const samples = [];
    for (let i = 0; i < 75; i++) {
      await page.waitForTimeout(100);
      const s = await page.evaluate(() => {
        const beat = document.querySelector('.at-cursor-beat');
        const bar = document.querySelector('.at-cursor-bar');
        const br = beat ? beat.getBoundingClientRect() : null;
        const ar = bar ? bar.getBoundingClientRect() : null;
        return {
          tick: Player.S.api.tickPosition,
          beat: br ? { left: br.left, width: br.width } : null,
          bar: ar ? { left: ar.left, width: ar.width } : null,
          state: Player.S.api.playerState
        };
      });
      if (s.beat && s.bar && s.bar.width > 1) {
        s.rel = (s.beat.left - s.bar.left) / s.bar.width;
        samples.push(s);
      }
      if (s.state !== 1) break;
    }
    await page.evaluate(() => Player.stop());

    const inRange = (a, b) => samples.filter(s => s.tick >= a && s.tick < b);
    const first = inRange(T0, T1);
    const second = inRange(T1, T2);
    const third = inRange(T2, T2 + 3840);
    const near = (v, target, tol) => Math.abs(v - target) <= tol;
    const endRel = first.length ? Math.max(...first.map(s => s.rel)) : NaN;
    const startRel = first.length ? Math.min(...first.map(s => s.rel)) : NaN;

    check(first.length >= 4, 'M.2 1er passage échantillonné', first.length + ' échantillon(s)');
    check(first.length >= 2 && endRel > startRel + 0.3,
      '1er passage : le curseur avance', 'rel ' + startRel.toFixed(2) + ' → ' + endRel.toFixed(2));

    check(second.length >= 3, 'M.2 2e passage échantillonné', second.length + ' échantillon(s)');
    if (second.length) {
      /* Le reset peut arriver 1-2 trames après la frontière : on prend le
         minimum des premiers échantillons, pas le tout premier. */
      const secondStart = Math.min(...second.slice(0, 4).map(s => s.rel));
      check(near(secondStart, startRel, 0.15),
        '2e passage : retour au début', 'rel=' + secondStart.toFixed(2) + ' (début=' + startRel.toFixed(2) + ')');
      const mid = second.find(s => s.tick >= (T1 + T2) / 2) || second[Math.floor(second.length / 2)];
      check(mid.rel > startRel + 0.05 && mid.rel < endRel - 0.08,
        '2e passage : avance au tempo pré-cuit (pas déjà à la fin)', 'mi-rel=' + mid.rel.toFixed(2));
      check(!near(secondStart, endRel, 0.12),
        '2e passage : ne reste pas collé à la fin', 'rel=' + secondStart.toFixed(2) + ' (fin=' + endRel.toFixed(2) + ')');
    }

    check(third.length >= 3, 'M.2 3e passage échantillonné', third.length + ' échantillon(s)');
    if (third.length) {
      const thirdStart = Math.min(...third.slice(0, 4).map(s => s.rel));
      check(near(thirdStart, startRel, 0.15),
        '3e passage : retour au début', 'rel=' + thirdStart.toFixed(2) + ' (début=' + startRel.toFixed(2) + ')');
    }

    /* Toutes les occurrences de M.2 (23 dans le plan), y compris les
       sections lointaines après les sauts. À 350 ms, le curseur doit avoir
       repris au début et progressé, jamais rester collé à la fin. */
    const starts = await page.evaluate(() =>
      Player.S.api.tickCache.masterBars.filter(e => e.masterBar.index === 1).map(e => e.start));
    check(starts.length === 23, '23 occurrences de M.2 dans le plan', starts.length + ' occurrence(s)');
    const badAll = [];
    for (let i = 0; i < starts.length; i++) {
      await page.evaluate(t => { Player.stop(); Player.S.api.tickPosition = t; }, starts[i]);
      await page.waitForTimeout(200);
      await page.evaluate(() => Player.play());
      await page.waitForTimeout(350);
      const s = await page.evaluate(() => {
        const beat = document.querySelector('.at-cursor-beat');
        const bar = document.querySelector('.at-cursor-bar');
        const br = beat ? beat.getBoundingClientRect() : null;
        const ar = bar ? bar.getBoundingClientRect() : null;
        return {
          tick: Player.S.api.tickPosition,
          rel: (br && ar && ar.width > 1) ? (br.left - ar.left) / ar.width : null,
          state: Player.S.api.playerState
        };
      });
      if (s.rel == null || s.rel >= 0.75 || s.state !== 1) {
        badAll.push('#' + i + ' tick=' + Math.round(s.tick) + ' rel=' +
          (s.rel == null ? '?' : s.rel.toFixed(2)) + ' state=' + s.state);
      }
    }
    check(badAll.length === 0, 'toutes les occurrences M.2 repartent du début',
      badAll.length ? badAll.slice(0, 3).join(' | ') : starts.length + '/' + starts.length);
    await page.evaluate(() => Player.stop());

    check(errors.length === 0, 'aucune erreur console', errors.slice(0, 3).join(' | '));
  } catch (e) {
    failed++;
    console.error('  ❌ exception : ' + (e && e.message ? e.message : e));
  } finally {
    await browser.close();
    await new Promise(r => srv.close(r));
  }

  console.log('');
  console.log(failed === 0 ? 'RESULTAT P3 : OK' : 'RESULTAT P3 : ' + failed + ' échec(s)');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
