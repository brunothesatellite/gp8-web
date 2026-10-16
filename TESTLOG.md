# TESTLOG.md — Journal de test d'écoute (validation humaine)

> **Objet** : valider **à l'oreille** les correctifs audio/synchro du plan
> `BUGFIX-TOTAL.md` (phases **P2, P3, P4, P6**). Ce journal est **vierge** : il
> est pré-rempli avec les morceaux, les **mesures/repères précis** à observer et
> les critères attendus ; les colonnes *Relevé / Verdict* sont à remplir.
>
> **Référence du plan** : `BUGFIX-TOTAL.md` §5.2 (les 15 points d'écoute) et
> §5.3 (journal). Ce fichier est la version **opérationnelle** à remplir.

---

## 0. Ce qui est déjà prouvé automatiquement (ne pas re-tester sans doute)

| Invariant | Preuve |
|---|---|
| `playbackSpeed` **jamais écrit en lecture** (⇒ 0 coupure de synthé) | banc **15/15** + navigateur réel **15/15** |
| 0 erreur console | navigateur **15/15** |
| dérive de croisière bornée par la zone morte | **10-80 ms** (navigateur), **≤ 11 ms** (banc) |
| anacrouses alignées sur l'audio | **6/6 ≤ 0,04 %** |
| fin de webapp **jamais** au-delà du MP3 | **15/15** |
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
**Angle** : renvoi **DS al Coda** en milieu de morceau + divergence de données GP (H2).
**Machine** : 43 mesures · 68 points · résidu **12 clés / 6 mesures H2 (5-8, 12-13)** · points **M6, M7**

| # | Repère | Où (mesure) | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | ≈ 01:03 | fin 17 → **6** | le saut D.S. al Coda est **net et unique** (pas de double déclenchement) | | |
| 2 | ≈ 01:10 | — | l'audio correspondant est situé là dans le MP3 (**normal**, donnée GP) | | |
| 3 | continu | 5-8, 12-13 | **aucun saut parasite** ajouté (écart accepté = donnée GP) | | |
| 4 | continu | groupes `@2/5`, `@6/9`, `@13/14`, `@30/31`, `@34/35` | chaque **volta à fin unique** jouée le bon nombre de fois | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.2 · Blink 182 — All the Small Things
`Blink 182 (1999 - Enema Of The State) - All the Small Things v2.gp`
**Angle** : **volta à fins multiples** (3 fins) — le cas où alphaTab était fautif.
**Machine** : 53 mesures · 147 points · résidu **0** · points **M10**

| # | Repère | Où (mesure) | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | continu | 6-10 | séquence **`6-7-8-9` ×3 puis `6-7-8-10`** | | |
| 2 | 3ᵉ passage | 9 → 10 | la **fin 4 (mes 10)** arrive **après** le 3ᵉ passage, pas avant | | |
| 3 | continu | 6-10 | **aucune fin escamotée**, aucun passage en trop (⚠ le nombre de traversées a **changé** avec le correctif → **à écouter en priorité**) | | |
| 4 | continu | 6-10 | le MIDI ne **se dédouble pas** au passage fin 3 → fin 4 | | |

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
**Angle** : **anacrouse vide** (mesure 0) + écart de tempo **permanent** (symptôme d'origine n°1).
**Machine** : 114 mesures · 112 points · résidu **0** · points **M4, M5**

| # | Repère | Où (mesure) | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | ≈ 00:00 | **0** (anacrouse) | la mesure 0 est **VIDE** dans le `.gp` ; elle doit durer **une mesure pleine** (≈ 1 599 ms) et **ne pas être escamotée** → le MIDI démarre **en phase** | | |
| 2 | ≈ 00:00 | 16-19 | **plus aucun retour en arrière** audio (le symptôme d'origine) | | |
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
**Angle** : **tempos très variables** (intro lente ↔ riff rapide) et leurs **transitions**.
**Machine** : 127 mesures · 137 points · résidu **0** · points **M1, M2, M3**

| # | Repère | Où | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | 00:00-00:30 | mes 1-16 | intro lente (≈ **0,65×**) **sans à-coups**, MIDI collé au MP3 | | |
| 2 | 02:01-04:11 | riffs | ≈ **1,72-1,79×** — **pas de « début trop rapide »** (symptôme d'origine) | | |
| 3 | — | mes 98 | transition de tempo la plus marquée (pente 0,524) : **pas de saut ni de flottement** | | |
| 4 | ~00:30, ~02:01 | frontières intro→riff | **ni trou ni décalage** à la bascule de tempo | | |
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

### 5.10 · Metallica — The Four Horsemen  *(témoin + correctif P6)*
`Metallica (1983 - Kill 'Em All) - The Four Horsemen.gp`
**Angle** : témoin **+ validation du manifeste** (ce morceau était **absent de la liste** avant P6).
**Machine** : 179 mesures · 240 points · résidu **0** · points **M15**

| # | Repère | Où | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | — | liste des exemples | le morceau **apparaît** dans la liste et **se charge** (correctif P6) | | |
| 2 | continu | tout | identique à la référence, 0 coupure | | |

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
**Angle** : renvois **complexes** (D.S., D.S.S., Coda) + **4 mesures H1 refusées** + forte divergence (55 clés).
**Machine** : 50 mesures jouées · 100 points · résidu **55 clés (33 H2 + 4 H1 refusées : mes 8/9/11/42)** · points **M8, M9**

| # | Repère | Où (mesure) | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | ≈ 00:00 | 1-6 | séquence **`1 2 3 4 · 1 2 3 5 · 1 2 3 6`** | | |
| 2 | — | 15-21 | **volta à 4 fins** : les 4 fins **dans l'ordre**, aucun passage sauté | | |
| 3 | — | global | parcours **1→36 puis D.S. vers mes 5 puis 50 (Coda)** ; la reprise repart bien **en mesure 5** | | |
| 4 | — | **8, 9, 11, 42** | mesures **H1 refusées** : **aucun saut parasite** (l'écart MIDI/audio = **donnée GP**) | | |
| 5 | — | — | un pic de dérive ≈ **6 939 ms** au moment d'un saut de renvoi est **attendu** (ce n'est **pas** un défaut) | | |

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
**Angle** : **saccades / micro-sauts d'origine** (RC-1 + RC-2) · seul fichier en **44,1 kHz**.
**Machine** : 138 mesures · 149 points · résidu **0** · points **M11, M12**

| # | Repère | Où | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | ≈ 01:00 | zone des saccades | **plus aucun micro-saut** ni note coupée | | |
| 2 | ≈ 00:00 | intro | le MP3 démarre à **1:04,7** (silence audio initial) : alignement **propre** | | |
| 3 | — | 44, 53, 117 | répétitions : **4 passages** chacun, dans l'ordre | | |
| 4 | — | segments de pont | les segments à pente extrême **0,50-0,69×** d'avant correctif ont **disparu** → le MIDI ne **traîne** ni n'**accélère** brutalement | | |

**Grille commune** : T1 ☐ · T2 ☐ · T3 ☐ · T4 ☐ · T5 ☐ · T6 ☐ · T7 ☐
**Console** : `[mix]` ____________ · dérive max `[mix-stats]` ______ ms · `[oracle]` ____________
**Verdict morceau** : ☐ ✅ ☐ 🟡 ☐ ❌ ☐ ? — **Anomalie(s)** n° ____________
**Notes** : ________________________________________________________________

---

### 5.15 · The Offspring — Self Esteem
`The Offspring (1994 - Smash) - Self Esteem.gp`
**Angle** : **saut historique de 6,9 s** (≈ 0:51) + divergence de données GP (H2).
**Machine** : 51 mesures · 251 points · résidu **5 clés / 2 mesures H2 (18-19)** · points **M13, M14**

| # | Repère | Où | Attendu | Relevé | Verdict |
|---|---|---|---|---|---|
| 1 | ≈ 00:51 | — | **plus de saut parasite** (les 6,9 s historiques) | | |
| 2 | — | 18-19 | écart auditeur = **donnée GP** : **aucun saut ajouté** | | |
| 3 | continu | tout | **0 coupure** | | |
| 4 | — | — | **X1** (×0,5 / ×1,5) appliqué | | |

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
