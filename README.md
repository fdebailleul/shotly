# Shotly – Capture & Annotation

Capturez n'importe quoi, annotez en quelques secondes.

Shotly est une extension Chrome (Manifest V3) de capture d'écran et d'annotation, rapide et complète. Aucun compte requis, pas de cloud : vos captures restent sur votre machine.

**[Voir la landing page](https://fdebailleul.github.io/shotly/)** · **[Chrome Web Store](https://chrome.google.com/webstore)** *(en attente de validation)*

---

## Fonctionnalités

**Capture**
- Zone visible : onglet actif en un clic (`Alt+Shift+V`)
- Page entière : scroll automatique et assemblage intelligent (`Alt+Shift+F`)
- Zone sélectionnée : sélection libre au pixel près (`Alt+Shift+A`)
- Écran & Fenêtre : capturez n'importe quelle fenêtre ou l'écran complet
- Capture différée : minuterie 3, 5 ou 10 secondes
- Annoter image locale : ouvrez un fichier image dans l'éditeur

**Annotation**
- Flèches, rectangles, cercles, lignes, dessin libre
- Texte avec fond optionnel et taille réglable
- Flou / pixelisation pour masquer des informations sensibles
- Surbrillance pour mettre en évidence
- Étapes numérotées (1, 2, 3...) pour tutoriels et rapports de bugs
- Sélection, déplacement et redimensionnement des annotations
- Recadrage après annotation

**OCR**
- Extraction de texte depuis une zone sélectionnée (français + anglais)
- Tesseract.js v5.1.1 intégré, 100 % côté client

**Partage & Export**
- Export PNG, JPG, PDF
- Copie directe dans le presse-papiers
- Partage rapide via Imgur (lien copié automatiquement)
- Nommage intelligent : titre de la page + date/heure

**Historique**
- Sauvegarde automatique de chaque capture (IndexedDB)
- Page historique avec grille de vignettes
- Sélection multiple, suppression par lot
- Bouton « Dernière capture » dans le popup pour rouvrir en 1 clic

**UX**
- Zoom molette + badge pourcentage
- Raccourcis clavier complets (V, R, C, A, L, F, T, B, H, N, X, O)
- Design glassmorphism indigo cohérent partout
- Bilingue français / anglais
- Page d'onboarding au premier lancement

---

## Installation (développement)

1. Clonez ce dépôt :
   ```bash
   git clone https://github.com/fdebailleul/shotly.git
   ```

2. Ouvrez Chrome et allez sur `chrome://extensions/`

3. Activez le **Mode développeur** (toggle en haut à droite)

4. Cliquez **Charger l'extension non empaquetée** et sélectionnez le dossier du projet

5. L'icône Shotly apparaît dans la barre d'extensions – c'est prêt !

---

## Architecture

```
shotly/
├── manifest.json          # Manifest V3
├── background.js          # Service worker : capture, stitch, routing
├── popup.html/css/js      # Interface popup principale
├── editor.html/css/js     # Éditeur d'annotation canvas
├── history.html/css/js    # Page historique des captures
├── db.js                  # Module IndexedDB partagé (captures)
├── content-capture.js     # Content script : sélection de zone, countdown
├── screen-capture.html/js # Capture écran/fenêtre (getDisplayMedia)
├── offscreen.html/js      # Document offscreen pour stitch & blobs
├── onboarding.html/js     # Page de bienvenue (1er install)
├── privacy.html           # Politique de confidentialité
├── _locales/              # i18n (fr, en)
├── icons/                 # Icônes 16, 48, 128px
├── lib/                   # Librairies tierces
│   ├── jspdf.umd.min.js
│   ├── tesseract.min.js
│   ├── tesseract-worker.min.js
│   └── tesseract-core-simd-lstm.wasm.js
└── docs/                  # Landing page (GitHub Pages)
    └── index.html
```

---

## Stack technique

- **Chrome Extension Manifest V3** : service worker, offscreen documents, CSP strict
- **Canvas 2D API** : annotation, zoom, resize, blur pixelisé
- **IndexedDB** : historique des captures avec vignettes
- **Tesseract.js v5.1.1** : OCR côté client (WASM, `OffscreenCanvas` dans le worker)
- **jsPDF** : export PDF
- **Imgur API** : partage anonyme (Client-ID)

---

## Vie privée

Shotly est **100 % hors ligne**. Aucune donnée n'est collectée, aucun serveur n'est contacté (sauf partage Imgur explicite et téléchargement des données de langue OCR au premier usage). Vos captures ne quittent jamais votre ordinateur.

Voir [privacy.html](privacy.html) pour la politique complète.

---

## Licence

MIT – voir [LICENSE](LICENSE)
