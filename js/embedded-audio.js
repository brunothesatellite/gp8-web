/* ==================================================================
   GP8 PLAYER â€” js/embedded-audio.js
   3. EMBEDDED â€” Bonus JSZip : lecture du conteneur .gp (piste audio embarquÃ©e).
   ------------------------------------------------------------------
   ChargÃ© en <script classique> par index.html, dans l'ordre de l'ancien
   app.js monolithique. Le partage se fait par les bindings lexicographiques
   globaux (CFG, AT, $, safe, Player, Appâ€¦), PAS par des imports : un module
   ES est impossible ici car l'application doit s'ouvrir depuis file://.
   ================================================================== */
'use strict';
  /* ============== 3. EMBEDDED AUDIO (bonus JSZip) ================= */
  /*
   *  Un fichier .gp (GP7/8) est une archive ZIP. On y trouve notamment :
   *
   *    VERSION
   *    meta.json
   *    Content/
   *      score.gpif                 ← la partition (XML)
   *      BinaryStylesheet
   *      LayoutConfiguration / PartConfiguration
   *      Preferences.json
   *      ScoreViews/*.gpsv
   *      Stylesheets/*.gpss
   *      Assets/<GUID>.mp3          ← ★ L'AUDIO EMBARQUÉ
   *
   *  NOTE : alphaTab extrait DÉJÀ ce mp3 à l'import (Gp7To8Importer →
   *  GpifParser.loadAsset) et le place dans `score.backingTrack.rawAudioFile`.
   *  Le module ci-dessous sert :
   *    - à inspecter l'archive (bouton "Analyser"),
   *    - à extraire l'audio soi-même si on veut le piloter via notre <audio>
   *      (mode "Média externe"), sans dépendre d'alphaTab.
   */
  const EmbeddedAudio = (() => {
    const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;

    /* Inspection : liste les entrées audio du zip ------------------- */
    async function probe(file) {
      if (typeof JSZip === 'undefined') throw new Error('JSZip indisponible (CDN ?)');
      const zip = await JSZip.loadAsync(file);
      const audioEntries = [];
      const otherEntries  = [];
      for (const name of Object.keys(zip.files)) {
        const entry = zip.files[name];
        if (entry.dir) continue;
        const meta = { name, size: 0 };
        if (AUDIO_RE.test(name)) {
          // On lit uniquement la taille : on inflate l'entrée demandée
          const data = await entry.async('uint8array');
          meta.size = data.byteLength;
          meta.data  = data;
          audioEntries.push(meta);
        } else {
          otherEntries.push(name);
        }
      }
      return { audioEntries, otherEntries };
    }

    /* Extraction → Blob utilisable par <audio src=objectURL> -------- */
    async function extract(file) {
      const { audioEntries } = await probe(file);
      if (!audioEntries.length) return null;
      const a = audioEntries[0];
      const mime = a.name.endsWith('.wav') ? 'audio/wav'
                : a.name.endsWith('.ogg') ? 'audio/ogg'
                : 'audio/mpeg';
      return { blob: new Blob([a.data], { type: mime }), name: a.name, size: a.size, entries: audioEntries };
    }

    /* Repli : si alphaTab a déjà extrait le fichier ----------------- */
    function fromScore(score) {
      const raw = score && score.backingTrack && score.backingTrack.rawAudioFile;
      if (!raw) return null;
      return new Blob([raw], { type: 'audio/mpeg' });
    }

    return { probe, extract, fromScore };
  })();

