# GP8-Web — Analyse audio / synchro & plan de correction définitif

> **Date** : 2026-11-26 · **Périmètre** : dépôt `gp8-web` (commit `84395ea`),
> 17 échantillons dont le nouveau `Nirvana (1989 - Bleach) - Mr. Moustache.gp`.
> **Objet** : expliquer les saccades, les décalages et les brusques
> ralentissements/accélérations à la lecture des `.gp` avec piste audio
> embarquée, puis proposer un plan de correction **définitif**.
>
> **Statut des correctifs précédents** : RC-2/RC-3 (écritures de
> `playbackSpeed` en lecture) sont réellement corrigés. En revanche, les
> harnais actuels **ne mesurent pas** les trois causes critiques décrites
> ici (ticks partition/performance, alignement GPIF/répétitions, horloge
> `<audio>` vs AudioWorklet). Le vert 8/8 + 16/16 ne prouve donc pas la
> synchro audible.
>
> **État après P2b (appliqué le 2026-11-26)** : l'audio embarqué est décodé en
> `AudioBuffer` et joué par une `AudioBufferSourceNode` dans l'**AudioContext
> du synthé** (`js/audio-sync.js`). À vitesse utilisateur ≠ 1, bascule sur un
> `<audio>` caché avec `preservesPitch`, routé dans le même AudioContext via
> `MediaElementAudioSourceNode` : le time-stretch préserve la hauteur.
> Navigateur 17/17 **✅ cible stricte**, dérive **2-8 ms**, 0 seek de correction,
> 0 erreur console ; vitesses ×0,5/×1,5 : dérive < 25 ms.

---

## 0. TL;DR — les trois causes critiques

| # | Cause | Preuve mesurée | Symptôme entendu |
|---|---|---|---|
| **C1** | **Confusion tick de partition / tick de performance** dans `gotoBar()`, `setLoopRange()`, `barIndexAt()` | `gotoBar(26)` sur Mr. Moustache va à **0:36 (M.12)** au lieu de **1:18 (M.27)** ; sur AC/DC, M.27 va à **0:53** au lieu de **2:22** | saut au mauvais endroit, boucle qui rejoue le mauvais passage, saccade après un seek |
| **C2** | **Alignement GPIF ↔ déroulé alphaTab incomplet** (H1/H2, voltes multi-fins, DS/DC, occurrences) | 90 clés GPIF manquantes sur 17 fichiers ; **18** sur Mr. Moustache, 12 sur AC/DC, 55 sur Renaud ; sauts avant de +9 s à +224 s | audio qui « saute », accélération/ralentissement soudain, sections jouées dans le mauvais ordre |
| **C3** | **Deux horloges indépendantes** : `<audio>` HTML5 vs AudioWorklet alphaTab, corrigées par une boucle `performance.now()` + écritures `playbackRate` | la cible est intégrée en temps réel (`musMs += dw*sp`) au lieu d'utiliser `api.timePosition × vitesse` ; écritures de taux jusqu'à 13,3 % du temps (Helloween, navigateur) ; `setRate()` non compté par les métriques | micro-saccades permanentes, dérive, « ça rame » sans erreur console |

**Conséquences** : les correctifs P2/P3 ont supprimé une cause réelle
(les coupures de synthé dues à `playbackSpeed`), mais ont **déplacé** le
problème vers (a) une carte de synchro fausse et (b) un correcteur de
phase qui étire l'audio au lieu de corriger le MIDI. Les harnais actuels
mesurent la boucle fermée avec la **même** formule de cible : ils ne
peuvent pas voir une cible fausse.

---

## 1. Méthode d'analyse

1. Lecture intégrale du code livré (`js/*.js`), du vendor alphaTab 1.8.4
   (`tools/vendor/alphaTab.js`) et des documents `BUGFIX-TOTAL.md`,
   `TESTLOG.md`.
2. Exécution de la suite : `node tools/test-all.js` → **9/9 verts** (depuis P1).
3. Exécution du harnais navigateur réel sur le nouveau sample
   (`tools/browser/run.js --sample "Mr. Moustache" --seconds 30`) → 🟡,
   46 ms de dérive, 0 écriture de vitesse **sur les 30 premières secondes**.
4. Nouvel audit de cohérence (`tools/sync-coherence.js`, ajouté par cette
   analyse) qui exécute le chemin livré et compare :
   - clés GPIF ↔ déroulé réel ;
   - axe « pré-cuit » de `segmentsFrom` ↔ temps réel du `MidiFile` pré-cuit ;
   - ticks de mesure (partition) ↔ ticks de performance (`tickCache`) ;
   - sauts avant/arrière et saut de fin.
5. Mesures ciblées dans Chrome réel : `gotoBar(26)` sur Mr. Moustache,
   instrumentées sur `audio.currentTime`, `audio.playbackRate`,
   `api.tickPosition`, `api.timePosition`.
6. Analyse de la structure GPIF (mesures, répétitions, voltes, directions
   DS/DC) des 17 échantillons.

**Reproductibilité** :

```bash
node tools/test-all.js                     # 9/9 (dont sync-coherence --strict)
node tools/sync-coherence.js               # audit, code 0
node tools/sync-coherence.js --strict      # échoue : cible du plan
node tools/browser/run.js --sample "Mr. Moustache" --seconds 30 --verbose
```

---

## 2. Architecture actuelle et axes de temps

```
.gp (zip) ──► alphaTab ScoreLoader ──► score (mesures, reprises, syncPoints GPIF)
                                      │
                                      ├─ fixEmptyAnacrusis
                                      ├─ RepeatOracle.raise (repeatCount + H1)
                                      ├─ MidiFileGenerator.generate
                                      │     └─ installTempoPrebake → MixSync.prebake
                                      │           (TempoChangeEvent réécrits)
                                      ├─ render (partition)
                                      └─ MixSync.build (generateSyncPoints → table du pont)

Lecture :
  alphaTab synth (worker + AudioWorklet) ── maître du temps
  <audio id="externalAudio"> (HTML5)     ── esclave
  MixSync.correct() toutes les 250 ms    ── playbackRate / seek
```

Cinq axes de temps cohabitent — et c'est là que naissent les bugs :

| Axe | Unité | Producteur | Utilisé par |
|---|---|---|---|
| `masterBar.start` | tick **partition** | modèle de score | `gotoBar`, `setLoopRange`, `barIndexAt` |
| `tickPosition` / `synthTick` | tick **performance** (reprises incluses) | `MidiPlaybackController` → `MidiFileGenerator` | séquenceur, `generateSyncPoints`, `playerPositionChanged` |
| `timePosition` | ms **réelles** (axe public, 1 ms/ms) | `AlphaSynth._onSamplesPlayed` | UI, `MixSync` |
| axe **pré-cuit** `points[].t` | ms du MIDI après réécriture des tempos | `prebake` + `segmentsFrom` | cible audio |
| axe **audio** `points[].a` | ms du MP3 | GPIF `millisecondOffset` | `<audio>` |

**Règle** : `api.timePosition × api.playbackSpeed` = temps interne du
séquenceur (axe pré-cuit). Cette égalité est exacte à chaque événement ;
l'intégrer avec `performance.now()` est une source d'erreur.

---

## 3. Constats mesurés

### 3.1 Table de cohérence (état **avant P0**, 17 fichiers)

Extrait de `tools/sync-coherence.js` :

| fichier | GPIF brut | gén. | clés | manq. | levés | BPM@0 | natif | précuit | audio fin | axe | sauts av/ar | hors | tail | barMap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| AC/DC — Highway to Hell | 80 | 68 | 77 | **12** | 1 | 106,2 | 174,5 s | 174,8 s | 207,1 s | 67 ms | 3/0 | 2 | — | 38 |
| Blink 182 — All the Small Things | 147 | 147 | 96 | 0 | 1 | 147,8 | 160,5 s | 160,5 s | 170,2 s | 78 ms | 2/0 | 0 | +7,6 s | 48 |
| Europe — The Final Countdown | 58 | 58 | 57 | 0 | 0 | 117,0 | 291,8 s | 290,1 s | 302,9 s | 40 ms | 0/0 | 0 | — | 99 |
| F-Zero X — Goal BGM | 14 | 14 | 10 | 0 | 0 | 163,0 | 15,0 s | 14,5 s | 21,4 s | 0 ms | 0/0 | 0 | — | 0 |
| Helloween — Dr. Stein | 112 | 112 | 97 | 0 | 0 | 150,8 | 334,0 s | 269,3 s | 300,3 s | 0 ms | 1/0 | 0 | +8,8 s | 69 |
| Igorrr — Blastbeat Falafel | 4 | 4 | 2 | 0 | 0 | 196,7 | 175,5 s | 189,9 s | 191,0 s | 13 ms | 0/0 | 1 | — | 89 |
| Igorrr — Headbutt | 18 | 18 | 17 | 0 | 0 | 190,0 | 216,0 s | 216,7 s | 223,6 s | 30 ms | 1/0 | 0 | +7,7 s | 107 |
| Iron Maiden — Fear of the Dark | 136 | 137 | 106 | 0 | 0 | 76,5 | 290,0 s | 249,4 s | 251,6 s | 0 ms | 3/0 | 2 | — | 125 |
| Led Zeppelin — Immigrant Song | 64 | 64 | 56 | 0 | 0 | 112,5 | 141,4 s | 141,1 s | 143,0 s | 58 ms | 0/0 | 0 | — | 37 |
| Metallica — Four Horsemen | 239 | 240 | 207 | 0 | 1 | 194,8 | 450,6 s | 462,5 s | 429,2 s | **205 ms** | 2/1 | 0 | — | 150 |
| Metallica — For Whom… | 141 | 141 | 126 | 0 | 0 | 118,4 | 279,0 s | 287,5 s | 293,6 s | 0 ms | 0/0 | 0 | — | 63 |
| **Nirvana — Mr. Moustache** | **121** | **103** | **99** | **18** | **0** | 167,2 | 228,0 s | **184,7 s** | 201,1 s | 0 ms | 2/0 | **10** | **+6,1 s** | 43 |
| Nirvana — Come as you are | 65 | 65 | 63 | 0 | 5 | 115,8 | 210,0 s | 210,3 s | 215,7 s | 0 ms | 1/0 | 0 | +8,4 s | 40 |
| Renaud — Morgane de toi | 156 | 100 | 142 | **55** | 0 | 105,0 | 240,0 s | 235,7 s | 368,8 s | 0 ms | 8/0 | 3 | — | 46 |
| Sepultura — Amen | 167 | 168 | 89 | 0 | 0 | 78,4 | 257,1 s | 267,2 s | 267,3 s | 69 ms | 0/0 | 0 | — | 58 |
| Slayer — Hell Awaits | 148 | 149 | 138 | 0 | 4 | 99,6 | 320,9 s | 308,5 s | 373,2 s | 42 ms | 0/0 | 0 | — | 107 |
| The Offspring — Self Esteem | 259 | 251 | 112 | **5** | 1 | 99,7 | 242,3 s | 243,4 s | 257,6 s | 16 ms | 1/0 | 0 | — | 48 |

Légende :
- **GPIF brut** = nombre de `SyncPoint` dans le `.gpif` ; **gén.** = points
  effectivement produits par le déroulé alphaTab (après oracle) ; l'écart
  est la perte de couverture ;
- **manq.** = clés `mesure.occurrence` GPIF que le déroulé alphaTab ne joue pas ;
- **axe** = écart entre `points[].t` (table du pont) et le temps réel du
  MIDI pré-cuit au même tick. C'est exactement ce que le correcteur doit
  rattraper en lecture ;
- **sauts av/ar** = segments classés « saut » (pente > 3 ou audio qui recule) ;
- **hors** = pentes hors `[0,5 ; 2]` non classées saut ;
- **tail** = dernier segment traité comme un saut (outro coupée) ;
- **barMap** = nombre de mesures dont `masterBar.start` ≠ tick de performance.

### 3.2 Preuve C1 — les seeks et boucles visent le mauvais endroit

Sur `Mr. Moustache`, la mesure M.27 a :
- `masterBar.start = 99 840` (tick partition) ;
- tick de performance = **218 880** (`tickCache.getMasterBarStart`) ;
- audio correspondant = **77,99 s**.

Or `Player.gotoBar()` écrit directement `masterBar.start` dans
`api.tickPosition` (qui attend un tick **performance**). Mesure dans
Chrome : après `gotoBar(26)`, l'audio joue **35,96 s** et l'indicateur
affiche **M.12/45**. Sur AC/DC, M.27 va à **53,44 s** au lieu de
**142,49 s**.

| mesure | tick partition | tick performance | audio via tick partition | audio via tick performance |
|---|---:|---:|---:|---:|
| AC/DC M.6 | 19 200 | 34 560 | 9,76 s | **18,14 s** |
| AC/DC M.27 | 99 840 | 211 200 | 53,44 s | **142,49 s** |
| Mr. Moustache M.27 | 99 840 | 218 880 | 35,96 s | **77,99 s** |
| Mr. Moustache M.42 | 157 440 | 414 720 | 56,08 s | **178,27 s** |
| Mr. Moustache M.32 | 119 040 | **0 (jamais jouée)** | 42,69 s | — |

**Portée** : `gotoBar`, `setLoopRange`, `barIndexAt` (donc les listes A/B
et le curseur de boucle), et `seekTick` qui borne sur une `playbackRange`
elle aussi exprimée en ticks performance. **16 fichiers sur 17** ont au
moins une mesure concernée (voir `barMap`).

**Seek et boucle** : `MixSync.resync()` est appelé immédiatement après
`seekTick()`, mais le setter `api.tickPosition` du worker met à jour le
tick **sans** recalculer `api.timePosition` (il reste l'ancien). Le
`<audio>` est donc recalé sur **l'ancienne** position, puis un second
seek arrive avec `positionChanged(isSeek)`. Deux seeks pour un seul
geste = saccade garantie. `MixSync.onPosition()` ignore d'ailleurs le
booléen `isSeek` de l'événement.

### 3.3 Preuve C2 — la carte de synchro ne couvre pas le déroulé

`RepeatOracle.raise()` est un optimiseur **local** :
- il ne considère que les groupes à **fermeture unique** (`g.closings.length !== 1` → `continue`) ;
- il ne teste que `saved+1 … saved+4` (jamais de **baisse** de `repeatCount`) ;
- il mesure les clés manquantes avec `walkMaxOcc` (le **maximum** d'occurrence
  par mesure, pas la **séquence**) ;
- sa garde refuse tout changement qui augmente `danger`/`jumps`, même s'il
  corrige l'ordre global ;
- `normalizeMultiClosingRepeats()` déplace le `repeatCount` sur la
  **dernière** fin. Pour un groupe à deux fins **adjacentes** (Mr. Moustache
  M.30-M.32 : M.31 = fin 1, M.32 = fin 2 + D.S. al Coda), la première fin
  n'est plus un `repeatEnd` ; M.32 est masquée sur la première passe et
  n'est **jamais jouée**. Le déroulé saute M.32.

Résultat : AC/DC 12 clés manquantes, Mr. Moustache 18 (dont M.30.1,
M.31.0, M.32.0), Renaud 55. Les points GPIF manquants ne sont pas des
« données H2 » anodines : ils créent des segments de pont énormes,
classés sauts ou hors plage :

| fichier | segment | Δ audio | pente | effet |
|---|---|---:|---:|---|
| AC/DC | M.9.3 → M.10.1 | **+22,9 s** | 10,5 | seek avant, passage sauté |
| AC/DC | M.14.3 → M.15.1 | +10,3 s | 4,7 | seek avant |
| Renaud | M.37 → M.38 | **+94,2 s** | 39,3 | seek avant |
| Four Horsemen | M.29.3 → M.23.4 | **+224,5 s** | 190,9 | seek avant |
| Four Horsemen | M.29.5 → M.30.0 | **−288,2 s** | −490,2 | retour arrière |
| Offspring | M.20.3 → M.21.1 | +13,2 s | 7,8 | seek avant |
| Mr. Moustache | M.11.4 → M.12.4 | +9,3 s | 4,7 | seek avant |
| Mr. Moustache | M.45 (fin) | +6,1 s | 3,06 | **outro coupée** |

Ces sauts ne sont pas de la « correction de phase » : ce sont des
**trous de déroulé**. Aucun réglage de `playbackRate` ne peut les rendre
inaudibles.

### 3.4 Preuve C3 — la boucle de correction se trompe d'horloge

`advanceMusicalClock()` (mix-sync.js) :

```js
musMs += dw * sp;                              // dw = performance.now()
if (Math.abs(real - musRef - dw) > ANCHOR_TOL_MS + dw * 0.5)
  musMs = real * sp;                            // ré-ancrage conditionnel
```

- `api.timePosition` avance déjà à **1 ms par ms réelle** ; l'axe interne
  est exactement `timePosition × playbackSpeed`. Intégrer `performance.now()`
  ajoute la dérive de l'horloge murale (jitter du main thread, throttling,
  charges GC) **sur** une valeur déjà exacte. Les deux horloges ne sont pas
  le même oscillateur.
- La zone morte (`DEADBAND_MS = 100`) ne corrige rien tant que l'écart est
  petit ; une dérive lente s'installe puis est corrigée par un `seek` ou un
  `playbackRate` de ±10 % (audible, `preservesPitch` ou pas).
- `STALL_RATIO = 0.5` compare l'avance de `api.timePosition` à `dt` mural :
  c'est correct sur le principe (l'axe public avance bien à 1×), mais le seuil
  est grossier — un jank du main thread ou un underrun passager peut le
  déclencher et geler la correction alors que l'audio continue. Le vrai
  symptôme n'est pas la vitesse utilisateur (qui ne change pas l'axe public),
  c'est la combinaison jank + `readyState` + seek asynchrone.
- `setRate()` écrit `playbackRate` au démarrage, mais n'incrémente pas
  `nRate` : les métriques browser annoncent « 0 écriture » alors que le
  taux initial peut être ≠ 1.
- `onState(Playing)` appelle `resync()` puis `a.play()` sans attendre
  `canplay`/`seeked` : sur un MP3 fraîchement décodé, le seek peut être
  ignoré, l'audio démarre à 0, puis saute.
- `<audio>` et l'AudioWorklet sont deux pipelines distincts (deux clocks,
  deux buffers). Chaque `currentTime =` ou `playbackRate =` reconfigure le
  décodeur média ; c'est la source directe des « saccades » même quand
  `nSeek`/`nRate` restent faibles.

### 3.5 Preuve C4 — le pré-cuit n'est pas exact

`prebake()` calcule :

```js
const bpm = nativeAt(tick) / notSlope;
```

- `nativeAt(tick)` est le tempo **natif au début du segment** ;
- `notSlope = Δaudio / ΔsynthTime` intègre les changements de tempo natifs
  **à l'intérieur** du segment.

Si le segment contient un ou plusieurs `tempoAutomations`, les deux ne se
compensent pas. L'axe `points[].t` (intégration de `notSlope`) et le temps
réel du MIDI pré-cuit divergent. Mesures : **205 ms** (Four Horsemen),
78 ms (Blink), 69 ms (Sepultura), 67 ms (AC/DC), 58 ms (Led Zeppelin),
42 ms (Slayer). Le contrôleur voit cette erreur comme une dérive et écrit
`playbackRate`/`seek` pour la corriger.

De plus, si le premier point de synchro n'est pas au tick 0, aucun tempo
n'est écrit au tick 0 : le séquenceur part à **120 BPM** jusqu'au premier
point. Latent sur les échantillons actuels (premier tick = 0 partout),
mais faux par construction.

### 3.6 Preuve C5 — la classification « saut » est trop agressive

`JUMP_SLOPE = 3`, `SLOPE_MIN/MAX = 0,5/2` :

- **Iron Maiden M.5** : 3 sauts + 2 hors plage sur 1,4 s (pentes 3,27 à
  11,27). C'est une transition de tempo réelle (intro), pas une
  discontinuité : le code fait 3 seeks au lieu de laisser le MIDI suivre.
- **Fins de morceau** : Blink +7,6 s, Helloween +8,8 s, Igorrr Headbutt
  +7,7 s, Come as you are +8,4 s, Mr. Moustache +6,1 s. Le dernier point
  de synchro est traité comme un saut ; l'audio est coupé/avancé alors
  que c'est simplement une **queue d'outro** plus longue que la dernière
  mesure.
- **Mr. Moustache, 2ᵉ partie** : 10 segments hors plage (2,0 à 2,99) sur
  31 s. Le pré-cuit clampe à 2, l'audio doit rattraper à 1,0-1,5× : c'est
  le « ralentissement/accélération soudaine ».

Une pente > 2 n'est pas forcément un saut : c'est un changement de tempo
que le MIDI peut suivre si on autorise un BPM plus large (10-500 BPM) et
qu'on pré-cuit correctement. Un saut ne devrait être reconnu que si
l'audio **recule** ou si la structure de partition (renvoi, reprise,
saut) le justifie.

### 3.7 Preuve C6 — le nouveau sample est un cas d'école

`Nirvana (1989 - Bleach) - Mr. Moustache.gp` :

- 45 mesures, 2 pistes, tempo **noté 120** mais audio réel ≈ **167 BPM** ;
- **121** points GPIF, **103** générés après oracle → **18 clés manquantes** ;
- oracle : **0 groupe levé**, H1 1 détecté / 0 appliqué / 1 rejeté ;
- 2 sauts avant, **10 pentes hors plage**, saut de fin **+6,1 s** ;
- MIDI natif 228,0 s → pré-cuit 184,7 s ; audio utile **201,1 s** :
  **16,2 s de musique non couverte** ;
- structure : 7 groupes multi-fins, deux voltes adjacentes
  M.30-M.32 (M.31 = fin 1, M.32 = fin 2 + D.S. al Coda), M.42-M.45 ;
- navigateur réel, 30 premières secondes : 46 ms, 0 écriture → 🟡,
  alors que les problèmes commencent vers 1:18.

**Test de seek réel** : `gotoBar(26)` (M.27) → audio 0:36 / M.12 au lieu
de 1:18 / M.27. Le harnais navigateur ne teste que le départ à 0, donc
il ne voit pas ce bug.

### 3.8 Pourquoi les harnais sont verts

| harnais | angle mort |
|---|---|
| `mix-sync-harness` | `api.timePosition` et `sim.now` avancent **en lockstep** ; `<audio>` factice ; pas de jitter, pas de seek async, pas de `readyState`, pas de latence worker |
| `sync-audit` | modélise encore l'ancien moteur de tempo pré-P2 (`TEMPO_EPS`, `speedAt`) ; n'exécute pas le contrôleur livré |
| `tempo-correct-sim` | modèle pré-P2, conservé comme référence |
| `repeat-check` | vérifie seulement « pas de régression » ; 18 clés manquantes passent |
| `duration-check` | vérifie « fin webapp ≤ MP3 » ; une outro coupée passe |
| navigateur | 21-30 s depuis 0, 1 échantillon/s, exclut la 1ʳᵉ fenêtre, ne compte pas `setRate`, ne teste ni seek ni boucle ni vitesse |
| `barocc-instrument` | classe H1/H2 mais ne vérifie pas la **chronologie** des points |

**Conclusion méthodologique** : un test qui reconstruit la même cible que
le code ne peut pas détecter une cible fausse. Il faut confronter la cible
aux **points GPIF** et aux **ticks de performance**, pas seulement à
`audio.currentTime - target`.

---

## 4. Liste des bugs / erreurs d'implémentation

### 4.1 Critiques

| ID | Fichier / lignes | Bug | Correctif |
|---|---|---|---|
| **B1** | `js/player.js` 423-451 (`seekTick`, `gotoBar`) | tick partition écrit comme tick performance | convertir via `api.tickCache.getMasterBarStart()` / `masterBarLookup` ; fallback mesure jamais jouée |
| **B2** | `js/player.js` 981-991 (`setLoopRange`) | `range.startTick = bars[a].start` (partition) | utiliser `entry.start` / `entry.end` de `tickCache` (performance) |
| **B3** | `js/app.js` 364-404 (`fillLoopSelects`, `barIndexAt`) | indexe les ticks performance avec les starts partition | indexer `tickCache.masterBars` (performance) |
| **B4** | `js/player.js` 404, 438, 450 + `js/mix-sync.js` 445-451, 457-463 | `resync()` après seek avec `api.timePosition` périmé ; `isSeek` ignoré | passer l'événement à `onPosition(e)` ; sur `isSeek`, recaler immédiatement avec `e.currentTime` ; ne pas appeler `resync` sur un tick non encore appliqué |
| **B5** | `js/repeat-oracle.js` 255-295 | groupes multi-fins ignorés ; pas de baisse ; max d'occurrence au lieu de séquence | alignement global GPIF (voir §5.2) |
| **B6** | `js/player.js` 609-653 | `normalizeMultiClosingRepeats` casse les fins adjacentes (M.31/M.32) | garder chaque fin jouable ou remplacer par un plan de lecture piloté GPIF |
| **B7** | `js/mix-sync.js` 278-319 | pré-cuit `bpm = nativeAt/notSlope` inexact ; pas de tempo à 0 | `bpm = Δtick·60000/(division·Δaudio)` ; tempo à 0 ; recalcul de `points[].t` depuis le MIDI réel |
| **B8** | `js/mix-sync.js` 59-100, 151-210 | `JUMP_SLOPE=3`, clamp `[0,5;2]` : tempos et outres pris pour des sauts | élargir selon BPM 10-500 ; saut = audio qui recule ou structure ; tail séparée |
| **B9** | `js/mix-sync.js` 381-395 | intégration `performance.now()` au lieu de `timePosition × speed` | supprimer l'intégration ; PLL lent optionnel |
| **B10** | `js/audio-sync.js` + `<audio>` | deux horloges, seeks/rates média coûteux | `AudioBuffer` + `AudioBufferSourceNode` dans l'AudioContext du synthé |

### 4.2 Majeures

| ID | Bug | Correctif |
|---|---|---|
| **B11** | `onState`/`resync` démarre l'audio avant `canplay`/seek effectif | attendre `decodeAudioData`/`readyState` ; audio buffer |
| **B12** | saut de fin : `playerFinished` coupe l'audio sur la fin du MIDI | jouer la queue audio jusqu'à `lastGP.syncTime` ; fade de fin |
| **B13** | `STALL_RATIO` (50 %) trop grossier : un jank/underrun passager gèle la correction | seuil plus bas + `audio.paused`/`readyState` et/ou audio buffer (P2) |
| **B14** | `setRate` non instrumenté ; taux initial ≠ 1 non mesuré | instrumenter toutes les écritures (`setRate`, `resync`) |
| **B15** | `fixEmptyAnacrusis` force toute anacrouse vide en mesure pleine | décider d'après la portée audio GPIF (déjà dans duration-check) |
| **B16** | `refreshSpeedLabel` affiche le tempo noté, pas le tempo audio | afficher le BPM pré-cuit / réel |
| **B17** | `fromScore` force `audio/mpeg` pour tout format | détecter WAV/OGG/M4A |
| **B18** | `setSource` révoque deux fois l'URL | un seul propriétaire |

### 4.3 Mineures / dette

- `advanceMusicalClock` et `musMs` deviennent inutiles si B9 est corrigé.
- `barMap` : les mesures jamais jouées (M.32 de Mr. Moustache) n'ont pas
  d'entrée performance ; l'UI doit le signaler.
- `normalizeMultiClosingRepeats` est appliqué à chaque `_playThroughSong`
  mais `raise` l'ignore ; deux logiques à réunifier.
- `duration-check` parse le MP3 par trames : sur AC/DC il trouve 207 s
  alors que le conteneur en fait 310 s (l'audio utile s'arrête toutefois
  vers 207,6 s). À remplacer par une mesure de contenu réel.
- `deploy/gp8-web` était périmé (14 samples) ; reconstruit le 2026-11-26
  (17 samples, Mr. Moustache inclus).

---

## 5. Plan de correction définitif

### Principe directeur

1. **Un seul axe de référence en lecture** : `api.timePosition` (déjà
   échantillonné par le synthé) × vitesse utilisateur. Pas d'intégration
   `performance.now()`.
2. **L'audio reste natif (1,0×)** en lecture normale. Tout l'écart de
   tempo est **pré-cuit dans le MIDI**, pas absorbé par un time-stretch
   du MP3.
3. **La carte de synchro est la vérité GPIF**, pas une heuristique
   d'occurrences. Si le déroulé alphaTab ne couvre pas les points GPIF,
   on corrige le déroulé (ou on construit un plan de lecture), pas la
   vitesse de l'audio.
4. **Un saut = un seek**, et seulement pour une vraie discontinuité
   (audio qui recule, renvoi structurel). Pas de seek pour un tempo ou
   une outro.
5. **Une seule horloge audio** : décoder le MP3 en `AudioBuffer` et le
   jouer dans l'`AudioContext` du synthé (ou, à défaut, utiliser
   `timePosition` comme référence unique et ne jamais écrire
   `playbackRate` en régime établi).

### Phase P0 — Temps, seeks, boucles, fin (bloquant, faible risque)

> **État 2026-11-26 : APPLIQUÉ.** `tools/sync-coherence.js` mesure axe = 0 ms
> et tail = 0 sur 17/17 ; `tools/browser/p0-check.js` valide seek M.27 et
> boucle M.12-13. Les clés GPIF (P1) restent ouvertes.

**P0.1 Traduction tick partition ↔ tick performance**

Dans `player.js` :

```js
function perfEntryOfBar(idx) {
  const tc = S.api && S.api.tickCache;
  if (!tc) return null;
  return tc.masterBars.find(e => e.masterBar.index === idx) || null;
}
function perfStartOfBar(idx) {
  const e = perfEntryOfBar(idx);
  return e ? e.start : null;
}
function perfEndOfBar(idx) {
  const e = perfEntryOfBar(idx);
  return e ? e.end : null;
}
```

- `gotoBar(delta)` : cible = `perfStartOfBar(next)` ; si `null`
  (mesure jamais jouée), prendre la première mesure jouée suivante ou
  précédente et afficher un toast.
- `setLoopRange(a,b)` : `startTick = perfStartOfBar(a)`,
  `endTick = perfEndOfBar(b)` (ou `perfStartOfBar(b+1)` si la mesure b
  est incomplète/anacrouse).
- `barIndexAt(tick)` : parcourir `tickCache.masterBars` (triés par
  `.start` performance) et renvoyer `.masterBar.index` ; fallback
  partition pour les ticks hors performance.
- `seekTick(tick)` : renommer `seekPlaybackTick` et n'accepter que des
  ticks performance ; ajouter `seekScoreTick` qui convertit.

**Critère** : Mr. Moustache M.27 → audio 77,99 s ; AC/DC M.27 →
142,49 s ; boucle M.12-M.13 de Mr. Moustache → 49,3-50,7 s.

**P0.2 Seek immédiat et boucle propre**

```js
api.playerPositionChanged.on(e => {
  App.updatePosition(e);
  MixSync.onPosition(e);          // e contient isSeek / currentTime
});
```

Dans `MixSync.onPosition(e)` :

```js
if (e && e.isSeek) {
  musMs = (e.currentTime || 0) * curSpeed();
  musRef = -1;
  leadIn = false;
  seekTo(targetSeconds());
  setRate(curSpeed());
  lastControl = lastWrite = performance.now();
  return;
}
```

- Ne plus appeler `MixSync.resync()` juste après un `tickPosition` non
  appliqué ; laisser `isSeek` faire le travail (ou utiliser le tick
  demandé pour calculer la cible).
- Sur une boucle, le seek audio doit être **immédiat** (un seul), pas
  attendre les 250 ms de la boucle de contrôle.

**Critère** : boucle A→B : un seul `seek`, dérive < 10 ms après la
frontière, pas de double lecture.

**P0.3 Pré-cuit exact**

Remplacer la formule `nativeAt/notSlope` par la formule **tick/audio** :

```js
// pour un segment continu p→q :
const dTick = q.tick - p.tick;
const dAudio = q.a - p.a;
const bpm = dAudio > 0 ? dTick * 60000 / (division * dAudio) : bpmPrec;
```

- écrire un tempo au tick 0 (tempo natif ou premier BPM) ;
- pour un saut, utiliser la pente du bloc destination (comme aujourd'hui)
  mais **ne pas clamper** avant d'avoir vérifié la plage BPM ;
- après écriture, recalculer `points[].t = timeAtTick(midi, tick + shift)`
  depuis la carte de tempo réellement produite (ou réutiliser la même
  formule, qui est exacte par construction) ;
- vérifier dans un harnais : `|points[].t - timeAtTick(midi)| < 1 ms`.

**Critère** : `axe < 5 ms` sur les 17 fichiers (aujourd'hui 10 fichiers
échouent, pire 205 ms).

**P0.4 Fin de morceau / outro**

- Identifier un **tail** : dernier segment de pente > 3 avec `dA > 0`,
  ou `lastGP.syncTime > preEnd`.
- Ne pas le traiter comme un saut. Laisser l'audio continuer après la
  fin du MIDI jusqu'à `lastGP.syncTime`, avec un fade de 100-300 ms.
- `playerFinished` ne doit couper l'audio que si `audio.currentTime >=
  audioEnd - epsilon` ; sinon programmer l'arrêt à `audioEnd`.
- `App.updatePosition` doit utiliser la fin audio pour la barre de
  progression (ou afficher la fin MIDI + queue).

**Critère** : Blink 170,2 s, Helloween 300,3 s, Mr. Moustache 201,1 s,
Igorrr Headbutt 223,6 s, Come as you are 215,7 s sont joués jusqu'au
bout ; pas de saut de fin.

**P0.5 Classification saut/tempo**

- `JUMP` si `dA < 0` (audio recule) **ou** si la structure de partition
  au point courant est un renvoi/saut (repeat/DS/DC) avec un écart
  incompatible avec un tempo.
- Sinon, traiter comme **tempo** : autoriser `SLOPE_MIN/MAX` dérivés des
  limites BPM (10-500) plutôt que `[0,5;2]`. Le pré-cuit suit, l'audio
  reste à 1,0×.
- Pour les segments > 2 mais < limite, ne pas clamper à 2 ; écrire le
  BPM réel et laisser `points[].slope = 1,0`.
- Pour Iron Maiden M.5, le pré-cuit doit jouer un ralentissement
  progressif (ou un tempo très bas sur les points concernés), pas 3
  seeks.

**Critère** : Iron Maiden intro : 0 seek, 0 hors plage ; Mr. Moustache
2ᵉ partie : 0 hors plage ; Four Horsemen : 1 seul saut arrière
(‑288 s) et 2 sauts avant structurels justifiés.

---

### Phase P1 — Alignement global GPIF / déroulé (cœur de la synchro)

> **État 2026-11-26 : APPLIQUÉ.** `js/repeat-oracle.js` construit un plan de
> lecture GPIF (LCS sur les mesures + occurrences réécrites + parcours direct
> `generateMasterBar` / `generateTracks` / `_processBarTime`). L'audit
> `sync-coherence` donne **0 clé manquante sur 17/17**. Le détail ci-dessous
> est conservé comme spécification de l'algorithme retenu.

**P1.1 Remplacer l'heuristique `RepeatOracle` par un alignement de
séquences.**

Algorithme proposé :

1. **Séquence jouée** : instrumenter `_playThroughSong` (déjà fait par
   l'oracle) pour produire la liste ordonnée
   `P = [(barIndex, occurrence, playbackTick)]` (pas seulement le max).
2. **Séquence GPIF** : trier les points GPIF par `millisecondOffset`,
   puis les regrouper en passes `(barIndex, occurrence)` ; conserver
   `ratioPosition` et `audioMs`.
3. **Alignement** : LCS/DTW sur les `barIndex` (pas les occurrences),
   dans l'ordre chronologique audio. On obtient :
   - points GPIF appariés à une passe jouée → réassigner
     `syncPointValue.barOccurence` à l'occurrence réelle ;
   - points GPIF non appariés → candidate à une **reprise manquante**
     (insérer une passe) ou à une **section audio-only** (ignorer) ;
   - passes jouées sans point GPIF → interpolation.
4. **Recherche de correction** : tester `repeatCount` **à la hausse et à
   la baisse** (par exemple `saved-8 … saved+8`), y compris les groupes
   multi-fins, avec une fonction de coût :
   `coût = 1000·clés_manquantes + 100·sauts + 20·hors_plage +
   10·|taux_moyen-1| + passes_non_appariées`.
5. **Garde** : accepter une correction seulement si le coût baisse **et**
   si aucun segment d'audio ne recule sans justification.
6. **Itérer** jusqu'au point fixe (plafond 8 passes) ; beam search de
   largeur 3-5 pour éviter l'explosion combinatoire.

**P1.2 Cas des fins adjacentes**

Pour M.30-M.32 (Mr. Moustache), la normalisation actuelle supprime la
première fin. Il faut soit :
- patcher `MidiPlaybackController.processCurrent()` pour évaluer les
  `alternateEndings` même quand la fin précédente a été sautée ;
- soit construire un **plan de lecture** explicite (liste de mesures)
  à partir des points GPIF, et générer le MIDI avec ce plan.

**P1.3 Si l'alignement ne suffit pas : plan de lecture piloté GPIF**

Pour les fichiers dont l'audio contient des sections absentes de la
partition (ou l'inverse), construire une séquence de mesures
`plan = [bar0, bar1, …]` à partir de l'ordre audio des points GPIF,
puis générer le MIDI en appelant `MidiFileGenerator._generateBar` dans
cet ordre (avec les `synthTick` cumulés). La partition affichée reste
celle du fichier ; seul le **déroulé MIDI** suit l'audio. C'est la seule
façon de garantir 0 saut pour les arrangements divergents.

**Critère** : `tools/sync-coherence.js --strict` :
- `manq = 0` sur les 17 fichiers (ou liste d'exceptions audio-only
  documentée et justifiée par GPIF) ;
- **`perd = 0`** : la séquence de notation brute P doit être une
  sous-séquence du plan (LCS). Une passe perdue fusionne deux mesures et le
  pré-cuit étire la première (tempo ÷ 2) — c'était la régression v1.3,
  corrigée le 27/11/2026 : 136 passes perdues sur 17 fichiers, dont la
  2ᵉ passe de M.3 dans For Whom the Bell Tolls et le 2ᵉ passage du thème de
  The Four Horsemen ;
- plus aucun saut avant non structurel ;
- `barMap` corrigé (via P0).

> **Affinage temporel (27/11/2026)** : quand les ancres GPIF sont espacées,
> le LCS par indice de mesure choisissait une occurrence de notation trop tôt
> (Mr. Moustache : la 1ʳᵉ paire M.2/M.3 étirée sur 4 mesures). `refinePairs`
> choisit maintenant, pour chaque ancre, l'occurrence de **même mesure** qui
> minimise l'écart entre l'écart audio et l'écart de notation (durée médiane
> locale), par DP bornée (+4 mesures, pénalité de déviation, ordre strict).
> Résultat Mr. Moustache : M.1-M.3 à 0,72-0,74 mesure/s sur **toutes** les
> occurrences (avant : 0,36 pour la première M.2).
>
> **Limite connue** : les passes **audio-only** entre deux ancres GPIF
> espacées (ex. Four Horsemen M.23-M.29 aux passages ≈ 1:14 et ≈ 5:14) restent
> étirées : le plan ne peut pas inventer les mesures intermédiaires que la
> notation ne joue pas. Piste : remplir l'écart entre ancres avec l'ordre des
> mesures du groupe de reprise, borné par l'écart audio. Les points restants
> (Four Horsemen, Mr. Moustache M.10/M.29/M.42, Mony Mony) sont consignés dans
> **`RESTE-A-ANALYSER.md`**, avec les durées et les timestamps.
>
> **Mony Mony (2026-11-28)** : les reprises **internes** (M.6 ×2, M.9 ×4,
> M.10 ×3, M.12 ×2) semblent consommées lors de la première traversée de
> M.1-M.14 ; la seconde traversée n'en garde qu'une passe dans P, alors que
> l'audio/GPIF les rejoue. D'où 39/70 appariements LCS, 31 ancres audio-only,
> 35 passes de notation non ancrées, 105 pas de plan pour 39 mesures, et des
> étirements ×2 à ×3 à 96/107/112/229/234/249/254 s. Le pré-cuit reste
> cohérent avec la carte GPIF (axe 0 ms), mais le tempo musical est faux dans
> ces sections. Piste : réinitialiser les compteurs de reprise imbriqués à
> chaque traversée externe, ou remplir les écarts entre ancres. Le contrôle
> **P1.5 `tempo-strict-check`** fige les 53 exceptions actuelles et échoue si
> une nouvelle mesure devient anormale.

---

### Phase P2 — Moteur audio (supprimer les saccades résiduelles)

> **État 2026-11-26 : APPLIQUÉ (P2 + P2b).** `js/audio-sync.js` décode le MP3
> en `AudioBuffer` et le joue dans l'AudioContext du synthé. À vitesse ≠ 1,
> bascule sur un `<audio>` `preservesPitch` routé dans le même contexte
> (`MediaElementAudioSourceNode`). `p2-check` : 17/17 ✅, dérive **2-8 ms**,
> 0 écriture `playbackRate`, 0 seek de correction en régime établi.

**Option recommandée : `AudioBuffer` + `AudioBufferSourceNode`.**

1. Récupérer l'`AudioContext` du synthé :
   `api._player._instance._output.context` (mode synthé).
2. `decodeAudioData(rawAudioFile)` → `AudioBuffer` (une fois par fichier).
3. Chaîne : `source → GainNode (volume/mute) → destination`.
4. Lecture :
   - calculer `offset` depuis la carte de synchro (cible audio) ;
   - `source.start(ctx.currentTime + 0.05, offset)` ;
   - calibrer **une fois** le décalage constant entre le début du
     worklet et `ctx.currentTime` (mesure de 200 ms) ; ne pas corriger
     en continu ;
   - sur pause/seek : `source.stop()` puis recréer la source à l'offset
     cible. Un seek AudioBuffer est instantané et sans décodage.
5. Aucune écriture `playbackRate` en régime établi : le MIDI pré-cuit
   suit l'audio. Le taux reste 1,0.
6. Vitesse utilisateur :
   - soit `source.playbackRate = v` (léger changement de hauteur) ;
   - soit garder `<audio preservesPitch>` **uniquement** pour ce mode ;
   - soit un time-stretch WSOLA dans un AudioWorklet (phase ultérieure).
7. Garder `<audio>` en fallback si `decodeAudioData` échoue.

**Si cette bascule est jugée trop lourde**, minimum vital sur
`<audio>` :
- `musMs = api.timePosition * curSpeed()` (pas d'intégration) ;
- `onPosition(e)` + `isSeek` ;
- ne jamais écrire `playbackRate` dans la zone morte ;
- ne corriger que si `|drift| > 150 ms` et au plus une fois toutes les
  5 s ;
- attendre `canplay`/`seeked` avant le premier `play` ;
- `STALL_RATIO` affiné (jank/underrun, pas la vitesse utilisateur).

**Critère navigateur réel** :
- dérive < 10 ms sur 5 min, y compris après seek/boucle ;
- 0 écriture `playbackRate` en régime établi ;
- 0 seek sur un morceau continu ;
- 1 seek exact par discontinuité ;
- aucune saccade audible au casque.

---

### Phase P3 — Tests et instrumentation

1. **`tools/sync-coherence.js`** (ajouté) : audit de la carte, des clés,
   de l'axe, des tails, du barMap. `--strict` devient le test de sortie.
2. **`mix-sync-harness`** : ajouter
   - une horloge audio indépendante avec jitter (dérive sinusoïdale +
     sauts) ;
   - des seeks asynchrones et `readyState` transitoires ;
   - la vérification de `setRate`/`resync` (pas seulement `correct`) ;
   - des scénarios de boucle et de vitesse 0,4×/1,5×.
3. **`repeat-check`** : passer de « non-régression » à
   « 0 clé manquante » (avec exceptions audio-only listées) ; inclure le
   nouveau sample et un REF explicite.
4. **`sync-audit`** : supprimer le moteur de tempo pré-P2 ou le brancher
   sur le contrôleur livré ; ne pas garder deux vérités.
5. **Navigateur** :
   - tester 0 %, 25 %, 50 %, 75 % du morceau (pas seulement 0) ;
   - tester `gotoBar`, boucle A→B, seek, vitesse ×0,5/×1,5 ;
   - mesurer `audio.currentTime` et `api.timePosition` à 20 Hz ;
   - compter **toutes** les écritures `playbackRate`/`currentTime`
     (setters proxy) ;
   - comparer la position audio aux **points GPIF** (pas à la cible du
     code).
6. **`duration-check`** : vérifier que la dernière position audio
   atteinte = dernier point GPIF (pas seulement ≤ durée MP3) ; mesurer
   le contenu audio réel, pas le conteneur.
7. **Ajouter Mr. Moustache** aux fiches d'écoute et aux références de
   non-régression (voir §7).

**Critère** : `node tools/test-all.js` vert **et**
`node tools/sync-coherence.js --strict` vert ; navigateur 17/17 avec
scénarios de seek/boucle.

---

### Phase P4 — Finitions produit

- BPM affiché = BPM réel pré-cuit / audio (pas `score.tempo`).
- Barre de progression et fin = audio (queue incluse).
- Indicateur « mesure non jouée » pour les mesures sans occurrence
  performance (M.32 de Mr. Moustache).
- Fade de fin 100-300 ms pour éviter le clic.
- Message console `[mix]` synthétique : `points`, `jumps`, `off`,
  `tail`, `axis`, `barMap`.
- Documenter les exceptions audio-only dans `BUGFIX-TOTAL.md`.

---

## 6. Ce qu'il ne faut PAS refaire

| Piste | Pourquoi c'est une impasse |
|---|---|
| Réintroduire `playbackSpeed` en lecture pour suivre le tempo | chaque écriture coupe le synthé (`AlphaSynth.updatePlaybackSpeed → seek`) ; RC-2/RC-3 reviennent |
| Corriger la dérive par des `playbackRate` permanents | time-stretch audible, `preservesPitch` imparfait, saccades média |
| Se fier à `barOccurence` comme identifiant absolu | GP et alphaTab ne comptent pas les mêmes passes (H1/H2) ; c'est la racine des 90 clés manquantes |
| Relever `repeatCount` uniquement à la hausse, groupe par groupe | optimum local ; ne couvre ni les multi-fins, ni les baisses, ni les réordonnancements DS/DC |
| Classer tout `slope > 3` en saut | les tempos réels et les outres ne sont pas des discontinuités |
| Considérer `mix-sync-harness` vert comme preuve d'écoute | il utilise la même cible et une horloge parfaite |
| Time-stretcher tout le MP3 pour cacher un trou de déroulé | c'est le symptôme « ça ralentit/accélère » que l'on veut supprimer |

---

## 7. Fiche d'écoute — Nirvana, Mr. Moustache (nouveau sample)

`Nirvana (1989 - Bleach) - Mr. Moustache.gp`

**Angle** : voltes multi-fins adjacentes + D.S. al Coda + tempo audio
très différent du tempo noté (120 → ≈167 BPM) + outro longue.

**Machine** : 45 mesures · 2 pistes · 121 points GPIF · **121 générés
(plan GPIF)** · **0 clé manquante** · 1 saut structurel · 0 hors plage ·
MIDI plan 224,0 s → pré-cuit 200,8 s · audio 201,1 s.

| # | Repère | Attendu | Verdict |
|---|---|---|---|
| 1 | M.1-M.3, 4 passes | tempo ≈167 BPM, pas de dérive | |
| 2 | M.6-M.7 (5 passes jouées, GP jusqu'à 7) | pas d'accélération/ralentissement ; aucun saut | |
| 3 | M.30-M.32 (fins 1/2 + D.S. al Coda) | M.31 **et** M.32 jouées, une seule transition | |
| 4 | M.42-M.45 (2 fins) | ordre correct, pas de mesure sautée | |
| 5 | ≈ 3:21 (201,1 s) | l'outro va jusqu'au bout, pas de coupure | |
| 6 | seek M.27 | arrive à **1:18** (77,99 s), pas à 0:36 | |
| 7 | boucle M.12-M.13 | boucle 49,3-50,7 s, un seul seek | |
| 8 | global | audio natif (pas de voix accélérée), MIDI collé | |

**Verdict actuel attendu** : ❌ sur 2, 3, 4, 5, 6, 7 ; le test navigateur
30 s à 0 ne les voit pas.

---

## 8. Ordre d'exécution recommandé

1. **P0.1 + P0.2** (ticks + isSeek) : ½ journée, gain immédiat sur tous
   les seeks/boucles. C'est le correctif le plus rentable.
2. **P0.3 + P0.4 + P0.5** (pré-cuit exact, tail, classification) :
   1-2 jours, supprime les corrections de taux et les outres coupées.
3. **P1.1 + P1.2** (alignement GPIF) : 3-5 jours, le cœur. Commencer par
   un mode « audit » qui n'active les corrections que si le coût baisse.
4. **P2** (AudioBuffer) : 2-3 jours, élimine les saccades résiduelles.
5. **P3/P4** : 1-2 jours, verrouille et documente.

**Jalon de sortie** :

```bash
node tools/test-all.js
node tools/sync-coherence.js --strict
cd tools/browser && npm run test:all   # 17/17 + scénarios seek/boucle
```

DoD :
- 0 clé GPIF manquante non justifiée ;
- `axe < 5 ms` ;
- audio natif (aucun time-stretch permanent) ;
- 1 seek par discontinuité réelle, 0 saut de fin ;
- seek/boucle exacts sur les mesures répétées ;
- dérive < 10 ms sur 5 min en navigateur réel ;
- écoute des 17 fiches conforme.

---

## 9. Annexes

### 9.1 Fichiers modifiés / ajoutés par cette analyse

- `samples/list.json` : + `Nirvana (1989 - Bleach) - Mr. Moustache.gp`
  (count 16 → 17).
- `deploy/gp8-web/` : reconstruit (17 samples, liste à jour).
- `js/mix-sync.js` / `js/player.js` / `js/app.js` : P0.
- `js/repeat-oracle.js` : P1 — plan de lecture GPIF (LCS, occurrences,
  parcours direct du générateur).
- `js/audio-sync.js` : P2 — `AudioBufferSourceNode` dans l'AudioContext du
  synthé (fin du `<audio>` maître) ; P2b — bascule média `preservesPitch`
  à vitesse ≠ 1.
- `tools/sync-coherence.js` : audit (branché dans `test-all` en `--strict`).
- `tools/browser/p0-check.js` : test navigateur P0 (seek M.27 + boucle
  M.12-13 en ticks performance).
- `TESTLOG.md` : fiche Mr. Moustache ajoutée.
- `ANALYSE-AUDIO-SYNC-2026-11-26.md` : ce document.

### 9.2 Commandes de diagnostic

```bash
# état de la carte de synchro, tous les samples
node tools/sync-coherence.js

# un fichier, puis la cible stricte
node tools/sync-coherence.js --gp "samples/Nirvana (1989 - Bleach) - Mr. Moustache.gp"
node tools/sync-coherence.js --strict

# contrôleur réel (banc)
node tools/mix-sync-harness.js --gp "samples/Nirvana (1989 - Bleach) - Mr. Moustache.gp" --verbose

# navigateur (après npm i dans tools/browser)
node tools/browser/run.js --sample "Mr. Moustache" --seconds 30 --verbose
cd tools/browser && npm run test:p0
cd tools/browser && npm run test:p1
```

### 9.3 Glossaire

- **GPIF** : `Content/score.gpif` dans le `.gp` ; porte les `SyncPoint`
  (mesure, occurrence, ratio, millisecondes audio).
- **Tick partition** : `masterBar.start`, sert à l'affichage.
- **Tick performance** : tick du MIDI après reprises/renvois, seul axe
  compris par le séquenceur.
- **Axe pré-cuit** : timeline du MIDI après réécriture des tempos.
- **Clé GPIF** : couple `mesure.occurrence` ; une même clé peut porter
  plusieurs points (tempo en cours de mesure).

---

*Fin du document. Les mesures de ce rapport sont reproductibles avec
`tools/sync-coherence.js` sur le commit `84395ea` + le sample Mr.
Moustache.*
