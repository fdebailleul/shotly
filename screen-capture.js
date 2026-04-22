// ── Screen Capture Tab ──────────────────────────────────────────
// Auto-launches getDisplayMedia (screen, window, tab picker).
// After the user picks a source:
//   1. Switches back to the original tab (so the screen shows real content)
//   2. Waits for repaint
//   3. Grabs one frame
//   4. Stores it and opens the editor
//   5. Closes this tab

(async () => {
  // Get the return tab ID from URL params
  const params = new URLSearchParams(location.search);
  const returnTabId = parseInt(params.get('returnTab'), 10) || null;

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });

    // ── Switch back to the original tab so this white page
    //    doesn't appear in the screen capture ──
    let targetTabId = returnTabId;
    if (targetTabId) {
      try {
        await chrome.tabs.update(targetTabId, { active: true });
      } catch (e) {
        targetTabId = null;
      }
    }
    if (!targetTabId) {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const myTab = await chrome.tabs.getCurrent();
      const other = tabs.find(t => t.id !== myTab.id);
      if (other) {
        targetTabId = other.id;
        await chrome.tabs.update(other.id, { active: true });
      }
    }

    // Inject a small countdown overlay into the original tab
    // so the user knows when the capture will happen and can
    // dismiss Chrome's sharing bar in the meantime
    if (targetTabId) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          func: () => {
            const overlay = document.createElement('div');
            overlay.id = '__shotly_countdown__';
            overlay.style.cssText = `
              position: fixed; top: 20px; right: 20px; z-index: 2147483647;
              background: rgba(0,0,0,0.75); color: #fff;
              padding: 14px 24px; border-radius: 12px;
              font: 600 15px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
              pointer-events: none;
              box-shadow: 0 4px 20px rgba(0,0,0,0.25);
              transition: opacity 0.3s;
            `;
            overlay.innerHTML = 'Cliquez <b>« Masquer »</b> sur la barre de partage<br><span id="__shotly_timer__" style="font-size:13px;opacity:0.8">Capture dans 5s…</span>';
            document.body.appendChild(overlay);

            let remaining = 5;
            const timer = document.getElementById('__shotly_timer__');
            const iv = setInterval(() => {
              remaining--;
              if (remaining <= 0) {
                clearInterval(iv);
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 300);
              } else {
                timer.textContent = `Capture dans ${remaining}s…`;
              }
            }, 1000);
          }
        });
      } catch (e) {
        // Can't inject into some pages (chrome://, etc.) — that's OK
      }
    }

    // Wait 5 seconds: gives user time to click "Masquer"
    // on Chrome's sharing notification bar
    await new Promise(r => setTimeout(r, 5200));

    // ── Grab a frame ──
    const track = stream.getVideoTracks()[0];
    let bitmap;

    try {
      const imageCapture = new ImageCapture(track);
      bitmap = await imageCapture.grabFrame();
    } catch (e) {
      console.warn('[screen-capture] ImageCapture failed, video fallback:', e);
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await new Promise((res, rej) => {
        video.onloadedmetadata = res;
        video.onerror = rej;
      });
      await video.play();
      await new Promise(r => setTimeout(r, 400));
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      bitmap = await createImageBitmap(c);
      video.srcObject = null;
    }

    // Stop sharing
    stream.getTracks().forEach(t => t.stop());

    // Draw to canvas
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close?.();

    // Encode — JPEG fallback for very large captures
    let dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > 12 * 1024 * 1024) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    }

    // Store and open editor, then close this tab
    chrome.storage.local.set({ capturedImage: dataUrl }, () => {
      if (chrome.runtime.lastError) {
        console.error('[screen-capture] Storage error:', chrome.runtime.lastError);
        return;
      }
      chrome.runtime.sendMessage({ action: 'open-editor-tab' }, () => {
        // Close this capture tab
        chrome.tabs.getCurrent(tab => {
          if (tab) chrome.tabs.remove(tab.id);
        });
      });
    });
  } catch (e) {
    // User cancelled the picker — close this tab
    console.warn('[screen-capture] Cancelled:', e);
    chrome.tabs.getCurrent(tab => {
      if (tab) chrome.tabs.remove(tab.id);
    });
  }
})();
