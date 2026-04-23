// ── Screenshot Annotation Editor ──────────────────────────────────
// Canvas-based editor with full annotation toolkit.

(() => {
  'use strict';

  // ── i18n ──────────────────────────────────────────────────────
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });

  // ── State ─────────────────────────────────────────────────────
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const container = document.getElementById('canvas-container');

  let baseImage = null;       // original screenshot (Image)
  let annotations = [];       // list of annotation objects
  let redoStack = [];
  let currentTool = 'rect';
  let isDrawing = false;
  let startX = 0, startY = 0;
  let currentAnnotation = null;
  let selectedAnnotation = null;
  let isDragging = false;
  let dragOffsetX = 0, dragOffsetY = 0;
  let isResizing = false;
  let resizeHandle = null; // 'nw','ne','sw','se'

  // Crop state
  let cropRect = null;
  let isCropping = false;

  // OCR state
  let ocrRect = null;
  let isOcrSelecting = false;

  // Step counter (auto-increments for numbered circles)
  let stepCounter = 1;

  // Tool properties
  let strokeColor = '#6366f1';
  let strokeWidth = 3;
  let fontSize = 36;
  let textBgColor = '#ffffff';
  let textBgEnabled = false;

  // Page info for smart file naming
  let pageTitle = '';

  // ── Load captured image ───────────────────────────────────────
  chrome.storage.local.get(['capturedImage', 'cropInfo', 'pageTitle'], (data) => {
    if (data.pageTitle) pageTitle = data.pageTitle;
    if (data.capturedImage) {
      if (data.cropInfo) {
        // Area capture: load full image then crop to selected region
        loadAndCropImage(data.capturedImage, data.cropInfo);
        chrome.storage.local.remove(['capturedImage', 'cropInfo', 'pageTitle']);
      } else {
        loadImageFromDataUrl(data.capturedImage);
        chrome.storage.local.remove(['capturedImage', 'pageTitle']);
      }
    }
  });

  function loadAndCropImage(dataUrl, cropInfo) {
    const img = new Image();
    img.onload = () => {
      const { rect, dpr } = cropInfo;
      const sx = Math.round(rect.x * dpr);
      const sy = Math.round(rect.y * dpr);
      const sw = Math.round(rect.width * dpr);
      const sh = Math.round(rect.height * dpr);

      // Crop using a temporary canvas
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = sw;
      tempCanvas.height = sh;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      // Load the cropped result as the base image
      const croppedImg = new Image();
      croppedImg.onload = () => {
        baseImage = croppedImg;
        canvas.width = sw;
        canvas.height = sh;

        zoomLevel = getInitialScale();
        applyZoom();

        redraw();
      };
      croppedImg.src = tempCanvas.toDataURL('image/png');
    };
    img.src = dataUrl;
  }

  function loadImageFromDataUrl(dataUrl) {
    const img = new Image();
    img.onload = () => {
      baseImage = img;
      let w = img.naturalWidth;
      let h = img.naturalHeight;

      // Store at natural resolution
      canvas.width = w;
      canvas.height = h;

      // CSS scaling for display
      zoomLevel = getInitialScale();
      applyZoom();

      redraw();
    };
    img.src = dataUrl;
  }

  // ── Zoom (mouse wheel) ────────────────────────────────────────
  let zoomLevel = 1; // 1 = fit-to-view (initial)

  const zoomBadge = document.getElementById('zoom-badge');

  function applyZoom() {
    if (!baseImage) return;
    const w = canvas.width;
    const h = canvas.height;
    canvas.style.width = (w * zoomLevel) + 'px';
    canvas.style.height = (h * zoomLevel) + 'px';
    // Update zoom indicator (relative to natural pixel size)
    const pct = Math.round(zoomLevel * 100);
    zoomBadge.textContent = pct + '%';
  }

  function getInitialScale() {
    if (!baseImage) return 1;
    const maxW = container.clientWidth - 40;
    const maxH = container.clientHeight - 40;
    return Math.min(1, maxW / canvas.width, maxH / canvas.height);
  }

  container.addEventListener('wheel', (e) => {
    if (!baseImage) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    const initScale = getInitialScale();
    const minZoom = initScale * 0.25;
    const maxZoom = initScale * 5;
    zoomLevel = Math.max(minZoom, Math.min(maxZoom, zoomLevel + delta * zoomLevel));
    applyZoom();
  }, { passive: false });

  // Reset zoom on double-click container background (not canvas)
  container.addEventListener('dblclick', (e) => {
    if (e.target === container) {
      zoomLevel = getInitialScale();
      applyZoom();
    }
  });

  // ── Paste from clipboard ──────────────────────────────────────
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (ev) => loadImageFromDataUrl(ev.target.result);
        reader.readAsDataURL(blob);
        break;
      }
    }
  });

  // ── Coordinate helpers ────────────────────────────────────────
  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  // ── Toolbar: tool selection ───────────────────────────────────
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector('.tool-btn.active')?.classList.remove('active');
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
      canvas.style.cursor = currentTool === 'select' ? 'default' : 'crosshair';

      // Show/hide text props
      document.getElementById('text-props').style.display =
        currentTool === 'text' ? 'block' : 'none';

      // Handle crop mode
      if (currentTool === 'crop') {
        document.getElementById('crop-bar').style.display = 'flex';
        isCropping = true;
        cropRect = null;
      } else {
        document.getElementById('crop-bar').style.display = 'none';
        isCropping = false;
        cropRect = null;
        redraw();
      }

      // Handle OCR mode
      if (currentTool === 'ocr') {
        isOcrSelecting = true;
        ocrRect = null;
      } else {
        isOcrSelecting = false;
        ocrRect = null;
      }
    });
  });

  // ── Toolbar: properties ───────────────────────────────────────
  const colorInput = document.getElementById('stroke-color');
  const widthInput = document.getElementById('stroke-width');
  const widthVal = document.getElementById('stroke-width-val');
  const fontSizeInput = document.getElementById('font-size');
  const fontSizeVal = document.getElementById('font-size-val');
  const textBgColorInput = document.getElementById('text-bg-color');
  const textBgCheckbox = document.getElementById('text-bg-enabled');

  colorInput.addEventListener('input', (e) => {
    strokeColor = e.target.value;
    updateSelectedAnnotation();
  });

  // Color presets
  document.querySelectorAll('.preset[data-color]').forEach(btn => {
    btn.addEventListener('click', () => {
      strokeColor = btn.dataset.color;
      colorInput.value = strokeColor;
      updateSelectedAnnotation();
    });
  });
  widthInput.addEventListener('input', (e) => {
    strokeWidth = parseInt(e.target.value);
    widthVal.textContent = strokeWidth;
    updateSelectedAnnotation();
  });
  fontSizeInput.addEventListener('input', (e) => {
    fontSize = parseInt(e.target.value);
    fontSizeVal.textContent = fontSize;
    updateSelectedAnnotation();
  });
  textBgColorInput.addEventListener('input', (e) => {
    textBgColor = e.target.value;
    updateSelectedAnnotation();
  });
  textBgCheckbox.addEventListener('change', (e) => {
    textBgEnabled = e.target.checked;
    updateSelectedAnnotation();
  });

  // ── Toolbar: undo / redo ──────────────────────────────────────
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);

  function undo() {
    if (annotations.length === 0) return;
    redoStack.push(annotations.pop());
    redraw();
  }

  function redo() {
    if (redoStack.length === 0) return;
    annotations.push(redoStack.pop());
    redraw();
  }

  // ── Keyboard shortcuts ────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') { e.preventDefault(); undo(); }
      if (e.key === 'y') { e.preventDefault(); redo(); }
      if (e.key === 'c' && !e.shiftKey) { /* allow default copy */ }
      return;
    }

    const keyMap = {
      v: 'select', r: 'rect', c: 'circle', a: 'arrow',
      l: 'line', f: 'freehand', t: 'text', b: 'blur',
      h: 'highlight', n: 'step', x: 'crop', o: 'ocr'
    };
    if (keyMap[e.key]) {
      const btn = document.querySelector(`[data-tool="${keyMap[e.key]}"]`);
      if (btn) btn.click();
    }
  });

  // ── Canvas: mouse events ──────────────────────────────────────
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);

  function onMouseDown(e) {
    const pos = getCanvasCoords(e);

    // Crop mode
    if (isCropping) {
      startX = pos.x;
      startY = pos.y;
      isDrawing = true;
      cropRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
      return;
    }

    // OCR selection mode
    if (isOcrSelecting) {
      startX = pos.x;
      startY = pos.y;
      isDrawing = true;
      ocrRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
      return;
    }

    // Step tool — place numbered circle on click
    if (currentTool === 'step') {
      redoStack = [];
      annotations.push({
        type: 'step',
        x: pos.x,
        y: pos.y,
        number: stepCounter++,
        color: strokeColor,
        size: Math.max(strokeWidth * 6, 32)
      });
      redraw();
      return;
    }

    // Text tool — commit any pending text first, then open new input
    if (currentTool === 'text') {
      if (isTextInputVisible()) {
        commitText();
        // Defer new input so commit finishes first
        const savedE = { clientX: e.clientX, clientY: e.clientY };
        requestAnimationFrame(() => showTextInput(savedE, pos));
      } else {
        showTextInput(e, pos);
      }
      return;
    }

    // Select tool - try to pick an annotation
    if (currentTool === 'select') {
      // Commit pending text if any
      if (isTextInputVisible()) commitText();

      // Check resize handles on currently selected annotation first
      if (selectedAnnotation && resizableTypes.includes(selectedAnnotation.type)) {
        const handle = hitHandle(selectedAnnotation, pos);
        if (handle) {
          isResizing = true;
          resizeHandle = handle;
          startX = pos.x;
          startY = pos.y;
          return;
        }
      }

      selectedAnnotation = null;
      for (let i = annotations.length - 1; i >= 0; i--) {
        if (hitTest(annotations[i], pos)) {
          selectedAnnotation = annotations[i];
          isDragging = true;
          dragOffsetX = pos.x - (annotations[i].x || annotations[i].x1 || 0);
          dragOffsetY = pos.y - (annotations[i].y || annotations[i].y1 || 0);
          showSelectionProps();
          redraw();
          return;
        }
      }
      hideSelectionProps();
      redraw();
      return;
    }

    // Drawing tools
    isDrawing = true;
    startX = pos.x;
    startY = pos.y;
    redoStack = [];

    if (currentTool === 'freehand') {
      currentAnnotation = {
        type: 'freehand',
        points: [{ x: pos.x, y: pos.y }],
        color: strokeColor,
        width: strokeWidth
      };
    }
  }

  function onMouseMove(e) {
    // Update cursor for resize handles
    if (currentTool === 'select' && selectedAnnotation && !isDragging && !isResizing && !isDrawing) {
      const pos = getCanvasCoords(e);
      const handle = hitHandle(selectedAnnotation, pos);
      if (handle) {
        const cursors = { nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize' };
        canvas.style.cursor = cursors[handle] || 'default';
      } else if (hitTest(selectedAnnotation, pos)) {
        canvas.style.cursor = 'move';
      } else {
        canvas.style.cursor = 'default';
      }
    }

    if (!isDrawing && !isDragging && !isResizing) return;
    const pos = getCanvasCoords(e);

    // Resizing annotation
    if (isResizing && selectedAnnotation && resizeHandle) {
      const ann = selectedAnnotation;
      const b = getBounds(ann);
      if (!b) return;

      let newX = b.x, newY = b.y, newW = b.w, newH = b.h;
      const dx = pos.x - startX;
      const dy = pos.y - startY;

      if (resizeHandle.includes('e')) { newW = b.w + dx; }
      if (resizeHandle.includes('w')) { newX = b.x + dx; newW = b.w - dx; }
      if (resizeHandle.includes('s')) { newH = b.h + dy; }
      if (resizeHandle.includes('n')) { newY = b.y + dy; newH = b.h - dy; }

      // Enforce minimum size
      if (newW < 10) { newW = 10; if (resizeHandle.includes('w')) newX = b.x + b.w - 10; }
      if (newH < 10) { newH = 10; if (resizeHandle.includes('n')) newY = b.y + b.h - 10; }

      if (ann.type === 'rect' || ann.type === 'blur' || ann.type === 'highlight') {
        ann.x = newX; ann.y = newY; ann.w = newW; ann.h = newH;
      } else if (ann.type === 'circle') {
        ann.cx = newX + newW / 2;
        ann.cy = newY + newH / 2;
        ann.rx = newW / 2;
        ann.ry = newH / 2;
      }

      startX = pos.x;
      startY = pos.y;
      redraw();
      return;
    }

    // Dragging annotation
    if (isDragging && selectedAnnotation) {
      const dx = pos.x - dragOffsetX;
      const dy = pos.y - dragOffsetY;
      moveAnnotation(selectedAnnotation, dx, dy);
      dragOffsetX = pos.x - dx; // keep offset
      dragOffsetY = pos.y - dy;
      // actually we want absolute positioning
      if (selectedAnnotation.x !== undefined) {
        selectedAnnotation.x = dx;
        selectedAnnotation.y = dy;
      } else if (selectedAnnotation.x1 !== undefined) {
        const w = selectedAnnotation.x2 - selectedAnnotation.x1;
        const h = selectedAnnotation.y2 - selectedAnnotation.y1;
        selectedAnnotation.x1 = dx;
        selectedAnnotation.y1 = dy;
        selectedAnnotation.x2 = dx + w;
        selectedAnnotation.y2 = dy + h;
      }
      dragOffsetX = pos.x - dx;
      dragOffsetY = pos.y - dy;
      redraw();
      return;
    }

    // Cropping
    if (isCropping && cropRect) {
      cropRect.w = pos.x - startX;
      cropRect.h = pos.y - startY;
      redraw();
      drawCropOverlay();
      return;
    }

    // OCR selection
    if (isOcrSelecting && ocrRect) {
      ocrRect.w = pos.x - startX;
      ocrRect.h = pos.y - startY;
      redraw();
      drawOcrOverlay();
      return;
    }

    // Freehand
    if (currentTool === 'freehand' && currentAnnotation) {
      currentAnnotation.points.push({ x: pos.x, y: pos.y });
      redraw();
      drawAnnotation(currentAnnotation);
      return;
    }

    // Shape preview
    redraw();
    const preview = createAnnotation(currentTool, startX, startY, pos.x, pos.y);
    if (preview) drawAnnotation(preview);
  }

  function onMouseUp(e) {
    if (isResizing) {
      isResizing = false;
      resizeHandle = null;
      return;
    }
    if (isDragging) {
      isDragging = false;
      return;
    }
    if (!isDrawing) return;
    isDrawing = false;
    const pos = getCanvasCoords(e);

    // Crop
    if (isCropping && cropRect) {
      cropRect.w = pos.x - startX;
      cropRect.h = pos.y - startY;
      redraw();
      drawCropOverlay();
      return;
    }

    // OCR — selection complete, run recognition
    if (isOcrSelecting && ocrRect) {
      ocrRect.w = pos.x - startX;
      ocrRect.h = pos.y - startY;
      const r = normRect(ocrRect);
      if (r.w > 10 && r.h > 10) {
        runOcr(r);
      } else {
        ocrRect = null;
        redraw();
      }
      return;
    }

    // Freehand
    if (currentTool === 'freehand' && currentAnnotation) {
      annotations.push(currentAnnotation);
      currentAnnotation = null;
      redraw();
      return;
    }

    // Others
    const ann = createAnnotation(currentTool, startX, startY, pos.x, pos.y);
    if (ann) {
      annotations.push(ann);
      redraw();
    }
  }

  // ── Create annotation object ──────────────────────────────────
  function createAnnotation(type, x1, y1, x2, y2) {
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    if (w < 2 && h < 2 && type !== 'text') return null;

    switch (type) {
      case 'rect':
        return { type: 'rect', x: Math.min(x1,x2), y: Math.min(y1,y2), w, h, color: strokeColor, width: strokeWidth };
      case 'circle':
        return { type: 'circle', cx: (x1+x2)/2, cy: (y1+y2)/2, rx: w/2, ry: h/2, color: strokeColor, width: strokeWidth };
      case 'arrow':
        return { type: 'arrow', x1, y1, x2, y2, color: strokeColor, width: strokeWidth };
      case 'line':
        return { type: 'line', x1, y1, x2, y2, color: strokeColor, width: strokeWidth };
      case 'blur':
        return { type: 'blur', x: Math.min(x1,x2), y: Math.min(y1,y2), w, h };
      case 'highlight':
        return { type: 'highlight', x: Math.min(x1,x2), y: Math.min(y1,y2), w, h, color: strokeColor };
      default:
        return null;
    }
  }

  // ── Draw single annotation ────────────────────────────────────
  function drawAnnotation(ann) {
    if (ann._hidden) return; // hidden during text editing
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (ann.type) {
      case 'rect':
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = ann.width;
        ctx.strokeRect(ann.x, ann.y, ann.w, ann.h);
        break;

      case 'circle':
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = ann.width;
        ctx.beginPath();
        ctx.ellipse(ann.cx, ann.cy, Math.abs(ann.rx), Math.abs(ann.ry), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;

      case 'arrow':
        drawArrow(ann);
        break;

      case 'line':
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = ann.width;
        ctx.beginPath();
        ctx.moveTo(ann.x1, ann.y1);
        ctx.lineTo(ann.x2, ann.y2);
        ctx.stroke();
        break;

      case 'freehand':
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = ann.width;
        ctx.beginPath();
        if (ann.points.length > 0) {
          ctx.moveTo(ann.points[0].x, ann.points[0].y);
          for (let i = 1; i < ann.points.length; i++) {
            ctx.lineTo(ann.points[i].x, ann.points[i].y);
          }
        }
        ctx.stroke();
        break;

      case 'text':
        ctx.font = `${ann.fontSize}px system-ui, sans-serif`;
        if (ann.bgEnabled && ann.bgColor) {
          const metrics = ctx.measureText(ann.text);
          const padding = 6;
          ctx.fillStyle = ann.bgColor;
          ctx.fillRect(
            ann.x - padding,
            ann.y - ann.fontSize - padding + 4,
            metrics.width + padding * 2,
            ann.fontSize + padding * 2
          );
        }
        ctx.fillStyle = ann.color;
        ctx.fillText(ann.text, ann.x, ann.y);
        break;

      case 'blur':
        applyBlur(ann);
        break;

      case 'highlight':
        ctx.fillStyle = ann.color + '40'; // 25% opacity
        ctx.fillRect(ann.x, ann.y, ann.w, ann.h);
        break;

      case 'step': {
        const r = ann.size / 2;
        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        // Filled circle
        ctx.fillStyle = ann.color;
        ctx.beginPath();
        ctx.arc(ann.x, ann.y, r, 0, Math.PI * 2);
        ctx.fill();
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        // Number text
        const numSize = Math.round(r * 1.2);
        ctx.font = `700 ${numSize}px system-ui, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(ann.number), ann.x, ann.y + 1);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
        break;
      }
    }

    ctx.restore();
  }

  function drawArrow(ann) {
    const headLen = Math.max(ann.width * 4, 14);
    const angle = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1);

    ctx.strokeStyle = ann.color;
    ctx.fillStyle = ann.color;
    ctx.lineWidth = ann.width;

    // Compute arrowhead base center (where the line should stop)
    const baseX = ann.x2 - headLen * Math.cos(angle);
    const baseY = ann.y2 - headLen * Math.sin(angle);

    // Line — stops at arrowhead base, not at the tip
    ctx.beginPath();
    ctx.moveTo(ann.x1, ann.y1);
    ctx.lineTo(baseX, baseY);
    ctx.stroke();

    // Arrowhead triangle (filled, no stroke overlap)
    ctx.beginPath();
    ctx.moveTo(ann.x2, ann.y2);
    ctx.lineTo(
      ann.x2 - headLen * Math.cos(angle - Math.PI / 6),
      ann.y2 - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      ann.x2 - headLen * Math.cos(angle + Math.PI / 6),
      ann.y2 - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  }

  function applyBlur(ann) {
    // Pixelate the area to simulate blur
    const blockSize = 10;
    const x = Math.max(0, Math.round(ann.x));
    const y = Math.max(0, Math.round(ann.y));
    const w = Math.min(Math.round(ann.w), canvas.width - x);
    const h = Math.min(Math.round(ann.h), canvas.height - y);
    if (w <= 0 || h <= 0) return;

    const imageData = ctx.getImageData(x, y, w, h);
    const data = imageData.data;

    for (let by = 0; by < h; by += blockSize) {
      for (let bx = 0; bx < w; bx += blockSize) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = 0; dy < blockSize && by + dy < h; dy++) {
          for (let dx = 0; dx < blockSize && bx + dx < w; dx++) {
            const idx = ((by + dy) * w + (bx + dx)) * 4;
            r += data[idx]; g += data[idx + 1]; b += data[idx + 2];
            count++;
          }
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        for (let dy = 0; dy < blockSize && by + dy < h; dy++) {
          for (let dx = 0; dx < blockSize && bx + dx < w; dx++) {
            const idx = ((by + dy) * w + (bx + dx)) * 4;
            data[idx] = r; data[idx + 1] = g; data[idx + 2] = b;
          }
        }
      }
    }
    ctx.putImageData(imageData, x, y);
  }

  // ── Hit test for selection ────────────────────────────────────
  function hitTest(ann, pos) {
    const margin = 8;
    switch (ann.type) {
      case 'rect':
      case 'blur':
      case 'highlight':
        return pos.x >= ann.x - margin && pos.x <= ann.x + ann.w + margin &&
               pos.y >= ann.y - margin && pos.y <= ann.y + ann.h + margin;
      case 'circle':
        const dx = (pos.x - ann.cx) / (Math.abs(ann.rx) + margin);
        const dy = (pos.y - ann.cy) / (Math.abs(ann.ry) + margin);
        return dx * dx + dy * dy <= 1;
      case 'arrow':
      case 'line':
        return distToSegment(pos, { x: ann.x1, y: ann.y1 }, { x: ann.x2, y: ann.y2 }) < margin + ann.width;
      case 'freehand':
        return ann.points.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < margin + ann.width);
      case 'text':
        ctx.font = `${ann.fontSize}px system-ui, sans-serif`;
        const metrics = ctx.measureText(ann.text);
        return pos.x >= ann.x && pos.x <= ann.x + metrics.width &&
               pos.y >= ann.y - ann.fontSize && pos.y <= ann.y + 4;
      case 'step':
        const dist = Math.hypot(pos.x - ann.x, pos.y - ann.y);
        return dist <= (ann.size / 2) + margin;
      default:
        return false;
    }
  }

  function distToSegment(p, a, b) {
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
  }

  function moveAnnotation(ann, newX, newY) {
    // Handled in onMouseMove via direct property set
  }

  // ── Text input ────────────────────────────────────────────────
  const textInput = document.getElementById('text-input');
  let _textCommitting = false; // guard against re-entrant commits

  function isTextInputVisible() {
    return textInput.style.display !== 'none';
  }

  function showTextInput(e, canvasPos) {
    if (e.preventDefault) {
      e.preventDefault();
      e.stopPropagation();
    }

    const displayScale = canvas.getBoundingClientRect().width / canvas.width;
    textInput.style.display = 'block';
    textInput.style.left = e.clientX + 'px';
    textInput.style.top = e.clientY + 'px';
    textInput.style.fontSize = (fontSize * displayScale) + 'px';
    textInput.style.color = strokeColor;
    textInput.value = '';
    textInput._canvasPos = canvasPos;
    textInput._editing = null; // not editing an existing annotation

    requestAnimationFrame(() => textInput.focus());
  }

  function showTextInputForEdit(ann) {
    // Open textarea over an existing text annotation to re-edit it
    const displayScale = canvas.getBoundingClientRect().width / canvas.width;
    const rect = canvas.getBoundingClientRect();
    const screenX = rect.left + ann.x / (canvas.width / rect.width);
    const screenY = rect.top + ann.y / (canvas.height / rect.height);

    textInput.style.display = 'block';
    textInput.style.left = screenX + 'px';
    textInput.style.top = (screenY - ann.fontSize * displayScale) + 'px';
    textInput.style.fontSize = (ann.fontSize * displayScale) + 'px';
    textInput.style.color = ann.color;
    textInput.value = ann.text;
    textInput._canvasPos = { x: ann.x, y: ann.y };
    textInput._editing = ann; // reference to annotation being edited

    // Temporarily hide the annotation while editing
    ann._hidden = true;
    redraw();

    requestAnimationFrame(() => {
      textInput.focus();
      textInput.select();
    });
  }

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitText();
    }
    if (e.key === 'Escape') {
      cancelTextInput();
    }
    e.stopPropagation(); // don't trigger tool shortcuts while typing
  });

  // Don't use blur to commit — it caused the disappearing text bug.
  // Instead, commit explicitly on Enter, tool switch, or click elsewhere.
  textInput.addEventListener('blur', () => {
    // Small delay: if a new showTextInput is about to fire, let it commit first
    setTimeout(() => {
      if (isTextInputVisible() && !_textCommitting) {
        commitText();
      }
    }, 50);
  });

  function cancelTextInput() {
    // Restore hidden annotation if we were editing
    if (textInput._editing) {
      textInput._editing._hidden = false;
    }
    textInput.style.display = 'none';
    textInput._editing = null;
    redraw();
  }

  function commitText() {
    if (_textCommitting) return;
    _textCommitting = true;

    const text = textInput.value.trim();
    const editingAnn = textInput._editing;

    if (!text) {
      // If editing and cleared, delete the annotation
      if (editingAnn) {
        const idx = annotations.indexOf(editingAnn);
        if (idx >= 0) annotations.splice(idx, 1);
        editingAnn._hidden = false;
      }
      textInput.style.display = 'none';
      textInput._editing = null;
      _textCommitting = false;
      redraw();
      return;
    }

    if (editingAnn) {
      // Update existing annotation
      editingAnn.text = text;
      editingAnn.color = strokeColor;
      editingAnn.fontSize = fontSize;
      editingAnn.bgColor = textBgColor;
      editingAnn.bgEnabled = textBgEnabled;
      editingAnn._hidden = false;
    } else {
      // New annotation
      const pos = textInput._canvasPos;
      annotations.push({
        type: 'text',
        x: pos.x,
        y: pos.y,
        text,
        color: strokeColor,
        fontSize,
        bgColor: textBgColor,
        bgEnabled: textBgEnabled
      });
      redoStack = [];
    }

    textInput.style.display = 'none';
    textInput._editing = null;
    _textCommitting = false;
    redraw();
  }

  // ── Double-click to edit text annotation ──────────────────────
  canvas.addEventListener('dblclick', (e) => {
    const pos = getCanvasCoords(e);
    for (let i = annotations.length - 1; i >= 0; i--) {
      if (annotations[i].type === 'text' && hitTest(annotations[i], pos)) {
        // Load its props into the sidebar
        strokeColor = annotations[i].color;
        fontSize = annotations[i].fontSize;
        colorInput.value = strokeColor;
        fontSizeInput.value = fontSize;
        fontSizeVal.textContent = fontSize;
        textBgColor = annotations[i].bgColor || '#ffffff';
        textBgEnabled = annotations[i].bgEnabled || false;
        textBgColorInput.value = textBgColor;
        textBgCheckbox.checked = textBgEnabled;

        showTextInputForEdit(annotations[i]);
        return;
      }
    }
  });

  // ── Selection properties panel ────────────────────────────────
  // When an annotation is selected with the Select tool, show its
  // properties and allow live editing of color, size, etc.

  function showSelectionProps() {
    if (!selectedAnnotation) return;
    const ann = selectedAnnotation;

    // Update sidebar controls to reflect the selected annotation
    if (ann.color) {
      strokeColor = ann.color;
      colorInput.value = strokeColor;
    }
    if (ann.width) {
      strokeWidth = ann.width;
      widthInput.value = strokeWidth;
      widthVal.textContent = strokeWidth;
    }
    if (ann.type === 'text') {
      fontSize = ann.fontSize;
      fontSizeInput.value = fontSize;
      fontSizeVal.textContent = fontSize;
      textBgColor = ann.bgColor || '#ffffff';
      textBgEnabled = ann.bgEnabled || false;
      textBgColorInput.value = textBgColor;
      textBgCheckbox.checked = textBgEnabled;
      document.getElementById('text-props').style.display = 'block';
    }
  }

  function hideSelectionProps() {
    if (currentTool !== 'text') {
      document.getElementById('text-props').style.display = 'none';
    }
  }

  // ── Live-update selected annotation when sidebar changes ──────
  function updateSelectedAnnotation() {
    if (!selectedAnnotation || currentTool !== 'select') return;
    const ann = selectedAnnotation;
    if (ann.color !== undefined) ann.color = strokeColor;
    if (ann.width !== undefined) ann.width = strokeWidth;
    if (ann.type === 'text') {
      ann.fontSize = fontSize;
      ann.bgColor = textBgColor;
      ann.bgEnabled = textBgEnabled;
    }
    if (ann.type === 'step') {
      ann.size = Math.max(strokeWidth * 6, 32);
    }
    redraw();
  }

  // ── Crop ──────────────────────────────────────────────────────
  document.getElementById('btn-crop-apply').addEventListener('click', applyCrop);
  document.getElementById('btn-crop-cancel').addEventListener('click', () => {
    document.querySelector('[data-tool="select"]').click();
  });

  function drawCropOverlay() {
    if (!cropRect) return;
    const { x, y, w, h } = normRect(cropRect);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    // Top
    ctx.fillRect(0, 0, canvas.width, y);
    // Bottom
    ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);
    // Left
    ctx.fillRect(0, y, x, h);
    // Right
    ctx.fillRect(x + w, y, canvas.width - x - w, h);

    // Border
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    // Dimensions
    ctx.fillStyle = '#6366f1';
    ctx.font = '14px system-ui';
    ctx.fillText(`${Math.round(w)} x ${Math.round(h)}`, x + w / 2 - 30, y + h + 20);
    ctx.restore();
  }

  function applyCrop() {
    if (!cropRect) return;
    const { x, y, w, h } = normRect(cropRect);
    if (w < 5 || h < 5) return;

    // Render current state to get the image with annotations
    redraw();
    const imageData = ctx.getImageData(x, y, w, h);

    // Create new base image from crop
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(imageData, 0, 0);

    const img = new Image();
    img.onload = () => {
      baseImage = img;
      canvas.width = w;
      canvas.height = h;
      annotations = [];
      redoStack = [];

      zoomLevel = getInitialScale();
      applyZoom();

      redraw();
      document.querySelector('[data-tool="select"]').click();
      showToast('Recadrage appliqué');
    };
    img.src = tempCanvas.toDataURL('image/png');
  }

  function normRect(r) {
    return {
      x: r.w < 0 ? r.x + r.w : r.x,
      y: r.h < 0 ? r.y + r.h : r.y,
      w: Math.abs(r.w),
      h: Math.abs(r.h)
    };
  }

  // ── Redraw ────────────────────────────────────────────────────
  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (baseImage) {
      ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
    }
    annotations.forEach(ann => drawAnnotation(ann));

    // Selection highlight + resize handles
    if (selectedAnnotation && currentTool === 'select') {
      ctx.save();
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      const b = getBounds(selectedAnnotation);
      if (b) ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
      ctx.setLineDash([]);
      ctx.restore();
      drawHandles(selectedAnnotation);
    }
  }

  function getBounds(ann) {
    switch (ann.type) {
      case 'rect': case 'blur': case 'highlight':
        return { x: ann.x, y: ann.y, w: ann.w, h: ann.h };
      case 'circle':
        return { x: ann.cx - Math.abs(ann.rx), y: ann.cy - Math.abs(ann.ry), w: Math.abs(ann.rx) * 2, h: Math.abs(ann.ry) * 2 };
      case 'arrow': case 'line':
        return {
          x: Math.min(ann.x1, ann.x2), y: Math.min(ann.y1, ann.y2),
          w: Math.abs(ann.x2 - ann.x1), h: Math.abs(ann.y2 - ann.y1)
        };
      case 'text':
        ctx.font = `${ann.fontSize}px system-ui, sans-serif`;
        const m = ctx.measureText(ann.text);
        return { x: ann.x, y: ann.y - ann.fontSize, w: m.width, h: ann.fontSize + 4 };
      case 'freehand':
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        ann.points.forEach(p => {
          minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        });
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      case 'step': {
        const sr = ann.size / 2;
        return { x: ann.x - sr, y: ann.y - sr, w: ann.size, h: ann.size };
      }
      default: return null;
    }
  }

  // ── Resize handles ────────────────────────────────────────────
  const HANDLE_SIZE = 8;
  const resizableTypes = ['rect', 'blur', 'highlight', 'circle'];

  function getHandles(ann) {
    const b = getBounds(ann);
    if (!b) return [];
    const s = HANDLE_SIZE;
    return [
      { id: 'nw', x: b.x - s/2, y: b.y - s/2 },
      { id: 'ne', x: b.x + b.w - s/2, y: b.y - s/2 },
      { id: 'sw', x: b.x - s/2, y: b.y + b.h - s/2 },
      { id: 'se', x: b.x + b.w - s/2, y: b.y + b.h - s/2 },
    ];
  }

  function hitHandle(ann, pos) {
    if (!resizableTypes.includes(ann.type)) return null;
    const handles = getHandles(ann);
    const s = HANDLE_SIZE + 4; // extra tolerance
    for (const h of handles) {
      if (pos.x >= h.x - 2 && pos.x <= h.x + s + 2 &&
          pos.y >= h.y - 2 && pos.y <= h.y + s + 2) {
        return h.id;
      }
    }
    return null;
  }

  function drawHandles(ann) {
    if (!resizableTypes.includes(ann.type)) return;
    const handles = getHandles(ann);
    const s = HANDLE_SIZE;
    ctx.save();
    for (const h of handles) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(h.x + s/2, h.y + s/2, s/2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Delete selected annotation ────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') &&
        selectedAnnotation && currentTool === 'select' &&
        e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
      const idx = annotations.indexOf(selectedAnnotation);
      if (idx >= 0) {
        redoStack.push(annotations.splice(idx, 1)[0]);
        selectedAnnotation = null;
        redraw();
      }
    }
  });

  // ── Save / Export ─────────────────────────────────────────────
  document.getElementById('btn-save-png').addEventListener('click', () => saveImage('png'));
  document.getElementById('btn-save-jpg').addEventListener('click', () => saveImage('jpeg'));
  document.getElementById('btn-save-pdf').addEventListener('click', savePDF);
  document.getElementById('btn-copy').addEventListener('click', copyToClipboard);
  document.getElementById('btn-share').addEventListener('click', shareImgur);

  function getFinalCanvas() {
    // Render at full resolution without selection highlight
    const sel = selectedAnnotation;
    selectedAnnotation = null;
    redraw();
    selectedAnnotation = sel;
    return canvas;
  }

  function saveImage(format) {
    const c = getFinalCanvas();
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const quality = format === 'jpeg' ? 0.92 : undefined;

    c.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = smartFilename(ext);
      a.click();
      URL.revokeObjectURL(url);
      showToast(`${ext.toUpperCase()} enregistré`);
      redraw();
    }, mime, quality);
  }

  function savePDF() {
    const c = getFinalCanvas();
    const imgData = c.toDataURL('image/jpeg', 0.95);

    // Use jsPDF if available, otherwise fallback
    if (typeof jspdf !== 'undefined' && jspdf.jsPDF) {
      const { jsPDF } = jspdf;
      const w = c.width;
      const h = c.height;
      const orientation = w > h ? 'landscape' : 'portrait';
      const pdf = new jsPDF({ orientation, unit: 'px', format: [w, h] });
      pdf.addImage(imgData, 'JPEG', 0, 0, w, h);
      pdf.save(smartFilename('pdf'));
      showToast('PDF enregistré');
    } else {
      // Fallback: open image in new tab for print-to-PDF
      const win = window.open();
      win.document.write(`<img src="${imgData}" style="max-width:100%">`);
      win.document.title = 'Shotly - PDF';
      showToast('Utilisez Imprimer \u203a PDF');
    }
    redraw();
  }

  async function copyToClipboard() {
    const c = getFinalCanvas();
    try {
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast('Copié dans le presse-papiers');
    } catch (e) {
      console.error('Clipboard error:', e);
      showToast('Erreur de copie');
    }
    redraw();
  }

  function smartFilename(ext) {
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const time = `${String(d.getHours()).padStart(2,'0')}h${String(d.getMinutes()).padStart(2,'0')}`;
    // Sanitize page title: lowercase, keep alphanum/spaces, collapse
    let slug = '';
    if (pageTitle) {
      slug = pageTitle
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
        .replace(/[^a-z0-9 ]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 40)
        .replace(/-$/, '');
    }
    return slug
      ? `shotly-${slug}-${date}-${time}.${ext}`
      : `shotly-${date}-${time}.${ext}`;
  }

  // ── Share via Imgur (anonymous upload) ─────────────────────────
  const IMGUR_CLIENT_ID = '546c25a59c58ad7'; // Imgur anonymous demo Client-ID

  async function shareImgur() {
    const btn = document.getElementById('btn-share');
    const originalHTML = btn.innerHTML;

    // Show loading state
    btn.disabled = true;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
      <span>Upload...</span>`;

    try {
      const c = getFinalCanvas();
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      redraw();

      // Convert blob to base64
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });

      const resp = await fetch('https://api.imgur.com/3/image', {
        method: 'POST',
        headers: {
          'Authorization': `Client-ID ${IMGUR_CLIENT_ID}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image: base64,
          type: 'base64',
          title: smartFilename('png'),
          description: 'Shared via Shotly'
        })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.data?.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const link = data.data.link;

      // Copy link to clipboard
      await navigator.clipboard.writeText(link);
      showToast('Lien copié\u00a0: ' + link);

    } catch (e) {
      console.error('Imgur upload error:', e);
      showToast('Erreur upload\u00a0: ' + e.message, true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
    }
  }

  // ── Toast notification ────────────────────────────────────────
  function showToast(message, isError = false) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    const icon = document.createElement('span');
    icon.className = 'toast-icon' + (isError ? ' error' : '');
    icon.innerHTML = isError
      ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>'
      : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="4 12 10 18 20 6"/></svg>';
    toast.appendChild(icon);
    toast.appendChild(document.createTextNode(message));
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2400);
  }

  // ── OCR — Tesseract.js integration ─────────────────────────────
  function drawOcrOverlay() {
    if (!ocrRect) return;
    const { x, y, w, h } = normRect(ocrRect);
    ctx.save();
    // Dim outside
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, canvas.width, y);
    ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, canvas.width - x - w, h);
    // Border
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    // Label
    ctx.fillStyle = '#6366f1';
    ctx.font = 'bold 13px system-ui';
    ctx.fillText('OCR', x + 6, y - 6);
    ctx.restore();
  }

  let ocrWorker = null;

  async function getOcrWorker() {
    if (ocrWorker) return ocrWorker;
    const workerUrl = chrome.runtime.getURL('lib/tesseract-worker.min.js');
    const corePath = chrome.runtime.getURL('lib/');
    ocrWorker = await Tesseract.createWorker('fra+eng', 1, {
      workerPath: workerUrl,
      corePath: corePath,
      workerBlobURL: false,
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const pct = Math.round((m.progress || 0) * 100);
          const el = document.querySelector('.ocr-loading-progress');
          if (el) el.textContent = `Reconnaissance... ${pct}%`;
        }
      }
    });
    return ocrWorker;
  }

  async function runOcr(rect) {
    // Show loading overlay
    const loadingEl = document.createElement('div');
    loadingEl.className = 'ocr-loading';
    loadingEl.innerHTML = `
      <div class="ocr-loading-spinner"></div>
      <span>Extraction du texte...</span>
      <span class="ocr-loading-progress">Initialisation...</span>`;
    document.body.appendChild(loadingEl);

    try {
      // Crop the selected region from the canvas (with annotations rendered)
      redraw(); // make sure annotations are drawn
      const imageData = ctx.getImageData(
        Math.round(rect.x), Math.round(rect.y),
        Math.round(rect.w), Math.round(rect.h)
      );
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = rect.w;
      tempCanvas.height = rect.h;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.putImageData(imageData, 0, 0);

      const worker = await getOcrWorker();
      const { data: { text } } = await worker.recognize(tempCanvas);

      // Remove loading
      loadingEl.remove();
      ocrRect = null;
      redraw();

      const trimmed = text.trim();
      if (!trimmed) {
        showToast('Aucun texte détecté', true);
        return;
      }

      // Show result modal
      showOcrResult(trimmed);

    } catch (err) {
      loadingEl.remove();
      ocrRect = null;
      redraw();
      console.error('OCR error:', err);
      showToast('Erreur OCR\u00a0: ' + err.message, true);
    }
  }

  function showOcrResult(text) {
    const modal = document.getElementById('ocr-modal');
    const resultArea = document.getElementById('ocr-result');
    resultArea.value = text;
    modal.style.display = 'flex';
    resultArea.focus();
    resultArea.select();
  }

  // OCR modal — close
  document.getElementById('ocr-close').addEventListener('click', () => {
    document.getElementById('ocr-modal').style.display = 'none';
  });
  document.getElementById('ocr-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById('ocr-modal').style.display = 'none';
    }
  });

  // OCR modal — copy
  document.getElementById('ocr-copy').addEventListener('click', async () => {
    const text = document.getElementById('ocr-result').value;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Texte copié dans le presse-papiers');
      document.getElementById('ocr-modal').style.display = 'none';
    } catch (e) {
      showToast('Erreur de copie', true);
    }
  });

  // Close OCR modal on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('ocr-modal');
      if (modal.style.display !== 'none') {
        modal.style.display = 'none';
      }
    }
  });

})();
