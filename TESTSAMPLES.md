# TESTSAMPLES — journal d'écoute des 15 échantillons

> **Rôle.** Journal d'**écoute** : une entrée par `.gp` de `samples/`, avec ce que
> dit la **mesure automatique** (déjà verte — **BUGFIX-TOTAL.md §11**) et une case
> à remplir **par l'oreille**.
>
> **Protocole** (BUGFIX-TOTAL §7) : serveur local
> `python -m http.server 8777 --bind 127.0.0.1` → `http://localhost:8777/`, mode
> **mix** (MIDI + MP3), vitesse **×1,0**. Pour chaque point : écouter la zone,
> noter *tempo* (le MIDI suit-il l'enregistrement ?) et *phase* (les deux flux
> restent-ils collés ?), puis confronter à la console `[mix-stats]`.
>
> **Contrôle transverse** (Iron Maiden M1, Dr. Stein M4, AC/DC M6, Offspring M14) :
> pendant la lecture, passer la vitesse ×0,5 puis ×1,5 — le moteur doit composer
> vitesse utilisateur × tempo pré-cuit **sans trou ni décalage**.
>
> **Statut 2026-10-16** : mesure automatique **verte** — 8 harnais Node
> (`node tools/test-all.js`) + test **navigateur réel** sur les **15/15** entrées
> du manifeste (`tools/browser/`) : **0** écriture de `playbackSpeed` en lecture,
> 0 erreur console, dérive de croisière 10-80 ms. **Aucune** case d'écoute
> ci-dessous n'est encore cochée pour le correctif **P2** : les notes datées sont
> **antérieures** à P2 (état du 2026-10-02), conservées **verbatim** comme repère —
> elles ne valident pas le correctif.

## Légende

- **§7** : point d'écoute de `BUGFIX-TOTAL.md`.
- **Mesure** : `points` = points de synchro du pont livré ; `résidu` = clés GPIF
  qu'aucun appariement ne couvre — **H2** = donnée GP, cette webapp n'y peut rien
  (`BUGFIX-TOTAL §11.7`).
- **Écoute** : `[ ]` à cocher → `OK` / `KO` + une ligne de note.

---

## 1. ACDC — Highway to Hell
- **§7** : **M6** (fin mes 17 ≈ 1:03 → mes 6, D.S. al Coda) · **M7** (mes 6-10).
- **Mesure** : 68 points · résidu **12 clés / 6 mesures H2** (mes 5-8 et 12-13 : GP
  enregistre 5 à 7 traversées là où le déroulé en joue 4-5).
- **Écoute M6** : [ ] un **seul** saut propre à 1:03 ; le MP3 est alors vers
  1:10-1:11 (**normal**, données GP).
- **Écoute M7** : [ ] le MIDI est correct ; l'audio « faux » est la **divergence
  GP** (H2) — vérifier qu'aucun **saut parasite** n'est ajouté.
- **Historique (2026-10-02)** : « renvoi sembgle correct !!!! / Audio ok ».

## 2. Blink 182 — All the Small Things
- **§7** : **M10** (mes 6-10 : `6-7-8-9` ×3 puis `6-7-8-10`).
- **Mesure** : 147 points · résidu **0**.
- **Écoute** : [ ] 4 passages, fin 10 au bon endroit.
- **Historique** : « ça semble OK ».

## 3. Europe — The Final Countdown  *(témoin)*
- **§7** : **M15** (aucune régression attendue).
- **Mesure** : 58 points · résidu **0**.
- **Écoute** : [ ] strictement identique à avant le correctif.
- **Historique** : *(non écouté)*.

## 4. F-Zero X — Goal BGM  *(témoin)*
- **§7** : **M15**.
- **Mesure** : 14 points · résidu **0** · morceau **court** (~15 s : il se termine
  pendant la fenêtre du test navigateur).
- **Écoute** : [ ] identique à avant.
- **Historique** : « OK ».

## 5. Helloween — Dr. Stein
- **§7** : **M4** (mes 16-19 : historique « légers retours en arrière ») · **M5**
  (tout : 1 seule frontière de tempo, 23 coupures avant).
- **Mesure** : 112 points · résidu **0** · anacrouse : la mesure **0** est **VIDE**
  dans le `.gp` ; sa durée ne vient que de l'audio — une mesure pleine, 1 599 ms
  (§11.8).
- **Écoute M4** : [ ] **plus aucun retour** ; tempo constant ≈ 1,22×.
- **Écoute M5** : [ ] 0 coupure de synthé.
- **Historique** : « Qualité mp3 ok et vitesse ok ».

## 6. Igorrr — Blastbeat Falafel  *(témoin)*
- **§7** : **M15**.
- **Mesure** : 4 points · résidu **0**.
- **Écoute** : [ ] identique.
- **Historique** : *(non écouté)*.

## 7. Igorrr — Headbutt  *(témoin)*
- **§7** : **M15**.
- **Mesure** : 18 points · résidu **0**.
- **Écoute** : [ ] identique.
- **Historique** : *(non écouté)*.

## 8. Iron Maiden — Fear of the Dark
- **§7** : **M1** (intro 0:00-0:30 ≈ mes 1-16, tempo ≈ 0,65×) · **M2** (riffs
  2:01-4:11, tempo ≈ 1,72-1,79×) · **M3** (mes 98, pente 0,524 la plus sombre).
- **Mesure** : 137 points · résidu **0**.
- **Écoute M1** : [ ] intro lente, **sans à-coups**, MIDI collé au MP3.
- **Écoute M2** : [ ] pas de « début trop rapide » ; transitions de tempo sans trou.
- **Écoute M3** : [ ] pas de saut, pas de flottement.
- **Contrôle transverse** : [ ] ×0,5 puis ×1,5 sans trou.
- **Historique** : « PAs si mal, l'audio sur la séquence "3" qui ralentit est mieux ».

## 9. Led Zeppelin — Immigrant Song  *(témoin)*
- **§7** : **M15**.
- **Mesure** : 64 points · résidu **0**.
- **Écoute** : [ ] identique.
- **Historique** : *(non écouté)*.

## 10. Metallica — The Four Horsemen  *(témoin)*
- **§7** : **M15**.
- **Mesure** : 240 points · résidu **0**.
  *(Ajouté le 2026-10-16 : il manquait à `samples/list.json`, d'où le passage de
  **14 à 15** entrées du manifeste — `gen-samples.bat`.)*
- **Écoute** : [ ] identique.
- **Historique** : *(non écouté)*.

## 11. Metallica — For Whom the Bell Tolls  *(témoin)*
- **§7** : **M15**.
- **Mesure** : 141 points · résidu **0**.
- **Écoute** : [ ] identique.
- **Historique** : « OK au moins jusqu'au chant, à vérifier en entier ».

## 12. Renaud — Morgane de toi
- **§7** : **M8** (début, mes 1-6 : `1 2 3 4 · 1 2 3 5 · 1 2 3 6`) · **M9**
  (mes 15-21 : volta à 4 fins).
- **Mesure** : 100 points · résidu **55 clés** — **33 mesures H2** + **4 mesures H1**
  (mes 8/9/11/42) **détectées puis refusées** par la garde : les couvrir ferait
  passer `jumps` de **7 à 13**.
- **Écoute M8** : [ ] l'enregistrement joue la mes 5 **6 fois**, le déroulé **3** →
  vérifier qu'aucun **saut parasite** n'est ajouté (divergence = donnée GP).
- **Écoute M9** : [ ] les 4 fins jouées dans l'ordre ; ancrage passe 2 / passe 3
  inchangé.
- **Historique** : « Renvois et MP3 ok ».

## 13. Sepultura — Amen  *(témoin)*
- **§7** : **M15** — seul fichier à **100 %** de couverture des sync-points.
- **Mesure** : 168 points · résidu **0**.
- **Écoute** : [ ] identique.
- **Historique** : *(non écouté)*.

## 14. Slayer — Hell Awaits
- **§7** : **M11** (≈ 1:00 ; le MP3 démarre à 1:04,7) · **M12** (mes 44, 53, 117 :
  répétitions, 4 passages).
- **Mesure** : 149 points · résidu **0** · les 4 segments de pont à pente extrême
  (0,50-0,69×) de BUGMP3 §14.1 ont **disparu**.
- **Écoute M11** : [ ] 0 saccade ; démarrage audio calé à 1:04,7.
- **Écoute M12** : [ ] tous les passages présents.
- **Historique** : *(non écouté)*.

## 15. The Offspring — Self Esteem
- **§7** : **M13** (≈ 0:51 : saut historique de 6,9 s) · **M14** (tout : 137
  coupures avant).
- **Mesure** : 251 points · résidu **5 clés / 2 mesures H2** (mes 18-19).
- **Écoute M13** : [ ] plus de saut parasite.
- **Écoute M14** : [ ] 0 coupure.
- **Contrôle transverse** : [ ] ×0,5 puis ×1,5 sans trou.
- **Historique** : *(non écouté)*.

---

## Synthèse (à remplir)

- [ ] **M15 — témoins** (Europe, F-Zero X, Led Zeppelin, Sepultura, Metallica ×2,
  Igorrr ×2) : strictement identiques à avant le correctif.
- [ ] **Contrôle transverse** ×0,5 / ×1,5 : Iron Maiden, Dr. Stein, AC/DC,
  Offspring.
- [ ] **Validation mobile** (Pixel 7a) — hors harnais (BUGLATEST **T7**).

Journal rempli le : ...... / ...... / ..........  — par : ................
