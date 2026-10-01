# RESPONSIVE.md — Mode mobile / paysage

> **Définition du seuil (précision du rapporteur)** : « < 600 px » = **largeur du
> viewport strictement inférieure à 600 px**. Ce n'est pas un point de rupture codé —
> voir §1.2 et §6.
>
> **Cible de référence (demande explicite)** : **Google Pixel 7a**
> (1080 × 2400 @ DPR 2,625) → viewport CSS **412 × 915 en portrait**,
> **915 × 412 en paysage**.
> Le portrait tombe bien sous 600 px ; le paysage **dépasse** 600 px tout en n'ayant que
> **412 px de haut** → un test de **largeur seul ne peut pas le traiter**. C'est la
> démonstration qu'il faut une condition de hauteur (§6).
>
> **Statut** : analyse terminée, **correction codée (P1, P2, P3, P4 + P6 partiel)**,
> en attente de validation sur device. · Date : 2026-10-01
> · Portée : `index.html`, `css/styles.css`, `js/app.js`
> Entrée associée dans `BUG.md` : *« Le mode mobile (<600px) n'est pas fonctionnel »*.

---

## 0. Constat rapporté

> *« Le mode mobile (<600px) n'est pas fonctionnel : paramétrage impossible en vertical,
> l'interface est en bas et masquée ; en horizontal les paramètres masquent totalement
> la piste et ne sont pas collapsable. »*

Deux symptômes distincts :
- **Paysage (« en horizontal »)** → les réglages recouvrent la partition, impossibles à replier.
- **Portrait (« en vertical »)** → la barre de contrôle est en bas et inaccessible/masquée.

---

## 1. Modèle de mise en page tel qu'il est écrit

### 1.1 Arbre DOM / flex

```
<body h-[100dvh] flex flex-col overflow-hidden>               index.html:35
 ├─ <header id="transport">  order-2 md:order-1  z-40  shrink-0
 │    padding-bottom: env(safe-area-inset-bottom)             index.html:59-61
 │    ├─ rangée progression (order-1) + rangée boutons (order-2)   index.html:64-114
 │    └─ <div id="advanced">  grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
 │                                                        index.html:117-118
 └─ <div id="stage">  order-1 md:order-2  flex-1 min-h-0
      flex-col md:flex-row                                    index.html:186
      ├─ #pane (flex-1 min-h-0) → #viewport (flex-1 overflow-auto)
      │                            └─ #scoreArea / #emptyState / #loader
      └─ <aside id="drawer">          ← ENFANT de #stage     index.html:254-301
```

- Le `#drawer` est **enfant de `#stage`** → en mobile il se colle **en bas** de la partition,
  en desktop **à droite**. Le principe « jamais de recouvrement » est respecté sur ce point.
- `viewport-fit=cover` (index.html:5) + `env(safe-area-inset-bottom)` (index.html:61)
  et `h-[100dvh]` (index.html:35) : la gestion du navigateur mobile est déjà correcte.
- Le `z-40` de `#transport` **fonctionne** même sans `position:relative` : un élément flex
  avec un `z-index` non-`auto` crée un contexte d'empilement → il peint au-dessus du tiroir.

### 1.2 Points de rupture réellement présents dans le code

> ⚠️ **Il n'existe AUCUN point de rupture à 600 px**, aucune règle `orientation`,
> aucun `max-height` sur `#advanced`, aucun `min-height` sur `#stage`.
> Vérifié par grep sur les 3 fichiers.
> Le « <600 px » du rapport est donc **empirique** — le rapporteur précise
> qu'il désigne la **largeur du viewport** ; en l'état, aucun seuil ne porte ce nom.
>
> **Ajout après analyse** — la rangée de boutons a **changé de taille** :
> le bouton **Décompte (4 temps)** ajouté en `c17adbb` est le 8ᵉ enfant de la rangée
> (`index.html:87`). Le calcul de P3 doit être refait avec lui (voir §2 P3).

| Seuil | Où | Effet |
|---|---|---|
| **480** | `styles.css` — `.btn-ctl:not(.btn-primary)` | `min-width` 38 → **36 px**, `padding` 9 → 7 px (nouveau, P3) |
| **480** | `styles.css:185` | `.mx-vol` 74 → 96 px |
| **560** | `styles.css` `@media (min-width:768px) and (**min-height:560px**)` | force-ouverture de `#advanced` + suppression de `#btnMore` (nouveau, P1) |
| **640** | Tailwind `sm` sur `#advanced` | `grid-cols-1` → `grid-cols-2` |
| **768** | Tailwind `md:` · `styles.css` (tiroir 340 px) · `app.js` `mqDesktop` | transport en haut ; tiroir en colonne ; layout `horizontal` |
| **1024** | Tailwind `lg` sur `#advanced` | `grid-cols-2` → `grid-cols-3` |

---

## 2. Défauts **prouvés** (arithmétique, aucune hypothèse)

### P1 — 🔴 Le point de rupture est en **largeur**, la décision est en **hauteur**

`styles.css:77-85` :

```css
#advanced { display: none; }
body.adv-open #advanced { display: grid; }
@media (min-width: 768px){
  #advanced { display: grid !important; }   /* ← forcé ouvert */
  #btnMore  { display: none !important; }   /* ← bouton de repli SUPPRIMÉ */
}
```

Un téléphone en paysage fait **800×360 → 932×430** : largeur ≥ 768 ✔, hauteur ≤ 430.

- Le panneau « Réglages » est **toujours déployé**.
- `#btnMore` est `display:none !important` → **replier est impossible**.
  C'est littéralement « *ne sont pas collapsable* » — prouvé par deux lignes.
- Hauteur du header en paysage (largeur 844 → `sm:grid-cols-2`) :
  - rangée principale (`md:flex-row`, `.btn-primary` 44 px + `py-2.5`) ≈ **64 px**
  - `#advanced` : `max(sec1≈88, sec2≈140)` + `sec3≈130` + `gap-y-3` 12 + `py-3` 24 ≈ **284 px**
  - → **≈ 348 px de header sur un écran de 360 à 430 px**
- `#stage` = **≈ 12 px (800×360)** à **≈ 82 px (932×430)** → « *masquent totalement la piste* » ✓

**Effet aggravant** : à ≥768 le `#drawer` devient une colonne de `width:340px`
(`styles.css:130-137`) → encore 340 px de pris sur 800 de large.

### P2 — 🔴 Aucun **budget de hauteur**, aucun **plancher** sur la partition

Trois composants sont `shrink-0`, et **personne ne les compare à `100dvh`** :

| Élément | Taille / comportement | Source |
|---|---|---|
| `#transport` | `shrink-0`, hauteur libre | `index.html:60` |
| `#drawer` (mobile) | `height:46vh` + `flex-shrink:0` | `styles.css:123,126` |
| `#stage` | `flex-1 min-h-0` → **peut tomber à 0** | `index.html:186` |

Quand `transport + 46vh > 100dvh`, **c'est `#stage` qui encaisse** : la partition tombe à **0**
et le tiroir **déborde** de sa boîte vers le bas, sous la barre de transport.

**Calcul — portrait 375×667, `adv-open` + tiroir ouvert :**

- `#advanced` en `grid-cols-1` (< 640) :
  sec1 (Lecture) ≈ 88 + sec2 (Boucle A/B) ≈ 140 + sec3 (Affichage) ≈ 130
  + `gap-y-3` 24 + `py-3` 24 = **≈ 406 px**
- `#transport` = rangée mobile (88) + 406 = **≈ 495 px**
- `#stage` = 667 − 495 = **≈ 172 px**
- `#drawer` = 46 vh = **307 px > 172** → `#pane` = **0**, débordement ≈ **135 px**

→ la **partition disparaît**, et **le bas du tiroir (Master / Métronome) passe sous
`#transport`** → inaccessible. Le transport survit (z-40), mais **les réglages du bas du
tiroir sont perdus**.

C'est l'explication la plus probable de « *paramétrage impossible en vertical … masquée* ».

### P3 — 🔴 La rangée de boutons **déborde** en portrait étroit

Largeurs issues de `.btn-ctl { min-width:38px; padding:0 9px }` et
`.btn-primary { min-width:52px }` — **`min-width` interdit au flex de réduire
davantage**, donc la rangée ne peut que déborder.

**Recalculé après l'ajout du bouton Décompte (`c17adbb`, 8ᵉ enfant de la rangée)** :

```
#btnPlay 52
+ #btnStop #btnPrev #btnNext #btnMetronome #btnCountIn #btnLoop    6×38 = 228
+ 7 gaps de 6 px (gap-1.5)                                            =  42
+ groupe ml-auto { #btnMixer 38 + gap 6 + #btnMore 38 }               =  82
= 404 px   +   px-3 (12+12)                                           = 428 px
```

| Viewport | Espace dispo (viewport − 24) | Débordement | `#btnMore` visible |
|---|---|---|---|
| **412 px (Pixel 7a portrait)** | 388 | **40 px** ✗ | **coupé ← SYMPTÔME REPRODUIT** |
| **393 px** | 369 | 59 px | coupé |
| **375 px** | 351 | 77 px | coupé |
| **360 px** | 336 | 92 px | coupé |
| **320 px** | 296 | 132 px | coupé |

> ⚠️ **L'ancien tableau disait « 412 px → 0 de débordement »** : il ne comptait que
> **5** boutons secondaires. Le bouton Décompte ajoute **44 px** (38 + gap 6) →
> le seuil du symptôme passe de **~380 px à ~420 px**, c'est-à-dire **il touche le
> Pixel 7a en portrait**. Cause ajoutée à la liste des régressions introduites après
> la rédaction de ce document.
>
> **Corrigé** : `flex-wrap` sur la rangée (`index.html:87`), `gap-1 md:gap-1.5`, et
> `.btn-ctl:not(.btn-primary){ min-width:36px; padding:0 7px }` sous 480 px
> (`styles.css`) → **396 px utiles sur 412** (16 px de marge), et sous ~396 px le
> groupe `ml-auto` bascule sur une 2ᵉ ligne **au lieu d'être rogné**.

`body overflow-hidden` (`index.html:35`) → **pas de scroll, juste un rognage**.
`#btnMore` (Réglages) et une partie de `#btnMixer` (Mélangeur) sont donc **coupés au bord
droit** → le bouton qui ouvre les réglages n'est plus atteignable.

Cause **la plus probable** de « *paramétrage impossible en vertical* ».
Hypothèse forte : elle suppose un viewport **≤ ~380 px** → à confirmer (§4, cas D).

### P4 — 🟠 `#advanced` n'a **ni `max-height` ni `overflow-y`**

`styles.css:80-85` est la **seule** règle qui le touche. En colonne unique (< 640) il mesure
~406 px sans plafond : impossible de le faire défiler, il ne peut que rogner.

### P5 — 🟠 Le tiroir mobile n'a **aucun état intermédiaire**

Soit `46vh` plein, soit fermé (`✕` / `Échap`).
`46vh` est une valeur **absolue viewport**, pas une fraction de `#stage` : elle ne s'adapte
ni à la hauteur du transport, ni à la rotation.

### P6 — 🟠 La rotation n'est pilotée que par la **largeur**, et incomplètement

- `app.js:1230` → `mqDesktop = window.matchMedia('(min-width: 768px)')`
- `app.js:1837` → **seul** effet de `change` : `applyResponsiveLayout()`
- `app.js:1817` → `if (api.settings… || layoutTouched) return;`
  → **dès que l'utilisateur a choisi un layout manuellement, la rotation ne change plus rien.**
- Rien ne referme `adv-open`, rien ne rééquilibre le tiroir.
- `#advanced` / `#btnMore` sont pilotés **uniquement par le CSS** :
  `body.adv-open` (JS) et le `!important` (CSS) peuvent **entrer en conflit**
  (paysage → forcé ouvert ; retour portrait → il reste ouvert si `adv-open` était actif).

---

## 3. Ce qui **n'est pas prouvé** (hypothèses)

| # | Hypothèse | Pourquoi elle est douteuse | Comment trancher |
|---|---|---|---|
| **H1** | En portrait, « masquée » = le tiroir passe sous la barre (cf. P2) | Exige `adv-open` **et** tiroir ouvert simultanément | §4, cas C |
| **H2** | Clavier virtuel / barre de gestes recouvre le bas | `viewport-fit=cover` (index.html:5) **et** `env(safe-area-inset-bottom)` (index.html:61) sont déjà en place. Surtout : **aucun `<input type="text">`** dans l'app — tout est `range` / `select` → le clavier virtuel ne s'ouvre quasiment jamais | Test sur device réel |
| **H3** | `#toastBox` mal placé | `bottom: calc(safe-area + 190px)` (index.html:54) est un **nombre magique** : le transport mobile mesure ~88 px, pas 190 → les toasts flottent au mauvais endroit. Gênant, **pas bloquant** | Visuel |

---

## 4. Protocole de vérification

DevTools → Device toolbar. Pour chaque cas, relever
`document.querySelector(x).getBoundingClientRect()` :

| Cas | Viewport | `adv-open` | Tiroir | Résultat attendu si le diagnostic est juste |
|---|---|---|---|---|
| **A** | 844×390 (paysage) | — | fermé | `#btnMore` **absent**, `#advanced` **ouvert**, `#stage.height < 90` |
| **B** | 800×360 (paysage) | — | fermé | `#stage.height ≈ 12` |
| **C** | 375×667 (portrait) | **oui** | **ouvert** | `#stage.height = 0`, débordement du `#drawer` > 100 px |
| **D** | 360×640 (portrait) | — | fermé | `#btnMore.getBoundingClientRect().right > innerWidth` → **coupé** |
| **E** | 412×915 (portrait) | — | fermé | tout passe (contre-exemple attendu) |

> Les cas **A** et **B** **seuls** confirment déjà P1 (la partie
> « masquent totalement la piste et ne sont pas collapsable »).

---

## 5. Plan de correction — **codé, en attente de validation**

Ordre de priorité :

- [x] **1. P1** — Force-ouverture de `#advanced` conditionnée à la **hauteur** :
      `@media (min-width: 768px) and (min-height: 560px)` · `styles.css`.
      `#btnMore` n'est plus supprimé sur un écran court → **recollement possible**.
      → *débloque le paysage (Pixel 7a 915×412).* ✅
- [x] **2. P3** — La rangée passe en `flex-wrap` (`index.html:87`) + `gap-1 md:gap-1.5`,
      et `.btn-ctl:not(.btn-primary)` passe à `min-width:36px / padding:0 7px` sous 480 px.
      **396 px utiles → tient sur 412 px** ; en dessous le groupe de droite bascule sur
      une 2ᵉ ligne au lieu d'être rogné. ⚠️ Seuil du symptôme révisé : **≤ ~420 px**,
      pas ~380 — l'ajout du bouton Décompte (`c17adbb`, 8ᵉ enfant) a coûté 44 px. ✅
- [x] **3. P2** — `#drawer` mobile : `height:46vh` + **`max-height:46%`** + `overflow-y:auto`
      (le `%` est résolu sur `#stage`, pas sur la fenêtre) ; `max-height:none` en ≥768.
      Le tiroir ne peut plus déborder de `#stage` ni passer sous `#transport`. ✅
- [x] **4. P4** — `#advanced` : `max-height: min(46dvh, 420px)` + `overflow-y:auto` +
      `overscroll-behavior:contain` → le panneau défile au lieu de chasser la
      partition. ✅
- [ ] **5. P5** — État réduit du tiroir (et, en paysage court, du panneau réglages).
      **Non fait** — le « collapsable » demandé est couvert par P1 (le panneau se
      replie via `#btnMore`), mais le tiroir lui-même n'a toujours que 46 % / fermé.
- [~] **6. P6** — Fait en partie : `mqShort = matchMedia('(max-height: 559px)')` +
      `syncShortViewport()` suppriment `adv-open` en entrant en zone courte
      (`app.js:19-21, 596-597`), en miroir exact de la condition CSS.
      **Reste** : retirer le `return` prématuré de `applyResponsiveLayout()`
      sur `layoutTouched`, et rééquilibrer le tiroir à la rotation.
- [ ] **7. H3** — `#toastBox` ancré à `bottom: calc(safe-area + 190px)` : **non fait**
      (nombre magique, gênant mais non bloquant).

### Contraintes respectées

1. **3 fichiers** — `index.html`, `css/styles.css`, `js/app.js` (aucun 4ᵉ fichier ajouté).
2. Le tiroir reste **dans le flux** (DAW) : pas de recouvrement, pas de backdrop,
   fermeture uniquement par `✕` / `Échap`. ✅
3. CSS `@media` et Tailwind `md:` restent alignés sur 768 px ; la **nouvelle** condition
   n'existe **que** dans `styles.css` (`#advanced`) — `mqShort` en JS lui répond en
   miroir. ✅
4. `node --check js/app.js` + U+FFFD = 0 sur les 3 fichiers + `tools/load-smoke.js` OK. ✅

---

## 6. ✅ Décision tranchée

**Quel seuil pour la zone « mobile » ?**

| Option | Avantage | Inconvénient |
|---|---|---|
| **640 px** (`sm`) | le plus proche du « <600 px » rapporté | seuil Tailwind **déjà utilisé** par `#advanced` (`grid-cols-2`) → risque d'un **4ᵉ** point de rupture |
| **768 px** (`md`) | celui **réellement en vigueur** (`mqDesktop`, `order`, `md:`, `!important`) | ne correspond pas au chiffre annoncé par le rapporteur |

**Décision** : **768 px comme unique seuil de largeur** + **`min-height: 560px`**
en condition complémentaire — et surtout **pas de nouveau seuil de largeur**.

**Justification chiffrée — Google Pixel 7a (cible de référence)**

| Orientation | Viewport CSS | `< 600 px` ? | Seuil codé | Comportement obtenu |
|---|---|---|---|---|
| **Portrait** | **412 × 915** | ✔ 412 < 600 | < 768 | zone « mobile » : transport en bas, `#advanced` replié par défaut, tiroir en bas |
| **Paysage** | **915 × 412** | ✘ 915 > 600 | ≥ 768 | **sans `min-height`** : `#advanced` forcé ouvert **et** `#btnMore` supprimé sur **412 px** de haut |

- Le rapporteur raisonne en **largeur** — et il a raison pour le portrait (412 < 600).
  Mais le **paysage échappe à ce test tout en étant le cas le plus cassé** :
  915 px de large « prouvent » qu'on est en desktop, alors qu'il reste 412 px de haut.
  → la largeur seule ne peut pas définir la zone.
- Un seuil posé à 600 ou 640 créerait une **zone grise 600–768** sans règle : c'est
  exactement le bug d'origine, simplement déplacé.
- Choix de **560 px** : paysage de téléphone ≈ 412 ✗ (→ repliable), portable 1366×768 ✔
  (→ forcé ouvert, comme avant), fenêtre réduite 800×500 ✗ (→ repliable).
  **En dessous de 560 on rend le recollement, on ne le supprime jamais.**
- Miroir JS : `mqShort = matchMedia('(max-height: 559px)')` → `app.js:19`.

---

## 7. Hors périmètre (rappel)

- La **correction du 404 sur `samples/`** est **déjà livrée** (scan HTTP + repli sur
  `CFG.sampleFiles`, index local de 14 fichiers) — voir la section équivalente dans `BUG.md`.
  Elle n'a **rien à voir** avec ce plan responsive.
- Les bugs **B1 / B2 / B3 (boucle A→B)** et la conservation de la boucle au clic simple
  sont également livrés, en attente de validation.
