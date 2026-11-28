# Reste à analyser — points tempo consignés le 2026-11-28

> **Mise à jour 2026-11-28 (v1.4.0)** : la **traversée générique exacte**
> (reprises, fins alternatives, D.C./D.S./Coda) remplace l'heuristique
> d'appariement quand elle couvre toutes les ancres GPIF. Résultat : Mony Mony
> passe de 14 mesures / 31 occurrences anormales à **0**, et l'audit global de
> 53 / 87 à **28 mesures / 37 occurrences**. Les chiffres Mony du corps
> ci-dessous sont donc **historiques**.
>
> **Statut** : ces points sont **consignés pour analyse ultérieure**, pas corrigés.
> Ils ne sont pas des régressions de la v1.3.2 : ils étaient déjà présents, ou
> relèvent d'un désaccord structurel entre la notation et l'audio embarqué.
>
> **Version** : v1.4.0 — traversée structurelle générique, plan GPIF exact,
> budget global des durées anormales.
>
> **Outils** :
> - `node tools/tempo-outliers.js` : liste les occurrences d'une même mesure
>   dont la durée pré-cuite dévie de plus de 40 % de la médiane
>   (**28 mesures / 37 occurrences / 18 fichiers** avec la traversée exacte).
> - `node tools/tempo-strict-check.js` : test P1.5 ; budget global
>   (35 mesures / 50 occurrences, plafond 12 / 16 par fichier), sans liste
>   d'exceptions par morceau.
> - `node tools/tempo-repeat-check.js` : test P1.4 (mesures répétées à durée
>   égale, Mr. Moustache M.1-M.3).
> - `node tools/sync-coherence.js --strict` : invariants globaux (0 clé,
>   0 notation perdue, 0 axe, 0 tail).
> - `cd tools/browser && npm run test:p3` : curseur de **toutes** les
>   occurrences de M.2 de Mony Mony (intégré à `npm test`).
>
> Les durées ci-dessous sont les durées **pré-cuites** (celles que joue le
> synthé), mesurées après `RepeatOracle.raise` + `MixSync.prebake`, et les
> temps audio sont ceux de la piste embarquée.

---

## 1. The Four Horsemen — thème M.23-M.29, 2ᵉ et 3ᵉ passages

Fichier : `samples/Metallica (1983 - Kill 'Em All) - The Four Horsemen.gp`

| Mesure | plan# | Audio | Durée | Référence | Ratio |
|---|---:|---:|---:|---:|---:|
| M.23 (passage 1) | 22 | 25,52 s | 1 163 ms | 1 163 ms | 1,00 |
| M.23 (passage 2) | 29 | 33,78 s | 1 185 ms | 1 163 ms | 1,02 |
| **M.23 (passage 3)** | **64** | **74,44 s** | **2 320 ms** | 1 163 ms | **2,00** |
| M.25 | 65 | 76,76 s | 2 333 ms | 1 190 ms | 1,96 |
| M.27 | 66 | 79,09 s | 2 333 ms | 1 201 ms | 1,94 |
| M.29 | 67 | 81,42 s | 2 361 ms | 1 218 ms | 1,94 |
| **M.23 (passage 4)** | **222** | **314,24 s** | **2 367 ms** | 1 163 ms | **2,04** |
| M.27 | 225 | 318,99 s | 2 367 ms | 1 201 ms | 1,97 |
| M.29 | 226 | 321,36 s | 2 367 ms | 1 218 ms | 1,94 |

**Mesure navigateur** : M.23 passage 3 = **1 643 tk/s** (0,43 mesure/s) contre
**3 235-3 243 tk/s** (0,84) pour les passages 1 et 2.

**Hypothèse** : les ancres GPIF de ce passage sont espacées
(`M.23.2` 74,44 s → `M.25.2` 76,76 s → `M.27.2` 79,09 s → `M.29.2` 81,42 s,
puis `M.24.3` 83,78 s…). Le plan contient bien les ancres, mais pas les mesures
intermédiaires **M.24, M.26, M.28** entre elles : le pré-cuit étire chaque
ancre sur deux mesures. Le DP de `refinePairs` ne traite que les ancres déjà
**appariées** par le LCS ; ici plusieurs ancres sont **non appariées** et
insérées telles quelles.

**Piste** : étendre l'appariement temporel aux ancres non appariées, ou
remplir l'écart entre deux ancres avec l'ordre des mesures du groupe de reprise
(M.23-M.29, `M.23` = début de reprise, `M.29` = fin de reprise), borné par
l'écart audio. Valider avec `tempo-outliers` + sonde navigateur + `run.js --all`.

**Ne pas confondre** : le ralentissement rapporté initialement « M.16-17 » n'est
pas reproduit ; M.16-17 joue le tempo natif. Les passages lents sont bien les
reprises du thème M.23-M.29 à ≈ 1:14 et ≈ 5:14.

---

## 2. Mr. Moustache — M.10, M.29, M.42

Fichier : `samples/Nirvana (1989 - Bleach) - Mr. Moustache.gp`

### 2.1 M.10 (et le cluster M.4-M.12)

| Occurrence | plan# | Audio | Durée | Référence | Ratio |
|---|---:|---:|---:|---:|---:|
| M.10 #0 | 28 | 38,63 s | 1 389 ms | 1 338 ms | 1,04 |
| M.10 #1 | 30 | 41,35 s | 1 338 ms | 1 338 ms | 1,00 |
| M.10 #2 | 32 | 44,04 s | 1 338 ms | 1 338 ms | 1,00 |
| M.10 #3 | 34 | 46,72 s | 1 320 ms | 1 338 ms | 0,99 |
| M.10 #4 | 75 | 108,89 s | 1 321 ms | 1 338 ms | 0,99 |
| **M.10 #5** | **77** | **111,56 s** | **2 653 ms** | 1 338 ms | **1,98** |
| M.10 #6 | 78 | 114,22 s | 1 336 ms | 1 338 ms | 1,00 |

Le même phénomène touche **M.4, M.5, M.7, M.11, M.12** entre ≈ 88 s et ≈ 124 s
(voir `tempo-outliers`) : les occurrences y sont étirées ×2 ou ×0,65. Cela
ressemble à un **cluster d'ancres GPIF espacées** dans cette section, pas à un
problème isolé de M.10.

**Piste** : inspecter les groupes GPIF de 88-124 s, vérifier si l'audio contient
réellement deux fois plus de mesures que la notation, puis appliquer le même
remplissage borné que pour Four Horsemen. À confirmer à l'écoute : il peut
s'agir d'un vrai changement de tempo de l'audio.

### 2.2 M.29

| Occurrence | plan# | Audio | Durée | Ratio |
|---|---:|---:|---:|---:|
| M.29 #0 | 59 | 80,68 s | 2 769 ms | 2,05 |
| M.29 #1 | 103 | 150,53 s | 1 349 ms | 1,00 |

Les deux occurrences diffèrent d'un facteur **2**. Laquelle est le tempo réel ?
M.29 est une fin de reprise / zone de coda : il peut y avoir un vrai
ralentissement à 80,68 s, ou un étirement de plan. **À vérifier à l'écoute et
dans les points GPIF** avant toute correction.

### 2.3 M.42 (fin / outro)

| Occurrence | plan# | Audio | Durée | Ratio vs médiane |
|---|---:|---:|---:|---:|
| M.42 #0 | 124 | 178,27 s | 2 965 ms | 1,00 |
| M.42 #1 | 126 | 184,90 s | 4 405 ms | 1,49 |
| M.42 #2 | 128 | 193,69 s | 1 306 ms | 0,44 |

Très variable : **probablement de vrais changements de tempo** (outro,
ritardando/fermata) plutôt qu'un bug d'appariement. Vérifier les
`tempoAutomations`/`fermata` de M.42 et écouter la section ; ne pas « corriger »
sans preuve.

---

## 3. Billy Idol — Mony Mony

Fichier : `samples/Billy Idol (1981 - Don't Stop) - Mony Mony.gp`

### 3.1 Alignement GPIF / notation

| Indicateur | Valeur |
|---|---:|
| Mesures du score | 39 |
| Ancres GPIF (groupes) | **70** |
| Passes de notation P | **74** |
| Plan final | **105** |
| **Appariements LCS réels** | **39 / 70** |
| Ancres GPIF non appariées | **31** |
| Passes de notation non ancrées | **35** |
| `report.matched` affiché | 70 (en réalité `G.length`, pas le LCS) |

**Hypothèse principale** : les reprises **internes** (M.6 ×2, M.9 ×4, M.10 ×3,
M.12 ×2) sont consommées lors de la **première** traversée de la section
M.1-M.14. Lors de la deuxième traversée (P[35]…), alphaTab ne les rejoue
qu'une fois : la séquence P ne contient plus les passes internes, alors que
l'audio et les ancres GPIF les contiennent encore. Le plan insère les ancres
GPIF supplémentaires en audio-only, mais pas les mesures intermédiaires entre
deux ancres espacées ; le pré-cuit étire alors ces mesures.

### 3.2 Occurrences anormales (durées pré-cuites)

| Mesure | plan# | Audio | Durée | Ratio |
|---|---:|---:|---:|---:|
| **M.5** | 86 | **229,55 s** | **5 313 ms** | **×2,99** |
| **M.6** | 45 | **96,39 s** | **3 551 ms** | **×2,00** |
| **M.7** | 87 | **234,86 s** | **5 313 ms** | **×1,50** |
| **M.9** | 49 | **107,04 s** | **5 327 ms** | **×1,49** |
| **M.10** | 50 | **112,37 s** | **3 551 ms** | **×2,00** |
| **M.10** | 90 | **249,07 s** | **3 544 ms** | **×2,00** |
| **M.12** | 92 | **254,41 s** | **3 560 ms** | **×1,99** |
| **M.18** | 64 | **160,32 s** | **1 776 ms** | **×0,50** |

Les mesures **vides** M.1 et M.2 ont aussi des durées variables (M.2 : 1 773 à
3 546 ms), mais elles sont inaudibles ; le curseur suit désormais le tempo
pré-cuit réel (P3 vérifie les 23 occurrences de M.2).

### 3.3 Fin de morceau

- Dernier point GPIF / fin de la webapp : **288,138 s**
- MP3 : **302,736 s**
- **14,6 s de MP3 ne sont pas jouées** : la webapp s'arrête après M.39, sur le
  dernier point GPIF, alors que le MP3 continue. La sonde de fin confirme
  l'arrêt à ≈ 288 s. À vérifier si cette fin est un outro musical ou du silence.

**Renaud (vérifié le 28/11/2026)** : la webapp s'arrête à **≈ 373,3 s**
(MP3 373,176 s) ; le `preEnd` pré-cuit de **374,193 s** n'est pas joué. Il n'y a
donc **pas de dépassement audible** ; l'écart `preEnd > MP3` est un tail MIDI
non joué, pas une coupure. `duration-check` reste valide sur l'axe audio.

### 3.4 Piste de correction

Rejouer les reprises internes à chaque traversée de la section externe
(réinitialiser les compteurs de reprise imbriqués), ou remplir les écarts entre
ancres GPIF avec l'ordre des mesures du groupe de reprise, borné par l'écart
audio. À valider avec `tempo-outliers`, `tempo-strict-check` et P3.

---

## 4. Autres mesures signalées par l'outil

`node tools/tempo-outliers.js` liste **28 mesures / 37 occurrences** sur 18
fichiers avec la traversée exacte (53 / 87 avec l'ancienne heuristique). Toutes
ne sont pas des bugs : certaines sont des changements de tempo réels. Les cas
ci-dessus sont ceux demandés ; le reste peut être trié plus tard avec le même
outil, en commençant par les ratios ≈ 2,00 ou ≈ 0,50 qui suivent souvent un
cluster d'ancres espacées. Le contrôle `tempo-strict-check` applique désormais
un **budget global**, sans liste d'exceptions par morceau.

---

## 5. Commandes de reproduction

```bash
node tools/tempo-outliers.js
node tools/tempo-strict-check.js
node tools/tempo-repeat-check.js
node tools/sync-coherence.js --strict
node tools/test-all.js
cd tools/browser && npm run test:p3
```

Pour mesurer le tempo réel d'une occurrence dans le navigateur : charger le
morceau, se positionner sur `tickCache.masterBars[i].start` de l'occurrence,
lire `Player.S.api.tickPosition` sur ≥ 2 s et diviser par le temps mur. La
sonde temporaire utilisée le 28/11/2026 est dans
`%TEMP%\opencode\gp8-analysis\mony-all-occ.js` et `end-probe.js`.

---

## 6. Références

- Correctif passes de notation : commit `1fff455`.
- Affinage temporel des ancres : commit `4da6cef`.
- Sample Mony Mony + curseur : commit `3d4baec`.
- Audit : `tools/sync-coherence.js`, `tools/tempo-repeat-check.js`,
  `tools/tempo-strict-check.js`, `tools/tempo-outliers.js`.
- Journal d'écoute : `TESTLOG.md` §5.10 (Four Horsemen), §5.17 (Mr. Moustache),
  §5.18 (Mony Mony).
