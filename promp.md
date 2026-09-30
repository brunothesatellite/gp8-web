Travaille dans D:\VS Code\gp8-web

Agis comme un développeur Frontend Expert spécialisé dans les applications musicales Web (Web Audio API, MIDI). 

Je souhaite créer une webapp responsive (PC et Smartphones Android) capable de lire des fichiers Guitar Pro (.gp, .gpx, .gp5) en utilisant la bibliothèque open-source AlphaTab. L'objectif est purement axé sur la lecture et l'entraînement, aucune fonction d'édition n'est requise.
Des exemples de fichiers gp avec audio embedded sont présents dans le dossier samples

Génère-moi un plan de développement ainsi qu'une maquette HTML/CSS/JS (Single Page Application) complète, propre et fonctionnelle qui intègre les éléments suivants :

1. ARCHITECTURE & UI RESPONSIVE (Mobile First) :
- Un design moderne et épuré (mode sombre de préférence pour le confort visuel des musiciens).
- Une zone de dépôt (Drag & Drop) ou un bouton d'import pour charger un fichier Guitar Pro local.
- Une barre de contrôle principale (Sticky / Fixée en bas sur mobile, en haut sur PC) comprenant : Bouton Play/Pause, Bouton Métronome (On/Off), Sliders de volume (un pour le MIDI, un pour l'Audio).
- Un sélecteur de piste/instrument (Dropdown ou liste latérale) pour choisir quelle piste afficher.
- La zone centrale d'affichage de la partition (gérée par AlphaTab) qui s'adapte à la largeur de l'écran (défilement horizontal ou vertical fluide).

2. FONCTIONNALITÉS TECHNIQUES ATTENDUES DANS LE CODE JS :
- Intégration d'AlphaTab (via CDN) pour le rendu visuel et la lecture MIDI.
- Gestion des contrôles de base : Lecture, pause, stop, activation du métronome natif d'AlphaTab.
- Gestion de la boucle (Loop) : Permettre la lecture en boucle d'une section sélectionnée sur la partition (en utilisant l'API d'AlphaTab).
- Structure pour l'audio synchronisé : Inclus une balise <audio> HTML5 invisible et prépare le code JavaScript (fonctions commentées ou placeholders) pour synchroniser le lecteur audio avec le lecteur AlphaTab (Player).
- Bonus structurel : Laisse une section commentée montrant comment on pourrait utiliser JSZip pour ouvrir le fichier .gp (qui est un zip) afin d'y extraire un potentiel fichier audio "embedded".

Livre-moi d'abord le plan de la structure des fichiers, puis le code complet combiné (ou séparé proprement HTML, CSS, JS) prêt à être testé dans un navigateur. Utilise Tailwind CSS (via CDN) pour le design si cela simplifie le responsive.
