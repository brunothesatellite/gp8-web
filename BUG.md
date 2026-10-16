> **État (2026-10-16)** : aucun bug **CRITICAL / MAJOR / MINOR** ouvert. Les deux
> symptômes audio/mix consignés à l'origine (Dr. Stein « légers retours en
> arrière », AC/DC « l'audio saute ») ont été diagnostiqués dans **BUGMP3 §14**
> (RC-1/RC-2/RC-3) puis **corrigés** par le plan **BUGFIX-TOTAL.md** (P2/P3/P4) et
> vérifiés **automatiquement** (§11 : 8 harnais + test navigateur réel). Restent,
> hors code : la **validation d'écoute** (§7 de BUGFIX-TOTAL) et la validation
> **mobile** (Pixel 7a).

# CRITICAL
* N/A

# MAJOR
* N/A

# MINOR
* N/A

# EVOLUTIONS
* **LOW - RISKY** ajouter un visuel pour la piste audio (forme d'onde)
* **HIGH - RISKY** Si le compte à rebour est activé et qu'une boucle est active, avoir une option permettant de jouer le compte à rebour à chaque boucle. Par défaut ce n'est joué qu'au démarrage (comme le comportement actuel). Cette option est grisée sur la boucle n'est pas activée : correction, simple, rapide et sans régression, ciblée.
* **HIGH - NO RISK** Faire un README, un MANUAL, des tests de non régression automatique, des captures d'écran
* **HIGH - RISK** Proposer 2 langues : FR / EN


# BACKLOG
* **DISABLED - RISKY** le défilement doux masque la mesure en cours de lecture en mode horizontal, parchemin ou page => option masquée pour l'instant