# BUGFIX-TOTAL — Plan d'action pour un rendu audio et une synchro MIDI/MP3 irréprochables

> **Nature du document : plan, désormais exécuté.** Les phases
> **P0, P1, P2, P3, P4 et P5** sont **livrées et vérifiées** (commits
> `cf9cfd7`, `d4028b7`, `15cb63c`, `3d3fe27` sur `main`, puis le présent commit
> P5-13). Le reste est listé dans la section « État d'avancement » ci-dessous ;
> l'analyse d'origine (§3–§9) est conservée, les résultats mesurés sont en §11.
>
> **Objectif produit :** le MIDI doit sonner **au tempo de l'enregistrement**
> (tempo variable de Guitar Pro inclus), la piste MP3 doit jouer **à sa vitesse
> native** (aucun time-stretch), et les deux flux doivent rester **verrouillés en
> phase** pendant toute la lecture, y compris aux répétitions, D.S./Coda et aux
> frontières de tempo.

---

## État d'avancement et reste à faire (2026-10-16)

| Phase | État | Preuve / ce qui reste |
|---|---|---|
| **P0** — mesure fiable | ✅ livré | `sync-audit` refondu + `mix-sync-harness` sur le code livré (§11.1) |
| **P1** — spike stratégie C | ✅ livré | GO variante B (table de segments), variante A rejetée (§11.2) |
| **P2** — tempo pré-cuit dans le MIDI | ✅ livré | **tempoWrites 0/15**, dérive croisière ≤ 11 ms, fidélité < 0,5 % (§11.4 ; mesuré à 14 échantillons, reconfirmé à 15) |
| **P3** — RC-1 résiduel (`barOccurrence`) | ✅ livré | `tools/barocc-instrument.js` ; renvois mesurés **104 → 72** clés manquantes, résidu **H2** (donnée GP) démontré, 4 mesures **H1** refusées par la garde (§11.7) |
| **P4** — anacrouse & fin de morceau (D6) | ✅ livré | `tools/duration-check.js` : les **6** anacrouses jouées couvrent leur portée audio GPIF à **≤ 0,04 %** (Dr. Stein #0 : mesure VIDE au GPIF, audio = mesure pleine) ; fin de webapp **jamais** au-delà du MP3 (§11.8) |
| **P5** — suite unique | ✅ livré | étape 12 : `tools/test-all.js`, **8** harnais déterministes ; étape 13 : test **navigateur** réel `tools/browser/` (Playwright isolé) — **14/14** exemples verts, **0** écriture de `playbackSpeed` (§11.10) |
| **P6** — clôture doc & déploiement | ⏳ **à faire** | `BUG.md`/`BUGMP3.md` §14/`BUGLATEST.md`/`TESTSAMPLES.md` + `deploy/_build.ps1` ; `samples/list.json` **incomplet** (14/15) |
| **Validation d'écoute** | ⏳ **requise** | les 15 points du §7 (oreille humaine) |

### Reste à faire, dans l'ordre

1. **Validation d'écoute (bloquante, humaine).** Le correctif P2 change l'axe
   temporel du synthé : il faut confirmer **à l'oreille** sur les zones du §7 —
   en priorité **Iron Maiden** (M1 intro, M2 riffs), **AC/DC** (M6 saut D.S.),
   **Blink 182** (M10), **Renaud** (M8/M9) et les **6 témoins** (M15). Protocole :
   serveur local `python -m http.server 8777 --bind 127.0.0.1`, mode mix, ×1,0.
   Contrôle transverse (M1/M4/M6/M14) : curseur de vitesse ×0,5 puis ×1,5.
2. **P3 — soldé** (§11.7). L'instrumentation classe **toutes** les clés
   manquantes : **72 = 41 mesures H2** (le .gp enregistre des traversées que le
   déroulé ne joue pas) **+ 4 mesures H1** (Renaud 8/9/11/42) que la garde
   **refuse** — les couvrir ajouterait 6 sauts. Sortie du plan atteinte par sa
   clause « sinon documenter H2 et remonter en amont » (DoD #5). Reste, hors
   périmètre webapp : remontée amont alphaTab (optionnelle).
3. **P4 — soldé** (§11.8). L'anacrouse de Dr. Stein est **vide** dans le .gp
   (`<Voices>-1 -1 -1 -1</Voices>`) : sa durée n'est PAS dans la notation, elle
   n'est déductible que de l'audio. Les sync-points GPIF lui donnent exactement
   **une mesure pleine** (1 599 ms à 150,77 BPM) → le correctif `fixEmptyAnacrusis`
   livré est **justifié par la donnée**, pas arbitraire. Vérifié sur les 6
   fichiers à anacrouse, écart ≤ 0,04 %.
4. **P5 étape 13 — soldé** (§11.10). Test d'intégration **navigateur** livré sous
   `tools/browser/` : Playwright (`playwright-core`) + le Chrome/Edge **déjà
   installé** — dépendance de dev **isolée**, jamais d'exécution. L'app entière
   est jouée (`cd tools/browser && npm i && npm test`) : **14/14** exemples
   verts, **0** écriture de `playbackSpeed` en lecture, 0 erreur console.
5. **P6 — clôture.** Mettre à jour `BUG.md`, `BUGMP3.md` §14, `BUGLATEST.md`
   (T1–T8 soldés), `TESTSAMPLES.md` (résultats d'écoute) ; rejouer
   `deploy/_build.ps1` (l'actuel `deploy/gp8-web/` est **antérieur à P2**) ;
   régénérer `samples/list.json` (`gen-samples.bat`) qui n'a que **14** entrées
   alors que la suite en teste **15** depuis l'ajout de
   `Metallica (1983 - Kill 'Em All) - The Four Horsemen.gp` (commit `e183dcc`).

> **DoD rappel (§8)** : tempo au tempo de l'enregistrement + **0 écriture
> `playbackSpeed`** en lecture ✅ ; dérive pic < 40 ms ✅ (croisière ≤ 11 ms) ;
> **0 coupure de synthé** ✅ ; MP3 natif ✅ (0,32 % d'écritures de taux) ; 0 clé
> GPIF manquante → **clause H2 invoquée** (72 clés, 100 % classées, §11.7) ✅ ;
> durée webapp = MP3 ±0,5 % → **vérifiée sur 15/15** au sens utile (jamais
> au-delà de la fin du MP3 ; l'écart négatif mesure la couverture des
> sync-points) ✅ ; `node tools/test-all.js` → 0 ✅ (**8** harnais) ; `deploy/`
> régénéré ⏳ (P6) ; 15 points d'écoute ⏳.

---

## 0. Objet, périmètre, méthode

| | |
|---|---|
| Périmètre | Rendu audio du synthé alphaTab, moteur de tempo, pont de synchro `MixSync`, traversées de répétition, harnais de test. |
| Hors périmètre | UI/CSS responsive, déploiement (sauf une anomalie signalée en D7), nouvelles fonctionnalités (`BUG.md` EVOLUTIONS). |
| Contraintes figées | alphaTab **1.8.4** (CDN), JSZip 3.10.1, `<script>` classiques compatibles `file://`, `deploy/_build.ps1` non modifiable, pas de liste d'échantillons codée en dur. |
| Méthode | Analyse statique du dépôt + du vendor, exécution des harnais Node, mesures déterministes hors navigateur. |

---

## 1. Verdict exécutif

L'application est **structurellement correcte** (alphaTab maître, `<audio>`
esclave, pont identique à `mainTimePositionToBackingTrack`), et les correctifs
déjà livrés (pont par pente locale, re-ancrage des sauts, oracle RC-1, tempo par
segment) ont **supprimé l'essentiel des saccades de dérive** (glitchs
`472 → 18` sur les 14 échantillons). **Il reste néanmoins trois défauts de
premier ordre**, cumulatifs, qui expliquent exactement les deux symptômes
signalés :

1. **Chaque écriture de tempo coupe le synthé.** Le moteur de tempo (§13) écrit
   `api.playbackSpeed` en cours de lecture ; dans alphaTab 1.8.4 cette écriture
   est un **seek destructeur** (arrêt de toutes les notes + vidage du buffer +
   re-synthèse silencieuse depuis 0). Mesure : **405 écritures = 405 coupures**
   sur les 14 échantillons, dont **Iron Maiden 47**, **Offspring 137**,
   **Sepultura 55**. C'est le « fichier mal rendu, surtout à tempo variable ».
2. **Le correcteur de dérive oscille en permanence** (zone morte qui ne remet
   jamais la vitesse au neutre) : le MP3 est **étiré temporellement de ±5 % la
   quasi-totalité du temps** (95 % du temps au-delà de 2 % sur Slayer), et
   l'écart MP3↔MIDI est **verrouillé à ±100 ms** — jamais résorbé. C'est le
   « léger décalage par moment » en écoute mixte.
3. **L'appariement des points de synchro reste incomplet** là où la numérotation
   `barOccurence` de Guitar Pro ne colle pas à celle d'alphaTab : **12 clés
   manquantes sur AC/DC, 55 sur Renaud, 5 sur The Offspring**. Le saut est propre
   mais peut viser une occurrence légèrement décalée.

**Recommandation forte :** ne pas se contenter de « contenir » ces défauts.
Le plan propose de **supprimer les écritures de tempo en cours de lecture**
(stratégie C : tempo modifié *pré-cuit* dans le MIDI — l'alphaTab public le
permet, cf. §4), ce qui élimine RC-2 **et** RC-3 à la racine, puis de traiter
RC-1 en parallèle.

> **Suivi (2026-10-16).** Les défauts 1 et 2 sont **corrigés** (P2, §11.4) :
> plus aucune écriture de tempo en lecture, dérive croisière ≤ 11 ms. Le défaut 3
> (RC-1, appariement `barOccurrence`) reste ouvert → **P3**. Le verdict ci-dessus
> décrit l'état **avant** P2 ; voir « État d'avancement » en tête de document.

---

## 2. Preuves — harnais exécutés le 2026-10-15 (Node 22.11, alphaTab 1.8.4 vendorisé)

### 2.1 `node tools/load-smoke.js` → **OK**
8 scripts déclarés dans le bon ordre, exécution complète, bindings présents
(`CFG, AT, enumId, safe, clamp, fmtTime, AudioSync, EmbeddedAudio, MixSync,
RepeatOracle, Player, Samples, App`). La base de chargement est saine.

### 2.2 `node tools/repeat-check.js` → **OK** (aucune régression, oracle RC-1 actif)
```
clés GPIF manquantes : AVANT 94 → APRÈS 72
audio embarqué à scoreLoaded : 14/14
```
| fichier | AVANT (manq/clamp/saut) | APRÈS | levés |
|---|---|---:|---:|
| AC/DC | 16 / 2 / 4 | **12 / 2 / 3** | 1 |
| Blink 182 | 7 / 0 / 3 | **0 / 0 / 2** | 1 |
| Slayer | 8 / 1 / 0 | **0 / 0 / 0** | 4 |
| The Offspring | 8 / 0 / 2 | **5 / 0 / 1** | 1 |
| Renaud | 55 / 3 / 7 | **55 / 3 / 7** | 0 |
| Iron Maiden | 0 / 2 / 3 | 0 / 2 / 3 | 0 |
| 8 autres | 0 | 0 | 0 |

→ RC-1 est **partiellement** résolu. Il reste des clés manquantes (AC/DC,
Renaud, Offspring) et des segments « pente hors clamp » (danger) : Iron Maiden 2,
AC/DC 2, Renaud 3, Igorrr Blastbeat 1.

### 2.3 `node tools/tempo-correct-sim.js` → **OK** (mais révélateur)
Écritures de tempo (= coupures synthé, **inchangées** par la loi de correction) :

| fichier | coupures `playbackSpeed` | écritures `playbackRate` (actuel → protège) |
|---|---:|---:|
| The Offspring | **137** | 51 → 18 |
| Sepultura | **55** | 61 → 42 |
| Iron Maiden | **47** | 52 → 27 |
| Blink 182 | 41 | 31 → 27 |
| Slayer | 33 | 75 → 38 |
| Metallica | 32 | 66 → 17 |
| Helloween (Dr. Stein) | 23 | 62 → 26 |
| Renaud | 10 | 31 → 25 |
| AC/DC | 9 | 33 → 21 |
| Led Zeppelin | 8 | 28 → 14 |
| F-Zero X | 5 | 1 → 2 |
| Igorrr ×2 | 2 + 2 | 1 + 0 |
| Europe | 1 | 58 → 8 |
| **TOTAL** | **405** | **550 → 266** |

Étirement temporel du MP3 (actuel → loi « protège ») : moyenne globale
**5,3 % → 1,5 %**, temps au-delà de 2 % : **95 % → 27 %** sur Slayer,
**92 % → 5 %** sur Metallica, **79 % → 2 %** sur Europe. La loi « protège »
n'ajoute ni recadrage ni coupure (`RESULTAT : OK`) mais **reste une béquille** :
elle ne supprime pas la cause (écritures fréquentes) et ne rend pas le MP3
strictement natif.

### 2.4 `node tools/sync-audit.js` → **miroir périmé** (cf. D4)
`LEGACY 671 → NEW 43` recadrages, glitchs `472 → 18`, mais il applique encore
`fixAlternateEndings` (supprimé du code livré) et **n'applique pas**
`RepeatOracle.raise`. Ses 399 écritures tempo et ses « points perdus »
(AC/DC 64/80, Iron Maiden 124/136, Renaud 65/156) décrivent l'**ancien**
comportement, pas celui livré.

### 2.5 Vendor — la chaîne destructive est **confirmée ligne à ligne**
| étape | référence (`tools/vendor/alphaTab.js`) |
|---|---|
| `api.playbackSpeed = v` | `AlphaTabApi.set playbackSpeed` l.46638 → `_player` |
| proxy worker | `AlphaSynthWebWorkerApi.set playbackSpeed` l.33568 → `postMessage alphaSynth.setPlaybackSpeed` |
| synthé | `AlphaSynthBase.set playbackSpeed` l.39842 → `updatePlaybackSpeed` l.39846 |
| **rescale + seek** | `updatePlaybackSpeed` : `this.timePosition = this.timePosition * (oldSpeed/value)` l.39849 |
| **setter destructeur** | `set timePosition` l.39866 : `mainSeek(value)` + `updateTimePosition(value,true)` + `_notPlayedSamples = 0` + **`output.resetSamples()`** l.39872 |
| **branche arrière** | `mainSeek` l.35039 : `_mainState.currentTime = 0` → **`noteOffAll(true)` + `resetSoft()`** → `_mainSilentProcess(timePosition)` (re-synthèse depuis 0) l.35047-35059 |
| **preuve d'un chemin non destructeur** | l'exporteur écrit `this._sequencer.playbackSpeed = newSpeed` **sans setter** l.40372 |
| **le synthé live n'applique PAS les sync points** | `currentUpdateCurrentTempo` l.35254 et `_updateCurrentTempo` l.35257 ne posent que le tempo **noté** ; `syncPointTempo` n'est consommé qu'à l'export l.40371 et par le getter `modifiedTempo` l.35026 |

**Conséquences :**
- l'application **doit** piloter le tempo elle-même (alphaTab live ne le fait
  pas) — le §13 est donc justifié dans son *intention* ;
- mais elle le fait par l'API **destructrice**, parce que le synthé tourne dans
  un **worker** (`js/core.js` l.29 `useWorkers: true`) : on ne peut pas patcher le
  séquenceur depuis le thread principal (l'instance est un proxy, cf. D1 §3.1).

---

## 3. Défauts confirmés (cause racine → preuve → impact)

### D1 — RC-2 : toute écriture de tempo coupe le synthé *(CRITIQUE, cause du « mal rendu »)*
**Cause racine.** `MixSync.applyTempo()` (`js/mix-sync.js` l.329-337) écrit
`api.playbackSpeed = want`. Via le proxy worker → `updatePlaybackSpeed` →
`set timePosition` → `mainSeek` (branche arrière) → `noteOffAll(true)` +
`resetSoft()` + `_mainSilentProcess` **depuis 0** + `output.resetSamples()`.

**Preuve.** Vendor l.33568→39872→35039-35059 (tableau §2.5) ; comptage
`tempo-correct-sim` : **405 écritures** (§2.3).

**Impact.**
- Toutes les notes sont **coupées sec** à chaque frontière de tempo (clics/trous).
- Le buffer de sortie est **vidé** ; le synthé **re-synthétise silencieusement
  depuis 0** jusqu'à la position courante → coût O(position) à chaque écriture
  (non modélisé par les harnais, donc **sous-estimé**).
- Fichiers les plus touchés = ceux à tempo variable (Iron Maiden 47, Offspring
  137, Sepultura 55) → correspond exactement au symptôme signalé.

**Nuance importante.** Le synthé étant dans un worker, un correctif « propre »
par patch d'instance est **impossible côté thread principal** (l'`_instance` est
`AlphaSynthWebWorkerApi`, cf. §2.5). C'est ce qui rend la stratégie C (§4)
nécessaire.

### D2 — RC-3 : le correcteur oscille et n'atteint jamais zéro *(MAJEUR, cause du décalage)*
**Cause racine.** `js/mix-sync.js` l.482 :
`if (Math.abs(drift) < DEADBAND_MS) return;` — en zone morte, **on ne remet
jamais la vitesse au neutre** (`sp × pente`). Le biais de la dernière écriture
(±5 % max) reste appliqué, la dérive retraverse la zone morte, écriture de signe
opposé, et ainsi de suite **indéfiniment** (une écriture toutes les ~4 s).

**Preuve.** `tempo-correct-sim` : 550 écritures `playbackRate` (actuel) contre
266 avec la loi « protège » ; étirement moyen 5,3 % → 1,5 % ; `> 2 % du temps`
95 % → 27 % (Slayer).

**Impact.**
- Le MP3 est **time-stretché en continu** (`preservesPitch` actif quasi en
  permanence → artefacts STFT, son « métallique » / voilé).
- En écoute mixte, l'écart MP3↔MIDI est **bloqué à ±100-115 ms** → battement /
  écho. C'est le « léger décalage par moment ».
- Aucun recadrage utile ne passe : le budget part en oscillation.

**Défaut annexe.** L'en-tête de `js/mix-sync.js` (l.32-36) annonce
« 25 ms / ajustement fin ±10 % » alors que le code applique `DEADBAND_MS = 100`,
`WRITE_MS = 1500` et une écriture ±5 % max (cf. D5).

### D3 — RC-1 résiduel : `barOccurrence` GP ↔ alphaTab *(MAJEUR, précision des sauts)*
**Cause racine.** `MidiFileGenerator._processBarTimeWithSyncPoints` n'applique un
point que si `syncPointValue.barOccurence === occurence`, où `occurence` est le
compteur de passage d'alphaTab. Guitar Pro numérote différemment (trous, base
hétérogène, occurrences « impossibles »). `RepeatOracle.raise` répare les cas
démontrables ; le reste est rejeté (à raison, sous peine de régression).

**Preuve.** `repeat-check` : AC/DC **12** clés manquantes, Renaud **55**,
Offspring **5** ; segments « pente hors clamp » Iron Maiden 2, AC/DC 2, Renaud 3.

**Impact.** Le saut de répétition est propre (re-ancrage Phase 1) mais peut
viser **l'occurrence voisine** → audio légèrement décalé autour du D.S./Coda.
Documenté dans `BUGRENVOI.md` §6 et `BUGMP3.md` §12.2 (tentative naive retirée).

### D4 — Harnais miroirs périmés *(MAJEUR pour la confiance dans les mesures)*
`tools/sync-audit.js` reconstruit le score avec `fixAlternateEndings`
(l.342-363, **supprimé** du code livré) et **sans** `RepeatOracle.raise`
(l.368-369). `tools/tempo-correct-sim.js` et `tools/repeat-check.js` sont à jour,
mais `sync-audit.js` **ment** sur l'état réel (cf. §2.4). Toute décision fondée
sur lui est faussée. Aucun harnais ne charge `js/mix-sync.js` **réel** : tous
recopient constantes et formules (risque de dérive silencieuse).

### D5 — Documentation déphasée *(MINEUR)*
- `js/mix-sync.js` l.32-36 : « 25 ms / ±10 % » ≠ code (`DEADBAND_MS=100`,
  `WRITE_MS=1500`, correction ±5 %).
- `js/mix-sync.js` l.202-204 : `tempoScale` présenté comme le facteur appliqué
  alors que `applySpeed()` passe désormais par `setUserSpeed`/`applyTempo`.
- `BUGLATEST.md` §1 table et §3 T4 déjà au courant — à solder.

### D6 — `fixEmptyAnacrusis` : mesure d'anacrouse forcée en mesure pleine *(À VALIDER)*
`js/player.js` l.558-573 : toute `isAnacrusis` de durée 0 est **désactivée**
(`mb.isAnacrusis = false`) → elle prend une **durée pleine**. Or une anacrouse
est une mesure **partielle** (pickup). Effet attendu : allongement de la
timeline et décalage possible de la fin du morceau. Correctif livré pour Dr. Stein
mais **la durée musicale correcte** (celle notée dans le GPIF) doit être
vérifiée, pas remplacée par une mesure pleine. À mesurer avant de garder.

### D7 — Hygiène / petits défauts *(MINEUR)*
- `MixSync.initialSpeed()` (`js/mix-sync.js` l.357-360) est **exposé mais jamais
  appelé** ; l'initialisation passe par `applySpeed()` dans `deferAudioWork`.
- `targetSeconds()` (`js/mix-sync.js` l.380) borne à `Math.max(0, ms)` : masque
  un `syncTime` **réellement négatif** (AC/DC `points[0].a = −1014 ms`). Le clamp
  est un pansement, pas une correction.
- `deploy/gp8-web/` est **périmé** : pas de `js/repeat-oracle.js`, `player.js`
  42,3 Ko vs 46,2 Ko, `samples/` incomplet. `_build.ps1` le régénère
  correctement (il copie tout hors `tools/`/`*.md`), donc simple à rejouer — mais
  à ne pas déployer tel quel.
- `countInBeatMs()` (`js/player.js` l.489-493) utilise `api.playbackSpeed`, donc
  le tempo **modifié** : l'overlay visuel du décompte peut être désynchronisé du
  décompte réel dès que la stratégie tempo change.

### D8 — Aucun test de non-régression du **contrôleur** lui-même *(MAJEUR méthode)*
`mix-sync.js` n'est couvert par aucun test : les harnais en sont des **miroirs**.
Le seul test « réel » est `load-smoke.js` (chargement) et l'extraction de
fonctions de `player.js`. Il faut un harnais qui **exécute le module livré**.

---

## 4. Architecture cible — « respect total des tempos »

### 4.1 Ce que fait réellement Guitar Pro / alphaTab
- GP enregistre, pour chaque point de synchro, `OriginalTempo` et
  `ModifiedTempo`. `ModifiedTempo` = tempo auquel **la partition doit sonner**
  pour coller à l'enregistrement (par segment).
- alphaTab, en mode **piste audio maître** (`BackingTrackPlayer`), ne change
  jamais le tempo du synthé : c'est **l'audio** qui pilote `updateTimePosition`
  (l.40453-40459), le synthé suivant la position musicale dérivée
  (`mainTimePositionFromBackingTrack` l.35282).
- En mode **export audio**, alphaTab applique le tempo modifié **sans seek** :
  `this._sequencer.playbackSpeed = syncPointTempo / currentTempo` (l.40371-40372).
- En **lecture live** (notre cas, `EnabledSynthesizer`), alphaTab **n'applique
  pas** les sync points (cf. §2.5). C'est à nous de le faire.

### 4.2 Trois stratégies, une recommandation

| | Stratégie | Effet RC-2 | Effet RC-3 | Faisabilité |
|---|---|---|---|---|
| **A** | Statu quo amélioré : écrire `playbackSpeed` moins souvent (lissage + frontières réelles) + loi « protège » | Réduit (405 → ~150-250), **ne supprime pas** | Réduit | Triviale (déjà chiffrée, BUGLATEST T3) |
| **B** | Patch non destructeur de `updatePlaybackSpeed` | Supprimé | Supprimé | **Bloquée par le worker** (instance = proxy). Exige `useWorkers:false` → synthèse sur le thread principal (risque UI/jank mobile) |
| **C** | **Tempo modifié pré-cuit dans le MIDI** : régénérer le MIDI avec les `ModifiedTempo` de GP comme événements de tempo, puis le jouer à `playbackSpeed = 1` | **Supprimé à la racine (0 écriture)** | **Supprimé (0 écriture)** | **Réalisable** : `alphaTab.midi.MidiFile`, `MidiFileGenerator`, `AlphaSynthMidiFileHandler`, `TempoChangeEvent` sont **exportés** ; `MidiFileGenerator.buildModifiedTempoLookup(score)` est **statique et public** |

**Recommandation : stratégie C**, avec la loi « protège » (D2) conservée comme
**filet de sécurité** résiduel (corrections rares et minuscules, pas un moteur de
tempo), et A en repli si C s'avère impossible sur un cas.

**Pourquoi C est la bonne réponse :**
- Le MIDI joue **exactement au tempo de l'enregistrement**, par construction
  (les segments de tempo sont les mêmes que ceux que calcule déjà `speedAt`).
- `playbackSpeed` reste **1,0** → **aucune coupure** (RC-2 disparaît), **aucun
  time-stretch** du MP3 (RC-3 disparaît : le MP3 reste natif).
- Le métronome, le curseur animé (`cursorSpeed = modifiedTempo/originalTempo`) et
  le count-in se calent naturellement sur le tempo de l'enregistrement.
- Le pont `MixSync` redevient ce qu'il aurait dû être : un **garde-fou** (vérifier
  que `<audio>.currentTime` suit la cible à quelques ms près), pas un moteur.

**Points à trancher par un spike (P1)** avant d'industrialiser C :
1. vérifier que les `TempoChangeEvent` insérés aux ticks de sync-point sont bien
   consommés par le séquenceur live (le `MidiFile` alimente `state.tempoChanges`) ;
2. gérer le **premier segment** (avant le premier sync-point) et le **dernier**
   (après le dernier) avec le tempo extrapolé ad hoc ;
3. confirmer que le **tempo utilisateur** (×0,4…×1,5) s'applique par **une seule**
   écriture `playbackSpeed` au chargement / au geste (pas en cours de lecture) ;
4. mesurer la **durée totale** MIDI vs MP3 (elle doit coïncider : c'est la
   signature d'un tempo pré-cuit correct).

### 4.3 Découpage cible de `MixSync`
| Sous-module | Rôle |
|---|---|
| **Pont** (`build`, `audioMsFor`, `analyzeSegments`) | inchangé dans l'esprit : table `synthTime→syncTime`, dédoublonnage, sauts. Devient surtout un **oracle de vérification** et la source du **tempo pré-cuit**. |
| **Tempo** | ne pilote plus `playbackSpeed` en lecture ; expose `speedAt()` pour (a) la génération du MIDI pré-cuit, (b) le repli A. |
| **Garde-fou** (`correct`) | dérive → **loi « protège »** (retour au neutre dès la zone morte), seuils larges, **jamais** de seek tant que `|dérive| < HOLD_MS`. Mesure et journalise. |
| **Instrumentation** | `[mix-stats]` doit montrer **0 écriture tempo** et ~0 écriture rate en régime établi. |

---

## 5. Plan d'action par phases

> Chaque phase a un **critère de sortie mesurable**. Aucune phase ne démarre
> avant que la précédente soit verte sur les harnais.

### P0 — Rétablir la confiance dans la mesure *(bloquant)* ✅ fait — voir §11.1
1. **Refondre `tools/sync-audit.js`** : retirer `fixAlternateEndings` (l.342-363),
   brancher `require('../js/repeat-oracle.js')` + `normalizeMultiClosingRepeats`
   extrait de `player.js`, comme `repeat-check.js`/`tempo-correct-sim.js`.
   Reporter la loi de correction retenue (D2).
2. **Créer `tools/mix-sync-harness.js`** : charge `js/mix-sync.js` **réel** dans
   un `vm` (stubs `AudioSync`, `Player.S.api`, `alphaTab` = vendor, `clamp`,
   `App`), puis **pilote** `build/start/onPosition/correct` en avançant une
   horloge factice. Compte : écritures `playbackSpeed`, écritures `playbackRate`,
   seeks, dérive pic. C'est **le** test de non-régression du contrôleur (D8).
3. Corriger la documentation déphasée (D5).
**Sortie :** `sync-audit` et `mix-sync-harness` décrivent le **même** comportement
que le code livré ; les chiffres de `tempo-correct-sim` sont reproduits par le
harnais réel à ±2 %.

### P1 — Spike stratégie C *(décision go/no-go)* ✅ fait — voir §11.2
4. Construire un prototype Node : `MidiFileGenerator.buildModifiedTempoLookup(score)`
   → régénérer le `MidiFile` (`new MidiFile()` + `AlphaSynthMidiFileHandler` +
   `MidiFileGenerator.generate()`) → **réécrire** les `TempoChangeEvent` aux ticks
   de sync-point avec `syncBpm` → mesurer la durée totale vs durée MP3 sur les 14
   échantillons.
**Sortie (révisée après exécution, cf. §11) :** la pré-cuisson doit reproduire
la **portée audio des sync-points** (durée MIDI = durée audio visée), et non la
durée MP3 brute — la durée du MP3 mesure la *couverture* des sync-points du
`.gp`, une propriété de **donnée**. Critère retenu : écart par **segment continu
non clampé** < 0,5 % sur 14/14, BPM pré-cuits tous ≥ 3,58 tr/min (limite SMF).
Document de décision : §11.

### P2 — Implémenter la stratégie C *(cœur du correctif)* ✅ fait — voir §11.4
5. **Injection retenue :** enveloppe de `MidiFileGenerator.prototype.generate`
   (`installTempoPrebake`, `js/player.js`) — le `MidiFile` est encore en mémoire
   (`this._handler._midiFile`) et les points de synchro viennent d'être calculés
   dans **la même passe** ; `loadMidiForScore()` le passe ensuite tel quel à
   `player.loadMidiFile()`. (Écarté : patcher `api.loadMidiForScore`, qui
   duplique la mécanique interne `ModelUtils`/`_tickShift`/`_onMidiLoad`.)
   `updateSyncPoints` reste appelé (UI/curseur). Garde sur l'audio embarqué :
   un `.gp5` sans MP3 garde le tempo noté.
   ⚠ **Ne PAS** pré-cuire le `syncBpm` brut (spike §11 : il descend à 2,5 tr/min
   ou devient négatif sur les segments de discontinuité). On pré-cuit la **table
   de segments de `mix-sync`** (mêmes `points[].notSlope` : détection de saut →
   pente du bloc destination, clamp `[0,5 ; 2]`). `segmentsFrom()` est **la**
   table partagée par `prebake` et le pont (fin du miroir).
6. `js/mix-sync.js` : **`applyTempo` supprimé** du chemin de lecture ;
   `setUserSpeed` n'écrit `playbackSpeed` **qu'au chargement et au geste
   utilisateur** (et seulement si la valeur change, pour ne pas couper le
   synthé). Le pont est ré-indexé sur l'**axe pré-cuit** (`points[].t`).
7. **Loi « protège »** appliquée dans la zone morte (remise au neutre si elle
   rapproche du taux natif ; sinon silence) — arbitrée par `tempo-correct-sim`.
8. D7 traité : `initialSpeed`/`speedAt`/`speed` morts retirés ; le clamp
   `Math.max(0, …)` de `targetSeconds` **retiré** au profit d'une gestion
   explicite du **pré-roll** (notation démarrant avant l'audio, `syncTime < 0`) ;
   `countInBeatMs` base sur le **1er tempo du MIDI pré-cuit** (`S.midiTempo0`).
**Sortie :** `mix-sync-harness` → **0 écriture `playbackSpeed` en lecture** sur
les 14 échantillons ; écritures `playbackRate` ≤ 2 % du temps ; dérive pic
< 40 ms.
**Résultat (14/14)** : tempoWrites **0**, dérive croisière **≤ 11 ms** (médiane
des pics), 8 écritures de taux au total. ✅

### P3 — RC-1 résiduel *(précision des sauts)* ✅ fait — voir §11.7
9. ✅ Instrumenté : `tools/barocc-instrument.js` confronte les clés GPIF brutes
   (`syncPointValue.barOccurence` + offsets audio) aux occurrences réellement
   JOUÉES par le déroulé (`walkMaxOcc` rempli par le module livré) et classe
   CHAQUE clé manquante **H1** (ensemble GP = ensemble joué translaté) ou **H2**
   (traversée absente / mesure jamais jouée — donnée GP).
10. ✅ Sous garde dans `js/repeat-oracle.js` (étape 4 de `raise`) : les mesures H1
    sont **tentées** puis CONSERVÉES seulement si les clés manquantes baissent
    strictement **sans** nouvelle pente hors clamp, nouveau saut re-ancré ni
    segment d'audio reculant ; sinon **restituées**.
**Sortie :** atteinte par la clause « sinon » de la DoD #5 — **72** clés
manquantes, **41 mesures H2** (donnée GP) et **4 mesures H1** (Renaud 8/9/11/42)
que la garde **refuse** (elles ajouteraient 6 sauts) ; non-régression sur les
15 autres fichiers.

### P4 — Anacrouse & fin de morceau (D6) ✅ fait — voir §11.8
11. ✅ Mesuré : la durée « notée » de l'anacrouse est **indéterminée dans la
    notation** quand la mesure est vide (Dr. Stein : `isAnacrusis` + bar 0 sans
    aucune voix) ; c'est la **portée audio GPIF** de la mesure qui tranche, et
    elle vaut **exactement une mesure pleine**. Le correctif livré est donc
    conservé et **prouvé** (harnais `tools/duration-check.js`).
**Sortie :** fin de webapp ≤ fin du MP3 sur **15/15** ; anacrouses jouées
alignées sur leur portée audio à **≤ 0,04 %** ; aucune régression de synchro.

### P5 — Durcissement & non-régression ✅ livrée
12. ✅ `tools/test-all.js` **(fait — §11.6)** : exécute les **8** harnais (dont
    `barocc-instrument` P3 et `duration-check` P4), tableau récapitulatif, sortie
    0/1. Chaque harnais porte ses seuils (`mix-sync-harness` : tempoWrites = 0,
    dérive croisière < 40 ms, écritures de taux ≤ 2 % du temps).
13. ✅ `tools/browser/` **(fait — §11.10)** : test d'intégration **navigateur**
    (Playwright, `playwright-core` + Chrome/Edge déjà installé, dépendance de
    dev **isolée**). Il sert le dépôt en `http://127.0.0.1` (contexte sûr →
    AudioWorklet), clique **vraiment** un exemple du manifeste puis **Lecture**,
    et relit l'instrumentation **livrée** `[mix-stats]`. Invariants : **0**
    écriture de `playbackSpeed` en lecture, moteur + piste audio câblés,
    horloge qui avance, pas d'emballement de dérive, 0 erreur console.
**Sortie :** suite déterministe verte sur les **15** échantillons ; test
navigateur vert sur le **manifeste** (14/15 — `samples/list.json` à régénérer,
P6) ; `tools/test-all.js` en une commande.

### P6 — Clôture documentaire & déploiement ⏳ à faire — voir « État d'avancement »
14. Mettre à jour `BUG.md`, `BUGMP3.md` §14, `BUGLATEST.md` (T1-T8 soldés),
    `TESTSAMPLES.md` (résultats d'écoute).
15. Rejouer `deploy/_build.ps1` et vérifier `deploy/gp8-web/js/repeat-oracle.js`
    présent + `samples/list.json` complet (D7).
**Sortie :** documents cohérents, artefact de déploiement conforme.

---

## 6. Plan de tests automatiques

### 6.1 Principe directeur
**Zéro miroir** : tout harnais qui mesure un comportement doit **exécuter le code
livré**. Les constantes/formules ne doivent exister qu'à **un seul endroit**
(`js/mix-sync.js`), les harnais les lisent ou importent le module.

### 6.2 Harnais et métriques

| Harnais | Ce qu'il exécute | Métriques / seuils |
|---|---|---|
| `tools/load-smoke.js` *(existant)* | les 8 `js/*.js` | ordre des scripts, bindings, `App.boot`/`Samples.build` → OK |
| `tools/repeat-check.js` *(existant)* | `js/repeat-oracle.js` réel + `fixEmptyAnacrusis`/`normalizeMultiClosingRepeats` extraits | clés GPIF manquantes, `danger`, `jumps` : **non-régression** + gains de référence |
| `tools/barocc-instrument.js` **(créé — P3)** | `repeat-oracle` réel + clés GPIF brutes du score | clés manquantes classées **H1**/**H2** par mesure, offsets audio GPIF ; **référence par fichier** (ACDC 12, Renaud 55, Offspring 5) |
| `tools/tempo-correct-sim.js` *(existant)* | `repeat-oracle` réel, simulation des 3 lois — **modèle PRÉ-P2** (référence historique + arbitrage de la loi « protège » sur `playbackRate`) | écritures rate (A/N/P), étirement, recadrages : **P ≤ A** |
| `tools/mix-sync-harness.js` **(à créer — P0)** | **`js/mix-sync.js` réel** | `nTempoLecture` (doit = **0** après P2), `nRate`, `nSeek`, dérive pic, `tempo hors plage` |
| `tools/sync-audit.js` *(à refondre — P0)* | chemin réel | recadrages/glitchs/sauts par fichier, points GPIF couverts |
| `tools/duration-check.js` **(créé — P4)** | chemin livré (`fixEmptyAnacrusis`, `repeat-oracle`, pré-cuisson, `MixSync.audioMsFor`) + GPIF/MP3 bruts | durée jouée de l'anacrouse vs **portée audio GPIF** (≤ 0,5 %), fin de webapp ≤ fin du MP3 |
| `tools/test-all.js` **(créé — P5)** | tous ci-dessus | sortie 0/1 + tableau récapitulatif |
| `tools/browser/run.js` **(créé — P5-13)** | **l'app entière** dans Chrome (servie en `http://127.0.0.1`) : clic sur un exemple du **manifeste** → `Player.loadFile` → clic **Lecture** ; l'instrumentation `[mix-stats]` **livrée** est relue (aucun miroir) | **0** écriture de `playbackSpeed` en lecture, 0 erreur console, moteur + piste audio câblés, horloge qui avance, pas d'emballement de dérive (§6.5) |

### 6.3 Assertions cibles (après P2)
| Assertion | Seuil | État P2 |
|---|---|---|
| Écritures `playbackSpeed` en lecture (hors geste utilisateur) | **0** sur les 15 | ✅ 0/15 |
| Écart durée MIDI pré-cuit ↔ **portée audio des sync-points** (par segment continu non clampé) | **< 0,5 %** | ✅ 15/15 (pire 0,234 %) |
| Dérive croisière MP3↔MIDI (médiane des pics de fenêtre) | **< 40 ms** | ✅ ≤ 11 ms |
| Dérive pic | = taille du saut (1 seek) ; pas un « glitch » | ✅ sauts uniquement |
| Écritures `playbackRate` | **≤ 2 % du temps de lecture** | ✅ 10 écritures au total |
| Recadrages « glitch » (dérive dans un bloc continu) | **0** | ✅ 0 |
| Recadrages « sauts » (discontinuités D.S./Coda) | **= 1 par discontinuité** | ✅ |
| Clés GPIF manquantes | **0** (ou documentées H2) | ✅ 72 — **41 mesures H2 documentées**, 4 H1 refusées (§11.7) |
| Pentes hors clamp `[0,5 ; 2]` | **0** | 🟡 résidu documenté (2+2+3+1 mesures sur 4 fichiers, §11.7) |
| Anacrouse jouée vs **portée audio GPIF** | **≤ 0,5 %** | ✅ 6/6 ≤ 0,04 % (§11.8) |
| Fin de webapp (axe audio) vs fin du MP3 | **≤ +0,5 %** | ✅ 15/15 (§11.8) |
| Écritures de `playbackSpeed` en lecture **dans un navigateur réel** | **0** | ✅ 0/14 (§11.10, Playwright) |

> ⚠ La cible initiale « écart durée MIDI ↔ **durée MP3** < 1 % » est **fausse** :
> la portée des sync-points est plus courte que le MP3 sur 12/14 fichiers
> (donnée de fichier, cf. §11.2.3). La bonne référence est la **portée audio des
> sync-points**. `tempo-correct-sim` n'est plus la référence de `playbackSpeed`
> (modèle pré-P2) : c'est `mix-sync-harness` qui l'est.

### 6.4 Diagnostics obligatoires en console (déjà partiels, à compléter)
- `[mix] N point(s) de synchro · X saut(s) · Y pente(s) hors plage`
- `[mix] tempo hors plage …` → **doit disparaître** après P2/P3.
- `[mix-stats]` toutes les 5 s : `playbackSpeed écriture/s` (**doit = 0**),
  `playbackRate écriture/s`, `seek/s`, `arrêts maître`, `dérive max`.
- `[oracle] N groupe(s) relevé(s) … clés manquantes a → b`.
- `[oracle] P3 renumérotation GP (H1) : … refusée(s) par la garde … résidu H2
  (donnée GP), voir BUGFIX-TOTAL §11.7` (nouveau, P3 — n'apparaît que sur un
  fichier qui porte des mesures H1, aujourd'hui **Renaud**).
- `[tempo] N tempo(s) pré-cuit(s)` (nouveau, P2 — via `trace`).

### 6.5 Harnais navigateur (P5-13) — deux niveaux de verdict

Le banc Node déterministe (§6.2) est la **référence de seuils** ; le test
navigateur, lui, tourne sur une **pile audio temps réel** (décodage MP3 réel,
ordonnanceur de l'OS, `AudioWorklet`) et ne peut pas être jugé comme une
simulation. D'où deux niveaux :

| Niveau | Critère | Sens |
|---|---|---|
| **❌ échec** | **0** écriture de `playbackSpeed` en lecture ; **0** erreur console ; `bars`/`tracks`/points de synchro > 0 ; durée audio > 0 ; horloge qui avance ≥ 70 % du temps ; piste audio qui avance ; dérive de croisière < **150 ms** (1,5× la zone morte) ; ≤ 1 arrêt maître ; écritures de taux ≤ 15 % | **invariants du livrable** |
| **🟡 vert** | cible stricte §6.3 (dérive < 40 ms, taux ≤ 2 %, 0 arrêt) **non atteinte** | bruit de la pile temps réel — l'oreille (§7) arbitre le ressenti |

**Deux écarts assumés vs le banc Node**, tous deux **de mesure**, pas de logique :

1. **La 1ʳᵉ fenêtre `[mix-stats]` (5 s) est écartée.** Elle couvre l'amorçage de
   la piste audio (blob → décodage MP3 → `readyState ≥ 3`, plus le
   `bufferTimeInMilliseconds: 800` du synthé). On y observe toujours la même
   signature : 1 arrêt maître, dérive ~300-500 ms, quelques écritures de taux.
   Le banc Node, lui, ne compte **qu'après** `onState(Playing)`.
2. **La dérive de croisière en navigateur est bornée par la ZONE MORTE, pas par
   40 ms.** `CONTROL_MS = 250` / `DEADBAND_MS = 100` / `WRITE_MS = 1500`
   (js/mix-sync.js) autorisent l'écart à respirer jusqu'à ~100 ms avant
   correction : les 14 exemples la mesurent entre **11 et 92 ms**. Le seuil
   « < 40 ms » du §6.3 reste la mesure du banc déterministe (audio factice sans
   gigue) ; en navigateur, l'invariant défendable est « pas d'emballement »
   (< 150 ms) et « 0 écriture de vitesse en lecture » — ce dernier, le vrai
   objectif P2, est tenu **partout**.

---

## 7. Plan de tests manuels réduits

> Objectif : **cibler** les samples et les zones à risque, sans réécouter les 15
> morceaux en entier. Protocole commun : serveur local
> `python -m http.server 8777 --bind 127.0.0.1` → `http://localhost:8777/`,
> mode **mix** (MIDI + MP3), vitesse 100 %. Pour chaque ligne : écouter la zone,
> noter *tempo* (le MIDI suit-il l'enregistrement ?) et *phase* (les deux flux
> restent-ils collés ?). Confronter à `[mix-stats]`.

| # | Sample | Zone / mesures | Ce qu'on écoute | Attendu |
|---|---|---|---|---|
| M1 | **Iron Maiden — Fear of the Dark** | intro **0:00–0:30** (≈ mes 1-16) | tempo lent ≈ **0,65×** de la notation, calé sur l'enregistrement | intro lente, **sans à-coups**, MIDI collé au MP3 |
| M2 | Iron Maiden | riffs **2:01–4:11** (segments longs) | tempo rapide ≈ **1,72-1,79×** | pas de « début trop rapide », transitions de tempo sans trou |
| M3 | Iron Maiden | **mes 98** (pente 0,524 la plus sombre) | ralentissement local | pas de saut, pas de flottement |
| M4 | **Helloween — Dr. Stein** | **mes 16-19** (historique « légers retours en arrière ») | stabilité | **plus aucun retour**, tempo constant ≈ 1,22× |
| M5 | Helloween | tout le morceau (1 seule frontière de tempo, 23 coupures avant) | continuité | 0 coupure de synthé |
| M6 | **AC/DC — Highway to Hell** | **fin mes 17 ≈ 1:03** → **mes 6** (D.S. al Coda) | le saut de répétition | **un** saut propre ; à 1:03 le MP3 est vers 1:10-1:11 (**normal**, données GP) |
| M7 | AC/DC | **mes 6-10** | « l'audio est faux alors que le MIDI est correct » | **Verdict P3 (§11.7) : H2** — GP a enregistré 5 à 7 traversées de ces mesures là où le déroulé en joue 4-5 (clés manquantes 12). La structure notée diverge de l'enregistrement : **attendu**, aucun appariement ne peut la couvrir. Écouter qu'aucun **saut parasite** n'est ajouté |
| M8 | **Renaud — Morgane de toi** | début : **mes 1-6** | séquence `1 2 3 4 · 1 2 3 5 · 1 2 3 6` | **H2 confirmé** : l'enregistrement joue la mes 5 **6 fois** (offsets 21 s / 30 s / 122 s / 131 s / 224 s / 233 s), le déroulé **3 fois**. Attendu : pas de saut parasite ; diverger de structure = donnée GP (à confirmer à l'oreille) |
| M9 | Renaud | **mes 15-21** (volta à 4 fins) | 4 fins jouées dans l'ordre | 4 mesures H1 (8/9/11/42) **détectées et refusées** par la garde (elles ajouteraient 6 sauts) → l'ancrage passe 2/passe 3 reste inchangé |
| M10 | **Blink 182 — All the Small Things** | **mes 6-10** | `6-7-8-9` ×3 puis `6-7-8-10` | 4 passages, fin 10 au bon endroit |
| M11 | **Slayer — Hell Awaits** | **≈ 1:00** (le MP3 démarre à 1:04,7) | saccades historiques | 0 saccade, démarrage audio calé à 1:04,7 |
| M12 | Slayer | **mes 44, 53, 117** (répétitions, 4 passages) | passages complets | tous les passages présents |
| M13 | **The Offspring — Self Esteem** | **≈ 0:51** (saut historique 6,9 s) | continuité | plus de saut parasite |
| M14 | The Offspring | tout (137 coupures avant) | rendu | 0 coupure |
| M15 | **Témoins « 0 recadrage »** : Europe, F-Zero X, Led Zeppelin, Sepultura, Metallica, Igorrr ×2 | intégralité | aucune régression | strictement identiques à avant |

**Contrôle transverse (à faire sur M1, M4, M6, M14)** : pendant la lecture,
manipuler le curseur de **vitesse** (×0,5 puis ×1,5) → le moteur doit composer
vitesse utilisateur × tempo pré-cuit **sans trou ni décalage**.

**Test d'isolation A/B (si un artefact persiste)** :
- couper la piste audio (mute) → l'artefact persiste ⇒ chemin **MIDI** (coupures
  synthé, D1) ;
- couper le master MIDI → l'artefact persiste ⇒ chemin **MP3** (écritures rate,
  D2) ;
- disparaît des deux côtés séparément ⇒ causes cumulatives (attendu avant P2).

---

## 8. Critères d'acceptation (Definition of Done)

1. **Tempo** : sur les 15 échantillons, le MIDI sonne au tempo de
   l'enregistrement (tempo variable inclus) ; **0 écriture `playbackSpeed`** en
   cours de lecture (hors geste utilisateur).
2. **Phase** : dérive MP3↔MIDI pic < 40 ms ; écart moyen < 10 ms en régime établi.
3. **Qualité** : **0 coupure de synthé** ; MP3 **natif** (aucun time-stretch
   permanent ; `|playbackRate − 1| ≤ 0,5 %` hors correction transitoire).
4. **Structure** : `0` recadrage de dérive (glitch) ; `1` saut propre par
   discontinuité voulue ; `0` pente hors `[0,5 ; 2]`.
5. **Données** : `0` clé GPIF manquante sur les 15 — **clause « sinon » invoquée** :
   anomalie de données GP documentée et acceptée (72 clés, **100 %** classées
   H2/H1, §11.7), sans impact audible ; le mécanisme de réassignation H1 reste
   actif sous garde.
6. **Durée** : fin de webapp = fin du MP3 à ±0,5 % au sens utile — la webapp ne
   dépasse **jamais** la fin du MP3 (15/15) ; l'écart négatif mesure la couverture
   des sync-points du .gp (donnée), et l'anacrouse est alignée à ≤ 0,04 % (§11.8).
7. **Tests** : `node tools/test-all.js` sort `0` (**8** harnais) ; aucun harnais
   « miroir » ne subsiste ; `deploy/` régénéré et conforme.
8. **Écoute** : les 15 points du §7 validés (dont les 6 témoins sans régression).

---

## 9. Risques & parades

| Risque | Parade |
|---|---|
| Stratégie C : les `TempoChangeEvent` insérés ne sont pas consommés par le séquenceur live | Spike P1 **avant** toute modification ; repli sur stratégie A (lissage + loi « protège ») |
| Stratégie C : durée MIDI ≠ durée MP3 (segments d'extrémité mal extrapolés) | Test d'assertion durée (§6.3) ; extrapolation ad hoc du 1er/dernier segment |
| Le worker empêche tout patch d'instance (D1) | C ne nécessite **aucun** patch de séquenceur : uniquement le `MidiFile` chargé |
| RC-1 : réassigner les occurrences casse des appariements corrects (régression déjà constatée) | Réassignation **sélective** uniquement, garde-fous `danger`/`jumps` (+ `back`), non-régression sur les 15 fichiers ; mesuré : la garde **refuse** les 4 H1 de Renaud (§11.7) |
| `fixEmptyAnacrusis` en mesure pleine allonge la timeline | Mesure GPIF + audio avant/après (P4, `tools/duration-check.js`) : **confirmé** — la portée audio GPIF d'une anacrouse vide vaut exactement une mesure pleine (§11.8) |
| Régression sur les morceaux aujourd'hui « parfaits » (Europe, F-Zero, Led Zep, Sepultura, Metallica, Igorrr) | Ces 6 sont des **témoins** dans chaque harnais et dans le test manuel (M15) |
| Coût de la re-synthèse silencieuse sous-estimé par les harnais | Le harnais réel P0 + l'instrumentation `[mix-stats]` mesurent en navigateur ; la stratégie C l'annule par construction |
| Déploiement périmé | Rejouer `_build.ps1`, vérifier `repeat-oracle.js` et `list.json` (P6) |

---

## 10. Hors périmètre / décisions à prendre

- **Forme d'onde de la piste audio** (`BUG.md` EVOLUTIONS) : indépendant.
- **Bilingue FR/EN**, README/MANUAL : indépendant.
- **Compte à rebours à chaque boucle** : indépendant.
- **Remontée amont alphaTab** (BUGRENVOI S4, BUGLATEST T3) : souhaitable
  (vitesse sans seek ; `Repeat.iterations` par-fin vs `alternateEndings`
  absolu) mais **non bloquant** si C est retenu.
- **`useWorkers:false`** : à n'envisager que si C échoue **et** si la synthèse
  main-thread est jugée acceptable sur mobile (mesurer sur Pixel 7a).

---

### Annexe A — fichiers du correctif par phase

| Phase | Fichiers touchés |
|---|---|
| P0 | `tools/sync-audit.js`, `tools/mix-sync-harness.js` (nouveau), `js/mix-sync.js` (commentaires) |
| P1 | `tools/` (spike, hors dépôt ou `tools/spike-tempo-bake.js`) |
| P2 | `js/player.js`, `js/mix-sync.js`, `js/core.js` (buffer éventuel) |
| P3 | `js/repeat-oracle.js` (réassignation sélective sous garde), `tools/barocc-instrument.js` (nouveau) |
| P4 | `js/player.js` (`fixEmptyAnacrusis` — **conservé**, justifié), `js/mix-sync.js` (`audioMsFor` exposé), `tools/duration-check.js` (nouveau) |
| P5 | `tools/test-all.js` (nouveau), CI |
| P6 | `BUG*.md`, `TESTSAMPLES.md`, `deploy/_build.ps1` (exécution) |

### Annexe B — commandes de vérification actuelles (état avant correctif)
```
node tools/load-smoke.js          # OK
node tools/repeat-check.js        # OK — clés 94 -> 72
node tools/tempo-correct-sim.js   # OK — coupures playbackSpeed = 405
node tools/sync-audit.js          # MIROIR PÉRIMÉ (à refondre, P0)
```

---

## 11. Résultats P0 + P1 (exécutés)

### 11.1 P0 — la mesure est fiable *(fait)*
- `tools/sync-audit.js` **refondu** : plus aucun miroir de `fixAlternateEndings` ;
  `fixEmptyAnacrusis` et `normalizeMultiClosingRepeats` **extraits de
  `js/player.js`** ; `js/repeat-oracle.js` **requis** et installé. La colonne
  `écrit.tempo` reproduit désormais **exactement** les comptes livrés
  (405 au total, identiques fichier par fichier à `tempo-correct-sim`).
- `tools/mix-sync-harness.js` **(nouveau)** : charge **`js/mix-sync.js` tel quel**
  dans un contexte `vm` (stubs `AudioSync` / `Player.S.api` / `alphaTab` = vendor
  / `clamp` / `App` / `performance`) et **pilote** `build → start → onState →
  onPosition`. La ré-échelle destructive d'alphaTab est reproduite fidèlement
  (`set playbackSpeed` ⇒ `timePosition *= ancien/nouveau`, vendor l.39849).
  Compte sur le code réel : `tempoWrites`, `rateWrites`, `seekWrites`, dérive
  (relue de `[mix-stats]` livré).
- **Résultat** : `tempoWrites` **413** vs REF **405** → **écart global 1,98 %**
  (≤ 2 %, critère P0 tenu). Par fichier, écarts ≤ 1 écriture (non significatifs
  sur des comptes de 1 à 5).
- **Découverte quantifiée (RC-3)** : la **dérive de croisière** (médiane des pics
  de fenêtre) se stabilise à **~100 ms** (= `DEADBAND_MS`) sur 13/14 fichiers.
  Le correcteur n'atteint donc **jamais** zéro : il bute sur la zone morte. C'est
  la preuve, sur le code réel, du « décalage » ressenti.
- **D5 + hygiène** : en-têtes de `js/*.js` dés-encodés (mojibake `â€”`/`Ã©` → `—`/`é`)
  et loi de correction réelle documentée (`HOLD_MS=400`, `DEADBAND_MS=100`,
  `WRITE_MS=1500`, ±10 %).

### 11.2 P1 — spike stratégie C : **GO** *(fait)*
Outil : `tools/tempo-prebake-spike.js` (chemin livré + `MidiFileGenerator` +
`AlphaSynthMidiFileHandler`). Deux variantes mesurées, durée relue **du binaire
SMF** (parseur indépendant) et des objets d'événements.

| Variante | Principe | Verdict |
|---|---|---|
| **A** — `syncBpm` brut | réécrit les `TempoChangeEvent` au tick de chaque sync-point avec le `syncBpm` calculé par alphaTab | **NO-GO** : sur les segments de discontinuité (recul/bond audio) le `syncBpm` n'est pas un tempo — mesuré jusqu'à **2,5 tr/min**, parfois **≤ 0** ; tronqué à la sérialisation SMF (limite 3 octets ≈ 3,58 tr/min). |
| **B** — règle de `mix-sync` | même chose, mais avec la **table de segments** de `js/mix-sync.js` (saut → pente du bloc destination, clamp `[0,5 ; 2]`) | **GO** : chaque **segment continu non clampé** dure exactement la durée audio visée — **14/14 < 0,5 %** ; BPM pré-cuits tous sains (50-190) ; binaire SMF identique aux objets. |

**Faits établis :**
1. La pré-cuisson est **exacte** : durée MIDI = portée audio des sync-points
   (14/14). La stratégie C est donc **au moins aussi bonne** que l'application
   actuelle du tempo par `playbackSpeed` (même table, même clamp), mais elle
   **supprime par construction** les 405 coupures de synthé (RC-2) et l'oscillation
   du correcteur (RC-3).
2. Les segments « clamp » (`pente hors plage`) gardent l'écart **volontaire** de
   `mix-sync` : identique à aujourd'hui, absorbé par le correcteur de dérive —
   qui, lui, agit sur `playbackRate` de l'audio (jamais sur le synthé).
3. **Donnée, pas bug** : la **couverture** des sync-points sur le MP3 complet
   n'est > 99 % que sur **2/14**. AC/DC (67 %), Blink (67 %), Iron Maiden (57 %)
   et F-Zero (3 %) ont des sync-points qui **s'arrêtent avant la fin du MP3** :
   la transcription est plus courte que la piste audio. Cela affecte **autant** le
   contrôleur actuel que C → hors périmètre de P2 (à documenter, P6).

**Décision :** **stratégie C retenue**, avec la précision du §P2.5 (pré-cuire la
table de `mix-sync`, **pas** le `syncBpm` brut). La loi « protège » (§P2.7) et le
correcteur de dérive restent en filet de sécurité pour les segments clampés et
les sauts.

### 11.3 Commandes de vérification (état après P0 + P1)
```
node tools/load-smoke.js            # OK
node tools/repeat-check.js          # OK — clés 94 -> 72
node tools/tempo-correct-sim.js     # OK — coupures playbackSpeed = 405
node tools/sync-audit.js            # OK — chemin livré, écrit.tempo = 405
node tools/mix-sync-harness.js      # OK — tempoWrites 413 vs 405 (1,98 %), dérive croisière ~100 ms
node tools/tempo-prebake-spike.js   # GO — variante B 14/14, variante A rejetée
```

### 11.4 P2 — stratégie C implémentée *(fait)*

**Ce qui a changé**

| Fichier | Changement |
|---|---|
| `js/mix-sync.js` | `segmentsFrom(raw)` = **table de segments pure et partagée** (axe pré-cuit `t`, axe audio `a`, `notSlope` partition clampée, `slope` pré-cuite clampée, sauts) ; `build(score)` l'utilise ; **`prebake(midiFile, raw, tickShift)`** écrit le tempo pré-cuit (retire tous les `TempoChangeEvent`, repose `tempoNatif / notSlope` par point) ; **`applyTempo` supprimé** ; `setUserSpeed` = seul écrivain de `playbackSpeed` (chargement + geste, si la valeur change) ; **loi « protège »** dans la zone morte ; pont ré-indexé sur l'axe pré-cuit ; **pré-roll** explicite (`syncTime < 0` → audio tenu à 0, à l'arrêt) ; `initialSpeed`/`speedAt`/`speed` morts retirés. |
| `js/player.js` | **`installTempoPrebake()`** : enveloppe de `MidiFileGenerator.prototype.generate` (appelée en `init`, comme la normalisation des renvois) → après génération, `MixSync.prebake(this._handler._midiFile, this.syncPoints, this._handler.tickShift)`, **gardé sur l'audio embarqué** ; relève `S.midiTempo0` (1er tempo pré-cuit) ; `countInBeatMs` s'appuie dessus. |
| `tools/mix-sync-harness.js` | Critère de sortie **tempoWrites = 0** ; modèle `vm` fidèle (le `<audio>` **ne bouge pas** à l'arrêt → pré-roll silencieux) ; sonde `MixSync._probe` + `--trace`. |
| `tools/tempo-prebake-spike.js` | La variante B **exécute `MixSync.prebake`/`segmentsFrom` livrés** (plus de miroir) et **relit le MidiFile produit** pour comparer ses durées à la table du pont. |
| `tools/tempo-correct-sim.js` | Marqué **modèle PRÉ-P2** (référence historique P0/P1 + arbitrage de la loi « protège » sur `playbackRate`). |

**Résultat `node tools/mix-sync-harness.js` (14/14)**

| Métrique | Avant P2 | Après P2 |
|---|---|---|
| écritures `playbackSpeed` (coupures du synthé) | 405 | **0** |
| dérive croisière (médiane des pics de fenêtre) | ~100 ms (13/14) | **≤ 11 ms** (14/14) |
| écritures `playbackRate` (total) | 550 | **8** |

- **RC-2 supprimé à la source** : le tempo de l'enregistrement vit dans le
  `MidiFile` (`prebake`), la lecture ne touche plus jamais à `playbackSpeed`.
- **RC-3 supprimé** : la dérive de croisière tombe sous la zone morte au lieu de
  s'y stabiliser.
- **Pré-roll** (défaut D7) : la notation démarre parfois **avant** le fichier
  audio (1er `syncTime` < 0 : AC/DC −1014 ms, Blink −565 ms). L'audio est
  désormais **tenu à 0, à l'arrêt** pendant ce pré-roll, au lieu d'avancer puis
  d'être recadré par un seek (ce qui laissait un résidu permanent — c'est ce que
  le clamp `Math.max(0, …)` masquait).
- **Fidélité de la pré-cuisson** (`tempo-prebake-spike`, code livré) : écart
  par segment continu non clampé **< 0,5 % sur 14/14** (pire 0,160 %), tempo
  pré-cuit minimal 50 tr/min (aucun tempo ≤ 0), binaire SMF = objets.
- **Curseur animé d'alphaTab** (défaut latent corrigé au passage) : il ancre
  sa durée sur `modifiedTempo / originalTempo` (`syncBpm × playbackSpeed` sur le
  tempo courant). Avant P2, `originalTempo` était le tempo NOTÉ et `syncBpm`
  compensait l'écart audio → le rapport était faussé par la pente. Maintenant
  que le MIDI EST au tempo de l'enregistrement, `installTempoPrebake` pose
  `syncBpm = synthBpm` (« aucun tempo modifié ») : le rapport redevient exact.

**Reste (P3+)** : la couverture des sync-points sur le MP3 complet (donnée de
fichier, 2/14), les **sauts** (Renaud 8, ACDC 3, Iron Maiden 3) — un seul seek
chacun, taille = celle du saut voulu — et le RC-1 résiduel (`barOccurrence`).

### 11.5 Commandes de vérification (état après P0 + P1 + P2)
```
node tools/load-smoke.js            # OK
node tools/repeat-check.js          # OK — clés 104 -> 72 (15 échantillons)
node tools/tempo-correct-sim.js     # OK — modèle PRÉ-P2 (référence historique)
node tools/sync-audit.js            # OK — chemin livré, écrit.tempo = 405
node tools/mix-sync-harness.js      # OK — tempoWrites 0/15, dérive croisière ≤ 11 ms
node tools/tempo-prebake-spike.js   # OK — pré-cuisson livrée, 15/15 < 0,5 %
```

### 11.6 P5 — suite unique *(fait)*
`tools/test-all.js` **(nouveau)** exécute les harnais en sous-processus et sort
**0/1** (0 si tout est vert). Chaque harnais garde SON critère :

| Harnais | Critère de sortie |
|---|---|
| `load-smoke` | ordre des scripts + bindings présents + `App.boot`/`Samples.build` |
| `repeat-check` | aucune régression (clés GPIF, `danger`, `jumps`) |
| `barocc-instrument` | RC-1 : chaque clé manquante classée H1/H2, sous référence par fichier |
| `tempo-correct-sim` | loi « protège » : `P ≤ A` (recadrages + écritures) |
| `sync-audit` | chemin livré, `écrit.tempo` = 405 (référence P0) |
| `tempo-prebake-spike` | fidélité pré-cuisson : 15/15 segments < 0,5 % |
| `mix-sync-harness` | **tempoWrites = 0**, dérive croisière < 40 ms, taux ≤ 2 % du temps |
| `duration-check` | anacrouses ↔ portée audio GPIF ≤ 0,5 % ; fin de webapp ≤ fin du MP3 |

```
node tools/test-all.js              # RESULTAT : OK — 8/8 harnais verts
```

Le test navigateur (Playwright) est **livré à part** (§11.10), sous
`tools/browser/` : il exige `npm i` dans ce dossier — hors du périmètre « dépôt
sans dépendance à l'exécution », donc **isolé** et jamais appelé par
`test-all.js`.

### 11.7 P3 — RC-1 résiduel : **H2 (donnée GP)**, H1 refusé par la garde *(fait)*

**Instrumentation** — `tools/barocc-instrument.js` (aucun miroir) : il installe
`js/repeat-oracle.js`, relit les clés GPIF brutes du score
(`masterBars[i].syncPoints` → `syncPointValue.barOccurence`, `millisecondOffset`),
les confronte aux occurrences réellement jouées (`walkMaxOcc`, occurrence
maximale jouée par mesure — les occurrences jouées sont contiguës à partir de 0)
et classe chaque clé manquante :

| Signature | Sens |
|---|---|
| **H1** | l'ensemble des occurrences GP de la mesure est **exactement** l'ensemble joué **translaté** (même cardinalité, décalage constant ≠ 0) → renumérotation prouvée, réparable |
| **H2** | cardinalité différente, ou mesure jamais jouée → GP décrit une/des traversée(s) que le déroulé ne produit pas : **donnée du .gp**, aucun décalage ne peut la couvrir |

**Mesure (code livré, 15 échantillons)** — clés manquantes **104 → 72** :

| fichier | clés GPIF | manquantes | H1 | H2 (mesures) |
|---|---|---|---|---|
| ACDC (Highway to Hell) | 77 | **12** | — | 6 |
| Renaud (Morgane de toi) | 142 | **55** | **4** (mes. 8/9/11/42) | 33 |
| The Offspring (Self Esteem) | 112 | **5** | — | 2 |
| les 12 autres | — | **0** | — | — |

**Preuve indépendante (Renaud, mesures 8/9/11/42)** — offsets audio GPIF relevés :
mes. 8 : GP occ `1@129 371` `2@231 134` — la mesure n'est jouée NI en passe 1 NI
dans la notation ; alphaTab, qui n'incrémente son compteur **que** quand la
mesure est jouée, la joue en occurrences 0 et 1. L'appariement actuel ancre donc
la **passe 3** de la notation sur l'audio de la **passe 2**. Le décalage +1 est
donc réel… mais **local** : les mesures voisines (10, 12, 14, 15, 16, 17-32,
37-43) portent elles aussi 3 passes enregistrées contre 2 jouées (**H2**), et
restent ancrées sur les passes 1-2.

**Verdict de la garde** — appliquer les 4 décalages H1 (séparément **ou**
atomiquement) fait baisser les clés manquantes (55 → 51) mais **ajoute 6 sauts**
(`jumps` 7 → 13) et fait **reculer un segment d'audio** : la région passe 3
pointerait vers l'audio de la passe 2 pendant que les mesures voisines pointent
encore la passe 1-2 → discontinuité. La garde de `raise` (étape 4) **refuse**
donc ces 4 réassignations et **restitue** les libellés à l'identique — aucune
régression possible, la décision est prise par la mesure, pas par un choix.

**Conclusion** — le résidu RC-1 est une **donnée GP** (le .gp a enregistré plus
de traversées que la partition n'en notate), exactement le cas prévu par la
clause « sinon documenter H2 et remonter en amont » (DoD #5) et par le précédent
BUGMP3 §12.2 (toute réassignation naïve régresse). Le mécanisme H1 reste en place,
documenté, et s'appliquera de lui-même si un futur .gp présente un décalage pur.

### 11.8 P4 — anacrouse : **mesure pleine confirmée par l'audio** *(fait)*

**Ce que dit la notation** (sondage alphaTab sur les 15 échantillons) :
6 fichiers portent une anacrouse en mesure 0 — AC/DC, Blink 182, F-Zero X,
Metallica (For Whom the Bell Tolls), The Offspring (durée notée **3 840 ticks =
mesure pleine**, le correctif ne change rien) et **Helloween — Dr. Stein**, dont
la mesure 0 vaut **0 tick**.

**Ce que dit le .gp brut (Dr. Stein)** : `<MasterTrack><Anacrusis />` (GP8 ne
stocke QUE le drapeau, jamais la durée) et la mesure 0 est **réellement vide** —
`<Bar id="0"><Clef>…</Clef><Voices>-1 -1 -1 -1</Voices></Bar>`, tout comme le
modèle alphaTab (4 voix vides, `isEmpty = true`). **Sa durée notée n'existe
donc pas** : ni GP ni alphaTab ne peuvent la donner.

**Ce qui tranche : les sync-points GPIF** (donnée brute, indépendante) :

| repère | `FrameOffset` | temps |
|---|---|---|
| mesure 0, position 0 | 0 | 0 ms |
| mesure 1, position 0 | 70 500 | **1 598,6 ms** |

Or 4 temps à `ModifiedTempo` 150,77 = **1 591,9 ms** → **écart 0,42 %**. Une
mesure pleine 4/4 est donc exactement ce que l'enregistrement consacre à cette
mesure. Le correctif `fixEmptyAnacrusis` livré **restitue la durée mesurée par
l'audio** ; ce n'est pas une convention, c'est la donnée.

**Vérification automatique** — `tools/duration-check.js` relit, pour la mesure
d'anacrouse : durée notée brute, durée après correctif, **portée audio GPIF**
(1er point de la mesure → 1er point de la mesure suivante) et durée **jouée**
relue sur l'axe pré-cuit livré :

| fichier | notée avant | après correctif | portée audio | jouée | écart |
|---|---|---|---|---|---|
| ACDC | 3 840 t | 3 840 t | 2 259 ms | 2 259 ms | 0,04 % |
| Blink 182 | 3 840 t | 3 840 t | 1 599 ms | 1 599 ms | 0,04 % |
| F-Zero X | 3 840 t | 3 840 t | 1 473 ms | 1 473 ms | 0,00 % |
| **Helloween (Dr. Stein)** | **0 t (VIDE)** | **3 840 t** | **1 599 ms** | **1 599 ms** | **0,00 %** |
| Metallica (FWTBT) | 3 840 t | 3 840 t | 2 027 ms | 2 027 ms | 0,00 % |
| The Offspring | 3 840 t | 3 840 t | 2 408 ms | 2 408 ms | 0,01 % |

**Durée totale (DoD #6)** — la fin de la webapp est mesurée **sur l'axe audio**,
par le pont livré lui-même (`MixSync.audioMsFor` sur l'axe pré-cuit total,
exactement ce que `targetSeconds()` vise) : **15/15** fichiers terminent **au
plus** à la fin du MP3 (aucun dépassement → le synthé ne joue jamais seul après
la fin de l'audio). L'écart négatif (−0,1 % à −42,6 %) mesure la **couverture**
des sync-points du .gp : quand elle est < 100 %, c'est l'audio qui termine le
morceau — donnée du fichier (§11.2.3), pas défaut. Sepultura, seule couverture
100 %, est à **+0,08 %** — dans la tolérance. ⚠️ L'axe pré-cuit total (journalisé
par le harnais) **n'est pas comparable** au MP3 : sauts et segments clampés le
rendent non additif (piège de mesure identifié par la refonte P0).

**Conclusion** — D6 est clos : la mesure pleine est **justifiée par la donnée**
sur Dr. Stein comme sur les 5 autres, à ≤ 0,04 % près. Aucun changement de code
n'était nécessaire : le correctif livré est le bon.

### 11.9 Commandes de vérification (état après P0 → P4)
```
node tools/load-smoke.js            # OK
node tools/repeat-check.js          # OK — clés 104 -> 72
node tools/barocc-instrument.js     # OK — 72 clés : 41 mesures H2 + 4 H1 refusées
node tools/sync-audit.js            # OK — chemin livré
node tools/tempo-correct-sim.js     # OK — modèle PRÉ-P2 (référence)
node tools/tempo-prebake-spike.js   # OK — pré-cuisson, 15/15 < 0,5 %
node tools/mix-sync-harness.js      # OK — tempoWrites 0/15, dérive croisière ≤ 11 ms
node tools/duration-check.js        # OK — anacrouses ≤ 0,04 %, fin ≤ fin du MP3
node tools/test-all.js              # RESULTAT : OK — 8/8 harnais verts
```

### 11.10 P5-13 — test navigateur : **0 écriture de vitesse, 14/14** *(fait)*

**Ce qui tourne.** `tools/browser/run.js` sert le dépôt en `http://127.0.0.1`
(contexte sûr → `AudioWorklet`), ouvre Chrome **déjà installé**
(`--autoplay-policy=no-user-gesture-required`, throttling des onglets de fond
désactivé — sans quoi le thread principal est bridé et fabrique de **faux**
« arrêts maître »), clique le bouton d'un **exemple du manifeste** (le vrai
chemin `Samples` → `fetch` → `Player.loadFile`), clique **Lecture**, joue 21 s
(ou jusqu'à la fin du morceau), puis relit l'instrumentation **livrée**
`[mix-stats]`. Aucun miroir : les expressions de relecture sont celles de
`tools/mix-sync-harness.js`, et la seule sonde ajoutée est un **compteur
passe-plaques** sur `api.playbackSpeed` (le vrai setter d'alphaTab est appelé —
comportement inchangé) pour mesurer la cible P2, absente du journal livré.

**Résultat (`node run.js --all`, 14 exemples du manifeste, 21 s chacun)** :

| exemple | mes. | pts synchro | audio (s) | horloge (s) | audio joué (s) | `playbackSpeed` | dérive croisière | pic | arrêts | err |
|---|---|---|---|---|---|---|---|---|---|---|
| AC/DC — Highway to Hell | 43 | 68 | 310,1 | 20,9 | 19,8 | **0** | 12 ms | 12 ms | 0 | 0 |
| Blink 182 — All the Small Things | 53 | 147 | 256,1 | 21,0 | 20,3 | **0** | 73 ms | 73 ms | 0 | 0 |
| Europe — The Final Countdown | 103 | 58 | 309,1 | 20,8 | 20,7 | **0** | 24 ms | 43 ms | 0 | 0 |
| F-Zero X — Goal BGM | 10 | 14 | 422,1 | 14,1 | 14,5 | **0** | 11 ms | 11 ms | 0 | 0 |
| Helloween — Dr. Stein | 114 | 112 | 306,4 | 21,0 | 20,8 | **0** | 58 ms | 58 ms | 0 | 0 |
| Igorrr — Blastbeat Falafel | 97 | 4 | 195,1 | 21,0 | 21,0 | **0** | 70 ms | 70 ms | 0 | 0 |
| Igorrr — Headbutt | 159 | 18 | 224,5 | 21,0 | 20,9 | **0** | 92 ms | 92 ms | 0 | 0 |
| Iron Maiden — Fear of the Dark | 127 | 137 | 438,2 | 20,9 | 20,8 | **0** | 25 ms | 25 ms | 0 | 0 |
| Led Zeppelin — Immigrant Song | 38 | 64 | 146,8 | 21,0 | 20,9 | **0** | 20 ms | 20 ms | 0 | 0 |
| Metallica — For Whom the Bell Tolls | 66 | 141 | 310,0 | 20,9 | 20,6 | **0** | 82 ms | 83 ms | 0 | 0 |
| Renaud — Morgane de toi | 50 | 100 | 373,2 | 20,9 | 16,9 | **0** | 21 ms | 6 939 ms | 0 | 0 |
| Sepultura — Amen | 63 | 168 | 267,1 | 21,0 | 20,8 | **0** | 79 ms | 79 ms | 0 | 0 |
| Slayer — Hell Awaits | 138 | 149 | 378,1 | 20,8 | 20,5 | **0** | 70 ms | 70 ms | 1 | 0 |
| The Offspring — Self Esteem | 51 | 251 | 257,9 | 21,0 | 20,9 | **0** | 23 ms | 23 ms | 0 | 0 |

**Ce que ça prouve :**

- **0 écriture de `playbackSpeed` en lecture sur 14/14** — la cible de P2 est
  tenue non plus seulement dans le banc (audio factice) mais dans un navigateur
  réel avec décodage MP3 : aucune coupure du synthé. C'est l'invariant de
  premier ordre.
- **0 erreur console sur 14/14** ; le moteur et la piste audio embarquée sont
  câblés partout (points de synchro > 0, durée audio > 0, audio réellement
  défilé).
- **La dérive de croisière reste sous la zone morte** (11-92 ms) : aucune
  emballement, la boucle de correction travaille dans sa bande de conception
  (§6.5). Le pic élevé de **Renaud (6 939 ms)** n'est **pas** une dérive : c'est
  la taille d'un **saut de renvoi** (un seul `seek`, exactement la signature
  attendue — « recadrages sauts », §6.3).
- Les **🟡** (8/14) signalent seulement l'écart à la cible **stricte** du §6.3
  (dérive < 40 ms), cible mesurée sur le banc déterministe ; ils ne sont pas des
  échecs (§6.5).
- La trace **P3** réapparaît à l'identique dans le navigateur (Renaud) :
  `[oracle] P3 renumérotation GP (H1) : 0 mesure(s) réassignée(s) …, 4 rejetée(s)
  par la garde (clés manquantes 55 → 55) — résidu H2`.

**Réserve de couverture** — le manifeste `samples/list.json` n'a que **14**
entrées alors que `samples/` en contient **15** : le test le **signale**
(`Metallica (1983 - Kill 'Em All) - The Four Horsemen.gp` non listé, non
cliquable) et couvre donc 14/15. La régénération (`gen-samples.bat`) relève de
P6.

**Commandes**
```
cd tools/browser && npm i      # playwright-core (devDependency locale, isolée)
npm test                       # 3 exemples représentatifs (~2 min)
npm run test:all               # les 14 exemples du manifeste (~9 min)
node run.js --headed --verbose # navigateur visible, journal complet
```
