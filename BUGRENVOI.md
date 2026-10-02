# BUGRENVOI — renvois / fins alternées / volta

> Analyse + plan de correction. **Un seul système maître : alphaTab.**
> Écrit après l'audit des 14 échantillons et l'implémentation du correctif
> (cf. §5). Aucun autre fichier n'a été touché que `js/player.js`.

---

## 0. Verdict en une ligne

| Fichier | Séquence MIDI | Cause | État |
|---|---|---|---|
| **AC/DC** (m6-m10) | **correcte** | pas un problème de renvoi | §6 : problème de **données de synchro** (`BarOccurrence`), non résolu |
| **Renaud** | **fausse** (61 mesures au lieu de ~100) | **deux** bugs imbriqués : le nôtre, puis celui d'alphaTab | **corrigé** (§4 + §5) |
| Iron Maiden, Igorrr | fausses (fins silencieuses) | même bug alphaTab que Renaud | **corrigé** (§5) |
| 11 autres échantillons | correctes | — | inchangés, **bites identiques** |

---

## 1. Carte de l'API alphaTab 1.8.4 (renvois)

Références = `dist/alphaTab.js` du CDN figé `alphatab@1.8.4`.

### 1.1 Modèle (`alphaTab.model`)

| Symbole | Ligne | Rôle |
|---|---|---|
| `MasterBar.alternateEndings` | 2460 | **masque ABSOLU de bits** : bit k = fin k+1 (fin 1 → `1`, fin 2 → `2`, fins 1-2-3 → `7`) |
| `MasterBar.isRepeatEnd` | 2529 | **getter** `return this.repeatCount > 0` |
| `MasterBar.repeatCount` | 2535 | nombre de traversées du groupe ; alphaTab en tire `masterBarRepeatCount = repeatCount - 1` sauts en arrière |
| `MasterBar.isRepeatStart` | 2528 | ouvre un groupe |
| `MasterBar.repeatGroup` | 2540 | `RepeatGroup` d'appartenance |
| `RepeatGroup.opening` / `.closings` / `.isClosed` | 2895 | première barre / **tableau de TOUTES les fins** / groupe complet |
| `Score.rebuildRepeatGroups()` | 3521 | construit les groupes à l'import |
| `GpifParser._parseMasterBar` | 20308 | lit `Repeat start/end/count` et `AlternateEndings` |
| `AlternateEndings` | 19679-19680 | bit `1 << (n-1)` |
| `Directions` (`Target`, `Jump`) | — | 21 membres de `alphaTab.model.Direction` |

### 1.2 Moteur de lecture (`alphaTab.midi`, **non exporté**)

| Symbole | Ligne | Rôle |
|---|---|---|
| `Repeat` | 41949 | `iterations = group.closings.map(() => 0)` + `closingIndex` |
| `MidiPlaybackController` | 41964 | **le** calculateur de l'ordre de lecture |
| `processCurrent()` | 41979 | `iteration = repeat.iterations[repeat.closingIndex]` puis `shouldPlay = (alternateEndings & 1 << iteration) !== 0` |
| `moveNext()` | 42004 | directions d'abord, sinon répétitions |
| `_moveNextWithDirections()` | 42046 | DaCapo / DalSegno / DaCoda / Fine (`_findJumpTarget` : *backwardsFirst* puis *forwards*) |
| `_moveNextWithNormalRepeats()` | — | saut si `iterations[closingIndex] < repeatCount - 1` ; **sinon** avance `closingIndex`, **sinon** dépile |
| `MidiFileGenerator._playThroughSong()` | 43059 | **SEUL** utilisateur du contrôleur (`new MidiPlaybackController(score)` l.43060) |
| `PlayThroughContext` | 42921 | `synthTick / synthTime / currentTempo / syncPoints / …` |
| `_processBarTimeWithSyncPoints()` | 43157 | `if (syncPoint.syncPointValue.barOccurence !== occurence) continue;` |
| `occurence` | 43073-43075 | part à `-1`, `++` ⇒ **0-based** |

**Point clé pour l'implémentation** : `_playThroughSong` a exactement **3 appelants**
— génération MIDI (42980), `generateSyncPoints` (43050), `buildModifiedTempoLookup`
(43057). Le MIDI, les points de synchro et la table de tempo modifié sortent donc
**tous du même parcours** : envelopper cette méthode suffit à tout aligner.

### 1.3 Ce qu'alphaTab fait correctement (démontré)

* volta à **fin unique** (tous les groupes d'AC/DC : `@2/5`, `@6/9`, `@13/14`, `@30/31`, `@34/35`),
* **DaCapo**, **DalSegno**, **DaCoda / Fine** (`Target=Segno` m5, `SegnoSegno` m6, `Jump=DaCoda` m33, `Jump=DaSegno` m36, `Jump=DaSegnoSegnoAlCoda` m37 sur Renaud) — la séquence 1→36 puis DS→5→50 est exacte,
* **la position de chaque barre dans le temps** (ticks, durées).

### 1.4 Ce qu'alphaTab fait INCORRECTEMENT

1. **Volta à fins multiples** — voir §4.
2. **Après un DalSegno, les renvois sont ignorés** : `_moveNextWithDirections`
   renvoie `true` en permanence dès que `_state !== 0` (`case 1: this.index++`),
   donc `_moveNextWithNormalRepeats()` **n'est jamais appelé** dans la section
   D.S. C'est un choix d'implémentation, pas une panne — mais il n'est pas
   vérifié contre Guitar Pro (§8, point O3).
3. **`barOccurence`** : le couplage GPA→alphaTab est fragile (§6).

---

## 2. Cause n°1 — notre propre court-circuit (Renaud)

### 2.1 Où

`js/player.js`, dans `scoreLoaded` :

```
scoreLoaded → fixEmptyAnacrusis(score) → fixAlternateEndings(score) → loadMidiForScore() → render()
```

Les deux fonctions s'exécutaient **entre le parse d'alphaTab et la génération
MIDI**, c'est-à-dire exactement entre `Score.finish()` (`rebuildRepeatGroups()`)
et `_playThroughSong()`. Toute mutation y était donc vue par **les deux**
générateurs, et **jamais** par le moteur de rendu qui, lui, a déjà lu le score.

### 2.2 Mesure (Node, mêmes fonctions, 14 échantillons)

| Fichier | alphaTab seul | avec nos 2 correctifs | delta |
|---|---:|---:|---:|
| Blink 182 | 92 | 99 | **+7** |
| Igorrr *Blastbeat Falafel* | 169 | 127 | **−42** |
| Iron Maiden | 146 | 137 | **−9** |
| **Renaud** | **119** | **61** | **−58** |
| Slayer | 209 | 221 | **+12** |
| The Offspring | 104 | 107 | **+3** |
| 8 autres | — | — | 0 |

`fixAlternateEndings` se déclenche donc sur **6 fichiers / 14**, et `fixEmptyAnacrusis`
sur **1 seul** (Helloween, barre de pickup à 0 tick).

### 2.3 Mécanisme exact de la chute 119 → 61 (tracé ligne à ligne)

`fixAlternateEndings` faisait, pour un groupe à **fins multiples** :
`mb.repeatCount = 1`.

1. `_moveNextWithNormalRepeats()` calcule `masterBarRepeatCount = repeatCount - 1 = 0`.
2. `if (repeatStack.length > 0 && masterBarRepeatCount > 0)` → **faux** : ni saut,
   **ni dépilement** (`else { pop }` jamais atteint).
3. Le groupe reste donc **collé à la pile `_repeatStack` pendant toute la chanson**.
4. Conséquences en cascade :
   * son filtre `alternateEndings` s'applique à **toutes** les barres masquées
     qui suivent (jusqu'au prochain `_resetRepeats()`, ici `Jump=DaSegno` m36) ;
   * et, via `previousAlternateEndings`, **aussi aux barres sans masque** ;
   * → Renaud se trouve amputé de m11-m14, m22-m36, etc.

Séquence obtenue par l'application : `1 2 3 4 | 6 7 8 9 | 6 7 8 | 15 16 17 18 | (DS) 5 6 7 8 … 50` (61 mesures).

### 2.4 Ce qui reste de nos anciens correctifs

* **`fixAlternateEndings` : SUPPRIMÉ** (aucune branche n'était fiable, §4.4).
* **`fixEmptyAnacrusis` : CONSERVÉ.** Il ne touche ni `repeatCount`, ni
  `alternateEndings`, ni `repeatGroup` : il ne change que `isAnacrusis` et
  recale `masterBar.start`. Il se déclenche sur **1 fichier sur 14**
  (Helloween) et **ne change pas la longueur de la marche** (167 → 167).
  Il garde par ailleurs `MasterBar.start` cohérent avec les ticks que
  `_playThroughSong` accumule (les deux passent par `calculateDuration()`),
  donc recherche + MIDI restent alignés.

---

## 3. Question initiale : « court-circuitons-nous alphaTab ? »

**Oui — c'était littéralement vrai, et c'était le bug.**

* Oui, `fixAlternateEndings` court-circuitait le modèle de répétition d'alphaTab
  **entre son parse et sa génération MIDI** (§2.1).
* Oui, il faut **laisser alphaTab entièrement maître de la piste MIDI**, parce que
  notre pont audio dépend du *même* parcours : `MixSync.build()` appelle
  `MidiFileGenerator.generateSyncPoints(score)`, qui rejoue exactement le même
  `_playThroughSong`. L'invariant « audio aligné sur le MIDI » ne tient **que si
  personne ne mutue le score entre les deux appels**.

Trois réserves, qui empêchent un « on touche à rien » pur :

1. alphaTab a un **vrai** défaut sur la volta à fins multiples (§4) ;
2. nos deux correctifs n'étaient pas neutres : en les supprimant on change le
   rendu de 6 fichiers — il faut donc **re-mesurer** (§5) ;
3. le fichier MP3 embarqué est un artefact **externe** : aucun alignement ne peut
   rattraper une piste dont les repères `barOccurence` sont mal numérotés (§6).

---

## 4. Cause n°2 — le bug résiduel d'alphaTab (fins multiples)

### 4.1 L'incohérence

* `Repeat.iterations` (l.41958) est créé par `group.closings.map(() => 0)` :
  c'est un compteur **par fin de répétition**, indexé par `closingIndex`.
* `alternateEndings` est un masque **absolu** : bit k = fin k+1.

Les deux coïncident **si et seulement si le groupe n'a qu'UNE fin de répétition** :
`closingIndex` vaut toujours 0, `iterations[0]` compte les traversées, les bits
et les traversées se répondent.

Dès qu'il y a **plusieurs** fins, ils divergent.

### 4.2 Tracé complet sur Renaud (groupe `m1…m5`, fins `m4` (fin 1) + `m5` (fin 2), `count=2` partout)

alphaTab **seul**, pas à pas :

| pas | barre | `closingIndex` | `iterations` | masque | joué ? | action |
|---|---|---|---|---|---|---|
| 1 | m4 | 0 | `[0,0]` | `1` | `1 & 1` → **oui** | `0 < 1` → **saut**, `[1,0]` |
| 2 | m4 | 0 | `[1,0]` | `1` | `1 & 2` → non | `1 < 1` faux → `closingIndex = 1` |
| 3 | m5 | 1 | `[1,0]` | `2` | `2 & 1` → **non** ← *devrait jouer la fin 2* | `0 < 1` → **saut**, `[1,1]` **puis reset `iterations[0] = 0`** |
| 4 | m4 | 0 | `[0,1]` | `1` | `1 & 1` → **oui** ← *devrait être silencieux* | `0 < 1` → **saut**, `[1,1]` |
| 5 | m4 | 0 | `[1,1]` | `1` | non | avance |
| 6 | m5 | 1 | `[1,1]` | `2` | `2 & 2` → oui | dépile → m6 |

**4 traversées au lieu de 3.** La ligne coupable est
`for (let i = 0; i < repeat.closingIndex; i++) repeat.iterations[i] = 0;`
: en sautant depuis la fin n°2, elle **remet à zéro le compteur de la fin n°1**,
qui re-saute donc une fois de trop.

### 4.3 Ce que cela donne

* alphaTab seul : `1 2 3 4 | 1 2 3 | 1 2 3 4 | 1 2 3 5 | 6 …` (119 mesures, **4** traversées)
* Guitar Pro (attendu) : `1 2 3 4 | 1 2 3 5 | 1 2 3 6` (**3** traversées)
* application (avec nos anciens correctifs) : `1 2 3 4 | 6 7 8 9 …` (61 mesures)

Le même mécanisme donne, sur le groupe `m15…m21` (fins `m18`+`m19`+`m20`),
**8 traversées au lieu de 4**, et sur Iron Maiden `m14` : **alphaTab seul ne
joue JAMAIS `m16`** — la fin 3 disparaît complètement (compteur `iterations[1]`
qui ne prend jamais la valeur 2).

### 4.4 Notre ancien `fixAlternateEndings`, branche par branche

| branche | idée | verdict |
|---|---|---|
| `closings.length > 1` → `repeatCount = 1` | « une traversée par fin » | **catastrophique** : `masterBarRepeatCount = 0` → ni saut ni dépilement → fuite de pile (§2.3). Démontré. |
| `maxEnd > repeatCount` → `repeatCount = maxEnd` | « le nombre de traversées doit atteindre la fin la plus haute » | **supprimé aussi.** Démontré faux par AC/DC : le groupe `@6/9` a exactement la même notation (volta `1 2 3` + `count=2` + fin `4` juste après) et alphaTab **sans correctif** donne `6 7 8 9 · 6 7 8 9 · 10` — séquence que l'utilisateur qualifie de **correcte**. La branche n'était appliquée que quand le masque porte sur la barre de fin elle-même (Blink `m9`, Slayer `m48/m55/…`, Offspring `m20`) : elle aurait produit 4 traversées là où AC/DC, noté pareil, en a 2. |

**Règle retenue : alphaTab est le seul à décider du `repeatCount`.** On ne corrige
que le cas où son *algorithme* est démontrablement incohérent avec lui-même.

---

## 5. Correctif implémenté (`js/player.js`)

### 5.1 Principe — regrouper les fins, sans toucher au contrôleur

`MidiPlaybackController` et `Repeat` ne sont **pas exportés** par le bundle UMD.
Mais `_playThroughSong` l'est (méthode statique) et c'est leur **seul** usage.
On enveloppe donc cette méthode ; la mutation du score n'existe **que pendant
l'appel** et est annulée en `finally`.

Pour un groupe à **plusieurs** fins de répétition :

1. toutes les fins **sauf la dernière** perdent `repeatCount`
   (donc `isRepeatEnd` → `false`) : elles deviennent de simples barres à masque ;
2. la dernière garde son masque et prend
   `repeatCount = max(` **numéro de fin le plus haut porté par une fin de répétition** `+ 1`,
   `nbFins + 1`, `compte du groupe`)` ;
3. `repeatGroup.closings` est ramené à **cette seule dernière fin**.

Effets :

* `Repeat.iterations` redevient un tableau d'**un** élément ⇒ `iterations[0]`
  **est** le numéro de traversée global ;
* les masques absolus tombent donc sur la bonne traversée ;
* le `for (i < closingIndex) … = 0` destructeur ne s'exécute **jamais**
  (`closingIndex` reste 0) ;
* le dépilement a lieu à la traversée de sortie.

### 5.2 D'où vient la formule du `repeatCount`

Elle n'a pas été choisie, elle a été **relevée sur les traces GPIF** :

| groupe | fins de répétition | fins portées | traversées observées par GP / attendues | `maxEnding+1` | `nbFins+1` |
|---|---|---|---|---|---|
| Renaud `@1` | m4, m5 | `1` · `2` | **3** (attendu utilisateur) | **3** ✓ | 3 ✓ |
| Renaud `@15` | m18, m19, m20 | `1` · `2` · `3` (+ m21 = fin 4) | **4** | **4** ✓ | 4 ✓ |
| Igorrr `@27` | m30, m32, m34 | `1` · `2` · `3` (+ m35/m36 = fin 4) | 4 | **4** ✓ | 4 ✓ |
| Iron Maiden `@14` | m15, m16 | **`1,2`** · `3` (+ m17 = fin 4) | **4** (`m14` ×4 chez GP) | **4** ✓ | 3 ✗ |

Le cas Iron Maiden tranche : `m15` porte **deux** fins à la fois, donc
`nbFins + 1` sous-évalue. C'est bien **`max(fin la plus haute portée par une fin de répétition) + 1`**
qui fait foi ; les deux autres termes ne servent que de garde-fous
(`max` avec le `repeatCount` d'origine : on ne réduit jamais).

### 5.3 Résultats (14 échantillons, harnais Node)

```
fichier                                        multi | marche alphaTab -> normalisé | annulé
ACDC (1979 - Highway to Hell)                    -    |   74 ->   74                | OK
Blink 182 (1999)                                 -    |   92 ->   92                | OK
Europe (1986)                                    -    |  143 ->  143                | OK
F-Zero X (1998)                                  -    |   10 ->   10                | OK
Helloween (1988)                                 -    |  167 ->  167                | OK
Igorrr (2025) Blastbeat Falafel                OUI  |  169 ->  155  (-14)          | OK | perdues:- gagnées:-
Igorrr (2025) Headbutt                           -    |  171 ->  171                | OK
Iron Maiden (1992)                             OUI  |  146 ->  145   (-1)          | OK | perdues:- gagnées:m16
Led Zeppelin (1970)                              -    |   66 ->   66                | OK
Metallica (1984)                                 -    |  144 ->  144                | OK
Renaud (1983)                                  OUI  |  119 ->  100  (-19)          | OK | perdues:- gagnées:-
Sepultura (1993)                                 -    |   89 ->   89                | OK
Slayer (1985)                                    -    |  209 ->  209                | OK
The Offspring (1994)                             -    |  104 ->  104                | OK

round-trip annulation : OK sur les 14 fichiers
```

Points saillants :

* **11 fichiers sur 14 : séquence strictement identique**, donc zéro risque de
  régression — y compris **AC/DC, qui est un contrôle parfait** (aucun groupe à
  fins multiples ⇒ la boîte enveloppe est un no-op).
* **Renaud** : `1 2 3 4 · 1 2 3 5 · 1 2 3 6` = **exactement** l'attendu
  Guitar Pro. Puis `6 7 8 9 · 6 7 8 10`, puis
  `15 16 17 18 · 15 16 17 19 · 15 16 17 20 · 15 16 17 21` (les 4 fins),
  `22…36`, `(DS) 5…50`.
* **Aucune mesure perdue** sur les 3 fichiers concernés ; **une gagnée** :
  Iron Maiden `m16`, la fin 3 que alphaTab seul n'a **jamais** jouée.
* **Round-trip** : `repeatCount` et `group.closings` sont restitués à
  l'identité (même référence de tableau) après chaque passe ⇒ le rendu, la
  recherche et l'export voient le score d'origine.
* Points GPIF consommés : Iron Maiden **105/106 → 106/106** ; Igorrr 2/2
  inchangé ; AC/DC 61/74 **inchangé** (cf. §6) ; Renaud 99 → 87 (cf. §6,
  le chiffre est faussé par le problème de numérotation, pas par la marche).

### 5.4 Pourquoi pas plutôt une réécriture du contrôleur ?

Option (b) « patcher `MidiPlaybackController` » a été étudiée puis écartée :
la classe n'est pas exportée, et le remplacer intégralement oblige à
réimplémenter `PlayThroughContext`, `BackingTrackSyncPoint` et
`MidiUtils.ticksToMillis` (ni `alphaTab.utils` ni `MidiUtils` ne sont exposés) —
soit recopier une méthode interne d'alphaTab à chaque montée de version.
L'enveloppe + regroupement pèse ~40 lignes et ne dépend que d'une **signature
publique de fait** (`_playThroughSong`). Reste à **remonter en amont** (§7, S4).

---

## 6. AC/DC — ce n'est PAS un problème de renvoi

### 6.1 La séquence MIDI est correcte

Structure GPIF : `@2/5` (m5), `@6/9` (m9), `@13/14` (m14), `@30/31`, `@34/35`,
`Jump=DaCoda` m16, `Jump=DaSegnoAlCoda` m17, `Target=Coda` m18 — **aucun groupe
à fins multiples**. Marche : `74` mesures, **identique** avec et sans correctif.

La séquence annoncée `6 7 8 9 · 6 7 8 9 · 10` correspond bien à
`repeatCount = 2` sur la fin unique `m9`, la bracket `1 2 3` portant sur `m8`
(barre **non** fin de répétition) et la fin `4` (`m10`) **hors** groupe.

### 6.2 Le défaut est dans les données de synchro

Confrontation des couples `(mesure, barOccurence)` GPIF ↔ parcours :

```
AC/DC : 80 points GPIF bruts → 64 générés → 16 perdus   (avant = après, inchangé)

  occurrences SANS point GP (13) : 3.0 4.0 3.1 4.1 5.0 6.0 7.0 8.0 13.1 15.0 20.0 25.0 26.0
  points GP NON appariés     (16) : 5.5 5.6 5.7 6.3 6.4 6.5 6.6 6.7 7.3 7.5 8.3 8.4 8.5 12.4 12.5 13.5
```

Or m6 → m9 sont joués **une seule fois** : GP ne peut pas y avoir de
`6.3 … 6.7`. **`barOccurence` GPIF n'est donc pas « nombre de fois où cette
mesure a été jouée ».**

Confirmation du même défaut **hors AC/DC** : sur Renaud, GPIF déclare
`14.5 … 14.11` (la mesure m15 numérotée jusqu'à la **12ᵉ** occurrence) alors
que la marche — même fautif — ne la joue que 8 fois. Le défaut est donc
**général**, pas spécifique à AC/DC.

### 6.3 Deux hypothèses en vie (non tranchées)

* **H1 — numérotation absente/hétérogène.** GP écrit des numéros 1-based ici,
  0-based ailleurs, avec des trous ; le filtre alphaTab
  (`barOccurence !== occurence`, sans repli chronologique) **jette** le point
  dans le silence. => simple défaut d'appariement, réparable côté données.
* **H2 — parcours réellement plus long.** Le parcours alphaTab (74 mesures ≈ 161 s)
  serait plus court que l'enregistrement (repères de −1,014 à 207,110 s ;
  MP3 de 310 s). => alors **aucun** alignement ne peut sauver m6-m10.

Indices déjà relevés en faveur d'une **anomalie de données** (BUGMP3.md) :
14,619 s d'audio entre m3@11,871 et m6@26,490 alors que la partition n'a que
6,545 s ; `m7 occ3 @45,225` isolé entre `m9@41,041` et `m10@47,306`.

**Aucune modification de `build()` / `audioMsFor()` tant que H1/H2 ne sont pas
tranchées** (§7, S5).

---

## 7. Plan de correction

| # | Action | État |
|---|---|---|
| **S1** | Supprimer `fixAlternateEndings` (les **deux** branches) | ✅ fait |
| **S2** | Auditer `fixEmptyAnacrusis` sur les 14 fichiers → conservé (1 déclenchement, marche inchangée) | ✅ fait |
| **S3** | Re-baseline des 14 fichiers en mode « alphaTab seul » ; corriger la volta à fins multiples par **regroupement scopé** autour de `_playThroughSong` | ✅ fait (§5) |
| **S4** | **Remonter le bug à alphaTab** : `Repeat.iterations` est par-fin alors que `alternateEndings` est absolu ; + la ligne de reset `for (i < closingIndex)` ; + renvois ignorés après DalSegno. Repro : fichier Renaud, séquence attendue `1 2 3 4 · 1 2 3 5 · 1 2 3 6`, obtenue `… 1 2 3 1 2 3 4 …` | ⬜ à faire |
| **S5** | **Trancher H1/H2 sur `barOccurrence`** : sortir les `(bar, barOccurence, millisecondOffset)` bruts des 14 GPIF, les comparer aux parcours, décider « appariement » vs « parcours trop court ». **Aucune écriture dans `mix-sync.js` avant.** | ⬜ à faire |
| **S6** | Validation à l'écoute (Pixel 7a) : Renaud, Iron Maiden, Igorrr, Blink/Slayer/Offspring (les 3 derniers **régressent en nombre de traversées** puisque l'ancienne branche `maxEnd` est retirée — à écouter en priorité) | ⬜ à faire |

---

## 8. Points ouverts

* **O1 — Blink / Slayer / Offspring.** Le retrait de la branche `maxEnd` leur
  **enlève** des traversées (+7, +12, +3 mesures auparavant). Aucune trace
  Guitar Pro ne les contredit, et AC/DC — noté pareil, validé à l'écoute —
  prouve qu'alphaTab a raison sans cette branche. **À écouter en priorité** :
  si la fin 3 de Blink `m9` manque, c'est que la règle est `maxEnd` et non
  l'inverse ; alors il faudra distinguer les deux notations plutôt que de
  généraliser.
* **O2 — nombre de points de synchro Renaud : 99 → 87.** Le parcours est
  correct (séquence GP exacte) mais moins de couples `(mesure, occurrence)`
  tombent juste. Conséquence attendue de H1/H2 (§6), **à re-vérifier après S5** —
  l'alignement passe alors par l'interpolation de `MixSync.correct()`.
* **O3 — renvois ignorés après DalSegno** (§1.4.2). Non vérifié contre GP.
* **O4 — aucune validation navigateur** : aucun onglet connecté pendant toute
  cette analyse. Tout est **statique / Node** ; le comportement runtime
  (`installRepeatNormalization` installé avant la première génération MIDI)
  reste à confirmer à l'écran.

---

## 9. Pistes de mesure reprises

Harnais (hors dépôt, `%TEMP%\opencode`) :

* `audit-fix.js` — déclenchements des anciens correctifs + marche brute vs corrigée.
* `verify-renvoi.js` — **extrait la fonction livrée depuis `js/player.js`**,
  marche avant/après, round-trip d'annulation, séquence de référence Renaud.
* `gp-match.js` — couples GPIF ↔ parcours, avant/après.
* `sync-renvoi.js` — nombre de points renvoyés par `generateSyncPoints`.
* `diff-renvoi.js` — structure d'un fichier + détail des écarts par mesure.
* `walk.js` / `trace.js` — copie fidèle de `MidiPlaybackController`.
