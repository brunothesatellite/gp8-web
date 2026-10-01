# CRITICAL
* **CONFIRMED - RISKY** Problème dans la lecture de la piste audio, lorsqu'il y a un retour important.
ACDC (1979 - Highway to Hell) - Highway to Hell-ref.gp
à la fin de la mesure 17 vers 1:03, il y DS Al Coda qui renvoi à la mesure 6 (c'est normal, c'est le fonctionnement de la partition), mais cela fait sauter l'audio.
J'ai vérifié la piste audio mp3 incluse dans le .gp, elle n'a pas ce problème mais la même séquence audio est plutôt vers 1'10" dans le mp3 par contre, à vérifier si cette désynchronisation dans la webapp est normale (je suis bien à 100% de vitesse).
C'est donc lié au rendu audio pour la piste mp3 de l'application.
Je ne trouve ce problème que dans cette piste, pour l'instant je ne l'ai pas remarqué ailleurs. Analyse pour voir si c'est lié à ce fichier GP particulier ou si c'est un problème plus fondamental dans la lecture audio : problème de performance sur des gros fichiers, de taux d'échantillonnage du mp3 ou lié à la synchro du mp3 dans le GP d'origine.
Ne code rien, fait juste une analyse.


# MAJOR
* N/A

# MINOR
* N/A

# EVOLUTIONS
* **LOW - RISKY** ajouter un visuel pour la piste audio (forme d'onde)
* **HIGH - RISKY** Si le compte à rebour est activé et qu'une boucle est active, avoir une option permettant de jouer le compte à rebour à chaque boucle. Par défaut ce n'est joué qu'au démarrage (comme le comportement actuel). Cette option est grisée sur la boucle n'est pas activée : correction, simple, rapide et sans régression, ciblée.

# BACKLOG
* **DISABLED - RISKY** le défilement doux masque la mesure en cours de lecture en mode horizontal, parchemin ou page => option masquée pour l'instant