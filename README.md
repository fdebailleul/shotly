# Shotly — Capture & Annotation

Capturez n'importe quoi, annotez en quelques secondes.

Shotly est une extension Chrome (Manifest V3) de capture d'ecran et d'annotation, rapide et complete. Aucun compte requis, aucun cloud — vos captures restent sur votre machine.

**[Voir la landing page](https://fdebailleul.github.io/shotly/)** · **[Chrome Web Store](https://chrome.google.com/webstore)** *(en attente de validation)*

---

## Fonctionnalites

**Capture**
- Zone visible — onglet actif en un clic (`Alt+Shift+V`)
- Page entiere — scroll automatique et assemblage intelligent (`Alt+Shift+F`)
- Zone selectionnee — selection libre au pixel pres (`Alt+Shift+A`)
- Ecran & Fenetre — capturez n'importe quelle fenetre ou l'ecran complet
- Capture differee — minuterie 3, 5 ou 10 secondes
- Annoter image locale — ouvrez un fichier image dans l'editeur

**Annotation**
- Fleches, rectangles, cercles, lignes, dessin libre
- Texte avec fond optionnel et taille reglable
- Flou / pixelisation pour masquer des informations sensibles
- Surbrillance pour mettre en evidence
- Etapes numerotees (1, 2, 3...) pour tutoriels et rapports de bugs
- Selection, deplacement et redimensionnement des annotations
- Recadrage apres annotation

**OCR**
- Extraction de texte depuis une zone selectionnee (francais + anglais)
- Tesseract.js v5.1.1 integre, 100% cote client

**Partage & Export**
- Export PNG, JPG, PDF
- Copie directe dans le presse-papiers
- Partage rapide via Imgur (lien copie automatiquement)
- Nommage intelligent : titre de la page + date/heure

**Historique**
- Sauvegarde automatique de chaque capture (IndexedDB)
- Page historique avec grille de vignettes
- Selection multiple, suppression par lot
- Bouton "Derniere capture" dans le popup pour reouvrir en 1 clic

**UX**
- Zoom molette + badge pourcentage
- Raccourcis clavier complets (V, R, C, A, L, F, T, B, H, N, X, O)
- Design glassmorphism indigo coherent partout
- Bilingue francais / anglais
- Page d'onboarding au premier lancement

---

## Installation (developpement)

1. Clonez ce depot :
   ```bash
   git clone https://github.com/fdebailleul/shotly.git
   ```

2. Ouvrez Chrome et allez sur `chrome://extensions/`

3. Activez le **Mode developpeur** (toggle en haut a droite)

4. Cliquez **Charger l'extension non empaquetee** et selectionnez le dossier du projet

5. L'icone Shotly apparait dans la barre d'extensions — c'est pret !

---

## Architecture

```
shotly/
├── manifest.json          # Manifest V3
├── background.js          # Service worker — capture, stitch, routing
├── popup.html/css/js      # Interface popup principale
├── editor.html/css/js     # Editeur d'annotation canvas
├── history.html/css/js    # Page historique des captures
├── db.js                  # Module IndexedDB partage (captures)
├── content-capture.js     # Content script — selection de zone, countdown
├── screen-capture.html/js # Capture ecran/fenetre (getDisplayMedia)
├── offscreen.html/js      # Document offscreen pour stitch & blobs
├── onboarding.html/js     # Page de bienvenue (1er install)
├── privacy.html           # Politique de confidentialite
├── _locales/              # i18n (fr, en)
├── icons/                 # Icones 16, 48, 128px
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

- **Chrome Extension Manifest V3** — service worker, offscreen documents, CSP strict
- **Canvas 2D API** — annotation, zoom, resize, blur pixelise
- **IndexedDB** — historique des captures avec vignettes
- **Tesseract.js v5.1.1** — OCR cote client (WASM, `OffscreenCanvas` dans le worker)
- **jsPDF** — export PDF
- **Imgur API** — partage anonyme (Client-ID)

---

## Vie privee

Shotly est **100% hors ligne**. Aucune donnee n'est collectee, aucun serveur n'est contacte (sauf partage Imgur explicite et telechargement des donnees de langue OCR au premier usage). Vos captures ne quittent jamais votre ordinateur.

Voir [privacy.html](privacy.html) pour la politique complete.

---

## Licence

MIT — voir [LICENSE](LICENSE)
