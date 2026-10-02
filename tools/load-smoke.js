'use strict';
/* ==================================================================
   tools/load-smoke.js — vérification de chargement (aucun navigateur)
   ------------------------------------------------------------------
   Reprend la réalité d'un <head>/fin de <body> : les fichiers de js/
   sont évalués l'un APRES l'autre, comme autant de <script classique>
   partageant le même contexte global (const CFG, AT, $, Player, App…).

   Le test échoue dès qu'un fichier lève une exception au chargement,
   ou si un binding attendu n'existe pas ensuite. Il attrape donc :
     · ordre des <script> inversé dans index.html
     · binding déplacé/déclaré deux fois (SyntaxError)
     · code exécuté au chargement qui dépend d'un fichier non chargé

   Usage :  node tools/load-smoke.js
   ================================================================== */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.resolve(__dirname, '..');

/* --- ordre EXACT des <script src="js/..."> de index.html ------------ */
const ORDER = [
  'js/core.js',
  'js/audio-sync.js',
  'js/embedded-audio.js',
  'js/mix-sync.js',
  'js/repeat-oracle.js',
  'js/player.js',
  'js/samples.js',
  'js/app.js'
];

/* --- DOM minimal : tout ce qui pourrait être touché au chargement ---- */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    nodeType: 1,
    style: {},
    dataset: {},
    classList: {
      _s: new Set(),
      add(...c)    { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c)    { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      contains(c)  { return this._s.has(c); }
    },
    children: [],
    attributes: {},
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    disabled: false,
    width: 0,
    height: 0,
    offsetWidth: 0,
    offsetHeight: 0,
    scrollWidth: 0,
    scrollHeight: 0,
    clientWidth: 0,
    clientHeight: 0,
    paused: true,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    play()      { return Promise.resolve(); },
    pause()     {},
    load()      {},
    canPlayType(){ return ''; },
    appendChild(c)     { this.children.push(c); return c; },
    append(...c)       { this.children.push(...c); },
    insertBefore(c)    { this.children.push(c); return c; },
    removeChild(c)     { return c; },
    remove()           {},
    replaceChildren()  { this.children.length = 0; },
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k)    { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
    removeAttribute(k) { delete this.attributes[k]; },
    hasAttribute(k)    { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
    addEventListener()    {},
    removeEventListener() {},
    dispatchEvent()    { return true; },
    querySelector()    { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() {
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    focus() {}, blur() {}, click() {}, select() {}, scrollIntoView() {},
    getContext() { return null; },
    toDataURL() { return 'data:,'; }
  };
  return el;
}

function makeDocument() {
  const doc = {
    nodeType: 9,
    readyState: 'loading',
    documentElement: makeEl('html'),
    head: makeEl('head'),
    body: makeEl('body'),
    createElement: t => makeEl(t),
    createElementNS: (ns, t) => makeEl(t),
    createTextNode: t => ({ nodeType: 3, textContent: t }),
    createDocumentFragment: () => makeEl('#fragment'),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    write() {},
    location: null
  };
  return doc;
}

/* --- contexte global ------------------------------------------------ */
function buildSandbox() {
  const doc = makeDocument();
  const sandbox = {
    console,
    document: doc,
    location: { protocol: 'http:', href: 'http://localhost/', pathname: '/', search: '' },
    navigator: { userAgent: 'load-smoke', language: 'fr-FR', onLine: true },
    history: { pushState() {}, replaceState() {} },

    // réseau : on n'appelle JAMAIS le réseau au chargement ; toute tentative
    // par le test doit échouer bruyamment plutôt que de faire semblant.
    fetch: () => Promise.reject(new Error('réseau indisponible dans load-smoke')),
    XMLHttpRequest: function () { throw new Error('XHR interdit dans load-smoke'); },
    DOMParser: function () {
      this.parseFromString = () => ({
        querySelector: () => null,
        querySelectorAll: () => [],
        documentElement: makeEl('html')
      });
    },

    Blob: function (parts, opts) { this.parts = parts; this.type = (opts || {}).type; this.size = 0; },
    File: function (parts, name, opts) { this.name = name; this.type = (opts || {}).type; this.size = 0; },
    URL: Object.assign(require('url').URL, { createObjectURL: () => 'blob:smoke', revokeObjectURL() {} }),
    URLSearchParams: require('url').URLSearchParams,
    FormData: function () { this.append = () => {}; },
    Headers: function () { this.get = () => null; },
    Request: function () {},
    Response: function () {},

    Audio: function () { return makeEl('audio'); },
    AudioContext: function () { this.createGain = () => ({ connect() {}, disconnect() {} }); },
    OfflineAudioContext: function () {},
    Worker: function () { this.postMessage = () => {}; this.terminate = () => {}; },

    localStorage: (() => {
      const m = new Map();
      return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k),
        clear: () => m.clear()
      };
    })(),

    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: cb => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: id => clearTimeout(id),
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now(), mark() {}, measure() {} },
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    devicePixelRatio: 1,
    innerWidth: 1440,
    innerHeight: 900,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    isSecureContext: false,
    top: null,
    self: null
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.top = sandbox;
  sandbox.self = sandbox;
  sandbox.location = sandbox.location;
  doc.defaultView = sandbox;
  doc.location = sandbox.location;
  return sandbox;
}

/* --- exécution ------------------------------------------------------ */
function main() {
  const sandbox = buildSandbox();
  const ctx = vm.createContext(sandbox);
  let failed = false;

  /* --- l'ORDRE des <script src="js/..."> de index.html doit être celui
         de ORDER : un tag déplacé casse le partage des bindings globaux. - */
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const tags = [...html.matchAll(/<script\s+src="(js\/[^"]+)"/g)].map(m => m[1]);
  const declared = JSON.stringify(tags);
  const wanted   = JSON.stringify(ORDER);
  if (declared !== wanted) {
    console.log('ORDRE DES SCRIPTS INCOHERENT dans index.html');
    console.log('  index.html : ' + declared);
    console.log('  attendu    : ' + wanted);
    failed = true;
  } else {
    console.log('ordre des <script> de index.html : conforme');
  }
  console.log('');

  for (const rel of ORDER) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
      console.log('MANQUANT  ' + rel);
      failed = true;
      continue;
    }
    const code = fs.readFileSync(file, 'utf8');
    const t0 = Date.now();
    try {
      new vm.Script(code, { filename: rel }).runInContext(ctx, { timeout: 5000 });
      console.log('OK       ' + rel.padEnd(26) + (Date.now() - t0) + ' ms');
    } catch (e) {
      failed = true;
      console.log('ECHEC    ' + rel);
      console.log('         ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n         ') : e));
    }
  }

  /* --- bindings attendus après chargement complet ------------------- */
  const expected = [
    'CFG', 'AT', 'enumId', 'safe', 'clamp', 'fmtTime',
    'AudioSync', 'EmbeddedAudio', 'MixSync', 'RepeatOracle', 'Player', 'Samples', 'App'
  ];
  const missing = expected.filter(n => {
    try { return vm.runInContext('typeof ' + n, ctx) === 'undefined'; }
    catch (e) { return true; }
  });

  console.log('');
  if (missing.length) {
    console.log('BINDINGS MANQUANTS : ' + missing.join(', '));
    failed = true;
  } else {
    console.log('bindings presents : ' + expected.join(', '));
  }

  /* --- App.boot doit être une fonction (branchée sur DOMContentLoaded),
         et Samples.build doit être appelable : c'est lui qui remplit la
         section « Fichiers d'exemple ». ------------------------------- */
  for (const probe of ['typeof App.boot', 'typeof Samples.build']) {
    try {
      const t = vm.runInContext(probe, ctx);
      console.log(probe + ' : ' + t);
      if (t !== 'function') failed = true;
    } catch (e) {
      console.log(probe + ' inaccessible : ' + e.message);
      failed = true;
    }
  }

  console.log('');
  console.log(failed ? 'RESULTAT : ECHEC' : 'RESULTAT : OK');
  process.exit(failed ? 1 : 0);
}

main();
