# BUGLATEST — état stable et reste à faire (audio/mix)

Date : 2026-10-02. Branchement : après `c7609e6` (renvois) et `47014c0` (tempo par
segment). Document de travail : les causes sont détaillées dans **BUGMP3.md §14**,
le suivi des écoutes est dans **TESTSAMPLES.md**. Celui-ci porte l'état *et la
file d'attente*.

---

## 1. État stable livré (code en place, contrôles verts)

| Élément | Fichier | État |
|---|---|---|
| Oracle de répétition (RC-1) | `js/repeat-oracle.js` | **nouveau**, chargé avant `player.js` |
| Branchement `scoreLoaded` | `js/player.js` (l.215-230) | appelle `RepeatOracle.raise` si audio embarqué |
| Enveloppe `_playThroughSong` + observatoire de marche | `js/player.js` (`installRepeatNormalization`) → délégué à `RepeatOracle.install` | normalisation **et** lecture des occurrences au même endroit |
| Déclaration des scripts | `index.html` (8 scripts) + `tools/load-smoke.js` (`ORDER`, bindings) | en phase |
| Contrôle non-régression RC-1 | `tools/repeat-check.js` | **nouveau**, sort 0 |
| Simulation du correcteur (RC-3) | `tools/tempo-correct-sim.js` | **nouveau**, sort 0 |
| Avertissement miroir périmé | `tools/sync-audit.js` (en-tête) | note ajoutée (voir T4) |

### Comment revérifier l'état (3 commandes, ~1 min)

```
node tools/load-smoke.js          # ordre des <script>, exécution, bindings
node tools/repeat-check.js        # RC-1 : non-régression + gains attendus
node tools/tempo-correct-sim.js   # comparaison des 3 lois de correction
```

Résultats obtenus sur les 14 échantillons :

* `load-smoke` → `RESULTAT : OK` (8 scripts, `RepeatOracle` exposé).
* `repeat-check` → clés GPIF manquantes **94 → 72**, aucune des trois métriques
  dégradée sur aucun fichier, idempotence vérifiée, audio présent à `scoreLoaded`
  **14/14**, coût ≤ 15 passes `generateSyncPoints` et ≤ 3 ms (Slayer).
* `tempo-correct-sim` → loi « protège » : écritures de taux **550 → 266**, aucun
  recadrage ni coupure supplémentaire.

### Ce que RC-1 change, morceau par morceau (clés GPIF uniques / pentes hors clamp / sauts)

| fichier | avant | après | groupes relevés |
|---|---|---|---|
| **Slayer – Hell Awaits** | 8 / 1 / 0 | **0 / 0 / 0** | més 48 (2→3), 55 (2→4), 108 (2→3), 119 (2→4) |
| **Blink-182 – All the Small Things** | 7 / 0 / 3 | **0 / 0 / 2** | més 9 (2→4) |
| **The Offspring – Self Esteem** | 8 / 0 / 2 | **5 / 0 / 1** | més 20 (2→4) |
| **AC/DC – Highway to Hell** | 16 / 2 / 4 | **12 / 2 / 3** | més 9 (2→4) |
| Renaud – Morgane de toi | 55 / 3 / 7 | 55 / 3 / 7 | aucun (relèvement rejeté) |
| Iron Maiden, Europe, Metallica, Sepultura, Dr. Stein, Led Zep, F-Zero, Igorrr ×2 | — | **intact** | aucun |

Rappel utile : l'ancien `fixAlternateEndings` totalisait **117 / 10**, soit *pire
que l'absence de correctif* — c'est bien pourquoi il n'est pas revenu.

**Conséquence audible attendue** : le MIDI n'est plus plaqué à 0,50-0,69× pendant
3-6 s sur Slayer (les 4 segments de pont à pente 1,45 / 1,79 / 1,81 / 2,23 ont
disparu avec les points qui les causaient), et Blink-182 retrouve ses 7 mesures
enregistrées manquantes.

---

## 2. Les trois causes, où on en est

**RC-1 — points de synchro perdus (régression `c7609e6`).** Corrigé et validé
hors navigateur (tableau ci-dessus). Reste à confirmer à l'écoute (T1).

**RC-2 — coupures du synthé à chaque écriture de tempo (`47014c0`).** **Pas de
correction locale.** Écriture de `playbackSpeed` → `updatePlaybackSpeed` →
`set timePosition` → `mainSeek()` (branche arrière, `noteOffAll(true)` +
re-rendu depuis 0) → `output.resetSamples()`. Toutes les voies de l'API
1.8.4 convergent là, et le synthé tourne dans un **worker** (`core.useWorkers:
true`, `js/core.js` l.29) : un wrapper posé sur le thread principal — comme
celui de `_playThroughSong` — ne l'atteint pas. Compteur actuel :
**405 écritures = 405 coupures** sur les 14 morceaux (Offspring 137, Blink 41,
Slayer 33, Dr. Stein 23). Décision à prendre en T3.

**RC-3 — cycle du correcteur de dérive.** Le défaut est une ligne :
`js/mix-sync.js` l.482, `if (Math.abs(drift) < DEADBAND_MS) return;` — en zone
morte on ne fait rien, le taux biaisé de la dernière écriture reste appliqué, la
dérive repart en sens inverse, et le système oscille (Slayer 75 écritures de
taux / 5 min, mp3 étiré ±5 % en permanence, `preservesPitch` quasi toujours
actif). Simulation :

| loi | écritures | Slayer moy. étirement | > 2 % du temps | verdict |
|---|---|---|---|---|
| `actuel` (livrée) | 550 | 5,3 % | 95 % | référence |
| `neutre` naïve | 346 | 1,5 % | 27 % | **REJETÉE** : Blink 31→45, Igorrr max 7,7 %→**100 %**, F-Zero 6,6 %→15,6 % |
| `protege` (avec garde) | **266** | **1,5 %** | **27 %** | retenue : jamais de recul sous le natif |

Pourquoi la garde est indispensable : `sp` est volontairement périmé
(`TEMPO_EPS` 4 %) pour limiter les coupures RC-2 ; `sp × pente` peut donc être
**plus loin** de 1,0 que le taux en cours. La loi `protege` n'écrit le neutre
que s'il rapproche le mp3 du taux natif (`|neutre − 1| ≤ |taux − 1|`). Deux
résidus acceptables : F-Zero 1→2 écritures, Led Zeppelin max 7,3 %→8,1 %
(moyenne 4,4 %→1,0 %). Gains notables : Maiden max 117 %→10 %, Europe 79 %→2 %
du temps au-delà de 2 %, Metallica 92 %→5 %.

---

## 3. Reste à faire (file d'attente ordonnée)

### T1 — Confirmer RC-1 à l'écoute *(court, obligatoire avant toute autre
modification audio)*
Serveur local : `python -m http.server 8777 --bind 127.0.0.1` →
`http://localhost:8777/`. Ouvrir Slayer, Blink, Offspring, AC/DC, puis Dr. Stein
et un morceau « intact » (Metallica) comme témoin.
À voir en console :
* `[renvoi] normalisation fins multiples installée` *(déjà acquis)* ;
* `[oracle] N groupe(s) de répétition relevé(s) d'après les points GPIF — clés
  manquantes X → Y, pentes hors clamp Z, sauts W` : cette ligne doit apparaître
  sur **Slayer (4 groupes, 8 → 0, pentes 1 → 0), Blink (1, 7 → 0), Offspring
  (1, 8 → 5) et AC/DC (1, 16 → 12)** — et sur AUCUN des 10 autres ;
* la ligne `[mix] tempo hors plage … pente 2.23` doit **avoir disparu** de
  Slayer ; `[mix-stats]` doit descendre vers ≈ 0,05-0,15 écriture/s (RC-3
  non corrigé à ce stade, donc pas encore 0).
Compléter TESTSAMPLES.md (cases `*CHECK*` de Blink et Slayer).
Si un morceau se comporte *mal*, `RepeatOracle.raise` est le premier suspect :
le neutraliser (garder seulement `install`) suffit à revenir à l'état précédent,
sans autre conséquence.

### T2 — Coder RC-3 loi « protège » dans `js/mix-sync.js`
Une branche, en l.482, dans le style des commentaires du fichier :

```js
if (Math.abs(drift) < DEADBAND_MS) {
  const neutre = sp * slope;
  if (Math.abs(neutre - 1) <= Math.abs(a.playbackRate - 1) &&   // garde
      now - lastWrite >= WRITE_MS && Math.abs(a.playbackRate - neutre) > RATE_EPS) {
    a.playbackRate = neutre; lastWrite = now; nRate++;           // puis silence
  }
  return;
}
```

Ne rien changer d'autre : constantes, `applyTempo`, recadrage, `nStall`.
Profiter du passage pour mettre l'en-tête (l.33-36) en phase — il annonce
« 25 ms / ±10 % » alors que le code applique `DEADBAND_MS = 100` et
`NUDGE = 0.10` avec une écriture espacée de `WRITE_MS = 1500`.
Critère de finition : `node tools/tempo-correct-sim.js` (colonne `P` = ce que
fait le code) + `[mix-stats]` en écoute ; ne pas oublier de reporter la loi
dans le miroir de `tools/sync-audit.js` (T4).

### T3 — Arbitrer RC-2 *(le vrai verrou de la qualité)*
Trois voies, chiffrées :
1. **Signalement amont alphaTab** (recommandé) : demander un réglage de vitesse
   sans seek — l'assignation de `timePosition` dans `updatePlaybackSpeed`
   (vendor l.39842-39850) n'a d'intérêt que pour une recherche ; un chemin
   « `sequencer.playbackSpeed = v` + rescaling de `_timePosition` », sans
   `mainSeek()` ni `resetSamples()`, suffirait. **Tant que ce n'est pas là,
   aucun réglage local ne donne à la fois peu de coupures ET un mp3 natif.**
2. **Contenir** : `TEMPO_EPS` 4 % → 8 % divise les coupures par ~2
   (405 → ~200, Offspring 137 → 35, Blink 41 → 15) mais fixe un étirement
   résiduel de ±8-11 % sur le mp3 — échange exactement le symptôme que l'on
   veut guérir. À ne faire qu'après T1/T2 et *sur écoute*.
3. ** lisser le pont** : une partie des écritures est du bruit de pente
   (Dr. Stein : 7 % de segments à > 4 % mais 23 écritures). Un lissage
   (médiane 3 points, ou fusion de segments à < 5 %) réduirait écritures *et*
   thrashing sans toucher au vendor. Mesure préalable : `slope-noise.js`
   (§4 annexes).
À trancher avec les résultats de T1/T2 : si l'écoute ne signale plus que des
artefacts de *vitesse* (et plus de coupures), la voie 3 devient prioritaire.

### T4 — Remettre `tools/sync-audit.js` en phase
Il reconstruit le score avec `fixAlternateEndings` (supprimé du code livré) et
sans `RepeatOracle.raise` : ses tableaux de pentes/points/« écritures tempo »
décrit l'ancien comportement (avertissement ajouté en en-tête). Il peut
désormais `require('../js/repeat-oracle.js')` et installer l'enveloppe comme le
font `tools/repeat-check.js` et `tools/tempo-correct-sim.js` — plus aucun miroir
à entretenir à la main. Reporter aussi la loi RC-3 retenue en T2.

### T5 — Cas H1 : numérotation d'occurrence de Guitar Pro (AC/DC, Renaud)
Après RC-1 il reste **12 clés manquantes sur AC/DC** et **55 sur Renaud**, que
aucun relèvement de `repeatCount` ne rattrape sans dégrader le pont (l'oracle
les rejette, et c'est voulu). TESTSAMPLES.md va dans le même sens :
* AC/DC — « mesures 6-7-8-9-10 : l'audio est faux alors que la séquence MIDI est
  correcte » → le déroulé est bon, ce sont les clés de GP qui ne correspondent
  pas ;
* Renaud — « le début doit être 1 2 3 4 · 1 2 3 5 · 1 2 3 6 » → attendre la
  re-écoute après `c7609e6` (la normalisation multi-fins vise exactement cette
  séquence) avant de conclure.
Investigation proposée : comparer, pour ces deux fichiers, `barOccurence` des
points GPIF avec l'axe réel de l'audio (les 55 clés de Renaud sont-elles en
*avance* ou en *retard* d'une traversée ?). Tant que H1 n'est pas compris, ne
pas chercher à « couvrir » ces clés : c'est ce qui a perdu Renaud en `c7609e6`.

### T6 — Documentation d'analyse
* BUGMP3.md §14 : ajouter « correction livrée » (RC-1) + renvoi vers
  `tools/repeat-check.js`, et la nuance **points vs clés uniques** — Slayer
  148 *points* = 138 *clés* (un même couple mesure/occurrence peut porter
  plusieurs points : tempo en cours de mesure), d'où les chiffres 94/72 du
  contrôle au lieu de 105/78 des premiers balayages ;
* BUG.md : faire passer l'item audio de `N/A` à MAJOR tant que T1 n'est pas
  clos (ou le valider et le fermer) ;
* TESTSAMPLES.md : cocher après écoute (Blink, Dr. Stein, AC/DC, Renaud).

### T7 — Déploiement et mobile
`deploy/_build.ps1` copie tout l'arbre hors `tools/` et `*.md` :
`js/repeat-oracle.js` est donc pris en charge **sans toucher au script** ✓
(à vérifier une fois : `deploy/gp8-web/js/repeat-oracle.js` présent).
Puis validation Pixel 7a (le worker synthé et `preservesPitch` n'y ont pas le
même coût) — en particulier Slayer autour de 1′ et Offspring (137 coupures).

### T8 — Hygiène (bas coût, à caser entre deux mesures)
* Les harnais de diagnostic hors dépôt (annexes) méritent un sort : versionner
  `walk.js`/`sync-renvoi.js` dans `tools/` ou les oublier ;
* Le nom `RepeatOracle.walkMaxOcc` exposé publiquement sert au diagnostic :
  soit l'assumer (commentaire), soit le rendre privé ;
* Aucun test automatique ne couvre `mix-sync.js` aujourd'hui :
  `tools/tempo-correct-sim.js` est le bon endroit pour en poser un (compter les
  écritures d'un pont synthétique à 3 segments, comparer aux 3 lois).

---

## 4. Annexes

**Garde-fous du projet** (inchangés) : `<script>` classiques compatibles
`file://` ; CDN alphaTab **1.8.4** et JSZip **3.10.1** figés ; favicon figé ;
`deploy/_build.ps1` non modifiable ; pas de liste d'échantillons codée en dur ;
tiroir = fermé par ✕ ou Échap uniquement.

**Encodage** : tous les fichiers du dépôt sont en **UTF-8 sans BOM**. La console
Windows (CP1252) affiche `⚠` et `→` en `?` : c'est un artefact de rendu, pas une
corruption — les outils du dépôt n'utilisent donc que `->` et `ok/x` dans leurs
sorties.

**Harnais hors dépôt** (réutilisables, `%TEMP%\opencode\`) : `oracle.js`
(référence de la table RC-1, 3 critères), `walk.js` (marche alphaTab isolée),
`timeline.js` (journal d'événements d'un morceau), `tempo-steps.js` (nombre
d'écritures tempo selon `TEMPO_EPS`), `slope-noise.js` (bruit de pente),
`offsets.js` (départ mp3), `slayer-keys.js`, `sync-renvoi.js`. Déjà intégrés au
dépôt : `tools/repeat-check.js`, `tools/tempo-correct-sim.js`.

**Ce qui n'est PAS encore fait, en une ligne** : écoute navigateur (T1), loi
RC-3 codée (T2), arbitrage RC-2 (T3).
