# CRITICAL
* Le Iron Maiden Fear of The Dark avec son rythme variable est complètement faux niveau tempo, le début est bien trop rapide par rapport à guitar pro, analyse en profondeur comment gérer les rythmes variables de Guitar Pro dans la webapp.
* Renvois incorrects MP3 dans ACDC à vérifier : toujours complétement faux : mesures 6-7-8-9-10 l'audio est faux alors que la séquence midi est correct : 6-8-7-9 6-7-8-9-10
* Renvois midi incorrects dans Renaud : le début doit être 1 2 3 4 1 2 3 5 1 2 3 6
Correction intégrale implémentée — l'horloge musicale remplace l'hypothèse « vitesse constante » pour tous les morceaux, sans branche spéciale. Récapitulatif :
Ce qui a changé
js/mix-sync.js — le cœur :
- Horloge musicale intégrée (advanceMusicalClock) : musMs += dt_réel × playbackSpeed, à la cadence des événements (~344/s). C'est désormais le seul axe du pont (targetSeconds, slopeAt, speedAt) — timePosition × speed est éliminé. Sur saut détecté (seek, stop, boucle, re-échelonnement vendor) → re-ancre musMs = réel × sp, exacte par construction puisque alphaTab maintient cette identité à ses frontières.
- Tempo par segment (style GP) : analyzeSegments stocke speed = 1/slope par segment ; applyTempo écrit playbackSpeed = userSpeed × speedAt(musMs) avec hystérésis 4 % + throttle 300 ms.
- Conséquence algébrique : rate_audio = sp × slope = userSpeed exactement → le MP3 est natif partout, uniforme ou variable.
js/player.js : applySpeed() délègue à MixSync.setUserSpeed() ; repli simple userSpeed sans points de synchro.
tools/sync-audit.js : miroir à jour (colonne « écrit.tempo », st.sp, intégration).
Validation (14 samples)
 	référence (avant)	maintenant
Totaux NEW (recadrages / retours / glitchs / burst)	43 / 8 / 18 / 2	43 / 8 / 18 / 2 — identiques
Dr. Stein	1 / 0 / 0	1 / 0 / 0
Iron Maiden	LEGACY 239 recadrages	6 (dont 2 sauts voulus) + intro à 0,645× et riffs à 1,75× au lieu du 1,171× plaqué
Bonus : la durée totale converge vers celle de l'enregistrement (chaque segment dure son Δa réel) — cela participe à l'écart 4:27 vs 4:36.
node --check, load-smoke (RESULTAT: OK) et l'audit complet passent. BUGMP3.md §13 est à jour : statut corrigé, mécanisme décrit, chiffres de validation.
À toi de tester en navigateur : Maiden (début = le vrai tempo GP, transitions aux frontières de segments, audio sans time-stretch), Dr. Stein (inchangé), puis molette de vitesse ×0,5/×2 pendant la lecture (le moteur doit composer vitesse utilisateur et tempo de segment).


# MAJOR
* N/A*

# MINOR
* N/A

# EVOLUTIONS
* **LOW - RISKY** ajouter un visuel pour la piste audio (forme d'onde)
* **HIGH - RISKY** Si le compte à rebour est activé et qu'une boucle est active, avoir une option permettant de jouer le compte à rebour à chaque boucle. Par défaut ce n'est joué qu'au démarrage (comme le comportement actuel). Cette option est grisée sur la boucle n'est pas activée : correction, simple, rapide et sans régression, ciblée.
* **HIGH - NO RISK** Faire un README, un MANUAL, des tests de non régression automatique, des captures d'écran
* **HIGH - RISK** Proposer 2 langues : FR / EN


# BACKLOG
* **DISABLED - RISKY** le défilement doux masque la mesure en cours de lecture en mode horizontal, parchemin ou page => option masquée pour l'instant