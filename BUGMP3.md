# BUGMP3 — Lecture de la piste audio embarquée (mp3)

> Analyse **sans modification de code**. Deux symptômes signalés dans `BUG.md` :
>
> 1. `Helloween … Dr. Stein.gp` — lecture lancée en mesure 16, **légers retours en
>    arrière audio** en mesures 18 et 19.
> 2. `ACDC … Highway to Hell.gp` — fin de la mesure 17 ≈ 1:03, **DS Al Coda** vers la
>    mesure 6 : « cela fait sauter l'audio ». De plus, la séquence correspondante se
>    trouve vers **1:10** dans le mp3 alors que la partition en est à 1:03.
>
> Questions posées : fichier GP particulier, **performance** sur gros fichiers,
> **taux d'échantillonnage** du mp3, ou **synchro du mp3 dans le GP d'origine** ?

---

## 1. Rappel du fonctionnement

```
alphaTab = MAÎTRE DU TEMPS  (playerMode = synthesizer, tempo NOTÉ)
    │  playerPositionChanged (~344/s)   ──  js/player.js → MixSync.onPosition()
    ▼
js/mix-sync.js
    build(score)      : alphaTab.midi.MidiFileGenerator.generateSyncPoints(score)
                        → points[] = { t: synthTime (ms), a: syncTime (ms) }, trié par t
    audioMsFor(t)     : interpolation linéaire entre 2 points consécutifs
    targetSeconds()   : audioMsFor(api.timePosition × playbackSpeed) / 1000
    correct()         : |dérive| > 400 ms → seek dur ; 50 ms < |dérive| < 400 ms
                        → playbackRate = 1 − clamp(dérive / 2000, ±10 %)
```

Constantes (`js/mix-sync.js` l.39-60) :

| constante | valeur | rôle |
|---|---|---|
| `HOLD_MS` | 400 ms | dérive au-delà de laquelle on **recalcule d'un coup** (seek) |
| `SOFT_MS` | 25 ms | en pause |
| `NUDGE` | **±10 %** | amplitude **max** de correction de `playbackRate` |
| `GAIN` | 2000 ms | vise une remise à zéro de la dérive en ~2 s |
| `CONTROL_MS` | 250 ms | cadence max de décision (4 décisions/s) |
| `DEADBAND_MS` | 50 ms | sous cette dérive, on ne touche à rien |
| `WRITE_MS` | 400 ms | écart min. entre deux écritures de `playbackRate` |

### 1.1 Le pont est **le même** qu'alphaTab

`audioMsFor()` (l.114-135) est **algorithmiquement identique** à
`MidiFileSequencer.mainTimePositionToBackingTrack()` (alphaTab.js l.35301-35323) :
recherche du dernier point dont `synthTime ≤ t`, puis interpolation linéaire sur le
segment suivant, extrapolation après le dernier point. **Le pont n'est pas la source
des écarts.**

### 1.2 Différence **d'architecture** avec alphaTab (important)

alphaTab, quand il pilote lui-même une piste audio :

* ne ré-applique le pont **que lors des seeks** :
  `updateTimePosition(t, isSeek)` → `if (isSeek) seekTo(mainTimePositionToBackingTrack(...))`
  (alphaTab.js l.40477-40480) ;
  et maintient `playbackRate = playbackSpeed` (l.40467), c'est-à-dire **1,0** ;
* absorbe l'écart de tempo **du côté du synthé** :
  `playbackSpeed = syncPointTempo / currentTempo` (l.40371-40372), avec
  `modifiedTempo = syncPointTempo × playbackSpeed` (l.35026-35028) exposé à
  l'UI (curseur : `cursorSpeed = modifiedTempo / originalTempo`, l.48614).

Autrement dit **GP/alphaTab déplacent la partition, pas l'enregistrement.**

Nous, par conception (« alphaTab reste maître, le MIDI doit sonner comme dans GP »),
le synthé tourne **au tempo noté**. Toute la compensation repose donc **à 100 % sur
notre `<audio>`**, qui est bridé à ±10 %.

---

## 2. Méthode d'analyse

Analyse **hors navigateur, déterministe**, pour éliminer toute cause temporelle :

1. extraction de `Content/score.gpif` (XML GP 8.1.3) et de `Content/Assets/*.mp3`
   depuis chaque `.gp` ;
2. chargement du score avec **alphaTab 1.8.4 exact** (le même `dist/alphaTab.js` que
   le CDN, chargé en Node) → `MidiFileGenerator.generateSyncPoints(score)` ;
3. comparaison points **bruts** du GPIF ↔ points **générés** ;
4. **simulation numérique** de `correct()` (mêmes constantes, pas de navigateur,
   pas de `<audio>` réel) : la dérive, les `playbackRate` écrits et les seeks sont
   recalculés pas à pas.

Si le phénomène apparaît dans une simulation purement numérique, il n'est pas dû à
une performance, à un thread, ni à un navigateur.

---

## 3. Réponse aux trois hypothèses

### 3.1 Performance / gros fichiers → **RÉFUTÉ**

* Le phénomène est **intégralement reproduit hors navigateur** (section 6 et 7) :
  c'est une fonction pure de la table de synchro, aucun chemin temps réel.
* Aucune corrélation avec la taille des fichiers : les pires (Iron Maiden 8,7 Mo,
  Renaud 7,4 Mo, Helloween 6,1 Mo, ACDC 4,2 Mo) côtoient des fichiers de même taille
  **parfaits** (Europe 6,2 Mo → 0 recadrage, Metallica 6,2 Mo → 2, Sepultura 5,3 Mo → 0).
* `F-Zero X` (8,3 Mo) : **0 recadrage**.

### 3.2 Taux d'échantillonnage du mp3 → **RÉFUTÉ**

* Tous les mp3 embarqués sont **48 kHz / 160 kbps CBR** (sauf `Slayer` en 44,1 kHz).
* alphaTab convertit les `FrameOffset` (et le `FramePadding`) en millisecondes avec
  **44100 codé en dur** : `GpifParser._sampleRate = 44100` (alphaTab.js l.19415),
  utilisé en l.19683-19684 (`millisecondOffset = frameOffset / 44100 × 1000`) et
  l.19619 (`_backingTrackPadding = FramePadding / 44100 × 1000`).
* Si cette hypothèse était vraie, **tous** les `syncTime` seraient de
  `48000 / 44100 = 1,08844` (**+8,84 %**) trop grands.
* Or, sur les fichiers dont la partition couvre l'intégralité du mp3, la **dernière
  cible tombe quasi exactement sur la fin du fichier** :

| fichier | dernière cible (s) | durée mp3 (s) | écart |
|---|---:|---:|---:|
| Sepultura – Amen | 267,3 | 267,3 | **0,03 %** |
| The Offspring – Self Esteem | 257,6 | 258,1 | 0,2 % |
| Igorrr – Headbutt | 223,6 | 224,7 | 0,5 % |
| Renaud – Morgane de toi | 368,8 | 373,4 | 1,2 % |
| Slayer – Hell Awaits | 373,2 | 378,3 | 1,3 % |
| Europe – Final Countdown | 302,9 | 309,3 | 2,1 % |
| Helloween – Dr. Stein | 300,3 | 306,6 | 2,0 % |
| Led Zeppelin – Immigrant Song | 143,0 | 146,9 | 2,6 % |

Une erreur de 8,84 % y ferait 245,6 s au lieu de 267,3 s sur Sepultura : **visible
immédiatement**. → la conversion 44100 est cohérente avec les unités qu'écrit GP.

### 3.3 Synchro du mp3 dans le GP d'origine (+ son indexation) → **CONFIRMÉE**

C'est **la bonne piste**, mais elle se décompose en **deux causes distinctes**, qui
correspondent exactement aux deux symptômes :

| | symptôme | cause |
|---|---|---|
| **A** | retours en arrière réguliers (Dr. Stein) | **écart de tempo permanent** partition ↔ enregistrement, non absorbable à ±10 % |
| **B** | saut violent (AC/DC DS Al Coda) | **discontinuités** dans la table générée : le `(BarIndex, BarOccurrence)` d'alphaTab ne colle pas à celui de GP |

---

## 4. Cause A — écart de tempo permanent (Dr. Stein)

GP enregistre, pour **chaque** point de synchro, `<OriginalTempo>` et `<ModifiedTempo>` :

| fichier | `OriginalTempo` | `ModifiedTempo` (moyenne) | min / max |
|---|---:|---:|---|
| Helloween – Dr. Stein | **120** | **146,65** | 27,35 / 160,36 |
| ACDC – Highway to Hell | **110** | **112,29** | 36,67 / 197,22 |

Définition alphaTab (l.34919-34921) : *« The BPM the song will have **virtually after**
this sync point to align the external media time axis with the one from the
synthesizer »*. C'est le tempo auquel **GP joue la partition** quand la piste audio
est active.

### 4.1 Ce que ça implique pour nous

Pour Dr. Stein, la piste audio doit avancer de `120 / 146,65 = **0,818** ×` le temps
réel pour rester calée sur la partition (qui, elle, sonne à 120 BPM).

Contrôle croisé — pente calculée directement sur la table autour des mesures visées :

```
barre 17 → 18 : (53,112 − 51,476) / (34,000 − 32,000) = 0,818
barre 18 → 19 : (54,748 − 53,112) / (36,000 − 34,000) = 0,818
barre 19 → 21 : (57,952 − 54,748) / (40,000 − 36,000) = 0,801
```

`1 / 0,818 = 1,2225` → `120 × 1,2225 = 146,7 BPM` ≈ `ModifiedTempo = 146,65` ✓
Les deux sources concordent **exactement**.

**Pente cible : 108 segments sur 111 sont compris entre 0,70 et 0,90** — donc
l'exigence est **permanente**, pas localisée.

### 4.2 Saturation du correcteur

`NUDGE = 0,10` borne `playbackRate` à **[0,90 ; 1,10]**. Il faudrait **0,818**.

Boucle réelle :

| dérive | décision | `playbackRate` | avance réelle de l'audio | avance de la cible | écart |
|---:|---|---:|---:|---:|---:|
| < 50 ms | rien | 1,000 | 1,000 | 0,818 | +182 ms/s |
| 50 ms | écriture | 0,975 | 0,975 | 0,818 | +157 ms/s |
| 200 ms | écriture | **0,900 (plafonné)** | 0,900 | 0,818 | **+82 ms/s** |
| 400 ms | **seek dur** | 1,000 | — | — | remise à zéro |

Le correcteur est donc **saturé en permanence** : il ne rattrape jamais, il
**sécue**. Cadence théorique ≈ 3,7 s, **mesurée ≈ 3,5 s**.

### 4.3 Simulation (0 → fin, 100 % de vitesse)

```
Helloween – Dr. Stein
  recadrages durs         : 103
  dont RETOURS en arrière : 94        →  18,6 / minute
  écritures playbackRate  : 286
  dérive pic              : 1 594 ms
```

Chaque recadrage ramène l'audio d'environ **400-420 ms en arrière** — exactement la
sensation de « **léger retour en arrière** ».

Position des recadrages par rapport à votre repro :

| temps partition | mesure | recadrage arrière |
|---:|---|---|
| 30,0 s | mesure 16 (départ) | — (resync initial) |
| **34,8 s** | **mesure 18** | −411 ms ✓ |
| **38,3 s** | **mesure 19** | −413 ms ✓ |

→ **Le symptôme est expliqué, reproduit et daté.**

### 4.4 Annexé : un second défaut mineur, propre à ce fichier

Dr. Stein présente **trois points de synchro de synthTime = 0** (`bar0/occ0` ×2,
`bar1/occ0`), donc trois `syncTime` différents : 24,163 s / 24,959 s / 25,762 s.

`audioMsFor()` renvoie `points[0].a` pour `t ≤ points[0].t`, puis, dès `t > 0`, le
**dernier** point de la série (recherche binaire `points[mid].t <= t`) :

```
t = 0 ms   →  24,163 s      (p = point 0)
t = 25 ms  →  25,782 s      (p = point 2)   →  saut de +1,599 s
```

alphaTab, lui, fait `while (next.synthTime <= t) i++` **sans** la branche spéciale
`t ≤ points[0].t` : il renvoie donc 25,762 s **dans les deux cas**.

Conséquence : `resync()` pose `currentTime = 24,163` au départ, puis le premier
`correct()` (≤ 250 ms après) voit −1 617 ms de dérive (> `HOLD_MS`) et recadre
immédiatement de +1,6 s. Un **saut d'1,6 s au tout démarrage** de la lecture.

Sur ACDC ce cas ne se présente pas (aucun point lié à `t = 0`), ni sur Iron Maiden
ni sur Renaud (`doublons de synthTime = 0` mesuré sur ces deux fichiers).

---

## 5. Cause B — discontinuités de la table (AC/DC, DS Al Coda)

### 5.1 Les données **brutes** de GP sont parfaites

`<Automation><Type>SyncPoint</Type>` dans `score.gpif` : **80 points, strictement
croissants, aucun retour en arrière**, de **−1,014 s** à **207,110 s**.

```
  0 bar  0/occ0   -1,014 s      24 bar 16/occ0   71,571 s
  1 bar  1/occ0    1,245 s      25 bar  6/occ4   74,168 s   ← suite chronologique
  ...                           ...
 23 bar 14/occ0   66,776 s      37 bar  9/occ1  101,163 s
```

### 5.2 La table **générée** par alphaTab en perd 16

`MidiFileGenerator._processBarTimeWithSyncPoints` (l.43162-43192) n'applique un
point que si `syncPoint.syncPointValue.barOccurence === occurence`, où `occurence`
est un compteur **par mesure** construit par `MidiPlaybackController`.

Résultat sur ce fichier : **80 points bruts → 64 points générés, 16 écartés** :

```
6/occ3, 6/occ4, 7/occ3, 8/occ3, 5/occ5, 6/occ5, 8/occ4,
5/occ6, 6/occ6, 7/occ5, 8/occ5, 5/occ7, 6/occ7,
12/occ4, 12/occ5, 13/occ5
```

| mesure (index) | `BarOccurrence` max chez GP | chez alphaTab |
|---|---:|---:|
| 5 | **7** | 2 |
| 6 | **7** | 2 |
| 7 | **5** | 2 |
| 8 | **5** | 2 |
| 12 | **5** | 3 |
| 13 | **5** | 3 |

**Les deux ordres de lecture divergent :**

```
GP  (ordre chronologique des FrameOffset) :
    bar8/occ1 → bar5/occ2 → bar6/occ2 → bar7/occ2 → bar8/occ2 → bar6/occ3 → bar9/occ0

alphaTab (MidiPlaybackController, répétitions développées dans les ticks) :
    bar8/occ1 → bar9/occ0 → bar10/occ0 → … → bar16/occ0 → bar5/occ2 → bar6/occ2 → … → bar9/occ1
```

> NB : le `.sort((x,y) => x.t - y.t)` de `MixSync.build()` (l.100) **ne corrige rien** :
> `synthTime` est déjà strictement croissant (les répétitions sont développées,
> `MidiPlaybackController.currentTick` ne fait qu'augmenter, l.42002).

### 5.3 Ce que ça produit dans la table

| segment | Δ synth | Δ audio | écart |
|---|---:|---:|---:|
| bar8/occ1 → bar9/occ0 | +2,181 s | +14,556 s | **+12,375 s** |
| **bar16/occ0 → bar5/occ2** | +0,545 s | **−36,744 s** | **RETOUR** |
| **bar8/occ2 → bar9/occ1** | +2,181 s | **+60,122 s** | **+57,941 s** |
| bar13/occ3 → bar14/occ1 | +2,181 s | +10,266 s | +8,085 s |
| bar37→38 | +2,181 s | +3,430 s | +1,249 s |
| bar38→39 | +2,181 s | +5,153 s | +2,972 s |
| bar39→40 | +2,181 s | +4,563 s | +2,382 s |
| bar40→41 | +2,726 s | +8,180 s | +5,454 s |
| bar41→42 | +1,636 s | +2,846 s | +1,210 s |

Distribution des pentes : **51 segments OK (0,90-1,10) · 1 retour · 8 accélérations brutales**.

### 5.4 Mécanisme du « saut »

`audioMsFor()` fait une interpolation **linéaire continue** entre deux points
consécutifs ; or le maître MIDI avance **continûment** (pas de saut de temps : les
répétitions sont développées dans les ticks). Donc :

* pendant les **545 ms** qui séparent `bar16/occ0` de `bar5/occ2`, la **cible balaie
  36,7 s en arrière** ;
* pendant les **2,18 s** suivantes, elle **balaie 60,1 s en avant**.

`correct()` ne décide qu'au plus toutes les `CONTROL_MS = 250 ms` : à chaque
décision, `|dérive| > 400 ms` → **seek dur**, `playbackRate = 1`, et on recommence.

Simulation :

```
ACDC – Highway to Hell
  recadrages durs         : 52   dont 3 en arrière
  écritures playbackRate  : 59
  dérive pic              : 17 105 ms
```

(53 recadrages dont 4 en arrière selon l'initialisation du départ — voir note de la section 7.)

Détail du passage critique :

| temps | dérive | audio avant → après | note |
|---:|---:|---|---|
| **62,8 s** | +4 955 ms | 71,67 → 66,72 s | début du saut ≈ **1:03 = fin mesure 17** |
| **63,0 s** | +17 105 ms | 66,97 → 49,86 s | |
| **63,3 s** | +15 259 ms | 50,11 → 34,85 s | arrivée ≈ mesure 6 (index 5) |
| 70,0 → 72,0 s | −6 125 → −5 231 ms | 41,37 → 101,21 s | **9 recadrages en avant** couvrant **+59,9 s** |
| 35,0 → 37,0 s | −641 → −1 418 ms | 32,97 → 46,96 s | 9 recadrages couvrant +14,0 s |
| 81,0 → 82,8 s | −1 107 → −927 ms | 109,86 → 119,21 s | 8 recadrages (pente 1,10-1,50) |
| 149,5 → 155,0 s | −483 → −680 ms | 182,69 → 194,93 s | 10 recadrages (fin de morceau) |

→ **Le symptôme « cela fait sauter l'audio » est expliqué** : l'audio est tiré en
arrière à travers **36,7 s en une demi-seconde**, en trois à quatre à-coups.

---

## 6. La question « 1'03 dans la partition vs 1'10 dans le mp3 » → **NORMAL**

À `synthTime = 62 703 ms` (= **1:02,7** de partition), `audioMsFor()` renvoie
**71 571 ms** (= **1:11,6** de mp3). Écart accumulé : **+8,87 s**.

C'est la donnée **de GP elle-même** (`FrameOffset`), pas un artefact de l'application :

* le fichier ne contient qu'**une seule** automatisation de tempo : **110 BPM constants**
  sur les 43 mesures ;
* l'enregistrement, lui, tourne en moyenne à **~117 BPM** sur cette zone
  (pentes 0,955 → 0,977) ;
* la carte du tempo noté court donc **plus lentement** que le disque, et l'écart
  grandit linéairement (+8,87 s à 1:03).

Notre application se contente d'appliquer le pont. **À 100 % de vitesse, cet écart est
normal et souhaitable** : il faut bien que le mp3 soit à 1:11 quand la partition en est
à 1:03 pour que les deux disent la même chose.

> **Réponse : oui, c'est normal. Ce n'est PAS le bug.** Le bug est le **saut** à cet
> endroit-là (cause B, section 5).

---

## 7. Audit des 14 fichiers de `samples/`

Simulation numérique du contrôleur (`HOLD 400 ms`, `NUDGE ±10 %`, `CONTROL 250 ms`)
sur chaque partition, de la première à la dernière mesure, à 100 % de vitesse.
**Modèle déterministe hors navigateur** — les comptes exacts varient de ±1 selon
l'initialisation, l'ordre de grandeur et les positions sont stables.

| fichier | BPM | pentes <0,9 | pentes >1,1 | sauts | recadrages (dont arrière) | /min | dérive pic |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Iron Maiden – Fear of the Dark** | 120 | 76 | 42 | 0 | **224 (153)** | **46,0** | 1 616 ms |
| **Renaud – Morgane de toi** | 100 | 1 | 18 | **6** | **195 (88)** | **41,0** | 20 508 ms |
| **Helloween – Dr. Stein** | 120 | **108** | 1 | 0 | **103 (94)** | **18,6** | 1 594 ms |
| **ACDC – Highway to Hell** | 110 | 2 | 9 | **1** | **53 (4)** | **19,7** | **17 105 ms** |
| Slayer – Hell Awaits | 109 | 16 | 11 | 0 | 20 (0) | 3,9 | 592 ms |
| Blink 182 – All the Small Things | 148 | 0 | 3 | 0 | 12 (1) | 4,8 | 6 924 ms |
| The Offspring – Self Esteem | 106 | 1 | 5 | 1 | 10 (4) | 2,5 | 61 339 ms |
| Igorrr – Headbutt | 190 | 0 | 2 | 0 | 6 (0) | 1,7 | 1 284 ms |
| Igorrr – Blastbeat Falafel | 212 | 0 | 1 | 0 | 3 (0) | 0,9 | 511 ms |
| Metallica – For Whom the Bell Tolls | 120 | 0 | 15 | 0 | 2 (0) | 0,4 | 428 ms |
| Europe – The Final Countdown | 117 | 1 | 0 | 0 | **0** | 0,0 | 149 ms |
| F-Zero X – Goal BGM | 160 | 2 | 0 | 0 | **0** | 0,0 | 76 ms |
| Led Zeppelin – Immigrant Song | 112 | 0 | 1 | 0 | **0** | 0,0 | 376 ms |
| Sepultura – Amen | 84 | 0 | 4 | 0 | **0** | 0,0 | 180 ms |

Légende :

* **pentes < 0,9** : l'audio devrait être **ralenti de plus de 10 %** → correcteur saturé
  (cause A) ;
* **pentes > 1,1** : l'audio devrait être **accéléré de plus de 10 %** → saturé (cause A) ;
* **sauts** : segments où l'axe audio **recule** (cause B) ;
* **recadrages** : `|dérive| > 400 ms` → seek dur ; **« arrière »** = l'audio était en
  avance et se fait tirer en arrière (le symptôme que vous décrivez).

### 7.1 Détails par cas problématique

**Iron Maiden – Fear of the Dark** (non signalé, mais **le plus touché**) :

```
histogramme des pentes : {"0.80-0.90": 76, "0.90-1.10": 16, "1.10-1.25": 6, ">1.25": 36}
seules 16 pentes sur 134 sont dans la plage tolérée
sombres  : r = 0,524 (mes 98→98), 0,540, 0,544, 0,554 …
rapides  : r = 4,190 (mes 5→5), 11,265 (mes 5→6) …
→ 224 recadrages, soit plus d'un tous les 1,3 s
```

**Renaud – Morgane de toi** (6 discontinuités, **bien plus violentes qu'ACDC**) :

```
retours : −194 478 ms (mes 19→20), −99 393 ms (mes 18→15),
          −83 492 ms, −81 241 ms, −16 281 ms, −16 162 ms
avancées : +111 281 ms (mes 20→21), +104 019 ms, +94 195 ms, +85 901 ms …
histogramme : {"0.90-1.10": 87, ">1.25": 17, "<0.80": 6}
```

→ Le symptôme ACDC n'est **pas propre à ce fichier** ; c'est la même cause, ici
amplifiée par un allers-retours DS/D.C. plus long.

---

## 8. Ce qui a été écarté / confirmé

| hypothèse | verdict | preuve |
|---|---|---|
| Performance sur gros fichiers | **non** | reproduit hors navigateur, sans corrélation à la taille |
| Taux d'échantillonnage du mp3 | **non** | 8/14 dernières cibles à ≤ 2,6 % de la durée exacte du mp3 (une erreur y ferait 8,84 %) |
| Écart 1:03 / 1:10 anormal | **non, normal** | c'est la donnée `FrameOffset` de GP (section 6) |
| Synchro mp3 dans le GP | **oui** | cause A : `ModifiedTempo` 146,65 vs `OriginalTempo` 120 ; cause B : 16/80 points perdus, 1 retour + 8 sauts |
| Notre pont `audioMsFor()` | **non** | identique à `mainTimePositionToBackingTrack` (l.35301) |
| Notre contrôleur | **partiellement** | `NUDGE ±10 %` insuffisant (cause A) ; interpolation continue à travers les discontinuités (cause B) |
| `ms >= 0` dans `targetSeconds()` | **anecdotique** | ACDC : `points[0].a = −1 014 ms` → cible nulle uniquement pour `t = 0` exact |

---

## 9. Pistes de correction (à arbitrer — **rien n'a été codé**)

### Cause A — saturer moins, ou ne plus saturer

1. **Piloter `playbackRate` sur la pente locale** plutôt que sur la seule dérive :
   `penteCible = (q.a − p.a) / (q.t − p.t)` sur le segment courant, puis
   `playbackRate = penteCible × (1 − correction_de_dérive)`.
   Avec `preservesPitch` déjà actif, un ralentissement de 18 % **ne transpose pas le
   son** : le mp3 descend à ~120 BPM effective, **le même tempo que le MIDI** → les
   deux flux convergent, c'est exactement le comportement voulu.
2. À défaut, **élargir `NUDGE`** (par ex. 0,25) — solution simple mais moins robuste :
   on perd la protection contre les dérives parasites.
3. **Alerter** : si `|penteCible − 1| > NUDGE`, logger un `[mix] tempo hors plage
   (pente 0,818 — NUDGE 0,10)` : le fichier est alors signalé explicitement au lieu de
   saccader silencieusement.

### Cause B — ne jamais balayer une discontinuité

4. **Détecter les discontinuités dans `build()`** : si
   `|(q.a − p.a) − (q.t − p.t)| > seuil` (ex. 1 000 ms), ce n'est pas un segment
   interpolable. Traiter le segment comme un **saut** : à l'entrée, **un seul**
   `seekTo(...)` vers la bonne extrémité, sans interpolation.
5. **Segmenter la table** aux discontinuités (blocs continus) et n'interpoler qu'à
   l'intérieur d'un bloc.
6. **Amont / upstream** : signaler à alphaTab que `generateSyncPoints()` perd 16/80
   points sur `ACDC … Highway to Hell.gp` faute d'accord sur `BarOccurrence`
   (GP pense mesures 6-9 jouées 8 fois, alphaTab 3 fois). En attendant, une piste
   locale serait de reconstruire les occurrences **à partir de l'ordre
   chronologique des `FrameOffset`**, qui, lui, est strictement cohérent.

### Vérifications utilisateur

7. Tester **Iron Maiden – Fear of the Dark** et **Renaud – Morgane de toi** : le modèle
   les classe en tête, ils devraient reproduire les deux symptômes.

---

## 10. Reproduction

Méthode utilisée (indépendante du navigateur) :

1. extraire `Content/score.gpif` et `Content/Assets/*.mp3` de chaque `.gp`
   (PowerShell : `System.IO.Compression.ZipFile`) ;
2. `npm i` inutile : charger `dist/alphaTab.js` (1.8.4, le même que le CDN) en Node :
   `const at = require('.../alphaTab.js')` — l'export UMD fonctionne tel quel ;
3. `at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(fs.readFileSync(gp)), new at.Settings())`
4. `at.midi.MidiFileGenerator.generateSyncPoints(score)` → table exacte utilisée par
   `MixSync.build()` ;
5. rejouer `audioMsFor()` + `correct()` pas à pas avec les constantes de
   `js/mix-sync.js` l.39-60.

Vérifications croisées utilisées dans ce document :

* points **bruts** du GPIF (regex sur `<Type>SyncPoint</Type>`) ↔ points **générés**
  → 16 écartés sur ACDC, 0 sur Helloween ;
* `<OriginalTempo>` / `<ModifiedTempo>` du GPIF ↔ pentes de la table générée ;
* durée des mp3 par comptage de trames et par `taille × 8 / bitrate` (CBR 160 kbps) ;
* premier octet de synchro mp3 : `FF FB A4` → MPEG-1 Layer III, `srIdx = 1` → 48 000 Hz.

---

## 11. Résultats après correction

**Correctifs appliqués** dans `js/mix-sync.js` (seul fichier de l'app modifié) :

1. **Dédoublonnage des `synthTime` identiques** (`analyzeSegments`) : on garde le
   **dernier** doublon — sémantique exacte d'alphaTab. → supprime le saut de 1,6 s
   au démarrage (annexe 4.4).
2. **Détection des discontinuités** : un segment est un « saut » si l'axe audio
   **recule** (Δa < 0) ou a une pente hors `[1/3 ; 3]`. Le seuil `|Δa − Δt| > 1 000 ms`
   proposé en §9.4 a été **écarté** : il confond un long segment à tempo modéré
   (ex. pente 0,818 sur 6 s → écart 1 092 ms) avec une discontinuité.
3. **Re-ancrage des sauts** : la cible ne **balaye plus** `p.a → q.a` sur Δt. Elle
   saute à l'entrée du segment vers le bloc destination, puis le rejoint sans couture
   en `q.t`. → **un seul seek** par discontinuité, au lieu d'un balayage saccadé.
4. **Rate piloté sur la pente locale** : `playbackRate = vitesse × penteLocale ×
   (1 − correction de dérive)`, pente clampée à `[0,5 ; 2,0]`. Le mp3 converge vers le
   tempo du MIDI (`preservesPitch` actif : aucune transposition). → fin de la sécussion.
5. **Alerte** : `console.warn('[mix] tempo hors plage …')` au build pour les segments
   que le rate ne peut pas suivre.

**Validation** — harnais déterministe `tools/sync-audit.js` (simulation `correct()`
hors navigateur, deux variantes sur la table `generateSyncPoints` réelle) sur les 14
`samples/*.gp`. La variante LEGACY reproduit la baseline du tableau §7 à ±1 près
(ACDC 53/4, Iron Maiden 224/153, Renaud 195/88, Offspring 10/4 …) — le modèle est validé.

| métrique (14 fichiers) | LEGACY | NEW | gain |
|---|---:|---:|---:|
| recadrages durs | 627 | 44 | −93 % |
| dont retours en arrière | 344 | 16 | −95 % |
| **dont GLITCHS (dérive — le vrai saccade)** | **397** | **10** | **−97,5 %** |
| pire burst (seeks / 1,5 s) | 7 | 4 | −43 % |

Par symptôme signalé dans `BUG.md` :

* **Helloween – Dr. Stein** : glitchs **95 → 0**, recadrages 102 → 1. Les retours
  audio des mesures 16-19 sont **éliminés**.
* **ACDC – Highway to Hell** (CRITICAL) : glitchs 15 → 3, burst 7 → 2. Le DS al Coda
  ne fait plus qu'**un saut propre** au lieu de faire « sauter l'audio ».

Les seeks restants de NEW sont **volontés** : ce sont les sauts aux répétitions
(DS al Coda, D.C.) — **1 par discontinuité**. Un `maxArr` élevé (Renaud −194 s) est la
**taille du saut voulu** (la répétition renvoie bien à cette position audio), pas un raté.

**Limite connue — Phase 3 (non couverte)** : là où alphaTab perd des points de synchro
(ACDC 16/80, Renaud 43/156), le `BarOccurrence` d'alphaTab ne colle pas à celui de GP :
le saut est maintenant **propre** mais peut viser une position audio légèrement décalée de
la « vraie » occurrence chronologique. La correction définitive (§9.6) consiste à
reconstruire les occurrences depuis l'ordre des `FrameOffset` — à faire si besoin.

**Reproduction / non-régression** :
* `node tools/sync-audit.js` (options `--debug` : liste les segments de saut ;
  `--gp <fichier>` : un seul .gp ; `--dt <ms>` : pas de simulation).
* `node tools/load-smoke.js` : chargement + bindings.
* alphaTab 1.8.4 est téléchargé une fois dans `tools/vendor/` (ignoré par git).

---

## 12. Reste à faire — 2 bugs identifiés (dans l'ordre d'attaque)

### 12.1 Bug des alternate endings (volta) — **cause racine de P3**

**Symptôme** (Blink 182 – All the Small Things) : les renvois multiples (fins
1‑2‑3 puis 4) sont mal développés. Attendu `6-7-8-9 6-7-8-9 6-7-8-9 6-7-8-10`,
observé `6-7-8-9` ×2 puis `10` — les fins ne sont pas épuisées.

**Structure GPIF** (correcte, bien lue par alphaTab) :
```
#5 (mes 6)  <Repeat start="true"  count="0">
#8 (mes 9)  <Repeat end="true" count="2"> <AlternateEndings>1 2 3</AlternateEndings>
#9 (mes 10) <AlternateEndings>4</AlternateEndings>
```
→ 4 passages attendus (fin 9 pour les passes 1‑2‑3, fin 10 pour la passe 4).

**Mécanisme** — `MidiPlaybackController._moveNextWithNormalRepeats`
(alphaTab.js l.42119) pilote le nombre de passages par `repeatCount` :
```js
const masterBarRepeatCount = masterBar.repeatCount - 1;   // = 2 - 1 = 1
if (repeat.iterations[…] < masterBarRepeatCount) { … répète … }
```
`repeatCount=2` → 2 passages, alors que les **alternate endings** (1‑2‑3‑4) en
exigent **4**. La boucle s'arrête avant d'épuiser les fins alternées.

**Portée** : **global** — tout morceau avec alternate endings (volta). Blink 182
n'est que le cas le plus visible (4 fins d'affilée).

**Lien avec P3** : c'est la **cause racine**. Le nombre de passages faux fait
diverger le compteur `(BarIndex, BarOccurrence)` d'alphaTab vs GP → les points de
synchro sont mal appariés → symptôme P3. Corriger le développement des fins
alternées doit **aussi** faire retomber une bonne partie de P3.

**Correctif à envisager** : dans `_moveNextWithNormalRepeats`, quand le groupe a
des alternate endings, le nombre de passages doit être dicté par le **numéro de
fin maximum** (ici 4), pas par `repeatCount` (2). Attention à ne pas casser les
répétitions simples (sans volta) où `repeatCount` = nombre de passages.

### 12.2 P3 / §9.6 — reconstruction des occurrences (résidu)

Une fois 12.1 corrigé, traiter le **résidu** : les fichiers où alphaTab et GP
divergent encore sur les occurrences de mesures (malgré un développement correct).
Concerne surtout **ACDC** (64/80 points), **Renaud** (113/156), **Iron Maiden**
(135/136).

**Correctif (§9.6)** : reconstruire le mapping `(mesure, occurrence) → FrameOffset`
**depuis l'ordre chronologique des `FrameOffset`** (lui strictement cohérent) au lieu
de se fier à l'appariement `(BarIndex, BarOccurrence)` d'alphaTab. → le saut (déjà
propre grâce à la Phase 1) atterrit alors sur la **bonne** occurrence.

**Limite** : §9.6 corrige la couche « appariement ». Si alphaTab développe encore
les répétitions un nombre de fois différent de l'enregistrement (couche 2), un saut
résiduel peut subsister → à remonter en amont (alphaTab) si besoin.

### Ordre d'attaque
1. **12.1** (alternate endings) — cause racine, corrige le MIDI *et* une partie de P3.
2. **12.2** (§9.6) — pour le résidu que 12.1 ne couvre pas.
