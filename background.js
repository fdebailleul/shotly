// ── Background Service Worker ──────────────────────────────────────
// Handles capture commands, full-page scroll-stitch, desktop capture,
// delayed capture, and opens the editor tab with the resulting image.

importScripts('db.js');
const MSG = chrome.i18n.getMessage.bind(chrome.i18n);

// ── Onboarding on first install ───────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});

// ── Keyboard shortcuts ────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  switch (command) {
    case 'capture-visible': captureVisible(tab); break;
    case 'capture-full':    captureFullPage(tab); break;
    case 'capture-area':    captureArea(tab); break;
  }
});

// ── Messages from popup / content scripts ─────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.action) {
        case 'capture-visible': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          await captureVisible(tab);
          break;
        }
        case 'capture-full': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          await captureFullPage(tab);
          break;
        }
        case 'capture-area': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          await captureArea(tab);
          break;
        }
        case 'capture-desktop': {
          // Legacy: now handled directly in the popup via getDisplayMedia
          // Kept for keyboard shortcut compatibility if needed
          break;
        }
        case 'capture-delay': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          await captureWithDelay(tab, msg.delay || 3);
          break;
        }
        case 'open-editor': {
          openEditor(msg.dataUrl);
          break;
        }
        case 'open-editor-tab': {
          // Image already stored by offscreen — just open editor
          chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
          break;
        }
        case 'delay-done': {
          // Content script countdown finished — capture now
          const delayTab = sender.tab;
          await captureVisible(delayTab);
          break;
        }
        case 'area-selected': {
          // Content script finished area selection
          const rect = msg.rect;
          const tab = sender.tab;
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
          // Pass full image + crop info to editor (avoids offscreen race condition)
          openEditorWithCrop(dataUrl, rect, msg.devicePixelRatio || 1, tab.title);
          break;
        }
        case 'reopen-capture': {
          // Reopen a capture from history by id
          const capture = await ShotlyDB.get(msg.id);
          if (capture) {
            chrome.storage.local.set({
              capturedImage: capture.dataUrl,
              pageTitle: capture.pageTitle || ''
            }, () => {
              chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
            });
          }
          break;
        }
        case 'reopen-last': {
          const last = await ShotlyDB.getLast();
          if (last) {
            chrome.storage.local.set({
              capturedImage: last.dataUrl,
              pageTitle: last.pageTitle || ''
            }, () => {
              chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
            });
          }
          break;
        }
        case 'full-page-part': {
          sendResponse({ ok: true });
          return;
        }
      }
      sendResponse({ ok: true });
    } catch (e) {
      console.error('Background error:', e);
      sendResponse({ error: e.message });
    }
  })();
  return true; // async
});

// ── Capture visible tab ───────────────────────────────────────────
async function captureVisible(tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  openEditor(dataUrl, tab.title);
}

// ── Capture full page (scroll & stitch) ───────────────────────────
async function captureFullPage(tab) {
  // Inject helper to get page dimensions and scroll
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      originalScrollX: window.scrollX,
      originalScrollY: window.scrollY
    })
  });
  const dims = result.result;
  const { scrollWidth, scrollHeight, viewportWidth, viewportHeight, devicePixelRatio } = dims;

  const parts = [];
  const cols = Math.ceil(scrollWidth / viewportWidth);
  const rows = Math.ceil(scrollHeight / viewportHeight);

  // Hide scrollbars during capture
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      document.documentElement.style.setProperty('overflow', 'hidden', 'important');
    }
  });

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // For the last row/col, clamp scroll so we capture exactly
      // the remaining strip instead of overlapping with previous tiles
      const x = (col === cols - 1) ? Math.max(0, scrollWidth - viewportWidth) : col * viewportWidth;
      const y = (row === rows - 1) ? Math.max(0, scrollHeight - viewportHeight) : row * viewportHeight;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (sx, sy) => window.scrollTo(sx, sy),
        args: [x, y]
      });
      // Wait for paint + respect MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND (2/s)
      await sleep(600);
      const dataUrl = await captureWithRetry(tab.windowId, 3);
      parts.push({ dataUrl, x, y, col, row });
    }
  }

  // Restore scroll & overflow
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (ox, oy) => {
      document.documentElement.style.removeProperty('overflow');
      window.scrollTo(ox, oy);
    },
    args: [dims.originalScrollX, dims.originalScrollY]
  });

  // Stitch via offscreen document
  const stitched = await stitchImages(parts, scrollWidth, scrollHeight, viewportWidth, viewportHeight, devicePixelRatio);
  openEditor(stitched, tab.title);
}

// ── Area selection ────────────────────────────────────────────────
async function captureArea(tab) {
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content-capture.js']
  });
  // content-capture.js will send 'area-selected' back
}

// ── Desktop / Window capture ──────────────────────────────────────
async function captureDesktop() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // desktopCapture needs a tab
  chrome.desktopCapture.chooseDesktopMedia(
    ['screen', 'window'],
    tab,
    (streamId) => {
      if (!streamId) return;
      // We need an offscreen document to get the stream
      handleDesktopStream(streamId);
    }
  );
}

async function handleDesktopStream(streamId) {
  await ensureOffscreen();
  try {
    await chrome.runtime.sendMessage({ action: 'offscreen-capture', streamId });
  } catch (e) {
    // Offscreen document may have been closed — recreate and retry
    console.warn('Offscreen not reachable, recreating…', e);
    await chrome.offscreen.closeDocument().catch(() => {});
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ action: 'offscreen-capture', streamId });
  }
}

// ── Delayed capture ───────────────────────────────────────────────
// The countdown runs entirely in the content script to avoid
// the service worker being suspended during sleep().
// When done, the content script sends 'delay-done' and the
// background captures the visible tab.
async function captureWithDelay(tab, seconds) {
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (secs) => {
      const BLUE = '#6366f1';

      // Remove any existing overlay
      const existing = document.getElementById('__captur_delay_overlay__');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = '__captur_delay_overlay__';
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(0,0,0,0.25);
        display: flex; align-items: center; justify-content: center;
        pointer-events: none;
      `;

      // Central card
      const card = document.createElement('div');
      card.style.cssText = `
        background: #fff; border-radius: 20px;
        padding: 32px 40px;
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04);
        position: relative;
      `;

      // Circular progress ring
      const size = 120;
      const r = 50;
      const circ = 2 * Math.PI * r;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', size);
      svg.setAttribute('height', size);
      svg.style.cssText = 'display: block;';

      // Background track
      const trackCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      trackCircle.setAttribute('cx', size / 2);
      trackCircle.setAttribute('cy', size / 2);
      trackCircle.setAttribute('r', r);
      trackCircle.setAttribute('fill', 'none');
      trackCircle.setAttribute('stroke', '#e5e7eb');
      trackCircle.setAttribute('stroke-width', '4');
      svg.appendChild(trackCircle);

      // Progress circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', size / 2);
      circle.setAttribute('cy', size / 2);
      circle.setAttribute('r', r);
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', BLUE);
      circle.setAttribute('stroke-width', '4');
      circle.setAttribute('stroke-linecap', 'round');
      circle.setAttribute('stroke-dasharray', circ);
      circle.setAttribute('stroke-dashoffset', '0');
      circle.style.cssText = 'transition: stroke-dashoffset 1s linear; transform: rotate(-90deg); transform-origin: center;';
      svg.appendChild(circle);

      // Counter text inside the SVG
      const counterText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      counterText.setAttribute('x', size / 2);
      counterText.setAttribute('y', size / 2 + 14);
      counterText.setAttribute('text-anchor', 'middle');
      counterText.setAttribute('fill', '#1a1a1a');
      counterText.style.cssText = 'font: 700 40px -apple-system, BlinkMacSystemFont, system-ui, sans-serif;';
      counterText.textContent = secs;
      svg.appendChild(counterText);

      card.appendChild(svg);

      const label = document.createElement('div');
      label.style.cssText = `
        font: 500 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #6b7280;
      `;
      label.textContent = 'Capture\u2026';
      card.appendChild(label);

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      let remaining = secs;

      const iv = setInterval(() => {
        remaining--;
        const progress = (secs - remaining) / secs;
        circle.setAttribute('stroke-dashoffset', (circ * progress).toString());

        if (remaining <= 0) {
          clearInterval(iv);
          overlay.remove();
          // Wait for the browser to repaint WITHOUT the overlay
          // before signaling the background to capture
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              chrome.runtime.sendMessage({ action: 'delay-done' });
            });
          });
        } else {
          counterText.textContent = remaining;
        }
      }, 1000);
    },
    args: [seconds]
  });
  // Don't sleep here — the content script will signal us via 'delay-done'
}

// ── Open editor with crop data (editor handles cropping) ─────────
function openEditorWithCrop(dataUrl, rect, dpr, pageTitle) {
  // Note: save full image to history; the editor will crop on load
  ShotlyDB.save(dataUrl, pageTitle).catch(e => console.warn('History save error:', e));

  chrome.storage.local.set({
    capturedImage: dataUrl,
    cropInfo: { rect, dpr },
    pageTitle: pageTitle || ''
  }, () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
  });
}

// ── Ensure offscreen document is ready ─────────────────────────────
async function ensureOffscreen() {
  // Check if offscreen document already exists (Chrome 116+)
  if (await chrome.offscreen.hasDocument()) return;

  // Set up the ready listener BEFORE creating the document
  // to avoid missing the signal if the script loads fast
  const readyPromise = new Promise((resolve) => {
    const handler = (msg) => {
      if (msg.action === 'offscreen-ready') {
        chrome.runtime.onMessage.removeListener(handler);
        resolve();
      }
    };
    chrome.runtime.onMessage.addListener(handler);
  });

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DISPLAY_MEDIA', 'USER_MEDIA', 'BLOBS'],
    justification: 'Image stitching, desktop capture, and blob handling'
  });

  await readyPromise;
}

// ── Image stitching ───────────────────────────────────────────────
async function stitchImages(parts, totalW, totalH, vpW, vpH, dpr) {
  await ensureOffscreen();

  return new Promise((resolve) => {
    const handler = (msg) => {
      if (msg.action === 'stitched-result') {
        chrome.runtime.onMessage.removeListener(handler);
        resolve(msg.dataUrl);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    chrome.runtime.sendMessage({
      action: 'offscreen-stitch',
      parts,
      totalW,
      totalH,
      vpW,
      vpH,
      dpr
    });
  });
}

// ── Open editor ───────────────────────────────────────────────────
async function openEditor(dataUrl, pageTitle) {
  // Save to history (non-blocking — don't delay editor open)
  ShotlyDB.save(dataUrl, pageTitle).catch(e => console.warn('History save error:', e));

  // Store image data and open editor
  chrome.storage.local.set({ capturedImage: dataUrl, pageTitle: pageTitle || '' }, () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
  });
}

// ── Helpers ───────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function captureWithRetry(windowId, maxRetries) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (e) {
      if (attempt >= maxRetries || !e.message.includes('MAX_CAPTURE_VISIBLE_TAB')) throw e;
      // Backoff : 750ms, 1500ms, 3000ms
      await sleep(750 * Math.pow(2, attempt));
    }
  }
}
