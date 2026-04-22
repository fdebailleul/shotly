# Memory — Extension Chrome "Shotly"

## Projet
Extension Chrome (Manifest V3) "Shotly" de capture d'ecran et annotation, bilingue FR/EN avec detection automatique.

## Structure des fichiers
```
captur-ecran-extension/
├── manifest.json              # MV3, permissions: activeTab, scripting, storage, clipboardWrite, offscreen, unlimitedStorage
├── background.js              # Service worker — gestion des captures, messages, ouverture editeur
├── offscreen.html / .js       # Document offscreen pour stitching (page entiere), reasons: DISPLAY_MEDIA, USER_MEDIA, BLOBS
├── popup.html / .css / .js    # Popup du bouton extension — menu des modes de capture
├── screen-capture.html / .js  # Onglet dedie pour capture ecran/fenetre/onglet via getDisplayMedia (persiste contrairement au popup)
├── content-capture.js         # Content script injectable — overlay de selection de zone
├── editor.html / .css / .js   # Editeur d'annotations canvas complet (layout sidebar + canvas)
├── lib/jspdf.umd.min.js       # jsPDF v2.5.1 pour export PDF
├── icons/icon{16,48,128}.png  # Icones generees via Pillow (fond blanc, viewfinder bleu #4a8bf5)
├── onboarding.html            # Page d'accueil au premier install
├── privacy.html               # Politique de confidentialite
├── store-description.txt      # Description marketing Chrome Web Store (FR+EN)
├── _locales/fr/messages.json  # 51 cles de traduction francais
├── _locales/en/messages.json  # 51 cles de traduction anglais
├── INSTALL.md                 # Guide d'installation
└── memory-captur.md           # Ce fichier
```

## Design
Theme clair inspire de Awesome Screenshot :
- **Popup** : fond blanc, grille 3 colonnes en haut (Zone visible, Page entiere, Zone selectionnee), liste en dessous (differee, ecran & fenetre, image locale). Accent bleu `#4a8bf5`, bordures fines `#e5e7eb`.
- **Editeur** : layout topbar (brand "Shotly" + undo/redo + export) + sidebar gauche (200px) + zone canvas. Sidebar contient grille d'outils 2 colonnes avec labels, palette de 8 couleurs preset, sliders. Boutons export en topbar droite.
- **Selection de zone** : overlay leger `rgba(0,0,0,0.25)`, hint en carte blanche flottante avec icone + badge ESC, guides crosshair bleus, selection a bordure bleue avec 4 poignees blanches, badge dimensions centre.
- **Countdown** : carte blanche arrondie avec anneau SVG bleu sur piste grise, chiffre noir au centre, label gris.
- **Icones** : fond blanc arrondi, viewfinder bleu `#4a8bf5` avec point central et crosshair (genere via Pillow).

## Fonctionnalites implementees

### Modes de capture
- **Zone visible** — `captureVisibleTab` (raccourci Alt+Shift+V)
- **Page entiere** — scroll & stitch via offscreen document (Alt+Shift+F)
- **Zone selectionnee** — overlay content script avec selection rectangle (Alt+Shift+A)
- **Ecran & Fenetre** — `getDisplayMedia()` dans un onglet dedie (`screen-capture.html`). Le popup ouvre l'onglet, le picker Chrome s'affiche automatiquement (3 onglets : Onglet Chrome, Fenetre, Tout l'ecran). Apres selection, l'onglet d'origine redevient actif, un countdown de 5s invite l'utilisateur a cliquer "Masquer" sur la barre de partage Chrome, puis le frame est capture via `ImageCapture.grabFrame()`.
- **Capture differee** — countdown 3/5/10s dans le content script, signal `delay-done` au background
- **Ouvrir image locale** — file input dans le popup
- **Coller image** — paste event dans l'editeur

### Editeur d'annotations (canvas)
- Outils : select, rectangle, cercle, fleche, ligne, dessin libre, texte, flou (pixelisation), surbrillance, etapes numerotees, recadrage
- Raccourcis clavier : V R C A L F T B H N X, Ctrl+Z/Y, Delete
- **Rectangle selectionne par defaut** a l'ouverture (pas Select)
- Selection et deplacement d'annotations existantes
- **Modification apres creation** : selectionner une annotation avec Select charge ses proprietes dans la sidebar ; changer couleur/epaisseur/taille met a jour l'annotation en temps reel
- **Double-clic sur un texte** : rouvre le textarea pre-rempli pour re-editer contenu, couleur, taille, fond
- Palette de 8 couleurs preset + color picker
- Undo/redo illimite
- Export PNG, JPG, PDF (jsPDF), copie presse-papiers
- Nommage intelligent : `shotly-{titre-page}-{date}-{heure}.{ext}`
- Zoom molette sur le canvas (min 25%, max 500% de la taille initiale), badge zoom dans la topbar, double-clic fond pour reinitialiser
- Poignees de redimensionnement sur les annotations rect, circle, blur, highlight quand selectionnees
- Toast notifications avec icone checkmark/erreur apres chaque action (copie, sauvegarde, recadrage)
- Raccourcis clavier visibles dans le popup (badges Alt+Shift+V/F/A)
- Page d'onboarding au premier install
- Politique de confidentialite integree
- Taille de texte par defaut : 36px (slider max 96px)

## Bugs corriges (historique)

### 1. Zone selectionnee ne fonctionnait pas
**Cause** : `cropImage()` creait le document offscreen et envoyait immediatement `offscreen-crop` via `sendMessage`. Le JS de l'offscreen n'avait pas charge son listener — message perdu, Promise jamais resolue.
**Fix** : Elimine la dependance a l'offscreen pour le recadrage. Le background stocke l'image complete + `cropInfo` (rect, dpr) dans `chrome.storage.local`. L'editeur recadre lui-meme au chargement via `loadAndCropImage()`.

### 2. Meme race condition pour le stitching et desktop capture
**Fix** : Ajout d'un mecanisme "ready handshake" — l'offscreen envoie `offscreen-ready` au chargement, `ensureOffscreen()` dans le background attend ce signal avant d'envoyer des commandes.

### 3. Capture differee ne se declenchait pas
**Cause** : `await sleep(seconds * 1000)` dans le service worker. En MV3, Chrome suspend le worker pendant le setTimeout.
**Fix** : Le countdown tourne entierement dans le content script. Quand il atteint zero, le content script envoie `delay-done` au background qui capture instantanement.

### 4. Capture differee — overlay visible dans la capture
**Cause** : `overlay.remove()` et `sendMessage('delay-done')` dans le meme tick — le navigateur n'avait pas repeint.
**Fix** : Double `requestAnimationFrame` avant d'envoyer `delay-done` — attend que le repaint sans overlay soit effectif.

### 5. Outil texte ne fonctionnait pas (focus vole)
**Cause** : Le `mousedown` sur le canvas volait le focus au textarea avant qu'il puisse etre utilise.
**Fix** : `preventDefault/stopPropagation` sur l'evenement mousedown du canvas pour le texte, et `requestAnimationFrame(() => textInput.focus())` pour differer le focus.

### 6. Fleche — artefact visuel a la pointe
**Cause** : La ligne allait jusqu'a `(x2, y2)` et le triangle de la pointe commencait aussi a `(x2, y2)`. Le trait traversait le triangle.
**Fix** : La ligne s'arrete maintenant a la base de la pointe (`baseX/baseY = x2 - headLen * cos/sin(angle)`), seul le triangle rempli depasse.

### 7. Redesign complet — passage au theme clair
**Changement** : Theme sombre violet remplace par theme clair blanc/bleu, inspire de Awesome Screenshot.
- Popup : grille 3 colonnes + liste, fond blanc, accent `#4a8bf5`
- Editeur : layout sidebar gauche + topbar + canvas central, grille outils 2 colonnes, palette couleurs, damier gris en fond canvas
- Selection de zone : overlay leger, hint carte blanche, guides crosshair, poignees aux coins
- Countdown : carte blanche avec anneau SVG au lieu de plein ecran sombre
- Select restaure (nom original, icone curseur), rectangle comme outil par defaut

### 8. Texte disparaissait en cliquant ailleurs
**Cause** : En cliquant sur le canvas avec l'outil texte actif, `mousedown` se declenchait AVANT `blur` sur le textarea. `showTextInput` vidait le textarea (`value = ''`), puis `blur` tentait de commiter une valeur vide — rien n'etait sauvegarde.
**Fix** : `onMouseDown` appelle maintenant `commitText()` explicitement avant d'ouvrir un nouveau champ. Le `blur` est protege par un guard `_textCommitting` et un delai de 50ms pour eviter les doubles commits. Ajout de `cancelTextInput()` pour ESC.

### 9. Texte trop petit par defaut et non modifiable apres creation
**Fix taille** : Default passe de 24px a 36px, slider max etendu a 96px.
**Fix modification** : Trois mecanismes ajoutes :
- Double-clic sur un texte → rouvre textarea pre-rempli, charge les props dans la sidebar
- Selection avec Select → charge les proprietes de l'annotation dans la sidebar (couleur, epaisseur, taille)
- Changement de propriete dans la sidebar → met a jour l'annotation selectionnee en temps reel via `updateSelectedAnnotation()`
- Annotation masquee (`_hidden`) pendant l'edition pour eviter le doublon visuel

### 10. Capture ecran/fenetre — evolution complete du flux
**Probleme initial** : `chrome.desktopCapture.chooseDesktopMedia` + `getUserMedia` dans un offscreen echouait (`AbortError: Error starting tab capture`) car le streamId est lie au contexte du tab, pas a l'offscreen. De plus `CANVAS_DRAWING` n'est pas une valeur valide pour offscreen reasons.
**Tentative popup** : `getDisplayMedia()` dans le popup fonctionnait pour fenetre/onglet mais pas pour ecran entier — Chrome ferme le popup quand le partage d'ecran s'active (perte de focus).
**Solution finale** : Onglet dedie `screen-capture.html` ouvert par le popup. Le picker Chrome se lance automatiquement au chargement (3 onglets : Chrome, Fenetre, Ecran). Apres selection :
1. L'onglet d'origine redevient actif (via `chrome.tabs.update` avec l'ID passe en URL param)
2. Un countdown de 5s est injecte dans la page d'origine invitant a cliquer "Masquer" sur la barre de partage Chrome
3. Frame capture via `ImageCapture.grabFrame()` (fallback video element)
4. Stocke dans `chrome.storage.local`, editeur ouvert, onglet de capture ferme

### 11. Double-clic necessaire sur les boutons du popup
**Cause** : `window.close()` appele immediatement apres `chrome.runtime.sendMessage()` sans attendre la reponse. En MV3, le service worker peut etre endormi — le premier clic le reveille mais le popup se ferme avant que le message soit delivre.
**Fix** : Fonction `sendAndClose()` qui attend le callback de `sendMessage` (= confirmation que le background a recu) avant d'appeler `window.close()`.

### 12. Renommage "Captur Ecran" → "Shotly"
Nom plus evocateur et moderne. Mis a jour dans : manifest (i18n), popup, editeur (titre + topbar brand), les deux fichiers de traduction.

### 13. Icones mises en conformite avec le design
Ancien design : fond sombre/violet avec viewfinder. Nouveau : fond blanc arrondi, viewfinder bleu `#4a8bf5` avec point central et crosshair, genere via Pillow en 3 tailles (16, 48, 128px).

## Points d'attention MV3
- **Service worker** : ne jamais utiliser `setTimeout` pour des delais longs — le worker peut etre suspendu. Deleguer au content script ou utiliser `chrome.alarms`.
- **Offscreen document** : toujours attendre un signal `ready` avant d'envoyer des messages. Declarer toutes les `reasons` necessaires (valeurs valides : `DISPLAY_MEDIA`, `USER_MEDIA`, `BLOBS`, etc. — `CANVAS_DRAWING` n'est PAS valide). Utiliser `hasDocument()` pour verifier l'existence. Placer le listener AVANT `createDocument()` pour eviter les race conditions. Proteger tous les `sendMessage` avec `.catch()`.
- **sendMessage en MV3** : `chrome.runtime.sendMessage()` echoue avec "Receiving end does not exist" si aucun contexte d'extension n'ecoute. Toujours envelopper dans un try/catch ou `.catch()`. Ne jamais appeler `window.close()` avant d'avoir recu la reponse du `sendMessage`.
- **getDisplayMedia dans un popup** : fonctionne pour fenetre/onglet mais PAS pour ecran entier — Chrome ferme le popup quand le partage d'ecran s'active. Utiliser un onglet dedie a la place.
- **Barre de partage Chrome** : sur macOS, la barre "Votre ecran est partage..." ne se masque pas automatiquement. L'utilisateur doit cliquer "Masquer" manuellement. Prevoir un countdown suffisant (5s) et un message explicite.
- **Repaint DOM** : apres un `element.remove()`, utiliser double `requestAnimationFrame` avant de capturer pour s'assurer que le rendu est a jour.
- **Focus dans mousedown** : `focus()` appele pendant un handler mousedown d'un autre element est ecrase — differer avec `requestAnimationFrame`.
- **Ordre blur/mousedown** : dans le navigateur, `mousedown` sur un nouvel element se declenche AVANT `blur` sur l'ancien. Toujours commiter explicitement avant de modifier l'etat du champ.
