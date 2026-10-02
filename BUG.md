# CRITICAL
* Renvois incorrects MP3 dans ACDC : toujours complétement faux : mesures 6-7-8-9-10 l'audio est faux alors que la séquence midi est correct : 6-8-7-9 6-7-8-9-10
* Renvois midi incorrects dans Renaud : le début doit être 1 2 3 4 1 2 3 5 1 2 3 6
* Régression tempo sur Blink-182 à vérifier ou alors artefacts sonores à investiguer

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