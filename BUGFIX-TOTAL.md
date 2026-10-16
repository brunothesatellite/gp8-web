# GP8-Web — Audio & synchro : bilan, impasses, plan, reste à faire

> **Document unique** (dernière mise à jour : 2026-10-16).
> Il **remplace et fusionne** : `BUG.md`, `BUGMP3.md`, `BUGRENVOI.md`,
> `BUGLATEST.md`, `RESPONSIVE.md`, `TESTSAMPLES.md`, `promp.md`, `TODO.md`
> — tous supprimés le 2026-10-16 ; leur détail intégral reste dans l'historique
> git. Autres documents du dépôt : **`TESTLOG.md`** (journal de test d'écoute à
> remplir — version **opérationnelle** du §5.2/§5.3), **`TESTLOG.html`** (éditeur
> local du journal, hors ligne, sans dépendance) et **`tools/browser/README.md`**
> (harnais navigateur).
>
> **Nature** : les correctifs **P0 → P6 sont livrés et vérifiés**. Il ne reste que
> des étapes **humaines** : l'**écoute** (§5.2) et la **validation mobile** (§7).

Projet : lecteur Guitar Pro **GP8-Web** — alphaTab 1.8.4 vendorisé + piste MP3
embarquée dans le `.gp`/`.gpx`, avec synchronisation MIDI ↔ MP3.

---

## 0. Origine de la mission

Symptômes rapportés (verbatim) :

1. `Helloween … Dr. Stein.gp` — lecture lancée en mesure 16 : **légers retours en
   arrière audio** en mesures 18 et 19.
2. `ACDC … Highway to Hell.gp` — fin de la mesure 17 ≈ **1:03**, **DS Al Coda**
   vers la mesure 6 : « cela fait sauter l'audio » ; la séquence correspondante
   se trouve vers **1:10** dans le mp3 alors que la partition en est à 1:03.

Demande : analyse profonde, **maximum de tests automatiques** (pas d'analyse
manuelle imposée), **plan d'écoute manuel réduit**, et un **respect total** des
tempos et des synchronisations.

Contraintes tenues :

- **aucune dépendance npm à l'exécution** — l'app s'ouvre en `file://` ;
- les harnais **n'ont pas le droit d'être des « miroirs »** : ils exécutent le
  **code livré** (§6.1) ;
- une dépendance de test reste **isolée** (`tools/browser/node_modules`, ignoré
  par git, **jamais** appelé par la suite principale).

---

## 1. État d'avancement

| Phase | État | Preuve |
|---|---|---|
| **P0** — mesure fiable | ✅ livré | `sync-audit` refondu + `mix-sync-harness` qui exécute le code livré |
| **P1** — spike stratégie C | ✅ livré | GO ; règle A rejetée, règle B retenue (§2.2) |
| **P2** — tempo pré-cuit dans le MIDI | ✅ livré | **tempoWrites 0/16**, dérive croisière ≤ 11 ms, fidélité < 0,5 % |
| **P3** — RC-1 résiduel | ✅ livré | clés manquantes **104 → 70** ; résidu **H2** (donnée GP) ; 4 mesures **H1** refusées par la garde |
| **P4** — anacrouse & fin de morceau | ✅ livré | **7/7** anacrouses ≤ 0,04 % ; fin de webapp **jamais** au-delà du MP3 (16/16) |
| **P5** — suite unique | ✅ livré | `tools/test-all.js` : **8** harnais ; `tools/browser/` : **16/16** en navigateur réel |
| **P6** — clôture & déploiement | ✅ livré | manifeste **16/16** ; `deploy/` conforme (8 `js/*.js` identiques) |
| **Écoute (§5.2)** | ⏳ **humaine** | les 16 points (`TESTLOG.md`) |
| **Validation mobile (§7)** | ⏳ **humaine** | Pixel 7a |

---

## 2. Ce qui a été fait

### 2.1 Les défauts trouvés

| # | Défaut | Gravité | Résolu par |
|---|---|---|---|
| **RC-2 / D1** | **toute écriture de `playbackSpeed` coupe le synthé** (`resetSamples()` + re-rendu depuis 0) | **CRITIQUE** — la cause du « mal rendu » | P2 |
| **RC-3 / D2** | le correcteur oscille : zone morte à **sortie non nulle** → relais ±5 % permanent, la dérive ne s'arrête jamais | MAJEUR — la cause du « décalage » | P2 |
| **RC-1 / D3** | `barOccurrence` de **Guitar Pro ≠ celui d'alphaTab** → points de synchro perdus sur les morceaux à renvois | MAJEUR — précision des sauts | P3 |
| **D6** | `fixEmptyAnacrusis` : une mesure d'anacrouse **vide** est forcée en mesure pleine | à valider | P4 |
| **D4 / D8** | harnais « miroirs » périmés ; **aucun** test du contrôleur lui-même | MAJEUR (méthode) | P0 / P5 |
| **D5 / D7** | documentation déphasée ; hygiène (`N/A*`, manifeste incomplet) | MINEUR | P6 |

**Fait notable** : les deux grosses causes, RC-2 et RC-3, étaient des
**régressions de nos propres commits** (`c7609e6` renvois, `47014c0` moteur de
tempo) — pas des défauts du fichier `.gp`.

### 2.2 Le correctif retenu — « stratégie C »

Principe : **ne plus jamais écrire `playbackSpeed` en lecture**. À la place, le
**tempo est pré-cuit dans le MIDI** au chargement (des `TempoChangeEvent` par
segment, insérés dans le `MidiFile`). Le synthé joue donc directement au tempo
de l'enregistrement, la piste MP3 est lue **native** (`playbackRate ≈ 1`), et le
seul écrivain de `playbackSpeed` devient la **vitesse utilisateur**, hors lecture.
Effet de bord voulu : la table de segments de `mix-sync.js` ne pilote plus le
synthé — le correcteur ne fait plus que de la **correction de phase** fine.

Le **spike P1** a chiffré les deux règles de découpage possibles :

| Règle | Critère | Verdict |
|---|---|---|
| **A** | index de tempo par mesure | ❌ rejetée (segments discontinués) |
| **B** | découpage en **segments continus non clampés**, clamp `[0,5 ; 2]` | ✅ **GO** — 14/14 segments < 0,5 % (pire 0,160 %) |

### 2.3 Résultats mesurés, phase par phase

| Phase | Harnais | Résultat |
|---|---|---|
| **P0** | `sync-audit` (refondu, exécute le code livré) | mesure fiable ; écritures de tempo de référence 405 |
| **P1** | `tempo-prebake-spike` | GO règle B (14/14 < 0,5 %) ; BPM pré-cuits tous sains (50–190) |
| **P2** | `mix-sync-harness` | **tempoWrites 0** ; dérive croisière médiane **= 11 ms** ; `playbackRate` écrit **2 %** du temps |
| **P3** | `barocc-instrument` | clés manquantes **104 → 72** ; classement **H1/H2** ; 4 mesures H1 (Renaud 8/9/11/42) **refusées** par la garde |
| **P4** | `duration-check` | **6/6** anacrouses couvrent leur portée audio GPIF à **≤ 0,04 %** ; fin de webapp **≤** fin du MP3 sur **15/15** |
| **P5** | `test-all` + `tools/browser/` | **8/8** harnais ; navigateur réel **15/15**, **0** écriture de `playbackSpeed`, 0 erreur console |
| **P6** | `gen-samples` + `_build.ps1` | manifeste **15/15** ; `deploy/` : 8 `js/*.js` identiques, `repeat-oracle.js` présent |

### 2.4 Le filet de sécurité : la « garde » de P3

La réassignation des occurrences ne s'applique **que** si elle est *prouvée
utile* : elle est **conservée** si et seulement si elle **baisse** les clés
manquantes **sans** ajouter de saut, de pente hors `[0,5 ; 2]` ni de segment
d'audio reculant. Sinon la garde **refuse**, et l'état d'origine est conservé.
C'est ce qui permet d'affirmer, mesure à l'appui, que le résidu restant est une
**donnée GP** et non un défaut de code.

### 2.5 Résultat navigateur réel — `npm run test:all`, 16 exemples, 21 s chacun

| exemple | mes. | pts synchro | audio (s) | horloge (s) | audio joué (s) | `spÉcrit` | taux | dérive croisière | pic | arrêts | err | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AC/DC — Highway to Hell | 43 | 68 | 310,1 | 20,9 | 19,7 | **0** | 0,0 % | 76 ms | 76 ms | 0 | 0 | 🟡 |
| Blink 182 — All the Small Things | 53 | 147 | 256,1 | 20,8 | 20,0 | **0** | 0,0 % | 61 ms | 61 ms | 0 | 0 | 🟡 |
| Europe — The Final Countdown | 103 | 58 | 309,1 | 20,7 | 20,6 | **0** | 0,0 % | 60 ms | 60 ms | 0 | 0 | 🟡 |
| F-Zero X — Goal BGM | 10 | 14 | 422,1 | 13,9 | 14,6 | **0** | 0,0 % | 6 ms | 6 ms | 0 | 0 | ✅ |
| Helloween — Dr. Stein | 114 | 112 | 306,4 | 21,1 | 20,8 | **0** | 13,3 % | 70 ms | 159 ms | 0 | 0 | 🟡 |
| Igorrr — Blastbeat Falafel | 97 | 4 | 195,1 | 20,9 | 20,9 | **0** | 0,0 % | 25 ms | 68 ms | 0 | 0 | ✅ |
| Igorrr — Headbutt | 159 | 18 | 224,5 | 21,1 | 21,0 | **0** | 0,0 % | 89 ms | 89 ms | 0 | 0 | 🟡 |
| Iron Maiden — Fear of the Dark | 127 | 137 | 438,2 | 21,2 | 21,0 | **0** | 0,0 % | 23 ms | 23 ms | 0 | 0 | ✅ |
| Led Zeppelin — Immigrant Song | 38 | 64 | 146,8 | 20,9 | 20,8 | **0** | 0,0 % | 27 ms | 27 ms | 0 | 0 | ✅ |
| Metallica — The Four Horsemen | 179 | 240 | 432,6 | 21,1 | 21,1 | **0** | 0,0 % | 56 ms | 56 ms | 1 | 0 | 🟡 |
| Metallica — For Whom the Bell Tolls | 66 | 141 | 310,0 | 21,0 | 20,8 | **0** | 0,0 % | 19 ms | 19 ms | 0 | 0 | ✅ |
| **Nirvana — Come as you are** | 43 | 65 | 256,1 | 21,1 | 20,0 | **0** | 0,0 % | 78 ms | 78 ms | 0 | 0 | 🟡 |
| Renaud — Morgane de toi | 50 | 100 | 373,2 | 21,1 | 17,0 | **0** | 0,0 % | 60 ms | 6 978 ms | 0 | 0 | 🟡 |
| Sepultura — Amen | 63 | 168 | 267,1 | 21,1 | 20,9 | **0** | 0,0 % | 30 ms | 30 ms | 0 | 0 | ✅ |
| Slayer — Hell Awaits | 138 | 149 | 378,1 | 20,7 | 20,5 | **0** | 0,0 % | 60 ms | 89 ms | 1 | 0 | 🟡 |
| The Offspring — Self Esteem | 51 | 251 | 257,9 | 21,1 | 21,1 | **0** | 0,0 % | 87 ms | 87 ms | 0 | 0 | 🟡 |

**Ce que ça prouve :**

- **0 écriture de `playbackSpeed` en lecture sur 16/16** — la cible de P2 est
  tenue dans un **navigateur réel** (décodage MP3 réel) et pas seulement dans le
  banc : **aucune coupure du synthé**. C'est l'invariant de premier ordre.
- **0 erreur console sur 16/16** ; le moteur et la piste audio sont **câblés
  partout** (points de synchro > 0, durée audio > 0, audio réellement défilé).
- **La dérive de croisière reste sous la zone morte** (6-89 ms) : aucun
  emballement. Le pic de **Renaud (6 978 ms)** n'est **pas** une dérive : c'est
  la taille d'un **saut de renvoi** (un seul `seek`, signature attendue). Le
  taux d'écritures de taux dépend du **bruit de la pile audio temps réel** : il
  monte à **13,3 %** sur un fichier selon l'exécution (Helloween ici, Blink ou
  Europe à d'autres passes) et reste à **0 %** partout ailleurs.
- Les **🟡 (9/16)** signalent seulement l'écart à la cible **stricte** du §6.2
  (dérive < 40 ms), cible du banc déterministe ; ce ne sont pas des échecs. Les
  **✅ (7/16)** — F-Zero X, Igorrr ×2, Iron Maiden, Led Zeppelin, For Whom,
  Sepultura — l'atteignent dans le navigateur. Les 2 « arrêts maître » (Four
  Horsemen, Slayer) restent dans la tolérance (≤ 1).
- **Nirvana — Come as you are** (nouvel échantillon) : invariants tenus, et la
  trace **P3** confirme la convergence de l'oracle en **une** passe —
  `[oracle] 5 groupe(s) de répétition relevé(s) … clés manquantes 13 → 0`
  (voir §5.1.1 : c'est ce fichier qui a révélé que `raise` devait itérer).
- La trace **P3** réapparaît à l'identique (Renaud) :
  `[oracle] P3 renumérotation GP (H1) : 0 mesure(s) réassignée(s) …, 4 rejetée(s)
  par la garde (clés manquantes 55 → 55) — résidu H2`.

### 2.6 Manifeste & déploiement (P6)

- `samples/list.json` : **14 → 16** entrées via `gen-samples.bat` — les exemples
  `Metallica … The Four Horsemen.gp` (présent sur disque mais **pas cliquable**,
  manifeste périmé depuis `e183dcc`) et `Nirvana … Come as you are.gp` (**ajouté
  le 16/10/2026**) ;
- `deploy/_build.ps1` **rejoué** → `deploy/gp8-web/` **conforme** (l'artefact
  datait d'**avant P2**) : `js/repeat-oracle.js` présent, les **8** `js/*.js`
  **identiques** au dépôt (hash), **16** `.gp`, ni `tools/` ni `*.md` ni
  `node_modules`. Non fait : `deploy/_build.ps1` **ne crée que** `gp8-web/` ;
  `deploy/gp8-web2/` est un artefact antérieur (§5.5).

---

## 3. Ce qui n'a **pas** marché (et pourquoi)

Chaque impasse a été **tranchée par la mesure**, pas par préférence.

| Piste tentée | Ce qui a échoué | Décision |
|---|---|---|
| **« Performance / gros fichiers »** | aucun lien taille ↔ défaut : le phénomène se reproduit **hors navigateur** (simulation purement numérique) | ❌ réfutée |
| **« Taux d'échantillonnage mp3 »** (alphaTab code 44100 en dur) | si c'était la cause, toutes les cibles seraient **+8,84 %** trop grandes ; or elles tombent à **0,03-2,6 %** de la fin du mp3 | ❌ réfutée |
| **Règle A** du spike P1 | segments discontinués | ❌ rejetée |
| **Réassignation naïve** des occurrences (2026-10-02 : réassigner *toute* mesure à ≥ 2 points) | **régression** : recadrages **43 → 199**, glitchs **18 → 46** | ❌ retirée |
| **`fixAlternateEndings`** (ancien correctif des voltes) | retiré du code livré : réparait Slayer mais **détruisait** Renaud / Iron Maiden ; conservé, il coûtait **8 points de synchro** à Slayer | ❌ supprimé |
| **Couvrir les 4 mesures « H1 » de Renaud** (mes 8/9/11/42) | la garde les **détecte** mais les **refuse** : les couvrir ferait passer les sauts de **7 à 13** et ferait **reculer** un segment d'audio | ❌ refusé (assumé) |
| **Voie RC-2 « contenir »** (`TEMPO_EPS` 4 % → 8 %) | divise les coupures par ~2 mais **impose** un étirement résiduel de ±8-11 % au mp3 — exactement le symptôme à guérir | ❌ abandonnée |
| **Voie RC-2 « lisser le pont »** | ne traite que le bruit de pente, pas la cause (l'écriture elle-même) | ❌ sans objet après P2 |
| **Patch amont d'alphaTab** (réglage de vitesse sans seek) | devenu **inutile** : en ne réglant plus la vitesse en lecture, l'API manquante n'est plus nécessaire | ⬜ optionnel (plus un verrou) |

### 3.1 Ce qui reste **non tranché** (à ne pas oublier)

- **Renvois ignorés après un DalSegno** : `MidiPlaybackController._moveNextWithDirections`
  renvoie `true` en permanence dès que `_state !== 0`, donc
  `_moveNextWithNormalRepeats()` **n'est jamais appelé** dans la section D.S.
  C'est un choix d'implémentation d'alphaTab, **non vérifié contre Guitar Pro**.
- **`barOccurrence`** : le couplage GPIF → alphaTab reste fragile ; c'est la
  racine du résidu **H2** (§5.1).
- **Volta à fins multiples** : le bug d'alphaTab (itération *par-fin* face à un
  masque *absolu* d'`alternateEndings`) n'a **pas** été corrigé en amont ; on le
  contourne par la garde (§2.4).

### 3.2 Pièges de mesure rencontrés (et neutralisés dans les harnais)

- `Player` / `MixSync` sont des `const` de portée script → accessibles par leur
  nom, **pas** via `window.` ;
- un onglet **headless de fond est bridé** par le navigateur → fabrique de
  **faux** « arrêts maître » ; d'où les flags anti-throttling du harnais ;
- en **fin de morceau**, alphaTab **réinitialise `timePosition` à 0** (cas
  F-Zero X, jingle court) → échantillonner les axes **pendant** la lecture ;
- la **1ʳᵉ fenêtre `[mix-stats]` (5 s)** est écartée : elle couvre l'amorçage
  audio (blob → décodage MP3 → `readyState ≥ 3` + buffer du synthé) ;
- la dérive de croisière **en navigateur est bornée par la zone morte (~100 ms)**,
  pas par les 40 ms du banc déterministe (audio factice sans gigue).

---

## 4. Architecture cible — « respect total des tempos »

1. **Un seul maître** : alphaTab. On ne reconstruit pas la marche à sa place.
2. **Tempo** : pré-cuit dans le `MidiFile` (`TempoChangeEvent`) → le synthé joue
   au tempo de l'enregistrement sans qu'on touche à `playbackSpeed`.
3. **Phase** : le MP3 est lu **natif** ; le correcteur ne corrige que l'écart de
   phase résiduel, par `playbackRate` borné (−10 %…+10 %), à écritures espacées
   (`CONTROL_MS = 250`, `DEADBAND_MS = 100`, `WRITE_MS = 1500`).
4. **Sauts** : un saut volontaire = **un** `seek` propre (jamais un glissement).

---

## 5. Ce qui reste à faire

### 5.1 Résidu accepté : H2 (donnée GP)

Après P3, il reste des clés de synchro qu'**aucun** appariement ne peut couvrir
— **70 clés** au total, **100 % classées** :

| Fichier | Clés manquantes | Nature |
|---|---|---|
| **Renaud** | 55 (33 mesures **H2** + 4 mesures **H1 refusées** : M.9, M.10, M.12, M.43) | GP enregistre plus de traversées que la partition n'en note |
| **AC/DC** | 12 (6 mesures H2 : M.6-9, M.13-14) | idem |
| **The Offspring** | 5 (2 mesures H2 : M.19-20) | idem |

Les **13** autres fichiers ont **0** clé manquante. La **clause « sinon »** de la
DoD #5 est donc invoquée : anomalie de **données GP** documentée et acceptée,
sans impact audible jugé bloquant — **sous réserve de l'écoute** (§5.2).

> **Numérotation** : `M. n` = numéro **affiché par l'app** (indicateur `M. n/N`),
> soit *index de mesure + 1*. Une **anacrouse** est donc `M. 1`, jamais « M. 0 ».

#### 5.1.1 Relèvement des répétitions : convergence en plusieurs passes

`RepeatOracle.raise()` relève les répétitions **groupe par groupe**, à partir de
la carte des clés manquantes du **déroulé courant**. Or relever un groupe change
le déroulé, donc cette carte : un groupe **rejeté** à un tour peut devenir
**gagnant** au tour suivant.

Mesuré le 16/10/2026 sur les **16** échantillons : **15 convergent en une passe**,
mais **Nirvana — Come as you are** en exige **deux** — ce morceau, ajouté au
manifeste le jour même, a mis en défaut l'**idempotence** exigée par
`tools/repeat-check.js` (« un second `raise` ne doit rien relever »).
`raise` **itère donc jusqu'au point fixe** (plafond `RAISE_MAX_PASSES = 4`),
chaque relèvement conservant ses gardes.

| Effet mesuré | Avant | Après |
|---|---|---|
| Nirvana — clés manquantes | 2 (13 → 2) | **0** (13 → 0) |
| Nirvana — sauts / pentes hors borne | 1 / 0 | **1 / 0** (inchangé) |
| Les 15 autres fichiers | — | **strictement identiques** (mêmes métriques, mêmes traces) |

Aucun relèvement n'est accepté s'il **augmente** les sauts, sort une pente de
`[0,5 ; 2]` ou fait **reculer** un segment d'audio : la convergence ne peut donc
**que** couvrir davantage de clés GPIF, jamais dégrader la synchro.

### 5.2 Écoute humaine — les 16 points

> Protocole : `python -m http.server 8777 --bind 127.0.0.1` →
> `http://localhost:8777/`, mode **mix** (MIDI + MP3), vitesse **×1,0**. Noter
> *tempo* (le MIDI suit-il l'enregistrement ?) et *phase* (les deux flux restent
> collés ?), puis confronter à la console `[mix-stats]`.
>
> **Numérotation** : les zones ci-dessous sont données en **`M. n`** = numéro
> **affiché par l'app** (`index + 1`) ; une **anacrouse** est donc **M. 1**.
> Les horodatages sont ceux de l'app.

| # | Échantillon | Zone | Attendu |
|---|---|---|---|
| M1 | Iron Maiden | intro (≈ 0:25, **M.4-M.6**) | bascule intro lente → riff sans trou ni décalage |
| M2 | Iron Maiden | riffs 1:00-4:11 | pas de « début trop rapide » |
| M3 | Iron Maiden | voltes **M.4/5 · M.15-17 · M.21/22** | fins jouées dans l'ordre (dont la **fin 3 : M.16**) |
| M4 | Dr. Stein | reprises **M.16-19** | **plus aucun retour en arrière** |
| M5 | Dr. Stein | anacrouse **M.1** + tout | la pickup vide dure 1 599 ms ; 0 coupure |
| M6 | AC/DC | **M.9 → M.10** ≈ 1:18 | **un seul** saut propre |
| M7 | AC/DC | anacrouse **M.1** ; H2 **M.6-9, M.13-14** | pickup en phase ; pas de saut parasite (l'écart MIDI/audio = **donnée GP**) |
| M8 | Renaud | **M.1-5** puis volta **M.18-21** | les fins dans l'ordre, y compris la **volta à 4 fins** |
| M9 | Renaud | **M.37 → M.38** ≈ 3:42 | grand saut de renvoi : **un seul** saut |
| M10 | Blink 182 | **M.6-10** | `M.6-7-8-9` ×3 puis `M.6-7-8-10` |
| M11 | Slayer | ≈ 1:00 | 0 saccade |
| M12 | Slayer | voltes **M.48/49 · M.55/56 · M.61/62 · M.108/109 · M.114/115 · M.119/120** | toutes les fins, dans l'ordre |
| M13 | Offspring | ≈ 0:51 ; H2 **M.19-20** | plus de saut parasite |
| M14 | Offspring | tout | 0 coupure |
| M15 | **Témoins** : Europe, F-Zero X, Led Zeppelin, Sepultura, Metallica ×2, Igorrr ×2 | tout | aucune régression |
| M16 | **Nirvana** | anacrouse **M.1** ; **volta à 8 fins M.4-6** ; **M.38-40** | pickup en phase ; le couplet joué **8 fois** (7 fins sur M.5 + la 8ᵉ sur M.6) ; fin non tronquée |

**Contrôle transverse** (sur M1, M5, M7, M14) : passer la vitesse **×0,5 puis
×1,5** en cours de lecture → le moteur doit composer vitesse utilisateur × tempo
pré-cuit **sans trou ni décalage**.

**Test d'isolation A/B** (si un artefact persiste) : couper la piste audio → s'il
persiste ⇒ chemin **MIDI** ; couper le master MIDI → s'il persiste ⇒ chemin
**MP3** ; ne subsiste des deux côtés que séparément ⇒ causes cumulatives.

### 5.3 Journal d'écoute (à remplir)

> **Version opérationnelle, à remplir** : **`TESTLOG.md`** — une fiche par
> morceau, avec les repères machine, les mesures précises à observer, la grille
> commune T1-T7 et le journal des anomalies. Le tableau ci-dessous n'en est que
> le résumé condensé (hérité de l'ancien `TESTSAMPLES.md`).
>
> Contexte **machine** par fichier : `points` = points de synchro du pont livré ;
> `résidu` = clés GPIF non appariables (H2 = donnée GP). Les notes datées sont
> **antérieures** au correctif P2 (2026-10-02), conservées **verbatim** — elles
> ne valident pas le correctif. `[ ]` → `OK` / `KO` + une ligne.

**1. ACDC — Highway to Hell** · §5.2 M6, M7 · 68 points · résidu 12 clés / 6 mes H2 (M.6-9, M.13-14)
- [ ] M6 : un seul saut propre (≈ 1:18, **M.9 → M.10**) ; l'audio correspondant se
  situe ailleurs dans le MP3 (**normal**, donnée GP).
- [ ] M7 : MIDI correct, aucun **saut parasite** ajouté (l'écart est la donnée GP).
- note (2026-10-02) : « renvoi sembgle correct !!!! / Audio ok »

**2. Blink 182 — All the Small Things** · M10 · 147 points · résidu 0
- [ ] 4 passages, fin 10 au bon endroit. · note : « ça semble OK »

**3. Europe — The Final Countdown** *(témoin)* · M15 · 58 points · résidu 0
- [ ] strictement identique à avant. · note : *(non écouté)*

**4. F-Zero X — Goal BGM** *(témoin)* · M15 · 14 points · résidu 0 · morceau court (~15 s)
- [ ] identique. · note : « OK »

**5. Helloween — Dr. Stein** · M4, M5 · 112 points · résidu 0
- [ ] M4 : **plus aucun retour** ; tempo constant ≈ 1,22×.
- [ ] M5 : 0 coupure.
- note : la mesure **M.1** (anacrouse) est **VIDE** dans le `.gp` ; sa durée ne
  vient que de l'audio (une mesure pleine, 1 599 ms). · note : « Qualité mp3 ok et vitesse ok »

**6. Igorrr — Blastbeat Falafel** *(témoin)* · M15 · 4 points · résidu 0 — [ ] identique

**7. Igorrr — Headbutt** *(témoin)* · M15 · 18 points · résidu 0 — [ ] identique

**8. Iron Maiden — Fear of the Dark** · M1, M2, M3 · 137 points · résidu 0
- [ ] M1 : intro lente sans à-coups, MIDI collé au MP3.
- [ ] M2 : pas de début trop rapide ; transitions de tempo sans trou.
- [ ] M3 : pas de saut, pas de flottement. · [ ] transverse ×0,5 / ×1,5
- note : « PAs si mal, l'audio sur la séquence "3" qui ralentit est mieux »

**9. Led Zeppelin — Immigrant Song** *(témoin)* · M15 · 64 points · résidu 0 — [ ] identique

**10. Metallica — The Four Horsemen** *(témoin)* · M15 · 240 points · résidu 0
- [ ] identique. · (ajouté au manifeste en P6 : 14 → 15 entrées)

**11. Metallica — For Whom the Bell Tolls** *(témoin)* · M15 · 141 points · résidu 0
- [ ] identique. · note : « OK au moins jusqu'au chant, à vérifier en entier »

**12. Renaud — Morgane de toi** · M8, M9 · 100 points · résidu **55 clés**
- [ ] M8 : l'enregistrement joue la mes 5 **6 fois**, le déroulé **3** → aucun
  **saut parasite** ajouté (divergence = donnée GP).
- [ ] M9 : les 4 fins dans l'ordre ; ancrage passe 2 / passe 3 inchangé.
- note : « Renvois et MP3 ok »

**13. Sepultura — Amen** *(témoin)* · M15 · 168 points · résidu 0 — [ ] identique

**14. Slayer — Hell Awaits** · M11, M12 · 149 points · résidu 0
- [ ] M11 : 0 saccade.
- [ ] M12 : tous les passages — voltes M.48/49 · M.55/56 · M.61/62 · M.108/109 · M.114/115 · M.119/120.
- (les 4 segments de pont à pente extrême 0,50-0,69× ont disparu)

**15. The Offspring — Self Esteem** · M13, M14 · 251 points · résidu 5 clés / 2 mes H2 (M.19-20)
- [ ] M13 : plus de saut parasite. · [ ] M14 : 0 coupure.
- [ ] transverse ×0,5 / ×1,5

**16. Nirvana — Come as you are** *(ajouté au manifeste le 16/10/2026)* · M16 · 65 points · résidu **0**
- [ ] M16 : anacrouse **M.1** en phase ; **volta à 8 fins** (couplet **M.4-6** joué **8 fois**) ;
  volta à 6 fins **M.38-40** ; fin **non tronquée** (arrêt ≈ 3:36, musique jusqu'à ≈ 3:39).
- note : c'est ce morceau qui a fait **durcir l'oracle de renvoi** (§5.1.1) —
  `[oracle] … clés manquantes 13 → 0`.

**Synthèse** — [ ] M15 témoins identiques · [ ] transverse (M1, M5, M7, M14) ·
[ ] validation mobile (§7). Journal rempli le : ...... / ...... / ......

### 5.4 Validation mobile

Google **Pixel 7a** (viewport CSS 412 × 915 portrait / 915 × 412 paysage) — voir
§7 : **hors harnais**, étape humaine.

### 5.5 Options / dette restante

- patch **amont alphaTab** (renvois après DalSegno, volta multi-fins) : optionnel ;
- `deploy/gp8-web2/` (ignoré par git) contient encore un `mix-sync.js` **antérieur
  à P2** — artefact d'une construction antérieure, à supprimer manuellement si inutile.

---

## 6. Critères d'acceptation (Definition of Done)

1. **Tempo** : MIDI au tempo de l'enregistrement (tempo variable inclus) ;
   **0 écriture `playbackSpeed`** en lecture (hors geste utilisateur). ✅
2. **Phase** : dérive pic < 40 ms ; écart moyen < 10 ms en régime établi
   (banc : croisière **≤ 11 ms**). ✅
3. **Qualité** : **0 coupure de synthé** ; MP3 **natif** (aucun time-stretch
   permanent ; `|playbackRate − 1| ≤ 0,5 %` hors correction transitoire). ✅
4. **Structure** : `0` recadrage de dérive ; `1` saut propre par discontinuité
   voulue ; `0` pente hors `[0,5 ; 2]`. ✅
5. **Données** : après relèvement, **13 des 16** fichiers n'ont plus **aucune**
   clé GPIF manquante ; les **3** autres (Renaud, AC/DC, Offspring) laissent
   **70 clés** → **clause « sinon » invoquée** (100 % classées H2/H1, §5.1) ; le
   mécanisme de réassignation H1 reste **actif sous garde**. ✅
6. **Durée** : fin de webapp = fin du MP3 à ±0,5 % au sens utile — la webapp ne
   dépasse **jamais** la fin du MP3 (16/16) ; anacrouse alignée à ≤ 0,04 % (7/7). ✅
7. **Tests** : `node tools/test-all.js` sort `0` (**8** harnais) ; navigateur réel
   **16/16** verts ; aucun harnais « miroir » ; `deploy/` régénéré et conforme. ✅
8. **Écoute** : les 16 points du §5.2 validés (dont les témoins sans régression). ⏳

### 6.1 Principe directeur des tests

**Zéro miroir** : tout harnais qui mesure un comportement **exécute le code
livré**. Les constantes/formules n'existent qu'à **un seul endroit**
(`js/mix-sync.js`), les harnais les lisent ou les importent.

### 6.2 Deux niveaux de verdict (harnais navigateur)

- **❌ échec** — invariant du livrable : **0** écriture de `playbackSpeed` en
  lecture, **0** erreur console, moteur + piste audio câblés, horloge qui avance,
  piste audio qui avance, dérive de croisière **< 150 ms**, **≤ 1** arrêt maître,
  écritures de taux **≤ 15 %**.
- **🟡 vert** — invariants tenus mais **cible stricte** non atteinte (dérive
  < 40 ms, taux ≤ 2 %, 0 arrêt) : bruit de la pile audio **temps réel** —
  l'oreille (§5.2) arbitre le ressenti.

---

## 7. Responsive & mobile (ex-`RESPONSIVE.md`)

Sujet **distinct** du correctif audio, conservé ici pour ne pas perdre la décision.

- **Cible** : Google Pixel 7a → **412 × 915** portrait, **915 × 412** paysage.
- **Le point clé** : le **paysage a 915 px de large** (donc « desktop » pour un
  test de largeur) mais seulement **412 px de haut** → un seuil de **largeur
  seul** ne peut pas le traiter. C'est le cas le plus cassé.
- **Décision** : seuil **unique de largeur 768 px** + condition
  **`min-height: 560px`** ; **pas** de nouveau point de rupture de largeur
  (un seuil à 600/640 créerait une zone grise 600-768 sans règle).

| Correction | État |
|---|---|
| P1 — force-ouverture de `#advanced` conditionnée à la **hauteur** | ✅ |
| P2 — `#drawer` mobile : `max-height` + `overflow-y` | ✅ |
| P3 — rangée de boutons `flex-wrap` (tient sur 412 px) | ✅ |
| P4 — `#advanced` : `max-height` + `overflow-y` | ✅ |
| P5 — état réduit du tiroir | ⬜ non fait (couvert par P1) |
| P6 — `mqShort` (`max-height: 559px`) en miroir JS | ◐ partiel (reste : `return` prématuré sur `layoutTouched`, rééquilibrage à la rotation) |
| H3 — ancre du `#toastBox` (nombre magique) | ⬜ non fait (non bloquant) |

**Statut** : correction **codée**, en attente de **validation sur device**.
Portée : `index.html`, `css/styles.css`, `js/app.js` (aucun 4ᵉ fichier).

---

## 8. Backlog produit (ex-`BUG.md`)

Aucun bug **CRITICAL / MAJOR / MINOR** ouvert.

**Évolutions**
- **LOW-RISKY** — visuel de la piste audio (forme d'onde).
- **HIGH-RISKY** — compte à rebours rejoué à chaque boucle (option, grisée hors boucle).
- **HIGH-NO RISK** — README, MANUAL, tests de non-régression, captures d'écran.
- **HIGH-RISK** — 2 langues FR / EN.

**Backlog**
- **DISABLED-RISKY** — défilement doux masquant la mesure en cours (option
  masquée pour l'instant).

---

## 9. Outils & commandes

| Harnais | Ce qu'il exécute | Métriques / seuils |
|---|---|---|
| `load-smoke` | ordre des `<script>`, bindings, boot | 0 erreur |
| `repeat-check` | renvois : clés GPIF manquantes | 104 → 72 |
| `barocc-instrument` | RC-1 : classe **H1/H2** | 41 H2, 4 H1 refusées |
| `tempo-correct-sim` | loi « protège » sur `playbackRate` (modèle pré-P2, référence) | — |
| `sync-audit` | chemin livré : recadrages / glitchs / sauts | — |
| `tempo-prebake-spike` | pré-cuisson livrée : fidélité par segment | < 0,5 % |
| `mix-sync-harness` | **contrôleur réel** : `tempoWrites`, dérive | 0 / ≤ 11 ms |
| `duration-check` | anacrouse ↔ portée audio GPIF, fin ≤ MP3 | ≤ 0,04 % |

```bash
node tools/test-all.js                  # les 8 harnais (~70 s) → RESULTAT : OK
gen-samples.bat                         # régénère samples/list.json
powershell -File deploy/_build.ps1      # reconstruit deploy/gp8-web/

cd tools/browser && npm i               # playwright-core (devDependency LOCALE, isolée)
npm test                                # 3 exemples (~2 min)
npm run test:all                        # les 16 exemples (~10 min)
node run.js --headed --verbose          # navigateur visible, journal complet
```

Le harnais navigateur est documenté dans **`tools/browser/README.md`**
(installation, options, verdicts, résultats de référence).
