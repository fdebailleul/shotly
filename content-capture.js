// ── Content Script: Area Selection Overlay ────────────────────────
// Clean light design matching the editor/popup style.

(function() {
  if (document.getElementById('__captur_overlay__')) return;

  const BLUE = '#6366f1';
  const BLUE_LIGHT = 'rgba(99,102,241,0.08)';
  const SHADOW = 'rgba(0,0,0,0.35)';

  // ── Overlay (dims the page) ───────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = '__captur_overlay__';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647;
    background: rgba(0,0,0,0.25); cursor: crosshair;
    transition: background 0.2s;
  `;

  // ── Hint banner ───────────────────────────────────────────────
  const hint = document.createElement('div');
  hint.style.cssText = `
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    z-index: 2147483647;
    background: #fff; color: #333;
    padding: 10px 22px;
    border-radius: 10px;
    font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    pointer-events: none;
    box-shadow: 0 2px 12px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04);
    display: flex; align-items: center; gap: 8px;
    transition: opacity 0.25s;
  `;
  // Icon
  const hintIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  hintIcon.setAttribute('width', '16');
  hintIcon.setAttribute('height', '16');
  hintIcon.setAttribute('viewBox', '0 0 24 24');
  hintIcon.setAttribute('fill', 'none');
  hintIcon.setAttribute('stroke', BLUE);
  hintIcon.setAttribute('stroke-width', '2');
  hintIcon.innerHTML = '<rect x="3" y="3" width="18" height="14" rx="2"/><rect x="8" y="6" width="10" height="8" rx="1" stroke-dasharray="3 2" opacity="0.6"/>';
  hint.appendChild(hintIcon);
  const hintText = document.createElement('span');
  hintText.textContent = chrome.i18n.getMessage('selectArea') || 'Click and drag to select an area';
  hint.appendChild(hintText);
  // ESC badge
  const escBadge = document.createElement('span');
  escBadge.textContent = 'ESC';
  escBadge.style.cssText = `
    font-size: 10px; font-weight: 600; color: #999;
    background: #f3f4f6; padding: 2px 6px; border-radius: 4px;
    margin-left: 4px; font-family: 'SF Mono', 'Fira Code', monospace;
  `;
  hint.appendChild(escBadge);

  // ── Selection rectangle ───────────────────────────────────────
  const selection = document.createElement('div');
  selection.style.cssText = `
    position: fixed;
    border: 2px solid ${BLUE};
    background: ${BLUE_LIGHT};
    z-index: 2147483647;
    display: none;
    pointer-events: none;
    box-shadow: 0 0 0 9999px ${SHADOW};
    border-radius: 2px;
  `;

  // ── Corner handles (visual only) ─────────────────────────────
  const corners = ['top-left','top-right','bottom-left','bottom-right'];
  corners.forEach(pos => {
    const handle = document.createElement('div');
    const [v, h] = pos.split('-');
    handle.style.cssText = `
      position: absolute; width: 8px; height: 8px;
      background: #fff; border: 2px solid ${BLUE};
      border-radius: 2px; pointer-events: none;
      ${v}: -5px; ${h}: -5px;
    `;
    selection.appendChild(handle);
  });

  // ── Dimension badge ───────────────────────────────────────────
  const dims = document.createElement('div');
  dims.style.cssText = `
    position: absolute; bottom: -30px; left: 50%; transform: translateX(-50%);
    background: #fff; color: #333;
    padding: 4px 10px;
    border-radius: 6px;
    font: 600 11px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace;
    white-space: nowrap;
    box-shadow: 0 1px 6px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.04);
    pointer-events: none;
  `;
  selection.appendChild(dims);

  // ── Crosshair guides ──────────────────────────────────────────
  const guideH = document.createElement('div');
  guideH.style.cssText = `
    position: fixed; left: 0; right: 0; height: 1px;
    background: ${BLUE}; opacity: 0.25;
    z-index: 2147483646; pointer-events: none;
    display: none;
  `;
  const guideV = document.createElement('div');
  guideV.style.cssText = `
    position: fixed; top: 0; bottom: 0; width: 1px;
    background: ${BLUE}; opacity: 0.25;
    z-index: 2147483646; pointer-events: none;
    display: none;
  `;

  document.body.appendChild(guideH);
  document.body.appendChild(guideV);
  document.body.appendChild(overlay);
  document.body.appendChild(hint);
  document.body.appendChild(selection);

  let startX, startY, isDrawing = false;

  // ── Mouse: crosshair guides before drawing ────────────────────
  overlay.addEventListener('mousemove', (e) => {
    if (!isDrawing) {
      guideH.style.display = 'block';
      guideV.style.display = 'block';
      guideH.style.top = e.clientY + 'px';
      guideV.style.left = e.clientX + 'px';
    }
  });

  overlay.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    isDrawing = true;
    // Hide guides & hint during draw
    guideH.style.display = 'none';
    guideV.style.display = 'none';
    hint.style.opacity = '0';

    selection.style.display = 'block';
    selection.style.left = startX + 'px';
    selection.style.top = startY + 'px';
    selection.style.width = '0px';
    selection.style.height = '0px';
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    selection.style.left = x + 'px';
    selection.style.top = y + 'px';
    selection.style.width = w + 'px';
    selection.style.height = h + 'px';
    dims.textContent = `${w} \u00d7 ${h}`;
  });

  overlay.addEventListener('mouseup', (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    cleanup();

    if (w < 5 || h < 5) return;

    setTimeout(() => {
      chrome.runtime.sendMessage({
        action: 'area-selected',
        rect: { x, y, width: w, height: h },
        devicePixelRatio: window.devicePixelRatio || 1
      });
    }, 100);
  });

  // ── ESC to cancel ─────────────────────────────────────────────
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      cleanup();
      document.removeEventListener('keydown', escHandler);
    }
  });

  function cleanup() {
    overlay.remove();
    hint.remove();
    selection.remove();
    guideH.remove();
    guideV.remove();
  }
})();
