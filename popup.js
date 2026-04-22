// ── Popup Logic ───────────────────────────────────────────────────

// i18n — translate all data-i18n elements
document.querySelectorAll('[data-i18n]').forEach(el => {
  const msg = chrome.i18n.getMessage(el.dataset.i18n);
  if (msg) el.textContent = msg;
});

// Helper: send message to background and wait for acknowledgement
// before closing the popup — avoids race when the service worker is asleep.
function sendAndClose(msg) {
  chrome.runtime.sendMessage(msg, () => {
    window.close();
  });
}

// Grid buttons + list buttons (all have data-action)
document.querySelectorAll('[data-action]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.action;

    if (action === 'open-image') {
      document.getElementById('file-input').click();
      return;
    }

    // ── Screen / Window / Tab capture: open dedicated tab ──────
    if (action === 'capture-screen') {
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const returnTabId = currentTab ? currentTab.id : '';
      chrome.tabs.create({
        url: chrome.runtime.getURL('screen-capture.html') + '?returnTab=' + returnTabId
      });
      window.close();
      return;
    }

    // ── Open history page ──────
    if (action === 'open-history') {
      chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
      window.close();
      return;
    }

    // ── Reopen last capture ──────
    if (action === 'reopen-last') {
      sendAndClose({ action: 'reopen-last' });
      return;
    }

    // All other actions: send to background, close after ack
    sendAndClose({ action });
  });
});

// Delay chips
document.querySelectorAll('.delay-chip').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const delay = parseInt(btn.dataset.delay, 10);
    sendAndClose({ action: 'capture-delay', delay });
  });
});

// File input for opening local image
document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    sendAndClose({ action: 'open-editor', dataUrl: ev.target.result });
  };
  reader.readAsDataURL(file);
});

// ── History: show last capture thumbnail + badge count ─────────
(async () => {
  try {
    // list() returns lightweight records (thumbnail + metadata, no full dataUrl)
    const captures = await ShotlyDB.list();
    if (captures.length > 0) {
      // Show badge
      const badge = document.getElementById('history-badge');
      badge.textContent = captures.length;
      badge.style.display = 'inline-block';

      // Show "Dernière capture" button with thumbnail (list is newest-first)
      const last = captures[0];
      const btn = document.getElementById('btn-last-capture');
      btn.style.display = 'flex';
      if (last.thumbnail) {
        document.getElementById('last-capture-thumb').src = last.thumbnail;
      }
    }
  } catch (e) {
    console.warn('History load error:', e);
  }
})();
