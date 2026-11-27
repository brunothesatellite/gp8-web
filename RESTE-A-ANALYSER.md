# Reste à analyser — points tempo consignés le 2026-11-27

> **Statut** : ces points sont **consignés pour analyse ultérieure**, pas corrigés.
> Ils ne sont pas des régressions de la v1.3.1 : ils étaient déjà présents, ou
> relèvent d'un désaccord structurel entre la notation et l'audio embarqué.
>
> **Version** : v1.3.1 (`4da6cef`) — correctifs « passes de notation perdues »
> et « affinage temporel des ancres GPIF ».
>
> **Outils** :
> - `node tools/tempo-outliers.js` : liste les occurrences d'une même mesure
>   dont la durée pré-cuite dévie de plus de 40 % de la médiane.
> - `node tools/tempo-repeat-check.js` : test P1.4 (mesures répétées à durée
>   égale, Mr. Moustache M.1-M.3).
> - `node tools/sync-coherence.js --strict` : invariants globaux (0 clé,
>   0 notation perdue, 0 axe, 0 tail).
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

## 3. Autres mesures signalées par l'outil

`node tools/tempo-outliers.js` liste **40 mesures / 55 occurrences** sur 17
fichiers. Toutes ne sont pas des bugs : certaines sont des changements de tempo
réels. Les cas ci-dessus sont ceux demandés ; le reste peut être trié plus tard
avec le même outil, en commençant par les ratios ≈ 2,00 ou ≈ 0,50 qui suivent
souvent un cluster d'ancres espacées.

---

## 4. Commandes de reproduction

```bash
node tools/tempo-outliers.js
node tools/tempo-repeat-check.js
node tools/sync-coherence.js --strict
node tools/test-all.js
```

Pour mesurer le tempo réel d'une occurrence dans le navigateur : charger le
morceau, se positionner sur `tickCache.masterBars[i].start` de l'occurrence,
lire `Player.S.api.tickPosition` sur ≥ 2 s et diviser par le temps mur. La
sonde temporaire utilisée le 27/11/2026 est dans
`%TEMP%\opencode\gp8-analysis\moustache-probe.js` et `occ-probe.js`.

---

## 5. Références

- Correctif passes de notation : commit `1fff455`.
- Affinage temporel des ancres : commit `4da6cef`.
- Audit : `tools/sync-coherence.js`, `tools/tempo-repeat-check.js`,
  `tools/tempo-outliers.js`.
- Journal d'écoute : `TESTLOG.md` §5.10 (Four Horsemen), §5.17 (Mr. Moustache).
