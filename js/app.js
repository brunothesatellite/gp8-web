/* ==================================================================
   GP8 PLAYER â€” js/app.js
   6. APP â€” Interface, tiroir, glisser-dÃ©poser, raccourcis, boot().
   ------------------------------------------------------------------
   ChargÃ© en <script classique> par index.html, dans l'ordre de l'ancien
   app.js monolithique. Le partage se fait par les bindings lexicographiques
   globaux (CFG, AT, $, safe, Player, Appâ€¦), PAS par des imports : un module
   ES est impossible ici car l'application doit s'ouvrir depuis file://.
   ================================================================== */
'use strict';
  /* ========================= 6. APP =============================== */
  const App = (() => {
    let dragging = false;
    let scrubbing = false;
    const UI_MS = 50;   // barre de progression : 20 Hz suffisent (344 Hz avant)
    const mqDesktop = window.matchMedia('(min-width: 768px)');
/* miroir exact de la condition CSS `@media (min-width:768px) and (min-height:560px)`
   (styles.css) : dès que l'écran est court, « Réglages » se replie. */
const mqShort = window.matchMedia('(max-height: 559px)');
function syncShortViewport() {
  if (mqShort.matches) document.body.classList.remove('adv-open');
}

    /* ---------- toasts ---------- */
    function toast(msg, type = 'info') {
      const colors = {
        info:  'border-sky-500/40 text-sky-200',
        error: 'border-rose-500/50 text-rose-200',
        ok:    'border-emerald-500/40 text-emerald-200'
      };
      const el = document.createElement('div');
      el.className = `rounded-xl border bg-slate-900/95 px-4 py-2.5 text-sm shadow-xl backdrop-blur ${colors[type] || colors.info} opacity-0 transition-opacity duration-200`;
      el.textContent = msg;
      $('#toastBox').appendChild(el);
      requestAnimationFrame(() => el.classList.remove('opacity-true'));
      el.classList.add('opacity-100');
      setTimeout(() => { el.classList.remove('opacity-100'); setTimeout(() => el.remove(), 250); }, 3200);
    }

    /* ---------- loader / empty state ---------- */
    let loaderOn  = false;
    let loaderTmr = null;

    function loader(on, text) {
      loaderOn = !!on;
      $('#loader').classList.toggle('hidden', !on);
      if (text) $('#loaderText').textContent = text;
      if (loaderTmr) { clearTimeout(loaderTmr); loaderTmr = null; }
    }

    /* Garde-fou. Depuis que le loader se relève dès la PREMIÈRE portion peinte
       (`renderer.partialRenderFinished`), le voir encore posé après 12 s ne
       veut plus dire « rendu lent » mais « rien n'a été peint » : soit les
       polices (Bravura) n'arrivent pas (404 sur fontDirectory), soit
       alphaTab a sauté le rendu (`renderer.width === 0` → conteneur mesuré
       à 0, donc masqué/hors flux). On le diagnostique plutot qu'on ne
       l'affirme. */
    function armLoaderWatchdog(label) {
      if (loaderTmr) clearTimeout(loaderTmr);
      loaderTmr = setTimeout(() => {
        loaderTmr = null;
        if (!loaderOn) return;
        loaderOn = false;
        $('#loader').classList.add('hidden');
        const api = Player.S.api;
        const fontsOk  = !!(api && api.uiFacade && api.uiFacade.canRender);
        const atWidth  = api && api.renderer ? api.renderer.width : -1;
        const domWidth = $('#scoreArea').offsetWidth;
        console.warn('[watchdog]', { label, fontsOk, atWidth, domWidth });
        const summary = Player.flushPerf();   // ce qui est fait / ce qui manque
        toast(
          !fontsOk
            ? 'Polices de notation (Bravura) introuvables → rendu bloqué. Vérifiez core.fontDirectory (slash final) et le CDN.'
            : (atWidth === 0 || domWidth === 0
                ? `Rendu sauté : conteneur mesuré à ${domWidth}px × ${atWidth}px (élément masqué ?)`
                : `Chargement jamais terminé (${label}) — ${summary}. Détail en console.`),
          'error');
      }, 12000);
    }

    function hideEmptyState() {
      // #scoreArea n'est JAMAIS masqué : alphaTab mesure sa largeur au render.
      $('#emptyState').classList.add('hidden');
    }
    function showEmptyState() {
      $('#emptyState').classList.remove('hidden');
    }

    /* ---------- score loaded : remplir les UI ---------- */
    /* BPM d'origine du .GP — `score.tempo`, getter alphaTab (l.3480) qui
       renvoie la tempo initiale du fichier (120 s'il n'y en a pas) — et
       BPM réellement lu à la vitesse courante : « 150% · 120→180 ».
       Avant chargement : simple pourcentage. */
    function refreshSpeedLabel(score) {
      const sc  = score || Player.S.score;
      const pct = +$('#speed').value;
      const bpm = sc && isFinite(sc.tempo) && sc.tempo > 0 ? Math.round(sc.tempo) : 0;
      $('#speedVal').textContent = bpm
        ? pct + '% · ' + bpm + '→' + Math.round(bpm * pct / 100)
        : pct + '%';
    }

    function onScoreLoaded(score) {
      // titre
      const title = [score.title, score.artist].filter(Boolean).join(' — ') || 'Sans titre';
      $('#drawerScoreTitle').textContent = title;
      document.title = `${title} · GP8 Player`;

      // le mélangeur ne se remplit qu'une fois le score connu
      $('#btnMixer').disabled = false;

      // boucle A/B — un nouveau score ne peut pas hériter de l'ancien A→B
      if (Player.S.api && Player.S.api.playbackRange) Player.S.api.playbackRange = null;
      Player.S.loopRange = null;
      Player.setLoopOn(false);
      fillBarSelect($('#loopStart'), score.masterBars.length);
      fillBarSelect($('#loopEnd'),   score.masterBars.length);
      $('#loopStart').disabled = $('#loopEnd').disabled = false;
      refreshSpeedLabel(score);
      $('#btnApplyLoop').disabled = false;
      $('#btnClearLoop').disabled = true;        // aucune plage au chargement
      $('#loopStart').value = '0';
      $('#loopEnd').value   = String(Math.max(0, Math.min(7, score.masterBars.length - 1)));

      // drawer
      buildTrackList(score);

      // boutons
      ['#btnPlay', '#btnStop', '#btnPrev', '#btnNext', '#btnMetronome', '#btnCountIn', '#btnLoop']
        .forEach(id => $(id).disabled = false);

      Player.S.currentBar = 0;
      $('#barLabel').textContent = `M. 1/${score.masterBars.length}`;
      toast(`« ${title} » chargé — ${score.tracks.length} piste(s), ${score.masterBars.length} mesures`, 'ok');
      // le reflet du modèle (mute / solo / niveaux) est peint par applyMix(),
      // appelé juste après par Player sur `scoreLoaded`.
    }

    function fillBarSelect(sel, count) {
      sel.innerHTML = '';
      for (let i = 0; i < count; i++) {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `Mesure ${i + 1}`;
        sel.appendChild(o);
      }
    }

    /* ---------- mélangeur : construction des lignes ---------- */
    const ICON = {
      eye:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
      mute: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/></svg>',
      solo: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>'
    };

    function mixerRow(key, o) {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-1.5 rounded-lg px-1 py-1.5 transition hover:bg-white/[.04]';
      row.dataset.mix = String(key);
      row.innerHTML = `
        <span class="h-7 w-1.5 shrink-0 rounded-full" style="background:${o.color}"></span>
        <span class="min-w-0 flex-1 truncate text-[12px] leading-tight text-slate-200"
              title="${escapeHtml(o.title)}">${escapeHtml(o.label)}</span>
        ${o.eye ? `<button class="mx-btn" data-act="eye"  title="Afficher ou masquer cette piste — les autres ne changent pas (1, plusieurs ou toutes au choix)">${ICON.eye}</button>` : ''}
        <button class="mx-btn" data-act="mute" title="Mute : la piste ne sonne pas">${ICON.mute}</button>
        <button class="mx-btn" data-act="solo" title="Solo : seul cela sonne (un seul à la fois)">${ICON.solo}</button>
        <input class="mx-vol" type="range" min="0" max="${o.max || 150}" value="${o.value || 100}" title="Niveau (100 % = niveau d'origine)">`;
      return row;
    }

    function buildTrackList(score) {
      const list = $('#trackList');
      list.innerHTML = '';

      score.tracks.forEach(t => {
        list.appendChild(mixerRow(t.index, {
          color: hexColor(t.color),
          label: `${t.index + 1}. ${t.name || 'Piste ' + (t.index + 1)}`,
          title: t.name || 'Piste ' + (t.index + 1),
          eye: true
        }));
      });

      // ★ ligne « Audio Track » : la piste audio embarquée joue EN PARALLÈLE
      //   du synthé (MixSync la tient calée) — elle a donc son propre M/S.
      //   Max 100 : HTMLMediaElement.volume est borné à [0;1] par le spec.
      if (score.backingTrack && score.backingTrack.rawAudioFile) {
        list.appendChild(mixerRow('audio', {
          color: '#f59e0b',
          label: 'Audio Track',
          title: 'Piste audio embarquée dans le fichier',
          eye: false,
          max: 100,
          value: Math.round(Player.S.audioVolume * 100)
        }));
      }
    }

    /* ---------- mélangeur : reflet du modèle dans le DOM ----------
     *  Le modèle (Player.S.mix) est la seule source de vérité : ici on ne
     *  fait que repeindre les boutons et les faders. */
    function refreshMixStates() {
      const m = Player.S.mix;
      if (!m) return;

      $$('#trackList [data-mix]').forEach(row => {
        const key = row.dataset.mix;
        const audio = key === 'audio';
        const idx = audio ? null : Number(key);

        const eye = row.querySelector('[data-act="eye"]');
        // 'all' → tous allumés ; sinon le Set décide piste par piste.
        if (eye) eye.classList.toggle('is-on', !audio && Player.isDisplayed(idx));

        row.querySelector('[data-act="mute"]').classList.toggle(
          'is-on', audio ? m.audioMute : m.muted.has(idx));
        row.querySelector('[data-act="solo"]').classList.toggle(
          'is-on', m.solo === (audio ? 'audio' : idx));

        const slider = row.querySelector('.mx-vol');
        if (slider) {
          const v = audio ? Player.S.audioVolume : (m.vol.has(idx) ? m.vol.get(idx) : 1);
          const pct = String(Math.round(v * 100));
          if (slider.value !== pct) { slider.value = pct; }
          paintRange(slider);
        }
      });
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }
    function hexColor(c) {
      if (!c) return '#38bdf8';
      try { return `rgba(${c.r | 0},${c.g | 0},${c.b | 0},.85)`; } catch (e) { return '#38bdf8'; }
    }

    /* ---------- position ----------
     *  `playerPositionChanged` tombe ~344 fois/s (quantum AudioWorklet de
     *  128 frames posté à chaque exécution de `process()`). On plafonne
     *  l'interface à 20 Hz et on n'écrit QUE si la valeur a changé :
     *  avant correction, `--pct` et `textContent` étaient réécrits 344 fois/s
     *  (99,7 % pour une chaîne identique), ce qui invalidait les styles en
     *  permanence sur le thread principal — celui-là même qui relaie les
     *  demandes d'échantillons du synthé.                                */
    let lastUiTick = 0;
    function updatePosition(e) {
      if (scrubbing) return;
      const now = performance.now();
      if (now - lastUiTick < UI_MS) return;
      lastUiTick = now;

      const range = Player.S.api.playbackRange;
      const from  = range ? range.startTick : 0;
      const to    = range ? range.endTick   : e.endTick;
      const tick  = clamp(e.currentTick, from, to);
      const ratio = to > from ? (tick - from) / (to - from) : 0;

      const p = $('#progress');
      const val = String(Math.round(ratio * 1000));
      if (p.value !== val) { p.value = val; paintRange(p); }

      const label = `${fmtTime(e.currentTime)} / ${fmtTime(e.endTime)}`;
      const t = $('#timeLabel');
      if (t.textContent !== label) t.textContent = label;
    }

    /* ---------- badges ---------- */
    function syncPlayBadge(playing) {
      $('#btnPlay').classList.toggle('is-on', playing);
    }
    function syncMetronome(on, synthActive) {
      const b = $('#btnMetronome');
      b.classList.toggle('is-on', !!on);
      b.disabled = !synthActive;
      b.title = synthActive ? 'Métronome (M)' : 'Métronome indisponible en mode piste audio';
    }
    /* ---- overlay du compte à rebours (pur visuel, aucun son propre) ----
       Déclenché par Player.play() au même instant où alphaTab lance son
       count-in ; l'horloge est simplement une série de setTimeout. */
    let countInTimers = [];
    function showCountIn(beats, beatMs) {
      hideCountIn();
      MixSync.setCountIn(true);     // la piste audio ne doit PAS sonner pendant le décompte
      const box = $('#countIn'), num = $('#countInNum');
      if (!box || !num) { MixSync.setCountIn(false); return; }
      beatMs = beatMs > 0 ? beatMs : 500;
      beats  = beats > 1 ? Math.round(beats) : 4;
      box.classList.remove('hidden');
      box.classList.add('flex');
      const tick = v => {
        num.textContent = String(v);
        num.classList.remove('pop');
        void num.offsetWidth;              // relance l'animation
        num.classList.add('pop');
        if (v > 1) countInTimers.push(setTimeout(() => tick(v - 1), Math.round(beatMs)));
      };
      tick(beats);
      countInTimers.push(setTimeout(hideCountIn, Math.round(beatMs * beats)));
    }
    function hideCountIn() {
      countInTimers.forEach(clearTimeout);
      countInTimers = [];
      const box = $('#countIn');
      if (box) { box.classList.add('hidden'); box.classList.remove('flex'); }
      MixSync.setCountIn(false);    // la piste audio reprend (resync + play)
    }

    function syncCountIn(on, synthActive) {
      const b = $('#btnCountIn');
      b.classList.toggle('is-on', !!on);
      b.disabled = !synthActive;
      b.title = synthActive ? 'Délai de 4 temps avant lecture' : 'Décompte indisponible en mode piste audio';
    }
    function syncLoop(on) {
      $('#btnLoop').classList.toggle('is-on', !!on);
    }

    /* ---- Boucle A→B : tout ce qui vient d'alphaTab ------------------
       B3 : l'argument est un `PlaybackRangeChangedEventArgs` dont la SEULE
       propriété est `.playbackRange` (alphaTab.js l.33370). L'ancien code
       lisait `range.startTick` → `undefined` → `barIndexAt(undefined)` = 0
       → les DEUX listes retombaient sur « Mesure 1 » (le fameux 1 et 1). */
    function rangeArg(e) {
      if (!e) return null;
      if ('playbackRange' in e) return e.playbackRange || null;
      if ('startTick' in e && 'endTick' in e) return e;
      return null;
    }
    function sameRange(x, y) {
      return !!x && !!y && x.startTick === y.startTick && x.endTick === y.endTick;
    }

    function onPlaybackRange(e) {
      const r = rangeArg(e);
      const st = Player.S;

      /* Filet de sécurité : la branche normale du clic est neutralisée par
         patchVendorClickKeepsLoop(). Si alphaTab perdait quand même la plage,
         on la remet en place SANS toucher à l'icône (l'état L doit survivre). */
      if (!r && st.loopRange) {
        if (st.api && !st.api.playbackRange) st.api.playbackRange = st.loopRange;
        return;
      }

      if (!r) {                                   // effacement volontaire
        $('#btnClearLoop').disabled = true;
        Player.setLoopOn(false);
        return;
      }

      $('#btnClearLoop').disabled = false;
      fillLoopSelects(r);                         // B3 : la liste suit la plage

      if (sameRange(r, st.loopRange)) return;     // simple ré-émision : on n'arme rien
      st.loopRange = r;
      Player.setLoopOn(true);                     // B2 : nouvelle plage = icône L
      highlightRange(r);                          // B1 : surlignage sur le score
    }

    /* B3 : la fin se lit sur le DERNIER tick de la plage (endTick - 1).
       L'ancien `barIndexAt(endTick) - 1` se trompait sur la dernière mesure,
       où endTick vaut `api.endTick`. On borne aux bornes réelles de la liste. */
    function fillLoopSelects(r) {
      const bars = Player.S.score ? Player.S.score.masterBars : [];
      if (!bars.length) return;
      const last = bars.length - 1;
      const a = clamp(barIndexAt(r.startTick), 0, last);
      const b = clamp(barIndexAt(Math.max(r.startTick, (r.endTick || 0) - 1)), a, last);
      const s = $('#loopStart'), t = $('#loopEnd');
      if (s.value !== String(a)) s.value = String(a);
      if (t.value !== String(b)) t.value = String(b);
    }

    /* B1 : `highlightPlaybackRange` pose _selectionStart/_selectionEnd, que
       alphaTab RÉAPPLIQUE après CHAQUE re-render (l.48224). Sans cet appel,
       le surlignage du chemin « listes A/B » disparaissait au premier reflow
       (ouverture du tiroir, changement de layout…) — le chemin souris, lui,
       renseignait ces champs tout seul.                                  */
    function highlightRange(r) {
      const st = Player.S;
      try {
        const tc = st.api && st.api.tickCache;
        const bl = st.api && st.api.boundsLookup;
        if (!tc || !bl || !st.score) return;
        const ids = new Set(st.score.tracks
          .filter(t => Player.isDisplayed(t.index))
          .map(t => t.index));
        if (!ids.size) return;
        const s = tc.findBeat(ids, r.startTick);
        const t = tc.findBeat(ids, Math.max(r.startTick, (r.endTick || 0) - 1));
        if (!s || !t || !s.beat || !t.beat || s.beat === t.beat) return;
        // garde anti-crash : _cursorSelectRange lève si les bornes manquent
        if (!bl.findBeat(s.beat) || !bl.findBeat(t.beat)) return;
        st.api.highlightPlaybackRange(s.beat, t.beat);
      } catch (e) { /* surlignage best-effort : jamais bloquant */ }
    }

    function barIndexAt(tick) {
      const bars = Player.S.score ? Player.S.score.masterBars : [];
      if (!(tick >= 0)) return 0;
      for (let i = bars.length - 1; i >= 0; i--) if (bars[i].start <= tick) return i;
      return 0;
    }

    /* ---------- mélangeur : événements ----------
     *  Délégation sur #trackList : le tiroir reste OUVERT pendant toute
     *  interaction (il ne se ferme que sur ✕ ou Échap). */
    function wireMixer() {
      const list = $('#trackList');

      list.addEventListener('click', e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const row = btn.closest('[data-mix]');
        if (!row) return;
        const key   = row.dataset.mix;
        const audio = key === 'audio';
        const idx   = audio ? null : Number(key);
        const act   = btn.dataset.act;

        if (act === 'eye')       { if (!audio) Player.toggleDisplay(idx); }
        else if (act === 'mute') { if (audio) Player.toggleAudioMute(); else Player.toggleTrackMute(idx); }
        else if (act === 'solo') { if (audio) Player.toggleAudioSolo(); else Player.toggleTrackSolo(idx); }
      });

      list.addEventListener('input', e => {
        const slider = e.target.closest('.mx-vol');
        if (!slider) return;
        paintRange(slider);
        const row = slider.closest('[data-mix]');
        if (!row) return;
        const v = +slider.value / 100;
        if (row.dataset.mix === 'audio') Player.setAudioVolume(v);
        else Player.setTrackVolume(Number(row.dataset.mix), v);
      });
    }

    /* ---------- range painting (progression lue à l'œil) ---------- */
    function paintRange(input) {
      const min = +input.min || 0, max = +input.max || 100;
      const pct = ((+input.value - min) / (max - min)) * 100;
      input.style.setProperty('--pct', pct + '%');
    }
    function paintAllRanges() {
      $$('input[type=range]').forEach(paintRange);
    }

    /* ---------- drawer : PART DU FLUX, il ne recouvre rien ----------
     *  Le tiroir est un membre du flex #stage : s'ouvrir l'agrandit et
     *  #viewport se rétracte. Aucun backdrop — la fermeture est manuelle
     *  (✕ ou Échap) et AUCUNE interaction avec le contenu ne le referme. */
    function openDrawer() {
      document.body.classList.add('drawer-open');
      syncDrawerBtn();
      reflowScore();
    }
    function closeDrawer() {
      document.body.classList.remove('drawer-open');
      syncDrawerBtn();
      reflowScore();
    }
    function toggleDrawer() {
      if (document.body.classList.contains('drawer-open')) closeDrawer(); else openDrawer();
    }
    function syncDrawerBtn() {
      const b = $('#btnMixer');
      if (b) b.classList.toggle('is-on', document.body.classList.contains('drawer-open'));
    }
    /* alphaTab re-mesure son conteneur quand la largeur change ; on relance
       le layout à la main au cas où le ResizeObserver ne se déclencherait pas. */
    function reflowScore() {
      setTimeout(() => window.dispatchEvent(new Event('resize')), 90);
    }

    /* ---------- drag & drop ---------- */
    function wireDnD() {
      let depth = 0;
      window.addEventListener('dragenter', e => {
        e.preventDefault(); depth++;
        $('#dropOverlay').classList.remove('hidden');
        $('#dropOverlay').classList.add('flex');
      });
      window.addEventListener('dragover', e => e.preventDefault());
      window.addEventListener('dragleave', e => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) hideDropOverlay();
      });
      window.addEventListener('drop', e => {
        e.preventDefault(); depth = 0; hideDropOverlay();
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) Player.loadFile(f, f.name);
      });
      function hideDropOverlay() {
        $('#dropOverlay').classList.add('hidden');
        $('#dropOverlay').classList.remove('flex');
      }
    }

    /* ---------- raccourcis clavier ---------- */
    function wireShortcuts() {
      document.addEventListener('keydown', e => {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
        if (!Player.S.api || !Player.S.score) return;

        switch (e.key) {
          case ' ': e.preventDefault(); Player.toggle(); break;
          case 'm': case 'M': Player.setMetronome(!Player.S.metronomeOn); break;
          case 'l': case 'L': Player.toggleLoop(); break;
          case 'ArrowLeft':  e.preventDefault(); Player.gotoBar(e.shiftKey ? -4 : -1); break;
          case 'ArrowRight': e.preventDefault(); Player.gotoBar(e.shiftKey ?  4 :  1); break;
          case 'Escape': closeDrawer(); break;
        }
      });
    }

    /* ---------- responsive : layout ---------- */
    function applyResponsiveLayout() {
      const api = Player.S.api;
      if (!api) return;
      // le layout par défaut suit la largeur d'écran ; on laisse le choix manuel ensuite
      const label = mqDesktop.matches ? 'horizontal' : 'page';
      const wanted = layoutId(label);
      if (api.settings.display.layoutMode === wanted || layoutTouched) return;
      $('#layoutSelect').value = label;
      if (Player.S.score) Player.setLayout(wanted);   // → render
      else api.settings.display.layoutMode = wanted;   // avant le 1er score
    }
    let layoutTouched = false;

    /* ---------- wiring ---------- */
    function wireUI() {
      // fichier
      $('#fileInput').addEventListener('change', e => {
        const f = e.target.files && e.target.files[0];
        if (f) Player.loadFile(f, f.name);
        e.target.value = '';
      });

      // transport
      $('#btnPlay').onclick       = () => Player.toggle();
      $('#btnStop').onclick       = () => Player.stop();
      $('#btnPrev').onclick       = () => Player.gotoBar(-1);
      $('#btnNext').onclick       = () => Player.gotoBar(1);
      $('#btnMetronome').onclick  = () => Player.setMetronome(!Player.S.metronomeOn);
      $('#btnCountIn').onclick    = () => Player.setCountIn(!Player.S.countInOn);
      $('#btnLoop').onclick       = () => Player.toggleLoop();

      // panneau avancé (mobile)
      $('#btnMore').onclick = () => document.body.classList.toggle('adv-open');

      // progression : scrub
      const p = $('#progress');
      p.addEventListener('pointerdown', () => scrubbing = true);
      p.addEventListener('input',  () => paintRange(p));
      p.addEventListener('change', () => { Player.seekRatio(+p.value / 1000); scrubbing = false; });
      p.addEventListener('pointerup',   () => scrubbing = false);

      // mélangeur : ouverture / fermeture manuelle (aucune interaction
      // avec le contenu ne referme le tiroir)
      $('#btnMixer').onclick  = toggleDrawer;
      $('#drawerClose').onclick = closeDrawer;
      $('#btnAllTracks').onclick = () => Player.showTrack('all');
      $('#btnResetMix').onclick  = () => Player.resetMix();
      wireMixer();                       // clics & faders délégués sur #trackList

      // niveaux du tiroir + vitesse
      $('#volMaster').addEventListener('input', e => {
        paintRange(e.target); $('#volMasterVal').textContent = e.target.value;
        Player.setMasterVolume(+e.target.value / 100);
      });
      $('#volClick').addEventListener('input', e => {
        paintRange(e.target); $('#volClickVal').textContent = e.target.value;
        Player.setMetronomeVolume(+e.target.value / 100);
      });
      $('#speed').addEventListener('input', e => {
        paintRange(e.target); refreshSpeedLabel();
        Player.setSpeed(+e.target.value / 100);
      });

      // boucle A/B
      $('#btnApplyLoop').onclick = () => Player.setLoopRange(+$('#loopStart').value, +$('#loopEnd').value);
      $('#btnClearLoop').onclick = () => Player.clearLoopRange();

      // affichage
      $('#layoutSelect').onchange = e => { layoutTouched = true; Player.setLayout(e.target.value); };
      $('#scrollSelect').onchange = e => Player.setScrollMode(e.target.value);

      // responsive
      mqDesktop.addEventListener('change', applyResponsiveLayout);
      /* P6 : la force-ouverture CSS de #advanced est désormais conditionnée
         à la hauteur ; si « Réglages » était ouvert en portrait, la
         rotation en paysage (915×412) ne doit pas laisser le panneau
         consommer les 412 px disponibles. */
      mqShort.addEventListener('change', syncShortViewport);
      syncShortViewport();
    }

    /* ---------- boot ---------- */
    function boot() {
      if (typeof alphaTab === 'undefined') {
        document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">Impossible de charger alphaTab (CDN injoignable).</div>';
        return;
      }
      Samples.build().catch(e => console.warn('[samples]', e));
      wireUI();
      wireDnD();
      wireShortcuts();
      paintAllRanges();

      /* alphaTab démarre sur LayoutMode.Page alors que la 1ʳᵉ option du select
         est « Horizontal » : sans réglage explicite le select MENT au
         chargement (et applyResponsiveLayout() rendait return, S.score == null).
         On pose donc la valeur RÉELLE avant la création de l'API. */
      const defaultLayout = mqDesktop.matches ? 'horizontal' : 'page';
      CFG.alphatab.display.layoutMode = layoutId(defaultLayout);
      $('#layoutSelect').value = defaultLayout;

      /* Rien ne doit tuer `boot()` en silence : une exception ici coupeait
         `applyResponsiveLayout()` ET l'affichage du diagnostic — l'interface
         « marchait » (DnD déjà câblé plus haut) alors que le moteur était à
         moitié initialisé. */
      try {
        Player.init($('#scoreArea'));
        applyResponsiveLayout();
      } catch (e) {
        console.error('[boot] échec de l’initialisation du moteur', e);
        toast('Échec du démarrage alphaTab : ' + (e && e.message ? e.message : e), 'error');
      }

      console.log('%cGP8 Player%c alphaTab ' + (alphaTab.meta && alphaTab.meta.version || '1.8.4'),
        'background:#0ea5e9;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold', 'color:#64748b');
    }

    return {
      boot, toast, loader, armLoaderWatchdog, hideEmptyState, showEmptyState,
      onScoreLoaded, updatePosition,
      syncPlayBadge, syncMetronome, syncCountIn, showCountIn, hideCountIn, syncLoop, onPlaybackRange,
      refreshMixStates, openDrawer, closeDrawer
    };
  })();

  document.addEventListener('DOMContentLoaded', App.boot);
