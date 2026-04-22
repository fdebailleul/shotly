// Offscreen document for canvas operations and desktop capture stream

// Signal that we're ready to receive messages
chrome.runtime.sendMessage({ action: 'offscreen-ready' }).catch(() => {
  // Service worker may not be listening yet — that's OK,
  // ensureOffscreen() sets up its listener before creating us.
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case 'offscreen-crop':
      cropImage(msg.dataUrl, msg.rect, msg.dpr);
      break;
    case 'offscreen-stitch':
      stitchImages(msg.parts, msg.totalW, msg.totalH, msg.vpW, msg.vpH, msg.dpr);
      break;
    case 'offscreen-capture':
      captureDesktopStream(msg.streamId);
      break;
  }
});

async function cropImage(dataUrl, rect, dpr) {
  const img = await loadImage(dataUrl);
  const cv = document.getElementById('cv');
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, rect.x * dpr, rect.y * dpr, w, h, 0, 0, w, h);
  chrome.runtime.sendMessage({
    action: 'cropped-result',
    dataUrl: cv.toDataURL('image/png')
  });
}

async function stitchImages(parts, totalW, totalH, vpW, vpH, dpr) {
  const cv = document.getElementById('cv');
  cv.width = totalW * dpr;
  cv.height = totalH * dpr;
  const ctx = cv.getContext('2d');

  for (const part of parts) {
    const img = await loadImage(part.dataUrl);
    const dx = part.x * dpr;
    const dy = part.y * dpr;
    const sw = Math.min(vpW * dpr, cv.width - dx);
    const sh = Math.min(vpH * dpr, cv.height - dy);
    ctx.drawImage(img, 0, 0, sw, sh, dx, dy, sw, sh);
  }

  chrome.runtime.sendMessage({
    action: 'stitched-result',
    dataUrl: cv.toDataURL('image/png')
  });
}

async function captureDesktopStream(streamId) {
  console.log('[offscreen] captureDesktopStream called, streamId:', streamId);
  try {
    // getUserMedia with chromeMediaSource requires the legacy mandatory syntax
    console.log('[offscreen] Calling getUserMedia…');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId
        }
      }
    });
    console.log('[offscreen] Got stream, tracks:', stream.getTracks().length);

    const video = document.getElementById('vid');
    video.srcObject = stream;

    // Wait for video metadata to load
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = reject;
      // Timeout safety: don't wait forever
      setTimeout(() => reject(new Error('Video metadata timeout')), 5000);
    });
    console.log('[offscreen] Video metadata loaded:', video.videoWidth, 'x', video.videoHeight);

    // Play the video to ensure a frame is available
    await video.play();
    // Wait a bit for the frame to be available for drawing
    await new Promise(r => setTimeout(r, 300));

    const cv = document.getElementById('cv');
    cv.width = video.videoWidth;
    cv.height = video.videoHeight;
    const ctx = cv.getContext('2d');
    ctx.drawImage(video, 0, 0);
    console.log('[offscreen] Frame drawn to canvas:', cv.width, 'x', cv.height);

    // Stop all tracks and release the stream
    stream.getTracks().forEach(t => t.stop());
    video.pause();
    video.srcObject = null;

    const dataUrl = cv.toDataURL('image/png');
    console.log('[offscreen] dataUrl length:', dataUrl.length);

    // Store directly in chrome.storage.local to avoid message size limits
    // and then tell the background to open the editor
    chrome.storage.local.set({ capturedImage: dataUrl }, () => {
      if (chrome.runtime.lastError) {
        console.error('[offscreen] storage.local.set error:', chrome.runtime.lastError);
        return;
      }
      console.log('[offscreen] Image stored, sending open-editor-tab to background');
      chrome.runtime.sendMessage({ action: 'open-editor-tab' }).catch((err) => {
        console.warn('[offscreen] Could not send open-editor-tab:', err);
      });
    });
  } catch (e) {
    console.error('[offscreen] Desktop capture error:', e);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
