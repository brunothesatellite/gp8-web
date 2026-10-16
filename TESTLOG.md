# TESTLOG.md — Journal de test d'écoute (validation humaine)

> **Objet** : valider **à l'oreille** les correctifs audio/synchro du plan
> `BUGFIX-TOTAL.md` (phases **P2, P3, P4, P6**). Ce journal est **vierge** : il
> est pré-rempli avec les morceaux, les **mesures/repères précis** à observer et
> les critères attendus ; les colonnes *Relevé / Verdict* sont à remplir.
>
> **Référence du plan** : `BUGFIX-TOTAL.md` §5.2 (points d'écoute) et §5.3
> (journal). Ce fichier est la version **opérationnelle** à remplir.
>
> **Numérotation des mesures** : toutes les mesures sont notées **M. n**, où *n*
> est le numéro **affiché par l'app** (indicateur `M. n/N` en haut de la
> partition) ; il vaut *index de mesure + 1*. Une éventuelle **anacrouse**
> (mesure d'intro incomplète, présente sur ACDC, Blink, F-Zero, For Whom,
> **Nirvana**, Offspring et **Dr. Stein**) est donc **M. 1** — jamais « M. 0 ».
> Les horodatages (*≈ mm:ss*) sont ceux de l'app.

---

## 0. Ce qui est déjà prouvé automatiquement (ne pas re-tester sans doute)

| Invariant | Preuve |
|---|---|
| `playbackSpeed` **jamais écrit en lecture** (⇒ 0 coupure de synthé) | banc `mix-sync-harness` **16/16** (`tempoWrites = 0`) + navigateur réel |
| 0 erreur console | navigateur réel, chaque morceau |
| dérive de croisière bornée par la zone morte | **0-11 ms** (banc), **10-79 ms** (navigateur) |
| anacrouses alignées sur l'audio | **7/7 ≤ 0,04 %** |
| fin de webapp **jamais** au-delà du MP3 | **16/16** |
| oracle de renvoi : converge en **une** passe sur les 16 | `tools/repeat-check` (propriété D) |
| `node tools/test-all.js` | **8/8**, exit 0 |

**Question posée à l'oreille** : le **ressenti** (timbre, « colle » MIDI↔MP3,
nature des sauts, transitions de tempo). Les chiffres disent *« pas de
régression mesurée »* ; l'oreille dit *« c'est bon à jouer »*.

**Piège à éviter** : sur **ACDC, Renaud et The Offspring**, il existe des écarts
**donnée GP** documentés (clés de synchro « H2 »). Ce sont des **désaccords du
fichier `.gp` lui-même**, pas des défauts de la webapp. Ne les signaler que s'ils
produisent un **saut parasite** (voir les zones listées par fiche).

---

## 1. Mode d'emploi

1. Une **fiche par morceau** (§5). Remplir le tableau *spécifique*, la ligne
   *grille commune*, la ligne *console*, le *verdict* et les *notes*.
2. Écouter chaque morceau **en entier une fois** (contrôle global), puis faire
   les **réécoutes ciblées** indiquées (contrôle local).
3. Noter pour toute anomalie : **l'horodatage** (mm:ss) et la **mesure**.
4. Cocher ensuite la **synthèse** (§7) et remplir le **journal des anomalies** (§8).

## 2. Vocabulaire & barème

| Verdict | Définition |
|---|---|
| **✅ conforme** | aucun écart perceptible |
| **🟡 conforme avec réserve** | écart audible mais **non bloquant** (≤ seuil machine ou gênant à peine) |
| **❌ défaut** | écart **audible bloquant** : coupure, saut parasite, décalage franc, transition ratée, erreur console |
| **?** | doute — à re-tester (noter l'horodatage) |

**Seuils machine pour interpréter la console** (contexte) :
- `playbackSpeed` écrit **0×** en lecture ;
- dérive de croisière < **40 ms** (toléré 🟡 jusqu'à ~100 ms, zone morte) ;
- **0** erreur console ;
- `[oracle] … résidu H2` **normal et attendu** sur ACDC / Renaud / Offspring.

## 3. Environnement de test (à préparer une fois)

- [ ] Serveur local : `python -m http.server 8777 --bind 127.0.0.1` → ouvrir
      `http://localhost:8777/` (ou `deploy/start.bat`).
- [ ] Navigateur **Chrome/Edge**, **casque** (la phase fine s'entend au casque).
- [ ] Mode **mix** (MIDI **+** MP3), volume MIDI ≈ volume audio.
- [ ] Vitesse **×1,0**.
- [ ] **Console ouverte** (F12) — recopier les lignes `[mix]`, `[mix-stats]`,
      `[oracle]` dans chaque fiche.
- [ ] Version testée : commit `__________` · Navigateur/OS : `__________`
      · Date : `__________`

## 4. Grille commune (définie une fois, appliquée à chaque morceau)

| Id | Critère | Ce qu'on écoute |
|---|---|---|
| **T1** | Tempo | le MIDI suit-il le **tempo de l'enregistrement** sur toute la durée ? |
| **T2** | Phase | MIDI et MP3 restent-ils **collés** (pas de flam, pas de traîne) ? |
| **T3** | Continuité | aucune **coupure** de synthé / note hachée / trou ? |
| **T4** | Renvois & reprises | passages dans le **bon ordre** et le **bon nombre** ? |
| **T5** | Sauts | un **seul** saut net par discontinuité voulue, **0 saut parasite** ? |
| **T6** | Fin de morceau | fin webapp = fin du MP3 (ni troncature, ni dépassement) ? |
| **T7** | Console | **0 erreur** ; dérive `[mix-stats]` ; `[oracle]` ; `[mix]` cohérents ? |

### Contrôles transverses

- **X1 — Vitesse utilisateur** (sur **Iron Maiden, Dr. Stein, AC/DC,
  Offspring**) : pendant la lecture, passer **×0,5 puis ×1,5** → le moteur doit
  composer vitesse × tempo pré-cuit **sans trou ni décalage**.
  → X1 : ☐ conforme ☐ réserve ☐ défaut · notes : ______________________
- **X2 — Isolation A/B** (si un artefact persiste) : couper la **piste audio**
  → s'il persiste ⇒ **MIDI** ; couper le **master MIDI** → s'il persiste ⇒
  **MP3** ; ne subsiste que séparément ⇒ **causes cumulatives**.
  → X2 : non requis ☐ · résultat : ______________________

---

## 5. Fiches par morceau

> Rappel par fiche : **Angle** = ce que ce morceau met à l'épreuve ·
> **Machine** = mesures / points de synchro / résidu · *Repère* = où regarder.

### 5.1 · ACDC — Highway to Hell
`ACDC (1979 - Highway to Hell) - Highway to Hell.gp`
**Angle** : **anacrouse** + reprises imbriquées + divergence de données GP (H2).
**Machine** : 43 mesures · 68 points · résidu **12 clés / 6 mesures H2 (M.6-9, M.13-14)** · anacrouse **M.1** (≈ 2,26 s)

| # | Repère | Où (mesure) | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | ≈ 00:00 | **M.1** (anacrouse) | la mesure d'intro (réelle dans le `.gp`) dure une mesure pleine ≈ **2,26 s** : le MIDI démarre **en phase** | | |
| 2 | continu | M.6-9, M.13-14 | **aucun saut parasite** ajouté (l'écart auditeur = **donnée GP** : Guitar Pro décrit plus de traversées que la partition n'en joue) | | |
| 3 | ≈ 01:18 | M.9 (fin de volta) → M.10 | le saut de fin de volta est **net et unique** (pas de double déclenchement) | | |
| 4 | ≈ 01:49 | M.14 (fin de reprise) → M.15 | saut de reprise **net et unique** | | |
| 5 | ≈ 03:14 | M.41 → M.42 | dernier saut (fin du dernier groupe ×3) : **net** | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.2 · Blink 182 — All the Small Things
`Blink 182 (1999 - Enema Of The State) - All the Small Things v2.gp`
**Angle** : **volta à fins multiples** (4 fins : M.9 = fins 1→3, M.10 = fin 4) — le cas où alphaTab était fautif.
**Machine** : 53 mesures · 147 points · résidu **0** · points **M10**

| # | Repère | Où (mesure) | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | continu | M.6-10 | séquence **`M.6-7-8-9` ×3 puis `M.6-7-8-10`** | | |
| 2 | 3ᵉ passage | **M.9 → M.10** | la **fin 4 (M.10)** arrive **après** le 3ᵉ passage, pas avant | | |
| 3 | continu | M.6-10 | **aucune fin escamotée**, aucun passage en trop (⚠ le nombre de traversées a **changé** avec le correctif → **à écouter en priorité**) | | |
| 4 | continu | M.6-10 | le MIDI ne **se dédouble pas** au passage fin 3 → fin 4 | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.3 · Europe — The Final Countdown  *(témoin)*
`Europe (1986 - The Final Countdown) - The Final Countdown v3.gp`
**Angle** : **témoin sans renvoi** — aucune régression attendue.
**Machine** : 103 mesures · 58 points · résidu **0** · points **M15**

| # | Repère | Où | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | continu | tout | rendu **identique** à la référence, tempo régulier | | |
| 2 | continu | tout | 0 coupure, 0 décalage | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.4 · F-Zero X — Goal BGM  *(témoin + fin de morceau)*
`F-Zero X (1998) - Goal BGM.gp`
**Angle** : **morceau très court** — la **fin** tombe pendant l'écoute.
**Machine** : 10 mesures · 14 points · résidu **0** · durée ≈ **15 s** · points **M15**

| # | Repère | Où | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | ≈ 00:15 | fin | l'app **s'arrête proprement** (pas de boucle, pas de retour audible à 0) | | |
| 2 | ≈ 00:15 | fin | le MIDI et le MP3 se terminent **ensemble** (ni clic, ni silence résiduel) | | |
| 3 | continu | tout | identique à la référence | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.5 · Helloween — Dr. Stein
`Helloween (1988 - Keeper of the Seven Keys - Part II) - Dr. Stein.gp`
**Angle** : **anacrouse vide** (pickup escamotée — affichée **M. 1**) + écart de tempo **permanent** (symptôme d'origine n°1).
**Machine** : 114 mesures · 112 points · résidu **0** · anacrouse **M.1** (mesure **VIDE** dans le `.gp`)

| # | Repère | Où (mesure) | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | ≈ 00:00 | **M.1** (anacrouse) | la mesure est **VIDE** dans le `.gp` (seul l'audio dit sa durée) : elle doit durer **une mesure pleine ≈ 1 599 ms** et **ne pas être escamotée** → le MIDI démarre **en phase** | | |
| 2 | aux reprises | M.16-19 | à la jonction des groupes (M.10-17, puis M.18-32) : **plus aucun retour en arrière** audio (le symptôme d'origine) | | |
| 3 | continu | tout | tempo constant ≈ **1,22×**, **0 coupure** | | |
| 4 | — | — | **X1** (×0,5 / ×1,5) appliqué | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.6 · Igorrr — Blastbeat Falafel  *(témoin)*
`Igorrr (2025 - Amen) - Blastbeat Falafel.gp`
**Angle** : témoin (peu de points de synchro).
**Machine** : 97 mesures · 4 points · résidu **0** · points **M15**

| # | Repère | Où | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | continu | tout | identique à la référence, 0 coupure | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.7 · Igorrr — Headbutt  *(témoin)*
`Igorrr (2025 - Amen) - Headbutt.gp`
**Angle** : témoin.
**Machine** : 159 mesures · 18 points · résidu **0** · points **M15**

| # | Repère | Où | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | continu | tout | identique à la référence, 0 coupure | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.8 · Iron Maiden — Fear of the Dark
`Iron Maiden (1992 - Fear of the Dark) - Fear of the Dark.gp`
**Angle** : **tempos très variables** (intro lente ↔ riff rapide) et leur **transition**.
**Machine** : 127 mesures · 137 points · résidu **0** · points **M1, M2, M3**

| # | Repère | Où (mesure) | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | ≈ 00:25 | **M.4-M.6** | bascule intro lente → riff : **ni trou ni décalage**. C'est là que se concentrent les **3 sauts volontaires** et les **2 pentes hors tolérance** mesurées du fichier | | |
| 2 | 01:00-04:11 | riffs | le MIDI reste **collé** au MP3 : **pas de « début trop rapide »** (symptôme d'origine) | | |
| 3 | — | voltes **M.4/5** · **M.15-17** · **M.21/22** | les fins de répétition sont jouées **dans l'ordre** — dont la **fin 3 (M.16)**, qu'alphaTab seul ne jouait **jamais**, et les **4 passages de M.14** | | |
| 4 | fin | M.127 | fin de morceau **propre** | | |
| 5 | — | — | **X1** (×0,5 / ×1,5) appliqué | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.9 · Led Zeppelin — Immigrant Song  *(témoin)*
`Led Zeppelin (1970 - Led Zeppelin III) - Immigrant Song.gp`
**Angle** : témoin.
**Machine** : 38 mesures · 64 points · résidu **0** · points **M15**

| # | Repère | Où | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | ≈ 00:00 | début | le riff démarre **au bon tempo** dès la 1ʳᵉ note | | |
| 2 | continu | tout | identique à la référence | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.10 · Metallica — The Four Horsemen  *(témoin P6 + renvois denses)*
`Metallica (1983 - Kill 'Em All) - The Four Horsemen.gp`
**Angle** : **3 grandes discontinuités** de renvoi + thème repris **8×** + **volta à 2 fins** ; c'est aussi le **témoin du manifeste** (absent de la liste avant P6).
**Machine** : 179 mesures · 240 points · résidu **0** · anacrouse : aucune
**Structure jouée (mesurée)** : M.23-29 **×8** · M.30-39 ×3 · M.44-49 ×2 (volta M.50/M.51) · M.56-62 ×2 · M.65 **×6** · M.67-70 ×4 · M.74-77 **×8** · M.105-108 ×4 · M.128-134 ×2 · M.136-139 ×4

| # | Repère | Où (mesure) | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | — | liste des exemples | le morceau **apparaît** dans la liste et **se charge** (correctif P6) | | |
| 2 | ≈ 00:41 | **M.29 → M.23** (2ᵉ passage du thème) | reprise du thème : **un seul** saut, net, le MIDI se recolle aussitôt | | |
| 3 | ≈ 01:30 | **M.29 → M.23** (4ᵉ passage) | **grande discontinuité** : un seul saut, **sans double lecture** | | |
| 4 | ≈ 05:30 | **M.29 → M.30** (6ᵉ passage) | **recul** de l'audio — le seul du morceau : saut **propre**, pas de hoquet | | |
| 5 | ≈ 01:06 | **M.50 / M.51** | **volta à 2 fins** (groupe M.44-49 ×2) : la **fin 2 (M.51)** arrive au **2ᵉ** passage, **jamais avant** | | |
| 6 | ≈ 02:05 · ≈ 02:38 | **M.65 (×6)** · **M.74-77 (×8)** | riffs courts **très répétés** : le **nombre de passages** doit être exact (6, puis 8) — point le plus sensible du morceau | | |
| 7 | ≈ 06:04 | **M.136-139 ×4** | dernière reprise longue (44 mesures du `.gp`) : **4 passages**, dans l'ordre | | |
| 8 | fin | fin | l'app s'arrête ≈ **3 s** avant la fin de l'audio (partition **429,1 s** / MP3 **432,6 s**) : la fin **ne doit pas couper** | | |
| 9 | continu | tout | identique à la référence, 0 coupure | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.11 · Metallica — For Whom the Bell Tolls  *(témoin)*
`Metallica (1984 - Ride the Lightning) - For Whom the Bell Tolls v4.gp`
**Angle** : témoin — **à écouter en entier**, y compris **après le chant** (l'écoute précédente s'arrêtait au chant).
**Machine** : 66 mesures · 141 points · résidu **0** · points **M15**

| # | Repère | Où | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | continu | tout **dont après le chant** | tempo et phase tenus de bout en bout | | |
| 2 | continu | tout | identique à la référence | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.12 · Renaud — Morgane de toi  ⚠ *fiche critique*
`Renaud (1983 - Morgane de toi) - Morgane de toi (amoureux de toi).gp`
**Angle** : renvois **complexes** (reprises imbriquées, voltes à fins multiples) + **4 mesures H1 refusées** + forte divergence (55 clés).
**Machine** : 50 mesures jouées · 100 points · résidu **55 clés (33 H2 + 4 H1 refusées : M.9, M.10, M.12, M.43)** · points **M8, M9**

| # | Repère | Où (mesure) | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | ≈ 00:00 | M.1-5 | première reprise : **fin 1 (M.4)** puis **fin 2 (M.5)** — les fins tombent **dans l'ordre** | | |
| 2 | — | **M.18-21** | **volta à 4 fins** (groupe M.15-17) : les 4 fins **dans l'ordre**, aucun passage sauté | | |
| 3 | ≈ 03:42 | **M.37 → M.38** | **grand saut de renvoi** (l'audio avance d'≈ **94 s**) : un seul saut, **sans double lecture** | | |
| 4 | — | **M.9, M.10, M.12, M.43** | mesures **H1 refusées** par la garde : **aucun saut parasite** (l'écart MIDI/audio = **donnée GP**) | | |
| 5 | — | — | un **pic de dérive** au moment d'un saut de renvoi est **attendu** ; seule la **médiane** compte | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.13 · Sepultura — Amen  *(témoin, couverture 100 %)*
`Sepultura (1993 - Chaos A.D.) - Amen.gp`
**Angle** : seul fichier à couvrir **100 %** des sync-points → la fin de la partition = fin du MP3.
**Machine** : 63 mesures · 168 points · résidu **0** · points **M15**

| # | Repère | Où | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | fin | fin | **arrêt final** propre (fin partition = fin MP3) | | |
| 2 | continu | tout | identique à la référence | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.14 · Slayer — Hell Awaits  ⚠ *fiche critique*
`Slayer (1985 - Hell Awaits) - Hell Awaits.gp`
**Angle** : **saccades / micro-sauts d'origine** (RC-1 + RC-2) — le fichier le plus « relevé » par l'oracle (4 groupes).
**Machine** : 138 mesures · 149 points · résidu **0** · points **M11, M12**

| # | Repère | Où (mesure) | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | ≈ 01:00 | zone des saccades | **plus aucun micro-saut** ni note coupée | | |
| 2 | continu | tout | le MIDI reste **collé** au MP3 (l'oracle a relevé **4 groupes** : clés manquantes **8 → 0**) | | |
| 3 | — | voltes **M.48/49 · M.55/56 · M.61/62 · M.108/109 · M.114/115 · M.119/120** | chaque fin de répétition au **bon passage** | | |
| 4 | — | groupes joués **4×** (M.32-33, M.57, M.67-68, M.73-74, M.110, M.116-118) | **4 passages** chacun, dans l'ordre | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.15 · The Offspring — Self Esteem
`The Offspring (1994 - Smash) - Self Esteem.gp`
**Angle** : **saut historique de 6,9 s** (≈ 0:51) + divergence de données GP (H2).
**Machine** : 51 mesures · 251 points · résidu **5 clés / 2 mesures H2 (M.19, M.20)** · points **M13, M14**

| # | Repère | Où (mesure) | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | ≈ 00:51 | — | **plus de saut parasite** (les 6,9 s historiques) | | |
| 2 | — | **M.19-20** | écart auditeur = **donnée GP** : **aucun saut ajouté** | | |
| 3 | continu | tout | **0 coupure** | | |
| 4 | — | — | **X1** (×0,5 / ×1,5) appliqué | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.16 · Nirvana — Come as you are  ⚠ *fiche critique (ajoutée après le plan)*
`Nirvana (1991 - Nevermind) - Come as you are.gp`
**Angle** : **anacrouse** + **volta à 8 fins** (M.5 = fins 1→7, M.6 = fin 8) — la structure de renvoi la plus chargée des 16 morceaux ; c'est elle qui a montré que l'oracle doit **itérer** (voir `BUGFIX-TOTAL.md` §5.1.1).
**Machine** : 43 mesures · 65 points · résidu **0** · anacrouse **M.1** (≈ 2,07 s)
**Structure jouée (mesurée)** : M.2-3 ×4 · **M.4 ×8, M.5 ×7, M.6 ×1** · M.7-9 ×2 · M.10-11 ×1 · M.12 ×4, M.13 ×3, M.14 ×1 · M.15-17 ×2 · M.18-19 ×1 · M.20 ×4, M.21 ×3, M.22 ×1 · M.23 ×2 · M.24-25 ×1 · M.26-29 ×4 · M.30-37 ×1 · **M.38-39 ×5, M.40 ×1** · M.41-42 ×4 · M.43 ×1

| # | Repère | Où (mesure) | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | ≈ 00:00 | **M.1** (anacrouse) | la mesure d'intro est **réelle** dans le `.gp` : elle dure **une mesure pleine ≈ 2,07 s** → le MIDI démarre **en phase** (pas d'intro escamotée) | | |
| 2 | ≈ 00:01 | M.2-3 ×4 | riff d'entrée joué **4 fois** : MIDI et audio restent **collés** | | |
| 3 | ≈ 00:17 | **M.4-6** | **volta à 8 fins** : le couplet est joué **8 fois** (7 fins sur M.5, la 8ᵉ sur M.6). C'est le point **le plus sensible** du fichier : un mauvais comptage décale tout le morceau | | |
| 4 | 00:49-01:35 | M.10/11 · M.13/14 · M.18/19 · M.21/22 · M.24/25 | les **5 voltes à 2 fins** : chaque fin tombe au **bon passage**, aucune escamotée | | |
| 5 | ≈ 02:01 | M.26-29 ×4 | reprise du refrain : **4 passages**, dans l'ordre | | |
| 6 | ≈ 02:50 | **M.38-40** | **volta à 6 fins** (M.39 = fins 1→5, M.40 = fin 6) : 5 passages puis la **sortie** | | |
| 7 | ≈ 03:27 | M.43 (dernière reprise) | le saut de fin de renvoi est **net**, puis **arrêt propre** | | |
| 8 | fin | fin | l'app s'arrête ≈ **03:36** alors que la musique va jusqu'à ≈ **03:39** (le MP3 fait 4:16 mais ses **36,6 dernières secondes sont du silence**) : la fin **ne doit pas couper** | | |

**Note de correctif (16/10/2026)** : ce morceau a révélé que l'oracle de renvoi
n'atteignait pas son optimum en **une** passe (2 clés GPIF non couvertes sur M.4).
`js/repeat-oracle.js` itère désormais **jusqu'au point fixe** : Nirvana passe de
**13 → 0** clés manquantes, **sans aucun changement** sur les 15 autres morceaux.

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

## 6. Fiche vierge (pour un nouveau morceau)

```
### 5.x · <Artiste> — <Titre>
`<nom du fichier .gp>`
**Angle** : ...
**Machine** : __ mesures · __ points · résidu __ · points **M__**

| # | Repère | Où (mesure) | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | | | | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________
```

---

## 7. Synthèse de campagne

| # | Morceau | Verdict | Réserve / anomalie | Écouté le |
|---|---|---|---|---|
| 1 | ACDC — Highway to Hell | | | |
| 2 | Blink 182 — All the Small Things | | | |
| 3 | Europe — The Final Countdown | | | |
| 4 | F-Zero X — Goal BGM | | | |
| 5 | Helloween — Dr. Stein | | | |
| 6 | Igorrr — Blastbeat Falafel | | | |
| 7 | Igorrr — Headbutt | | | |
| 8 | Iron Maiden — Fear of the Dark | | | |
| 9 | Led Zeppelin — Immigrant Song | | | |
| 10 | Metallica — The Four Horsemen | | | |
| 11 | Metallica — For Whom the Bell Tolls | | | |
| 12 | Renaud — Morgane de toi | | | |
| 13 | Sepultura — Amen | | | |
| 14 | Slayer — Hell Awaits | | | |
| 15 | The Offspring — Self Esteem | | | |
| 16 | Nirvana — Come as you are | | | |
| — | **X1** Vitesse ×0,5 / ×1,5 | | | |
| — | **X2** Isolation A/B *(si requis)* | | | |
| — | **Mobile** (Pixel 7a, voir BUGFIX-TOTAL §7) | | | |

**Décision de campagne** : ☐ **validée** · ☐ validée **avec réserves** · ☐ **défauts à corriger**
**Testeur** : ______________ **Date** : ____ / ____ / ______

---

## 8. Journal des anomalies

| N° | Morceau | Horodatage | Mesure | Description | Reproductible | Chemin (MIDI / MP3 / mix) | Gravité |
|---|---|---|---|---|---|---|---|
| 1 | | | | | ☐ oui ☐ non | | ☐ bloquant ☐ majeur ☐ mineur |
| 2 | | | | | ☐ oui ☐ non | | ☐ bloquant ☐ majeur ☐ mineur |
| 3 | | | | | ☐ oui ☐ non | | ☐ bloquant ☐ majeur ☐ mineur |
| 4 | | | | | ☐ oui ☐ non | | ☐ bloquant ☐ majeur ☐ mineur |
| 5 | | | | | ☐ oui ☐ non | | ☐ bloquant ☐ majeur ☐ mineur |

> Pour chaque anomalie **bloquante** ou **majeure**, joindre si possible le
> **mois de `[mix-stats]`** correspondant (dérive, écritures de taux) — c'est ce
> qui permet de trancher entre **défaut de code** et **donnée GP**.
