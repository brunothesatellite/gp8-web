# CRITICAL
* Corriger le bug de fond identifié avec ACDC
* Blink 182 - All the Small thinks : les renvois multiples (1,2,3 puis 4) sont mal gérés : mesures 
6-7-8-9 => renvoi en 6 pour la première itération OK, puis 7-8 et 9 (KO) et 10 (KO) ! Selon la partition on devrait faire 6-7-8-9 6-7-8-9 6-7-8-9 6-7-8-10 (si tu as corrigé la première mesure vides dans un autre bug avec le traitement de isAnacrusis, ce sera plutôt avec les bonnes numérotations Guitar Pro 5-6-7-8 5-6-7-8 5-6-7-8 5-6-7-9)
* **FIXED (01/10/2026)** Problème dans la lecture de la piste audio, lorsqu'il y a un retour important.
ACDC (1979 - Highway to Hell) - Highway to Hell-ref.gp
à la fin de la mesure 17 vers 1:03, il y DS Al Coda qui renvoi à la mesure 6 (c'est normal, c'est le fonctionnement de la partition), mais cela fait sauter l'audio.
J'ai vérifié la piste audio mp3 incluse dans le .gp, elle n'a pas ce problème mais la même séquence audio est plutôt vers 1'10" dans le mp3 par contre, à vérifier si cette désynchronisation dans la webapp est normale (je suis bien à 100% de vitesse).
C'est donc lié au rendu audio pour la piste mp3 de l'application.
Je ne trouve ce problème que dans cette piste, pour l'instant je ne l'ai pas remarqué ailleurs. Analyse pour voir si c'est lié à ce fichier GP particulier ou si c'est un problème plus fondamental dans la lecture audio : problème de performance sur des gros fichiers, de taux d'échantillonnage du mp3 ou lié à la synchro du mp3 dans le GP d'origine.
Ne code rien, fait juste une analyse.
Helloween (1988 - Keeper of the Seven Keys - Part II) - Dr. Stein.gp : je lance la lecture mesure 16, j'ai un léger retour en arrière audio en mesure 18 et 19

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