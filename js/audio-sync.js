/* ==================================================================
   GP8 PLAYER â€” js/audio-sync.js
   2. AUDIO SYNC â€” <audio> HTML5 cachÃ© (piste audio embarquÃ©e).
   ------------------------------------------------------------------
   ChargÃ© en <script classique> par index.html, dans l'ordre de l'ancien
   app.js monolithique. Le partage se fait par les bindings lexicographiques
   globaux (CFG, AT, $, safe, Player, Appâ€¦), PAS par des imports : un module
   ES est impossible ici car l'application doit s'ouvrir depuis file://.
   ================================================================== */
'use strict';
  /* ================== 2. AUDIO SYNC (<audio> caché) ================ */
  /*
   *  Rôle : héberger le lecteur HTML5 de la piste audio embarquée, jouée en
   *  ESCLAVE du synthé alphaTab (cf. MixSync) — alphaTab reste maître du
   *  temps, on ne fait que coller notre <audio> dessus.
   *
   *  Le mode `enabledExternalMedia` d'alphaTab (IExternalMediaHandler) n'est
   *  plus utilisé : le choix de source a été retiré de l'UI et le mode de
   *  lecture est fixé à `enabledSynthesizer`.
   */
  const AudioSync = (() => {
    const audio = $('#externalAudio');
    let url = null;            // objectURL en cours

    function setSource(src) {
      if (url) URL.revokeObjectURL(url);
      url = src || null;
      if (url) {
        audio.src = url;
        audio.load();
      } else {
        // ne JAMAIS faire `audio.src = ''` : le navigateur resolverait
        // l'URL du document comme source média.
        audio.removeAttribute('src');
        try { audio.load(); } catch (e) {}
      }
    }

    /* ---- Synchronisation ----
     *  alphaTab est maître du temps : MixSync (module 4) est l'unique
     *  mécanisme de calage entre le synthé et notre <audio> ci-dessus. */
    return { setSource, element: audio };
  })();

