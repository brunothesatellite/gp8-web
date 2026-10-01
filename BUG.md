# CRITICAL
* Le Iron Maiden Fear of The DArk avec son rythme variable est complètement faux niveau tempo, le début est bien trop rapide par rapport à guitar pro, ananlyse en profondeur comment gérer les rythmes variables de Guitar Pro dans la webapp.
* Corriger le bug de fond identifié avec ACDC
* je reformule j'ai fait une erreur en décrivant :j'ai aussi constaté ce bug énorme : Blink 182 - All the Small thinks : les renvois multiples (1,2,3 puis 4) sont mal gérés : 
observé : première fois mesures 6-7-8-9 OK => renvoi en 6 pour la secondes itération OK, puis 7-8 et 9 (KO) et 10 (KO) !
attendu :  Selon la partition on devrait faire 6-7-8-9 6-7-8-9 6-7-8-9 6-7-8-10


> **→ Corrigé (01/10/2026).** Analyse complète dans `BUGMP3.md`. Deux causes traitées
> dans `js/mix-sync.js` : **A** = écart de tempo permanent (`NUDGE ±10 %` saturé) et
> **B** = balayage des discontinuités (DS al Coda). Correctifs : dédoublonnage des
> `synthTime`, détection + re-ancrage des sauts (1 seek propre au lieu d'un balayage),
> rate piloté sur la pente locale. **Non-régression** : `tools/sync-audit.js`
> (glitchs 397 → 10 sur les 14 samples ; Dr. Stein 95 → 0, ACDC 15 → 3) +
> `tools/load-smoke.js` (OK). **Reste à vérifier manuellement** : Dr. Stein mes. 16-19
> et ACDC mesure 17 (~1:03) — le saut au DS al Coda doit être net, sans saccade.
> Limite connue (Phase 3) : sur ACDC/Renaud, la position audio du saut peut être
> légèrement décalée (occurrences `BarOccurrence` perdues côté alphaTab) — voir §11.
Ce qui reste : le bug « Phase 3 » (P3)
C'est bien celui identifié avec ACDC : le mauvais appariement des occurrences de mesures aux points de répétition (DS al Coda, D.C.). Deux couches :
1. Appariement (BarIndex, BarOccurrence) divergent — alphaTab et GP ne numérotent pas les occurrences de la même façon, et alphaTab perd des points de synchro dans la foulée :
- ACDC : 64/80 points (16 perdus, dont toute la zone post-retour)
- Renaud : 113/156 (43 perdus)
- Iron Maiden : 135/136 (1 perdu)
2. Nombre de répétitions divergent — alphaTab développe les répétitions moins de fois que l'enregistrement (ACDC : les mesures 5-8 tournent ~3× dans le mp3, ~1× côté MIDI). D'où le « saut » entre les mesures 8 et 9.
Ce que mon correctif (Phase 1) a déjà fait
Il rend le phénomène propre : plus de balayage saccadé, un seul seek net à la discontinuité. C'est le « ça fait sauter l'audio » qui a disparu. Mais le seek peut atterrir sur la mauvaise occurrence (la mesure 9 d'ACDC qui « n'est pas la bonne section »).
Ce que réglerait P3 (§9.6)
Reconstruire le mapping des occurrences depuis l'ordre chronologique des FrameOffset (qui, lui, est cohérent) au lieu de se fier à celui d'alphaTab. C'est un fix global (aucun morceau codé en dur), sûr pour les fichiers déjà corrects.
Limite honnête : §9.6 corrige l'atterrissage (couche 1). La couche 2 (alphaTab qui joue moins de répétitions que l'enregistrement) est un comportement d'alphaTab — si elle subsiste après §9.6, un saut résiduel restera et il faudra le remonter en amont.
À ne pas confondre
- La durée ~7 s (4:29 vs 4:36) n'est pas P3 : c'est l'approximation tempoScale constant vs le ModifiedTempo variable de GP — un point distinct et mineur.
- Les mesures vides/pickup : corrigé (hors P3).
Donc oui — il reste P3, prioritaire sur les morceaux à répétitions (ACDC, Renaud, Iron Maiden). Dites-moi quand vous voulez que je l'attaque.

# MAJOR
* **HIGH - LOW RISK** en mode paysage ou portrait sur android, garantir que l'on voit toutes les pistes dans le tiroir Melangeur de piste : supprimer le scrollbar sur la liste des pistes dans le tiroir au profit d'une tiroir Melange swipable verticalement dans son intégralité car parfois un voit à peine un bout de piste en mode horizontal.

# MINOR
* N/A

# EVOLUTIONS
* **LOW - RISKY** ajouter un visuel pour la piste audio (forme d'onde)
* **HIGH - RISKY** Si le compte à rebour est activé et qu'une boucle est active, avoir une option permettant de jouer le compte à rebour à chaque boucle. Par défaut ce n'est joué qu'au démarrage (comme le comportement actuel). Cette option est grisée sur la boucle n'est pas activée : correction, simple, rapide et sans régression, ciblée.
* **HIGH - NO RISK** Faire un README, un MANUAL, des tests de non régression automatique, des captures d'écran
* **HIGH - RISK** Proposer 2 langues : FR / EN


# BACKLOG
* **DISABLED - RISKY** le défilement doux masque la mesure en cours de lecture en mode horizontal, parchemin ou page => option masquée pour l'instant