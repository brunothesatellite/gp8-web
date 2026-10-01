# CRITICAL
* **BLOCKING** La lecture de la piste audio, même seule, se désynchronise, avec parfois des micro retours, des sauts, des défaormations.
* le défilement doux masque la mesure en cours de lecture, elle est trop à gauche de l'écran et on ne voit pas la barre verticale indiquant la lecture en cours
* Le mode mobile (<600px) n'est pas fonctionnel : paramétrage impossible en vertical l'interface est en bas et masquée, en horizontal les paramètres masquent totalement la piste et ne sont pas collapsable.
* Quand je change la vitesse alors qu'une boucle est sélectionné, la boucle est jouée mais le curseur revient en début de partition. Même problème quand je stoppe la lecture et reprend. Il y a une désynchro visuelle entre le curseur et la boucle réellement jouée. Ananlyse les autres cas où cela peut se produire.

# MAJOR
* N/A

# MINOR
* Dans la sélection de la vitesse, indiquer le BPM d'origine et adapté à la vitesse

# EVOLUTIONS
* ajouter un visuel pour la piste audio (forme d'onde)
* Ajouter une option pour avoir un délais au démarrage (4 temps), à côté du métronome.
