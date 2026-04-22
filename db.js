// ── Shotly — IndexedDB Capture History ───────────────────────────
// Shared module: used by background.js, popup.js, history.js, editor.js
// Stores captures with thumbnails for fast browsing.

const ShotlyDB = (() => {
  const DB_NAME = 'shotly-history';
  const DB_VERSION = 1;
  const STORE = 'captures';
  const THUMB_W = 320; // thumbnail max width

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Are we in a service worker context (no DOM)?
  const isServiceWorker = typeof document === 'undefined';

  // Generate a small thumbnail dataURL from a full-size dataURL
  // In a service worker, uses OffscreenCanvas + createImageBitmap.
  // In a page context, uses Image + canvas.
  async function makeThumbnail(dataUrl) {
    try {
      if (isServiceWorker) {
        // Service worker: decode via fetch + createImageBitmap + OffscreenCanvas
        const resp = await fetch(dataUrl);
        const blob = await resp.blob();
        const bmp = await createImageBitmap(blob);
        const scale = Math.min(1, THUMB_W / bmp.width);
        const w = Math.round(bmp.width * scale);
        const h = Math.round(bmp.height * scale);
        const oc = new OffscreenCanvas(w, h);
        const ctx = oc.getContext('2d');
        ctx.drawImage(bmp, 0, 0, w, h);
        bmp.close();
        const outBlob = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
        return await blobToDataUrl(outBlob);
      } else {
        // Page context: use Image + canvas
        return await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const scale = Math.min(1, THUMB_W / img.width);
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL('image/jpeg', 0.7));
          };
          img.onerror = () => resolve(null);
          img.src = dataUrl;
        });
      }
    } catch (e) {
      console.warn('Thumbnail generation failed:', e);
      return null;
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  // Get image dimensions from dataUrl
  async function getImageDims(dataUrl) {
    try {
      if (isServiceWorker) {
        const resp = await fetch(dataUrl);
        const blob = await resp.blob();
        const bmp = await createImageBitmap(blob);
        const w = bmp.width, h = bmp.height;
        bmp.close();
        return { width: w, height: h };
      } else {
        return await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => resolve({ width: 0, height: 0 });
          img.src = dataUrl;
        });
      }
    } catch {
      return { width: 0, height: 0 };
    }
  }

  // Save a capture: { dataUrl, pageTitle?, timestamp? }
  // Returns the new record id
  async function save(dataUrl, pageTitle) {
    const db = await open();
    const [thumbnail, dims] = await Promise.all([
      makeThumbnail(dataUrl),
      getImageDims(dataUrl)
    ]);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const record = {
        dataUrl,
        thumbnail,
        pageTitle: pageTitle || '',
        timestamp: Date.now(),
        width: dims.width,
        height: dims.height
      };
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // List all captures (lightweight: thumbnail + metadata, NO full dataUrl)
  async function list() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const results = [];
      const req = store.openCursor(null, 'prev'); // newest first
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const { id, thumbnail, pageTitle, timestamp, width, height } = cursor.value;
          results.push({ id, thumbnail, pageTitle, timestamp, width, height });
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  // Get a single capture (full dataUrl included)
  async function get(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  // Get the most recent capture (full dataUrl)
  async function getLast() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.openCursor(null, 'prev');
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        resolve(cursor ? cursor.value : null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // Delete one or multiple captures by id
  async function remove(ids) {
    if (!Array.isArray(ids)) ids = [ids];
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      ids.forEach(id => store.delete(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Count total captures
  async function count() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Clear all history
  async function clearAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { save, list, get, getLast, remove, count, clearAll };
})();
