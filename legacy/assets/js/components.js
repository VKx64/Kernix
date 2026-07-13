/* ============================================================
   Kernix — Components JS
   Consolidated round 44
   Sources: round7.js + round8-search.js + round9.js
            + round11.js + round12.js + round34-list-inline.js
   Each section is its own IIFE so they don't interfere.
   ============================================================ */


/* ============================================================
   === From round7.js ===
   ============================================================ */
/**
 * Round 7 — addons
 * - Live timezone clocks in client list
 * - Filter popover detached to body to escape table overflow clipping
 * - Project shelf task rows open the task shelf
 */
(function () {
  'use strict';

  /* ============================================================
     Live timezone clocks
  ============================================================ */
  function fmtTime(tz) {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
      }).format(new Date());
    } catch {
      return '—';
    }
  }

  function tickClocks() {
    document.querySelectorAll('.tz-cell').forEach(cell => {
      const tz   = cell.dataset.tz;
      const time = cell.querySelector('.tz-time');
      if (tz && time) time.textContent = fmtTime(tz);
    });
  }

  setInterval(tickClocks, 30000); // every 30s
  document.addEventListener('DOMContentLoaded', tickClocks);
  // Also tick when grid AJAX-refreshes
  const tbodyObserver = new MutationObserver(tickClocks);
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.data-table tbody').forEach(tb => {
      tbodyObserver.observe(tb, { childList: true });
    });
  });

  /* ============================================================
     Filter popover — detach to body on open to escape table overflow
  ============================================================ */
  // Move popovers to body, position absolutely under their header
  const detached = new WeakMap(); // popover → original parent

  function positionDetachedPopover(popover, th) {
    const rect = th.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.top      = (rect.bottom + 2) + 'px';
    // align-right popovers anchor to right edge of th
    if (popover.classList.contains('align-right')) {
      popover.style.left  = 'auto';
      popover.style.right = (window.innerWidth - rect.right) + 'px';
    } else {
      popover.style.left  = rect.left + 'px';
      popover.style.right = 'auto';
    }
    popover.style.zIndex = '1500';
  }

  function detachPopover(popover, th) {
    if (!detached.has(popover)) {
      detached.set(popover, { parent: popover.parentNode, next: popover.nextSibling });
      document.body.appendChild(popover);
    }
    positionDetachedPopover(popover, th);
  }

  function reattachPopover(popover) {
    if (detached.has(popover)) {
      const info = detached.get(popover);
      popover.style.position = '';
      popover.style.top = popover.style.left = popover.style.right = popover.style.zIndex = '';
      info.parent.insertBefore(popover, info.next);
      detached.delete(popover);
    }
  }

  // Hook the existing popover open/close — re-bind via MutationObserver on 'open' class
  function observePopovers() {
    document.querySelectorAll('.col-filter-popover').forEach(popover => {
      if (popover._round7Hooked) return;
      popover._round7Hooked = true;

      const obs = new MutationObserver(() => {
        const th = popover._origTh || popover.closest('th');
        if (th) popover._origTh = th;
        if (popover.classList.contains('open')) {
          if (popover._origTh) detachPopover(popover, popover._origTh);
        } else {
          reattachPopover(popover);
        }
      });
      obs.observe(popover, { attributes: true, attributeFilter: ['class'] });

      // Capture original th BEFORE first open
      popover._origTh = popover.closest('th');
    });
  }

  document.addEventListener('DOMContentLoaded', observePopovers);
  // Re-run after grid refreshes
  const gridObserver = new MutationObserver(observePopovers);
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.data-table thead').forEach(th => {
      gridObserver.observe(th, { childList: true, subtree: true });
    });
  });

  // Reposition on scroll / resize while open
  function repositionOpen() {
    document.querySelectorAll('.col-filter-popover.open').forEach(p => {
      if (p._origTh) positionDetachedPopover(p, p._origTh);
    });
  }
  window.addEventListener('scroll', repositionOpen, true);
  window.addEventListener('resize', repositionOpen);

  // Click-outside detection has to work when popover is body-level
  document.addEventListener('click', (e) => {
    if (e.target.closest('.col-filter-popover') || e.target.closest('.th-label')) return;
    document.querySelectorAll('.col-filter-popover.open').forEach(p => {
      p.classList.remove('open');
      reattachPopover(p);
    });
  }, true);

  /* ============================================================
     Project shelf → wire task row clicks to open task shelf
  ============================================================ */
  // The project shelf body is loaded by AJAX, so use event delegation
  document.addEventListener('click', (e) => {
    const row = e.target.closest('.proj-task-row[data-task-id]');
    if (!row) return;
    if (e.target.closest('a, button, input, select')) return;
    e.preventDefault();
    e.stopPropagation();
    const id = row.dataset.taskId;
    if (window.openTaskShelf) window.openTaskShelf(id);
  });

})();

/* ============================================================
   === From round8-search.js ===
   ============================================================ */
/**
 * Round 8 — global topbar search
 * Submits a `q=` param to the current page on enter (debounced 350ms while typing on list pages).
 */
(function () {
  'use strict';

  const input = document.getElementById('global-search');
  if (!input) return;

  // Init from URL
  const urlQ = new URL(location.href).searchParams.get('q') || '';
  input.value = urlQ;

  function go(q) {
    const url = new URL(location.href);
    if (q) url.searchParams.set('q', q);
    else   url.searchParams.delete('q');
    url.searchParams.delete('page');
    location.href = url.toString();
  }

  // Enter to search
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      go(input.value.trim());
    }
    if (e.key === 'Escape' && input.value) {
      input.value = '';
      go('');
    }
  });

  // Keyboard shortcut: / focuses search
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

})();

/* ============================================================
   === From round9.js ===
   ============================================================ */
/**
 * Round 9 — global helpers
 *  - checkClockedIn() — async; returns true if clocked in, else shows prompt and returns false
 *  - showClockInPrompt() — shows modal asking user to clock in
 *  - openLightbox() — image lightbox for note attachments
 */
(function () {
  'use strict';

  const BASE = document.querySelector('meta[name=app-base]')?.content || '';

  /* -------------------------------------------------------
     Clock-in checker
  ------------------------------------------------------- */
  // Cache the state for 30s to avoid hammering the endpoint
  let cachedState = null;
  let cachedAt    = 0;

  async function getClockState(force = false) {
    if (!force && cachedState && (Date.now() - cachedAt) < 30000) return cachedState;
    try {
      const res = await fetch(`${BASE}/index.php?p=time&action=status`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      cachedState = await res.json();
      cachedAt    = Date.now();
      return cachedState;
    } catch {
      return { status: 'unknown' };
    }
  }

  window.invalidateClockCache = () => { cachedState = null; };

  window.checkClockedIn = async function () {
    const s = await getClockState();
    if (s.status === 'working' || s.status === 'break') return true;
    showClockInPrompt();
    return false;
  };

  function showClockInPrompt() {
    let modal = document.getElementById('clockin-prompt');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'clockin-prompt';
      modal.className = 'modal-backdrop';
      modal.innerHTML = `
        <div class="modal" style="max-width:420px">
          <div class="modal-header">
            <h2 class="modal-title">⏰ Clock In First</h2>
            <button class="modal-close" data-modal-close>&times;</button>
          </div>
          <div class="modal-body">
            <p style="margin:0 0 10px;font-size:14px;line-height:1.5">
              You're not clocked in yet. You'll need to clock in before making changes.
            </p>
            <p style="margin:0;font-size:12px;color:var(--text-muted)">
              This ensures your work time is tracked accurately.
            </p>
          </div>
          <div class="modal-footer">
            <div class="modal-footer-left"></div>
            <div class="modal-footer-right">
              <button type="button" class="btn" data-modal-close>Not Now</button>
              <button type="button" class="btn btn-primary" id="clockin-prompt-go">Clock In Now</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modal);

      modal.querySelector('#clockin-prompt-go').addEventListener('click', async () => {
        const fd = new FormData();
        fd.append('_csrf', document.querySelector('meta[name=csrf]')?.content || '');
        try {
          const res = await fetch(`${BASE}/index.php?p=time&action=clock_in`, {
            method: 'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'}
          });
          const j = await res.json();
          if (j.ok) {
            window.showToast?.('Clocked in. Try again.', 'success');
            invalidateClockCache();
            window.closeModal?.('clockin-prompt');
            // Trigger any open time tracker widget to refresh
            window.dispatchEvent(new CustomEvent('clock-state-changed'));
          } else {
            window.showToast?.(j.message || 'Clock in failed.', 'error');
          }
        } catch {
          window.showToast?.('Network error.', 'error');
        }
      });
    }
    window.openModal?.('clockin-prompt');
  }
  window.showClockInPrompt = showClockInPrompt;

  /* -------------------------------------------------------
     Image lightbox
  ------------------------------------------------------- */
  let lightbox = null;
  function buildLightbox() {
    if (lightbox) return lightbox;
    lightbox = document.createElement('div');
    lightbox.id = 'image-lightbox';
    lightbox.innerHTML = `
      <button class="lb-close" type="button" aria-label="Close">&times;</button>
      <img class="lb-image" alt="">
    `;
    document.body.appendChild(lightbox);

    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox || e.target.classList.contains('lb-close')) {
        closeLightbox();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightbox.classList.contains('open')) closeLightbox();
    });

    return lightbox;
  }

  window.openLightbox = function (src) {
    const lb = buildLightbox();
    lb.querySelector('.lb-image').src = src;
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  function closeLightbox() {
    if (lightbox) {
      lightbox.classList.remove('open');
      document.body.style.overflow = '';
    }
  }
  window.closeLightbox = closeLightbox;

  /* -------------------------------------------------------
     Wire delete URLs through clock-in check too
     The existing delete handler is in app.js — we wrap it.
  ------------------------------------------------------- */
  // Listen at capture phase so we intercept before app.js handler
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete-confirm]');
    if (!btn) return;
    // Don't double-process if already prevented
    if (btn._clockChecked) return;

    // Only check on data-modifying delete actions
    const url = btn.dataset.deleteUrl || btn.dataset.deleteTemplate;
    if (!url) return;

    // Stop the default delete handler from running
    e.stopImmediatePropagation();
    e.preventDefault();

    // Confirm first (same UX as app.js)
    const label = btn.dataset.deleteConfirm || 'this record';
    if (!confirm(`Delete ${label}? This action cannot be undone.`)) return;

    if (!await window.checkClockedIn()) return;

    // Now proceed manually
    let finalUrl = btn.dataset.deleteUrl;
    if (!finalUrl && btn.dataset.deleteTemplate) {
      const id = btn.dataset.recordId;
      if (!id) { window.showToast?.('No record ID.', 'error'); return; }
      finalUrl = btn.dataset.deleteTemplate + encodeURIComponent(id);
    }

    const csrf = document.querySelector('meta[name=csrf]')?.content || '';
    const fd = new FormData();
    fd.append('_csrf', csrf);
    try {
      const res  = await fetch(finalUrl, { method:'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'} });
      const json = await res.json();
      if (json.ok) {
        window.showToast?.(json.message || 'Deleted.', 'success');
        setTimeout(() => location.reload(), 400);
      } else if (json.reason === 'not_clocked_in') {
        window.showClockInPrompt();
      } else {
        window.showToast?.(json.message || 'Delete failed.', 'error');
      }
    } catch { window.showToast?.('Network error.', 'error'); }
  }, true); // capture phase

  // Same for archive
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-archive-url]');
    if (!btn || btn._archiveChecked) return;
    e.stopImmediatePropagation();
    e.preventDefault();

    if (!await window.checkClockedIn()) return;

    const csrf = document.querySelector('meta[name=csrf]')?.content || '';
    const fd = new FormData();
    fd.append('_csrf', csrf);
    try {
      const res  = await fetch(btn.dataset.archiveUrl, { method:'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'} });
      const json = await res.json();
      if (json.ok) {
        window.showToast?.(json.message || 'Done.', 'success');
        setTimeout(() => location.reload(), 400);
      } else if (json.reason === 'not_clocked_in') {
        window.showClockInPrompt();
      } else {
        window.showToast?.(json.message || 'Failed.', 'error');
      }
    } catch { window.showToast?.('Network error.', 'error'); }
  }, true);

})();

/* ============================================================
   === From round11.js ===
   ============================================================ */
/**
 * Round 11 — UX fixes
 *  - Custom "Are you sure?" modal replacing native confirm()
 *  - Global header search → always searches Tasks
 */
(function () {
  'use strict';

  const BASE = document.querySelector('meta[name=app-base]')?.content || '';

  /* ============================================================
     Confirm modal — drop-in replacement for window.confirm()
     Returns a Promise<boolean>
  ============================================================ */
  function buildConfirmModal() {
    let modal = document.getElementById('confirm-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">Confirm</h2>
          <button class="modal-close" data-modal-close type="button">&times;</button>
        </div>
        <div class="modal-body">
          <div class="confirm-row">
            <div class="confirm-icon" id="confirm-modal-icon">!</div>
            <div style="flex:1;min-width:0">
              <h3 class="confirm-title" id="confirm-modal-title">Are you sure?</h3>
              <p class="confirm-message" id="confirm-modal-message">This action cannot be undone.</p>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <div class="modal-footer-left"></div>
          <div class="modal-footer-right">
            <button type="button" class="btn" id="confirm-modal-cancel">Cancel</button>
            <button type="button" class="btn btn-danger" id="confirm-modal-ok">Delete</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  let pendingResolve = null;

  function customConfirm(opts) {
    // opts can be a string (message) or object {title, message, okLabel, okClass, icon}
    if (typeof opts === 'string') opts = { message: opts };
    opts = opts || {};

    const modal     = buildConfirmModal();
    const titleEl   = modal.querySelector('#confirm-modal-title');
    const messageEl = modal.querySelector('#confirm-modal-message');
    const iconEl    = modal.querySelector('#confirm-modal-icon');
    const okBtn     = modal.querySelector('#confirm-modal-ok');
    const cancelBtn = modal.querySelector('#confirm-modal-cancel');

    titleEl.textContent   = opts.title   || 'Are you sure?';
    messageEl.textContent = opts.message || 'This action cannot be undone.';
    iconEl.textContent    = opts.icon    || '!';
    okBtn.textContent     = opts.okLabel || 'Delete';
    okBtn.className       = 'btn ' + (opts.okClass || 'btn-danger');

    // Resolve previous if any (shouldn't happen but be safe)
    if (pendingResolve) { pendingResolve(false); pendingResolve = null; }

    return new Promise(resolve => {
      pendingResolve = resolve;

      const cleanup = (result) => {
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        modal.querySelector('[data-modal-close]')?.removeEventListener('click', onCancel);
        window.closeModal?.('confirm-modal');
        if (pendingResolve) {
          pendingResolve(result);
          pendingResolve = null;
        }
      };

      const onOk     = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onBackdrop = (e) => { if (e.target === modal) cleanup(false); };
      const onKey = (e) => {
        if (e.key === 'Escape') cleanup(false);
        if (e.key === 'Enter')  cleanup(true);
      };

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      modal.querySelector('[data-modal-close]')?.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);

      window.openModal?.('confirm-modal');
      setTimeout(() => okBtn.focus(), 50);
    });
  }

  window.customConfirm = customConfirm;

  /* ============================================================
     Replace window.confirm() globally
     (Affects any code that still calls confirm() — including app.js delete handler)
  ============================================================ */
  const nativeConfirm = window.confirm;
  window.confirm = function (message) {
    // Native confirm is synchronous; we can't truly replicate that.
    // Most calls in this app are: `if (!confirm(...)) return;`
    // We can return false synchronously and show the modal — the caller bails,
    // then if user confirms, we re-trigger the action. But that requires per-call wiring.
    //
    // Better approach: intercept the click handlers at the source instead.
    // For now, fall back to native confirm for any legacy callers.
    return nativeConfirm.call(window, message);
  };

  /* ============================================================
     Intercept delete buttons EARLIER than round9.js
     Use capture phase + higher priority binding.
  ============================================================ */

  // We need to intercept BEFORE round9.js (which runs in capture phase too).
  // Strategy: bind on `mousedown` instead of click — mousedown fires before click.
  // OR: bind in capture and use stopImmediatePropagation.
  // Best: replace native confirm only for OUR delete flow.

  // Step 1: Intercept all data-delete-* clicks and route through customConfirm
  document.addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-delete-confirm]');
    if (!btn) return;
    if (btn._round11Handled) return;

    // Take over completely
    e.preventDefault();
    e.stopImmediatePropagation();

    const label = btn.dataset.deleteConfirm || 'this record';
    const ok = await customConfirm({
      title:   'Delete this item?',
      message: `Are you sure you want to delete ${label}? This action cannot be undone.`,
      okLabel: 'Delete',
      okClass: 'btn-danger',
    });
    if (!ok) return;

    // User confirmed — now check clock-in (round9 logic) then call API
    if (window.checkClockedIn && !await window.checkClockedIn()) return;

    let url = btn.dataset.deleteUrl;
    if (!url && btn.dataset.deleteTemplate) {
      const id = btn.dataset.recordId;
      if (!id) { window.showToast?.('No record ID.', 'error'); return; }
      url = btn.dataset.deleteTemplate + encodeURIComponent(id);
    }
    if (!url) { window.showToast?.('No delete URL.', 'error'); return; }

    const csrf = document.querySelector('meta[name=csrf]')?.content || '';
    const fd = new FormData();
    fd.append('_csrf', csrf);
    try {
      const res  = await fetch(url, { method: 'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'} });
      const json = await res.json();
      if (json.ok) {
        window.showToast?.(json.message || 'Deleted.', 'success');
        setTimeout(() => location.reload(), 400);
      } else if (json.reason === 'not_clocked_in') {
        window.showClockInPrompt?.();
      } else {
        window.showToast?.(json.message || 'Delete failed.', 'error');
      }
    } catch {
      window.showToast?.('Network error.', 'error');
    }
  }, true); // capture — fires before round9.js and app.js

  // Step 2: Subtask delete also needs the modal (uses [data-subtask-delete] in shelf inline JS)
  document.addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-subtask-delete]');
    if (!btn || btn._round11SubHandled) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    btn._round11SubHandled = true;
    setTimeout(() => { delete btn._round11SubHandled; }, 100);

    const ok = await customConfirm({
      title:   'Delete subtask?',
      message: 'Are you sure you want to delete this subtask? This action cannot be undone.',
      okLabel: 'Delete',
    });
    if (!ok) return;

    if (window.checkClockedIn && !await window.checkClockedIn()) return;

    const id   = btn.dataset.subtaskDelete;
    const csrf = document.querySelector('meta[name=csrf]')?.content || '';
    const fd   = new FormData();
    fd.append('_csrf', csrf);
    fd.append('id', id);
    try {
      const res = await fetch(`${BASE}/index.php?p=tasks&action=delete_subtask`, {
        method: 'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'}
      });
      const j = await res.json();
      if (j.ok) {
        window.showToast?.('Subtask deleted.', 'success');
        window.reloadSubtasks?.();
      } else {
        window.showToast?.(j.message || 'Failed.', 'error');
      }
    } catch { window.showToast?.('Network error.', 'error'); }
  }, true);

  // Step 3: Note delete
  document.addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-note-delete]');
    if (!btn || btn._round11NoteHandled) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    btn._round11NoteHandled = true;
    setTimeout(() => { delete btn._round11NoteHandled; }, 100);

    const ok = await customConfirm({
      title:   'Delete note?',
      message: 'Are you sure you want to delete this note? This action cannot be undone.',
      okLabel: 'Delete',
    });
    if (!ok) return;

    const id   = btn.dataset.noteDelete;
    const csrf = document.querySelector('meta[name=csrf]')?.content || '';
    const fd   = new FormData();
    fd.append('_csrf', csrf);
    fd.append('id', id);
    try {
      const res = await fetch(`${BASE}/index.php?p=tasks&action=delete_note`, {
        method: 'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'}
      });
      const j = await res.json();
      if (j.ok) {
        window.showToast?.('Note deleted.', 'success');
        // Reload notes partial — find the task shelf and re-fetch
        const list = document.querySelector('.notes-list[id^="notes-list-"]');
        if (list) {
          const taskId = list.id.replace('notes-list-', '');
          const r = await fetch(`${BASE}/index.php?p=tasks&action=notes_partial&id=${taskId}`, {
            headers: {'X-Requested-With':'XMLHttpRequest'}
          });
          list.innerHTML = await r.text();
        }
      } else {
        window.showToast?.(j.message || 'Failed.', 'error');
      }
    } catch { window.showToast?.('Network error.', 'error'); }
  }, true);

  /* ============================================================
     Global header search — always search Tasks
  ============================================================ */
  const searchInput = document.getElementById('global-search');
  if (searchInput) {
    // Replace placeholder for clarity
    searchInput.placeholder = 'Search tasks…';

    // Clone the node to strip the old listener bound by round8-search.js,
    // then re-bind ours.
    const newInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newInput, searchInput);

    // If we're already on tasks page AND there's a q= param, pre-fill it
    const urlQ = new URL(location.href).searchParams.get('q') || '';
    const onTasks = (new URL(location.href).searchParams.get('p') || 'dashboard') === 'tasks';
    if (onTasks) newInput.value = urlQ;

    function goSearch(q) {
      // Always go to the Tasks page, scoped to all (clear scope filters too)
      const url = new URL(location.origin + BASE + '/index.php');
      url.searchParams.set('p', 'tasks');
      if (q) url.searchParams.set('q', q);
      // Clear "My Tasks" so search is across all
      url.searchParams.set('t_mine', '');
      location.href = url.toString();
    }

    newInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        goSearch(newInput.value.trim());
      }
      if (e.key === 'Escape') {
        newInput.value = '';
        if (onTasks && urlQ) goSearch('');
      }
    });

    // Keep the `/` shortcut working
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        newInput.focus();
        newInput.select();
      }
    });
  }

})();

/* ============================================================
   === From round12.js ===
   ============================================================ */
/**
 * Round 12 — robust shelf loader
 * Overrides window.openTaskShelf with a version that surfaces errors clearly.
 */
(function () {
  'use strict';

  const BASE = document.querySelector('meta[name=app-base]')?.content || '';

  async function loadTaskShelf(taskId) {
    const body = document.getElementById('task-shelf-body');
    if (!body) return;
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading…</div>';

    try {
      const res = await fetch(`${BASE}/index.php?p=tasks&action=shelf&id=${taskId}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });

      const html = await res.text();

      // Detect blank or near-blank responses (PHP fatal that produced no output)
      if (!html || html.trim().length < 20) {
        body.innerHTML = `
          <div style="padding:30px;color:#fff">
            <h2 style="color:var(--danger);margin:0 0 12px">Empty Response</h2>
            <div style="background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);padding:14px;border-radius:8px;font-size:13px;line-height:1.6">
              The server returned an empty or near-empty response for task #${taskId}.
              <br><br>
              <strong>HTTP status:</strong> ${res.status} ${res.statusText}<br>
              <strong>Response length:</strong> ${html.length} chars<br>
              <strong>First 200 chars:</strong> <code style="display:block;background:rgba(0,0,0,.3);padding:6px;border-radius:4px;margin-top:6px;word-break:break-all">${escapeHtml(html.substring(0, 200)) || '(empty)'}</code>
              <br>
              This usually means a PHP fatal error occurred. Check the server's error log,
              or visit <a href="${BASE}/index.php?p=tasks&action=shelf&id=${taskId}" target="_blank" style="color:var(--primary-hover)">the shelf URL directly in a new tab</a> to see the raw error.
            </div>
          </div>
        `;
        return;
      }

      // Detect HTTP error status
      if (!res.ok) {
        body.innerHTML = `
          <div style="padding:30px;color:#fff">
            <h2 style="color:var(--danger);margin:0 0 12px">HTTP ${res.status} ${res.statusText}</h2>
            <div style="background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);padding:14px;border-radius:8px;font-size:12px;line-height:1.5;max-height:400px;overflow:auto">
              ${html}
            </div>
          </div>
        `;
        return;
      }

      body.innerHTML = html;

      // After injecting HTML, manually execute any <script> tags
      // (innerHTML does NOT execute inline scripts by default)
      body.querySelectorAll('script').forEach(oldScript => {
        const newScript = document.createElement('script');
        Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
        newScript.textContent = oldScript.textContent;
        oldScript.parentNode.replaceChild(newScript, oldScript);
      });

    } catch (err) {
      body.innerHTML = `
        <div style="padding:30px;color:#fff">
          <h2 style="color:var(--danger);margin:0 0 12px">Network Error</h2>
          <div style="background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);padding:14px;border-radius:8px;font-size:13px">
            ${escapeHtml(err.message || 'Unknown error')}
          </div>
        </div>
      `;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Override the global loader — but preserve the wrapping openTaskShelf logic
  const origOpen = window.openTaskShelf;
  window.openTaskShelf = function (taskId) {
    const shelfWrap = document.getElementById('task-shelf-wrap');
    if (!shelfWrap) return;
    shelfWrap.classList.add('open');
    document.body.style.overflow = 'hidden';
    loadTaskShelf(taskId);
    const url = new URL(location.href);
    url.searchParams.set('shelf', taskId);
    try { history.pushState({ shelfTask: taskId }, '', url.toString()); } catch {}
  };

  // Replay if URL has ?shelf= param on load (in case the original handler already fired with broken loader)
  window.addEventListener('load', () => {
    const wantShelf = new URL(location.href).searchParams.get('shelf');
    if (wantShelf && document.getElementById('task-shelf-wrap')?.classList.contains('open')) {
      // Already opened by app.js but possibly with broken loader — reload it
      const body = document.getElementById('task-shelf-body');
      if (body && body.textContent.trim().length < 20) loadTaskShelf(wantShelf);
    }
  });

})();

/* ============================================================
   === From round34-list-inline.js ===
   ============================================================ */
/**
 * Round 34 — Task list inline editing
 * Clicking any of these cells opens a popover picker:
 *   status_value_id, urgency_value_id, type_value_id, assignee_user_id, due_date
 * Updates via the existing handle_update_field endpoint.
 */
(function () {
  const popover  = document.getElementById('tl-popover');
  if (!popover) return;
  const listEl   = document.getElementById('tl-popover-list');
  const dataEl   = document.getElementById('tl-options-data');
  if (!dataEl) return;

  const BASE = document.querySelector('meta[name=app-base]')?.content || '';
  const CSRF = document.querySelector('meta[name=csrf]')?.content || '';
  const OPTIONS = JSON.parse(dataEl.textContent || '{}');

  let activeTrigger = null;   // the <button> that opened the popover
  let activeField   = null;   // which field is being edited
  let activeTaskId  = null;
  let activeCurrent = null;   // current id/value

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function close() {
    popover.style.display = 'none';
    listEl.innerHTML = '';
    activeTrigger = null;
    activeField   = null;
    activeTaskId  = null;
    activeCurrent = null;
  }

  function positionPopover(trigger) {
    const r = trigger.getBoundingClientRect();
    popover.style.display = 'block';   // show first to measure
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = r.left;
    let top  = r.bottom + 4;
    if (left + pw + 12 > vw) left = vw - pw - 12;
    if (left < 8) left = 8;
    if (top + ph + 12 > vh) top = r.top - ph - 4;   // flip above
    if (top < 8) top = 8;

    popover.style.left = left + 'px';
    popover.style.top  = top  + 'px';
  }

  function fieldOptions(field) {
    if (field === 'status_value_id')   return OPTIONS.status   || [];
    if (field === 'urgency_value_id')  return OPTIONS.urgency  || [];
    if (field === 'type_value_id')     return OPTIONS.type     || [];
    if (field === 'assignee_user_id')  return OPTIONS.assignee || [];
    return [];
  }

  function renderPicker(field, currentId) {
    const opts = fieldOptions(field);
    const isAssignee = field === 'assignee_user_id';
    let html = '';

    // "— None —" option (clear the value)
    html += `<button type="button" class="tl-popover-item ${!currentId ? 'tl-popover-item-active' : ''}" data-value="">
      <span class="tl-popover-clear">— None —</span>
    </button>`;

    for (const o of opts) {
      const active = String(o.id) === String(currentId) ? 'tl-popover-item-active' : '';
      if (isAssignee) {
        const avatar = o.image
          ? `<img src="${BASE}/uploads/${escapeHtml(o.image)}" class="tl-popover-avatar">`
          : `<span class="avatar tl-popover-avatar">${escapeHtml((o.label || '?').slice(0,2))}</span>`;
        html += `<button type="button" class="tl-popover-item ${active}" data-value="${o.id}">
          ${avatar}<span>${escapeHtml(o.label || '(unnamed)')}</span>
        </button>`;
      } else {
        const swatch = o.color
          ? `<span class="tl-popover-swatch" style="background:${escapeHtml(o.color)}"></span>`
          : '';
        html += `<button type="button" class="tl-popover-item ${active}" data-value="${o.id}">
          ${swatch}<span>${escapeHtml(o.label || '(unlabeled)')}</span>
        </button>`;
      }
    }

    listEl.innerHTML = html;
    listEl.className = 'tl-popover-list';
  }

  function renderDatePicker(currentValue) {
    listEl.className = 'tl-popover-list tl-popover-date';
    listEl.innerHTML = `
      <div class="tl-popover-date-wrap">
        <input type="date" class="tl-popover-date-input" value="${escapeHtml(currentValue || '')}">
        <div class="tl-popover-date-buttons">
          <button type="button" class="btn btn-sm tl-popover-date-clear">Clear</button>
          <button type="button" class="btn btn-sm btn-primary tl-popover-date-save">Save</button>
        </div>
      </div>
    `;
    setTimeout(() => listEl.querySelector('.tl-popover-date-input')?.focus(), 10);
  }

  async function saveValue(taskId, field, value) {
    const fd = new FormData();
    fd.append('_csrf', CSRF);
    fd.append('task_id', taskId);
    fd.append('field', field);
    fd.append('value', value);
    try {
      const res = await fetch(`${BASE}/index.php?p=tasks&action=update_field`, {
        method: 'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'}
      });
      const j = await res.json();
      return j;
    } catch {
      return { ok: false, message: 'Network error.' };
    }
  }

  function updateCellDisplay(trigger, field, value, display) {
    // Mutate the inner span of the trigger to reflect the new value
    trigger.dataset.currentId = value || '';
    if (field === 'due_date') {
      trigger.dataset.currentValue = value || '';
      const span = trigger.querySelector('.tl-current-date');
      if (!span) return;
      if (!value) {
        span.textContent = '— Set —';
        span.classList.add('muted');
        span.removeAttribute('style');
      } else {
        // Format YYYY-MM-DD into a Month Day, Year via Date
        const d = new Date(value + 'T00:00:00');
        if (!isNaN(d.getTime())) {
          span.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        } else {
          span.textContent = value;
        }
        span.classList.remove('muted');
        if (display?.overdue) {
          span.style.color = 'var(--danger)';
          span.style.fontWeight = '600';
        } else {
          span.removeAttribute('style');
        }
      }
      return;
    }

    if (field === 'assignee_user_id') {
      const opts = OPTIONS.assignee || [];
      const opt  = opts.find(o => String(o.id) === String(value));
      const wrap = trigger;
      // Remove existing avatar/badge
      wrap.querySelectorAll('img, span.assignee-icon-only').forEach(n => n.remove());
      if (!opt) {
        const ph = document.createElement('span');
        ph.className = 'avatar assignee-icon-only tl-current-assignee tl-assignee-empty';
        ph.textContent = '?';
        wrap.appendChild(ph);
        wrap.title = 'Unassigned';
      } else if (opt.image) {
        const img = document.createElement('img');
        img.src = `${BASE}/uploads/${opt.image}`;
        img.className = 'assignee-icon-only tl-current-assignee';
        img.alt = opt.label;
        wrap.appendChild(img);
        wrap.title = opt.label;
      } else {
        const sp = document.createElement('span');
        sp.className = 'avatar assignee-icon-only tl-current-assignee';
        sp.textContent = (opt.label || '?').slice(0,2);
        wrap.appendChild(sp);
        wrap.title = opt.label;
      }
      return;
    }

    // Pill fields (status, urgency, type)
    const span = trigger.querySelector('.tl-current-pill');
    if (!span) return;

    const opts = fieldOptions(field);
    const opt  = opts.find(o => String(o.id) === String(value));

    span.classList.remove('muted');
    span.removeAttribute('style');
    // Strip urgency-specific class
    Array.from(span.classList).forEach(c => {
      if (c.startsWith('pill-urgency-')) span.classList.remove(c);
    });

    if (!opt) {
      span.textContent = '— Set —';
      span.classList.add('muted');
      return;
    }

    span.textContent = opt.label;

    if (field === 'status_value_id' && opt.color) {
      span.style.background    = opt.color + '22';
      span.style.color         = opt.color;
      span.style.borderColor   = opt.color + '44';
    }
    if (field === 'urgency_value_id' && opt.key) {
      span.classList.add('pill-urgency-' + opt.key);
    }
  }

  // ---------- Open popover on click ----------
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-tl-edit]');
    if (trigger) {
      e.preventDefault();
      e.stopPropagation();
      // Toggle off if clicking the same trigger
      if (activeTrigger === trigger) { close(); return; }
      activeTrigger = trigger;
      activeField   = trigger.dataset.tlEdit;
      activeTaskId  = trigger.dataset.taskId;
      activeCurrent = trigger.dataset.currentId || trigger.dataset.currentValue || '';

      if (activeField === 'due_date') {
        renderDatePicker(activeCurrent);
      } else {
        renderPicker(activeField, activeCurrent);
      }
      positionPopover(trigger);
      return;
    }

    // Click inside the popover — handled by separate listeners (below)
    if (e.target.closest('#tl-popover')) return;

    // Click outside → close
    if (popover.style.display === 'block') close();
  });

  // ---------- Pick a value (non-date fields) ----------
  listEl.addEventListener('click', async (e) => {
    const item = e.target.closest('.tl-popover-item');
    if (!item || !activeTrigger) return;
    const newVal = item.dataset.value || '';
    if (String(newVal) === String(activeCurrent)) { close(); return; }

    const trigger  = activeTrigger;
    const field    = activeField;
    const taskId   = activeTaskId;

    const j = await saveValue(taskId, field, newVal);
    if (j.ok) {
      updateCellDisplay(trigger, field, newVal, j.display);
      window.showToast?.(j.message || 'Updated.', 'success');
    } else if (j.reason === 'not_clocked_in') {
      window.showToast?.('You must be clocked in to make changes.', 'error');
    } else {
      window.showToast?.(j.message || 'Failed.', 'error');
    }
    close();
  });

  // ---------- Date picker actions ----------
  listEl.addEventListener('click', async (e) => {
    if (e.target.classList.contains('tl-popover-date-clear') ||
        e.target.classList.contains('tl-popover-date-save')) {
      const isSave = e.target.classList.contains('tl-popover-date-save');
      const input  = listEl.querySelector('.tl-popover-date-input');
      const newVal = isSave ? (input?.value || '') : '';

      if (String(newVal) === String(activeCurrent || '')) { close(); return; }

      const trigger = activeTrigger;
      const field   = activeField;
      const taskId  = activeTaskId;

      const j = await saveValue(taskId, field, newVal);
      if (j.ok) {
        updateCellDisplay(trigger, field, newVal, j.display);
        window.showToast?.(j.message || 'Updated.', 'success');
      } else if (j.reason === 'not_clocked_in') {
        window.showToast?.('You must be clocked in to make changes.', 'error');
      } else {
        window.showToast?.(j.message || 'Failed.', 'error');
      }
      close();
    }
  });

  // ESC to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popover.style.display === 'block') close();
  });

  // Re-position on scroll/resize
  window.addEventListener('scroll',  () => { if (activeTrigger) positionPopover(activeTrigger); }, true);
  window.addEventListener('resize',  () => { if (activeTrigger) positionPopover(activeTrigger); });
})();
