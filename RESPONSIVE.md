# RESPONSIVE.md — Mode mobile / paysage (< 600 px et au-delà)

> **Statut** : analyse terminée, **aucune correction codée**.
> Date : 2026-10-01 · Portée : `index.html`, `css/styles.css`, `js/app.js`
> Entrée associée dans `BUG.md` : *« Le mode mobile (<600px) n'est pas fonctionnel »*.
>
> **Décision à prendre avant toute ligne de code** : voir §6 — **640 px ou 768 px ?**

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

| Seuil | Où | Effet |
|---|---|---|
| **480** | `styles.css:155` | `.mx-vol` 74 → 96 px |
| **640** | Tailwind `sm` sur `#advanced` | `grid-cols-1` → `grid-cols-2` |
| **768** | `styles.css:82-85`, `styles.css:130` · `index.html` (`md:`) · `app.js:1230` `mqDesktop` | panneau réglages forcé ouvert + `#btnMore` supprimé ; tiroir 340 px ; transport en haut ; layout `horizontal` |
| **1024** | Tailwind `lg` sur `#advanced` | `grid-cols-2` → `grid-cols-3` |

> ⚠️ **Il n'existe AUCUN point de rupture à 600 px**, aucune règle `orientation`,
> aucun `max-height` sur `#advanced`, aucun `min-height` sur `#stage`.
> Vérifié par grep sur les 3 fichiers.
> Le « <600 px » du rapport est donc **empirique** → il faut trancher entre 640 et 768 (§6).

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

Largeurs issues de `.btn-ctl { min-width:38px; padding:0 9px }` (`styles.css:91-96`) et
`.btn-primary { min-width:52px }` (`styles.css:102`) — **`min-width` interdit au flex
de réduire davantage**, donc la rangée ne peut que déborder :

```
#btnPlay 52 + #btnStop #btnPrev #btnNext #btnMetronome #btnLoop   5×38 = 190
+ 6 gaps de 6 px (gap-1.5)                                            =  36
+ groupe ml-auto { #btnMixer 38 + gap 6 + #btnMore 38 }               =  82
= 360 px   +   px-3 (12+12)                                           = 384 px
```

| Viewport | Espace dispo (viewport − 24) | Débordement | `#btnMore` visible |
|---|---|---|---|
| 412 px | 388 | 0 | ✔ |
| 393 px | 369 | 0 | ✔ (9 px de marge) |
| **375 px** | 351 | **9 px** | 29/38 px |
| **360 px** | 336 | **24 px** | **9/38 px ← non cliquable** |
| **320 px** | 296 | **64 px** | **0 ← entièrement coupé** |

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

## 5. Plan de correction — **pas encore codé**

Ordre de priorité :

- [ ] **1. P1** — Conditionner la force-ouverture de `#advanced` à une **hauteur** :
      `@media (min-width: 768px) and (min-height: 560px)`.
      **Ne jamais masquer `#btnMore` tant que le panneau peut être replié.**
      → *débloque tout le paysage.*
- [ ] **2. P3** — Faire tenir la rangée de boutons à 320 px : réduire `min-width`,
      regrouper les commandes, ou basculer le groupe `ml-auto` sur une 3ᵉ ligne.
      Seuil empirique du symptôme : **≤ ~380 px**, pas 600.
- [ ] **3. P2** — Poser un **plancher** sur `#stage` (`min-height`),
      et exprimer le tiroir mobile en **fraction du stage** (`flex: 0 0 46 %`)
      au lieu de `46vh` → il ne pourra plus dépasser l'espace disponible.
- [ ] **4. P4** — `max-height` + `overflow-y: auto` sur `#advanced`.
- [ ] **5. P5** — Ajouter un **état réduit** du tiroir (et, en paysage court, du panneau
      réglages) → c'est la demande explicite « collapsable ».
- [ ] **6. P6** — **Unifier** CSS et JS sur un point de rupture de **hauteur** (`mqShort`) ;
      gérer explicitement la rotation (fermer `adv-open` en entrant en zone courte,
      rééquilibrer le tiroir) ; retirer le `return` prématuré de
      `applyResponsiveLayout()` (`app.js:1817`) sur `layoutTouched`.
- [ ] **7. H3** — Remplacer le `190px` de `#toastBox` par la hauteur réelle du transport
      (mesurée), ou ancrer les toasts au `#stage`.

### Contraintes à respecter lors de l'implémentation

1. **3 fichiers seulement** — `index.html`, `css/styles.css`, `js/app.js`. Aucun 4ᵉ fichier.
2. Le tiroir reste **« dans le flux »** (DAW) : jamais de recouvrement de la partition,
   pas de backdrop, fermeture **uniquement** par `✕` / `Échap`.
3. Les images `md:` de Tailwind et les `@media` de `styles.css` doivent rester **alignés** :
   c'est précisément ce qui a cassé (P1).
4. `node --check js/app.js` + contrôle U+FFFD (`[regex]::Matches($t,[char]0xFFFD).Count`)
   avant de considérer la modification comme terminée.

---

## 6. ⚠️ Décision à prendre avant de coder

**Quel seuil pour la zone « mobile » ?**

| Option | Avantage | Inconvénient |
|---|---|---|
| **640 px** (`sm`) | le plus proche du « <600 px » rapporté | c'est un seuil Tailwind **déjà utilisé** par `#advanced` (`grid-cols-2`) → risque d'un **4ᵉ** point de rupture |
| **768 px** (`md`) | celui **réellement en vigueur** (`mqDesktop`, `order`, `md:`, `!important`) | ne correspond pas au chiffre annoncé par le rapporteur |

**Recommandation** : partir de **768** comme seuil principal (c'est la réalité du code),
et ajouter une **condition de hauteur** à côté — pas un nouveau seuil de largeur.
Sinon on ouvre une troisième zone grise (600–768) qui reproduira exactement le bug d'origine.

---

## 7. Hors périmètre (rappel)

- La **correction du 404 sur `samples/`** est **déjà livrée** (scan HTTP + repli sur
  `CFG.sampleFiles`, index local de 14 fichiers) — voir la section équivalente dans `BUG.md`.
  Elle n'a **rien à voir** avec ce plan responsive.
- Les bugs **B1 / B2 / B3 (boucle A→B)** et la conservation de la boucle au clic simple
  sont également livrés, en attente de validation.
