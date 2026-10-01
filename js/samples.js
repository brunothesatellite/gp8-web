/* ==================================================================
   GP8 PLAYER - js/samples.js
   6 bis. SAMPLES - decouverte et lecture des fichiers d'exemple.
   ------------------------------------------------------------------
   Aucun nom de fichier n'est ecrit en dur ici : la liste vient soit du
   manifeste samples/list.json (gen-samples.bat), soit du listage de
   samples/, soit elle n'existe pas et la section reste masquee.
   Charge en <script classique> par index.html, avant js/app.js.
   Les retours visibles (loader/toast) sont ceux de App, resolus au
   moment de l'appel : App existe forcement puisque App.boot() est le
   seul a appeler Samples.build().
   ================================================================== */
'use strict';

  const Samples = (() => {
    /* ---------- samples ----------
       AUCUNE liste d'exemple en dur dans le code. Trois régimes possibles,
       dans cet ordre, et rien d'autre :

         file://    → la section « Fichiers d'exemple » disparaît complètement
                      (fetch sur une URL `file:` est bloqué ; un fichier déposé
                      ou traversé reste, lui, parfaitement disponible).

         manifeste  → `samples/list.json`, produit par `gen-samples.bat`.
                      Source privilégiée : elle fonctionne aussi sur les
                      serveurs qui REFUSENT de lister un dossier (Synology
                      Web Station renvoie 403 ; HTTP n'a aucun verbe « lister »,
                      il n'y a donc aucun contournement côté client).
                      À régénérer après chaque ajout / renommage de .gp.

         listing    → scan dynamique de `samples/`, en repli lorsque le
                      manifeste est absent : Apache `Options +Indexes`,
                      nginx `autoindex on`, `python -m http.server`.
                      403 / 404 → AUCUNE entrée, la section reste masquée.

       Ni exemple codé en dur, ni section vide affichée : le code ne fait
       qu'interroger ces deux sources. Pas de source → pas de section.      */
    const SAMPLE_RE = /\.(gp|gpx|gp5)$/i;
    // un nom issu du manifeste ne doit jamais remonter au-dessus de samples/
    const SAMPLE_SAFE = /[/?#\\]/;

    function sampleLabel(file) {
      const base = file.replace(SAMPLE_RE, '');
      // « Artiste (1993 - Album) - Titre.gp » → « Artiste — Titre »
      const m = base.match(/^(.+?)\s*\([^)]*\)\s*-\s*(.+)$/);
      return m ? `${m[1]} — ${m[2]}` : base;
    }

    /* `samples/list.json` : soit un tableau brut de noms, soit l'objet
       { generated, count, files: [ … ] } écrit par gen-samples.bat. */
    async function scanManifest() {
      const res = await fetch('samples/list.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const raw = Array.isArray(json) ? json : (json && json.files);
      if (!Array.isArray(raw)) throw new Error('format de manifeste inattendu');
      const out = [];
      raw.forEach(item => {
        const name = typeof item === 'string' ? item
                   : (item && (item.file || item.name)) || '';
        if (!SAMPLE_RE.test(name)) return;           // sous-dossier, divers
        if (SAMPLE_SAFE.test(name) || name.startsWith('.')) return;
        out.push({ label: sampleLabel(name), file: name });
      });
      if (!out.length) throw new Error('manifeste vide');
      out.sort((x, y) => x.label.localeCompare(y.label, 'fr'));
      return out;
    }

    async function scanDirectory() {
      const res = await fetch('samples/', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const out = [];
      doc.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || '';
        let name = (a.textContent || '').trim();
        if (!SAMPLE_RE.test(name)) {                    // lien sans texte exploitable
          try { name = decodeURIComponent(href); } catch (e) { name = href; }
        }
        if (!SAMPLE_RE.test(name)) return;              // sous-dossier, ../, divers
        if (/[/?#]/.test(name) || name.startsWith('.')) return;
        out.push({ label: sampleLabel(name), file: name });
      });
      if (!out.length) throw new Error('aucun fichier .gp détecté');
      out.sort((x, y) => x.label.localeCompare(y.label, 'fr'));
      return out;
    }

    function renderSamples(list) {
      const box = $('#sampleList');
      const hint = $('#sampleHint');
      box.innerHTML = '';
      if (hint) {
        const n = `${list.length} fichier${list.length > 1 ? 's' : ''}`;
        hint.textContent = `${n} · audio embarqué inclus`;
      }
      list.forEach(s => {
        const b = document.createElement('button');
        b.className = 'group flex w-full items-center gap-3 rounded-lg border border-white/5 bg-slate-800/50 px-3 py-2 text-left transition hover:border-sky-500/50 hover:bg-slate-800';
        const ico = document.createElement('span');
        ico.className = 'text-sky-400 opacity-70 group-hover:opacity-100';
        ico.textContent = '▶';
        const name = document.createElement('span');    // texte = nom de fichier :
        name.className = 'truncate text-[13px] text-slate-300';   // jamais d'innerHTML
        name.textContent = s.label;
        const tag = document.createElement('span');
        tag.className = 'ml-auto shrink-0 text-[10px] uppercase tracking-wider text-slate-600';
        tag.textContent = 'gp';
        b.append(ico, name, tag);
        b.onclick = () => loadSample(s);
        box.appendChild(b);
      });
    }

    /* La section ne devient visible QUE si une source a renvoyé au moins un
       fichier. Jamais de contenu de remplacement, jamais de vide affiché :
       pas de source → section masquée (comme en file://). */
    async function buildSamples() {
      const section = $('#samplesSection');
      const hide = why => {
        if (section) section.classList.add('hidden');
        console.info('[samples] ' + why);
      };
      if (location.protocol === 'file:') {
        hide('file:// → section masquée (ni fetch, ni listing possible)');
        return;
      }
      // 1) manifeste samples/list.json — source privilégiée : elle répond
      //    même quand le serveur refuse de lister le dossier (Synology 403).
      // 2) listing dynamique — repli si le manifeste n'a pas été généré.
      let list = null, whyManifest = 'inconnu';
      try {
        list = await scanManifest();
        console.info('[samples] manifeste list.json → ' + list.length + ' fichier(s)');
      } catch (e) {
        whyManifest = e && e.message;
      }
      if (!list) {
        try {
          list = await scanDirectory();
          console.info('[samples] listing de samples/ → ' + list.length + ' fichier(s)');
        } catch (e) {
          hide('manifeste ' + whyManifest + ' · listing ' + (e && e.message) +
               ' → section masquée. Lancez gen-samples.bat pour produire le ' +
               'manifeste samples/list.json, ou autorisez le listage du ' +
               'dossier : Apache Options +Indexes / nginx autoindex on.');
          return;
        }
      }
      // On remplit AVANT de rendre visible : ni flash de section vide,
      // ni section visible si le remplissage échoue.
      renderSamples(list);
      if (section) section.classList.remove('hidden');
    }

    async function loadSample(s) {
      App.loader(true, `Téléchargement de « ${s.label} »…`);
      try {
        const res  = await fetch(encodeURI('samples/' + s.file));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const file = new File([blob], s.file, { type: 'application/octet-stream' });
        App.loader(false);
        Player.loadFile(file, s.label);
      } catch (e) {
        console.error('[samples]', e);
        App.loader(false);
        // Ne pas accuser file:// quand on est bien sur un serveur :
        // le vrai problème est alors un fichier absent (HTTP 404).
        App.toast(location.protocol === 'file:'
              ? 'Chargement impossible en file:// — servez le dossier en HTTP.'
              : `« ${s.label} » introuvable sur le serveur (${e && e.message}).`,
              'error');
      }
    }

    return { build: buildSamples };
  })();

