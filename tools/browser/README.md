# tools/browser — test d'intégration navigateur (P5-13)

Le **seul** harnais qui exécute l'application **en entière** : HTML + CSS + les
8 `<script>` classiques + alphaTab (CDN) + le synthé + la piste audio embarquée.
Tout ce que les harnais Node (`tools/*.js`) simulent, celui-ci le **joue pour de
bon**, dans un vrai Chrome.

## Pourquoi c'est isolé

Le dépôt reste **sans dépendance à l'exécution** (l'app s'ouvre en `file://`).
Ce test est la seule exception, et elle est confinée :

- sa dépendance (`playwright-core`) est un `devDependency` **local à ce dossier**
  (`tools/browser/node_modules`, ignoré par git) ;
- il utilise le **Chrome/Edge déjà installé** sur la machine — aucun navigateur
  n'est téléchargé ;
- il n'est **jamais** appelé par `tools/test-all.js` (qui doit rester `npm`-free).

## Installation et lancement

```bash
cd tools/browser
npm i          # installe playwright-core (léger : pas de Chromium embarqué)
npm test       # 3 exemples représentatifs (Sepultura, Dr. Stein, Renaud) ~2 min
npm run test:all          # les 16 exemples du manifeste ~10 min
node run.js --headed      # navigateur visible (débogage, audio réel)
node run.js --sample Renaud --seconds 15 --verbose
```

Si Chrome/Edge n'est pas au chemin par défaut :

```powershell
$env:GP8_BROWSER = "D:\chemin\vers\chrome.exe"; npm test
```

## Options

| option | effet |
|---|---|
| `--all` | tous les exemples listés par `samples/list.json` |
| `--sample <motif>` | filtre sur le nom de fichier |
| `--seconds <n>` | durée de lecture analysée (défaut **21 s** → ≥ 3 fenêtres de croisière) |
| `--headed` | navigateur visible |
| `--verbose` | journal console complet de chaque exemple |

## Ce qu'il fait, pas à pas

1. sert le dépôt en `http://127.0.0.1:<port>` (contexte sûr → `AudioWorklet`) ;
2. attend le boot (`alphaTab` + `Player.S.api`) et la liste d'exemples
   (chemin **real** : `samples/list.json` → boutons) ;
3. **clique** un exemple → `fetch` → `Player.loadFile` ;
4. attend le score **et** le pont audio (`MixSync._probe().n > 0`) ;
5. installe un **compteur passe-plaques** sur `api.playbackSpeed`
   (le vrai setter d'alphaTab est conservé — comportement inchangé) ;
6. **clique Lecture**, joue `--seconds` (ou jusqu'à la fin du morceau), puis
   relit l'instrumentation **livrée** `[mix-stats]`.

Aucun miroir : les expressions de relecture de `[mix-stats]` sont celles de
`tools/mix-sync-harness.js`.

## Verdicts (voir `BUGFIX-TOTAL.md` §6.2)

- **❌ échec** : invariant du livrable — **0** écriture de `playbackSpeed` en
  lecture, **0** erreur console, moteur + piste audio câblés, horloge qui
  avance, piste audio qui avance, dérive de croisière < 150 ms (1,5× la zone
  morte), ≤ 1 arrêt maître, écritures de taux ≤ 15 %.
- **🟡 vert** : invariants tenus, mais la cible **stricte** du §6.2
  (dérive < 40 ms, taux ≤ 2 %, 0 arrêt) n'est pas atteinte sur cet exemple —
  bruit de la pile audio **temps réel** ; l'oreille (§5.2) arbitre le ressenti.

Deux écarts de mesure assumés (documentés en §6.2) : la 1ʳᵉ fenêtre de 5 s
(amorçage de la piste audio) est **écartée**, et la dérive de croisière en
navigateur est **bornée par la zone morte du contrôleur (~100 ms)**, pas par les
40 ms du banc déterministe.

## Résultat de référence (`npm run test:all`)

**15/15** exemples verts : **0** écriture de `playbackSpeed` en lecture, 0 erreur
console, dérive de croisière 10-80 ms. 10 exemples en 🟡 (cible stricte non
atteinte), 5 en ✅ (F-Zero X, Igorrr ×2, Led Zeppelin, Offspring). La trace P3
`[oracle] … résidu H2` réapparaît à l'identique (Renaud). Détail complet en
`BUGFIX-TOTAL.md` §2.5.

> Le manifeste est **complet** depuis P6 : `samples/list.json` a **15** entrées,
> une par `.gp` de `samples/` (`The Four Horsemen` inclus). Si un `.gp` est
> ajouté, relancer `gen-samples.bat` — le harnais **signale** en tête de sortie
> tout fichier présent sur disque mais absent du manifeste.
>
> ⚠ Comme l'app charge alphaTab/JSZip/police/soundfont depuis le **CDN**
> jsdelivr, le test nécessite un accès réseau. Seuls les `<script>` de l'app
> viennent du CDN — les `.gp` sont servis localement.
