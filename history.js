// ── History Page Logic ─────────────────────────────────────────────
(() => {
  'use strict';

  const grid = document.getElementById('capture-grid');
  const emptyState = document.getElementById('empty-state');
  const countBadge = document.getElementById('count-badge');
  const selectionBar = document.getElementById('selection-bar');
  const selectionCount = document.getElementById('selection-count');
  const btnClearAll = document.getElementById('btn-clear-all');

  let captures = [];
  let selected = new Set(); // set of capture ids

  // ── Load & Render ──────────────────────────────────────────────
  async function loadCaptures() {
    captures = await ShotlyDB.list();
    render();
  }

  function render() {
    grid.innerHTML = '';
    countBadge.textContent = captures.length + ' capture' + (captures.length !== 1 ? 's' : '');

    if (captures.length === 0) {
      emptyState.style.display = 'flex';
      grid.style.display = 'none';
      btnClearAll.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    grid.style.display = 'grid';
    btnClearAll.style.display = 'flex';

    captures.forEach(cap => {
      const card = document.createElement('div');
      card.className = 'capture-card' + (selected.has(cap.id) ? ' selected' : '');
      card.dataset.id = cap.id;

      const title = cap.pageTitle || 'Capture sans titre';
      const date = formatDate(cap.timestamp);
      const dims = cap.width && cap.height ? `${cap.width}×${cap.height}` : '';

      card.innerHTML = `
        <div class="card-checkbox" data-role="checkbox">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="4 12 10 18 20 6"/></svg>
        </div>
        <div class="card-actions">
          <button class="card-action-btn delete" data-role="delete" title="Supprimer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
        </div>
        <img class="card-thumb" src="${cap.thumbnail || ''}" alt="${title}" loading="lazy">
        <div class="card-info">
          <div class="card-title">${escHtml(title)}</div>
          <div class="card-meta">
            <span>${date}</span>
            ${dims ? `<span>${dims}</span>` : ''}
          </div>
        </div>`;

      grid.appendChild(card);
    });

    updateSelectionBar();
  }

  // ── Event delegation on grid ───────────────────────────────────
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.capture-card');
    if (!card) return;
    const id = Number(card.dataset.id);

    // Delete button
    if (e.target.closest('[data-role="delete"]')) {
      e.stopPropagation();
      deleteCaptures([id]);
      return;
    }

    // Checkbox or shift-click → toggle selection
    if (e.target.closest('[data-role="checkbox"]') || e.shiftKey) {
      e.stopPropagation();
      toggleSelect(id);
      return;
    }

    // Normal click → open in editor
    openCapture(id);
  });

  // ── Selection ──────────────────────────────────────────────────
  function toggleSelect(id) {
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
    // Update card class
    const card = grid.querySelector(`[data-id="${id}"]`);
    if (card) card.classList.toggle('selected', selected.has(id));
    updateSelectionBar();
  }

  function updateSelectionBar() {
    if (selected.size > 0) {
      selectionBar.style.display = 'flex';
      selectionCount.textContent = selected.size + ' sélectionnée' + (selected.size > 1 ? 's' : '');
    } else {
      selectionBar.style.display = 'none';
    }
  }

  // Deselect all
  document.getElementById('btn-deselect').addEventListener('click', () => {
    selected.clear();
    grid.querySelectorAll('.capture-card.selected').forEach(c => c.classList.remove('selected'));
    updateSelectionBar();
  });

  // ── Open capture in editor ─────────────────────────────────────
  function openCapture(id) {
    chrome.runtime.sendMessage({ action: 'reopen-capture', id });
  }

  // Open selected (first one)
  document.getElementById('btn-open-selected').addEventListener('click', () => {
    if (selected.size === 0) return;
    // Open first selected
    const firstId = [...selected][0];
    openCapture(firstId);
  });

  // ── Delete captures ────────────────────────────────────────────
  async function deleteCaptures(ids) {
    await ShotlyDB.remove(ids);
    ids.forEach(id => selected.delete(id));
    captures = captures.filter(c => !ids.includes(c.id));
    render();
    showToast(ids.length === 1 ? 'Capture supprimée' : `${ids.length} captures supprimées`);
  }

  document.getElementById('btn-delete-selected').addEventListener('click', () => {
    if (selected.size === 0) return;
    deleteCaptures([...selected]);
  });

  // ── Clear all ──────────────────────────────────────────────────
  btnClearAll.addEventListener('click', async () => {
    if (!confirm('Supprimer tout l\'historique ?')) return;
    await ShotlyDB.clearAll();
    captures = [];
    selected.clear();
    render();
    showToast('Historique effacé');
  });

  // ── Helpers ────────────────────────────────────────────────────
  function formatDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const capDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = (today - capDay) / 86400000;

    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    if (diff === 0) return `Aujourd'hui ${time}`;
    if (diff === 1) return `Hier ${time}`;
    if (diff < 7) return d.toLocaleDateString('fr-FR', { weekday: 'long' }) + ` ${time}`;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) + ` ${time}`;
  }

  function escHtml(s) {
    const el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
  }

  function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2400);
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    // Ctrl+A → select all
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      captures.forEach(c => selected.add(c.id));
      grid.querySelectorAll('.capture-card').forEach(c => c.classList.add('selected'));
      updateSelectionBar();
    }
    // Delete / Backspace → delete selected
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size > 0) {
      deleteCaptures([...selected]);
    }
    // Escape → deselect
    if (e.key === 'Escape') {
      selected.clear();
      grid.querySelectorAll('.capture-card.selected').forEach(c => c.classList.remove('selected'));
      updateSelectionBar();
    }
  });

  // ── Init ───────────────────────────────────────────────────────
  loadCaptures();
})();
