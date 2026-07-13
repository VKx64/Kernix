/* Kernix legacy app — app.js v2 (fixed) */
(function () {
  'use strict';

  /* Theme — dark default */
  const root   = document.documentElement;
  const stored = localStorage.getItem('theme');
  root.setAttribute('data-theme', stored || 'dark');

  const toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) {
    const updateIcon = () => {
      const t = root.getAttribute('data-theme') || 'dark';
      toggleBtn.innerHTML = t === 'dark'
        ? '<svg class="icon"><use href="#i-sun"/></svg>'
        : '<svg class="icon"><use href="#i-moon"/></svg>';
      toggleBtn.title = t === 'dark' ? 'Switch to light' : 'Switch to dark';
    };
    updateIcon();
    toggleBtn.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      updateIcon();
    });
  }

  /* Dropdowns */
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-dropdown-toggle]');
    if (toggle) {
      e.stopPropagation();
      const menu = toggle.closest('[data-dropdown]')?.querySelector('[data-dropdown-menu]');
      if (!menu) return;
      const isOpen = menu.classList.contains('open');
      document.querySelectorAll('[data-dropdown-menu].open').forEach(m => m.classList.remove('open'));
      if (!isOpen) menu.classList.add('open');
      return;
    }
    if (!e.target.closest('[data-dropdown]')) {
      document.querySelectorAll('[data-dropdown-menu].open').forEach(m => m.classList.remove('open'));
    }
  });

  /* Modal system */
  window.openModal = function (id) {
    const bd = document.getElementById(id);
    if (!bd) return;
    bd.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const first = bd.querySelector('input:not([type=hidden]), select, textarea');
      if (first) first.focus();
    }, 100);
  };

  window.closeModal = function (id) {
    const bd = document.getElementById(id);
    if (!bd) return;
    bd.classList.remove('open');
    document.body.style.overflow = '';
    const form = bd.querySelector('form');
    if (form) resetFormErrors(form);
  };

  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-modal-open]');
    if (opener) { e.preventDefault(); openModal(opener.dataset.modalOpen); return; }
    const closer = e.target.closest('[data-modal-close]');
    if (closer) {
      e.preventDefault();
      const bd = closer.closest('.modal-backdrop');
      if (bd) closeModal(bd.id);
      return;
    }
    if (e.target.classList.contains('modal-backdrop')) {
      closeModal(e.target.id);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const open = document.querySelector('.modal-backdrop.open');
      if (open) { closeModal(open.id); return; }
      if (typeof closeTaskShelf === 'function') closeTaskShelf();
      if (typeof closeProjShelf === 'function') closeProjShelf();
    }
  });

  /* Modal: Add — resets form, supports prefill */
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-modal-add]');
    if (!trigger) return;
    e.preventDefault();
    const modal = document.getElementById(trigger.dataset.modalAdd);
    if (!modal) return;
    const form = modal.querySelector('form');
    if (form) {
      form.reset();
      resetFormErrors(form);
      const idField = form.querySelector('input[name=id]');
      if (idField) idField.value = '';
    }
    const title = modal.querySelector('.modal-title');
    if (title?.dataset.addLabel) title.textContent = title.dataset.addLabel;
    const delBtn = modal.querySelector('[data-delete-btn]');
    if (delBtn) delBtn.style.display = 'none';

    if (trigger.dataset.prefill && form) {
      try {
        const pre = JSON.parse(trigger.dataset.prefill);
        Object.entries(pre).forEach(([k, v]) => {
          const el = form.elements[k];
          if (el) el.value = v ?? '';
        });
      } catch {}
    }
    openModal(trigger.dataset.modalAdd);
  });

  /* Modal: Edit — populates form */
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-modal-edit]');
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();

    const modal  = document.getElementById(trigger.dataset.modalEdit);
    if (!modal) return;
    const record = JSON.parse(trigger.dataset.record || '{}');
    const form   = modal.querySelector('form');
    if (form) populateForm(form, record);

    const title = modal.querySelector('.modal-title');
    if (title?.dataset.editLabel) title.textContent = title.dataset.editLabel;

    const delBtn = modal.querySelector('[data-delete-btn]');
    if (delBtn) {
      delBtn.style.display = record.id ? '' : 'none';
      delBtn.dataset.recordId = record.id || '';
    }
    openModal(trigger.dataset.modalEdit);
  });

  /* AJAX form submit */
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!form.hasAttribute('data-ajax-form')) return;
    e.preventDefault();
    const btn  = form.querySelector('[type=submit]');
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = 'Saving…'; }
    resetFormErrors(form);
    try {
      const fd  = new FormData(form);
      const res = await fetch(form.action || location.href, {
        method: 'POST', body: fd,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const json = await res.json();
      if (json.ok) {
        showToast(json.message || 'Saved.', 'success');
        setTimeout(() => location.reload(), 400);
      } else if (json.errors) {
        showFormErrors(form, json.errors);
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
      } else {
        showToast(json.message || 'An error occurred.', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
      }
    } catch (err) {
      showToast('Network error. Please try again.', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
  });

  /* DELETE — handles both row buttons (data-delete-url) and modal buttons (data-delete-template) */
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete-confirm]');
    if (!btn) return;
    e.preventDefault();
    const label = btn.dataset.deleteConfirm || 'this record';
    if (!confirm(`Delete ${label}? This action cannot be undone.`)) return;

    // Two modes: full URL on row button, or template + ID for modal button
    let url = btn.dataset.deleteUrl;
    if (!url && btn.dataset.deleteTemplate) {
      const id = btn.dataset.recordId;
      if (!id) { showToast('No record ID.', 'error'); return; }
      url = btn.dataset.deleteTemplate + encodeURIComponent(id);
    }
    if (!url) return;

    const csrf = document.querySelector('meta[name=csrf]')?.content || '';
    const fd = new FormData();
    fd.append('_csrf', csrf);
    fd.append('action_type', 'delete');
    try {
      const res  = await fetch(url, { method: 'POST', body: fd, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const json = await res.json();
      if (json.ok) { showToast(json.message || 'Deleted.', 'success'); setTimeout(() => location.reload(), 400); }
      else showToast(json.message || 'Delete failed.', 'error');
    } catch { showToast('Network error.', 'error'); }
  });

  /* Archive */
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-archive-url]');
    if (!btn) return;
    e.preventDefault();
    const csrf = document.querySelector('meta[name=csrf]')?.content || '';
    const fd = new FormData();
    fd.append('_csrf', csrf);
    fd.append('action_type', 'archive');
    try {
      const res  = await fetch(btn.dataset.archiveUrl, { method: 'POST', body: fd, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const json = await res.json();
      if (json.ok) { showToast(json.message || 'Done.', 'success'); setTimeout(() => location.reload(), 400); }
      else showToast(json.message || 'Failed.', 'error');
    } catch { showToast('Network error.', 'error'); }
  });

  /* TASK SHELF */
  const taskShelfWrap = document.getElementById('task-shelf-wrap');
  window.openTaskShelf = function (taskId) {
    if (!taskShelfWrap) return;
    taskShelfWrap.classList.add('open');
    document.body.style.overflow = 'hidden';
    loadTaskShelf(taskId);
    const url = new URL(location.href);
    url.searchParams.set('task', taskId);
    history.pushState({ task: taskId }, '', url);
  };
  window.closeTaskShelf = function () {
    if (!taskShelfWrap) return;
    taskShelfWrap.classList.remove('open');
    document.body.style.overflow = '';
    const url = new URL(location.href);
    url.searchParams.delete('task');
    history.pushState({}, '', url);
  };

  if (taskShelfWrap) {
    taskShelfWrap.querySelector('.task-shelf-overlay')?.addEventListener('click', closeTaskShelf);
    taskShelfWrap.querySelector('.task-shelf-peek')?.addEventListener('click', closeTaskShelf);
    taskShelfWrap.querySelector('.task-shelf-close')?.addEventListener('click', closeTaskShelf);
  }

  async function loadTaskShelf(taskId) {
    const body = document.getElementById('task-shelf-body');
    if (!body) return;
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading…</div>';
    try {
      const base = document.querySelector('meta[name=app-base]')?.content || '';
      const res  = await fetch(`${base}/index.php?p=tasks&action=shelf&id=${encodeURIComponent(taskId)}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      body.innerHTML = await res.text();
    } catch {
      body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--danger)">Failed to load.</div>';
    }
  }

  /* Note submit inside shelf */
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!form.hasAttribute('data-note-form')) return;
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    if (btn) btn.disabled = true;
    const fd     = new FormData(form);
    const taskId = form.dataset.taskId;
    try {
      const base = document.querySelector('meta[name=app-base]')?.content || '';
      const res  = await fetch(`${base}/index.php?p=tasks&action=add_note`, {
        method: 'POST', body: fd,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const json = await res.json();
      if (json.ok) { form.reset(); loadNotes(taskId); }
      else showToast(json.message || 'Failed to add note.', 'error');
    } catch { showToast('Network error.', 'error'); }
    if (btn) btn.disabled = false;
  });

  async function loadNotes(taskId) {
    const list = document.getElementById('notes-list-' + taskId);
    if (!list) return;
    const base = document.querySelector('meta[name=app-base]')?.content || '';
    const res  = await fetch(`${base}/index.php?p=tasks&action=notes_partial&id=${encodeURIComponent(taskId)}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    list.innerHTML = await res.text();
  }
  window.loadNotes = loadNotes;

  /* Re-open task shelf on load if URL has task= */
  window.addEventListener('load', () => {
    const url  = new URL(location.href);
    const task = url.searchParams.get('task');
    if (task && taskShelfWrap) openTaskShelf(task);
  });
  window.addEventListener('popstate', (e) => {
    if (e.state?.task) openTaskShelf(e.state.task);
    else taskShelfWrap?.classList.remove('open');
  });

  /* Helpers */
  function populateForm(form, data) {
    form.reset();
    resetFormErrors(form);
    Object.entries(data).forEach(([key, val]) => {
      const el = form.elements[key];
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!val;
      else el.value = val ?? '';
    });
  }
  function resetFormErrors(form) {
    form.querySelectorAll('.field-error').forEach(el => el.textContent = '');
    form.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
  }
  function showFormErrors(form, errors) {
    Object.entries(errors).forEach(([field, msg]) => {
      const errEl = form.querySelector(`[data-error="${field}"]`);
      if (errEl) errEl.textContent = msg;
      const input = form.elements[field];
      if (input) input.classList.add('input-error');
    });
    const first = form.querySelector('.field-error:not(:empty)');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  let toastTimer;
  function showToast(msg, type = 'success') {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.style.cssText = [
        'position:fixed','bottom:24px','right:24px','z-index:9999',
        'padding:12px 20px','border-radius:10px','font-size:13px','font-weight:500',
        'box-shadow:0 8px 32px rgba(0,0,0,.4)','max-width:360px',
        'transition:opacity .2s,transform .2s',
        'border:1px solid rgba(255,255,255,.1)',
      ].join(';');
      document.body.appendChild(toast);
    }
    clearTimeout(toastTimer);
    toast.textContent = msg;
    const colors = {
      success: ['rgba(5,150,105,.95)',  'rgba(52,211,153,.4)'],
      error:   ['rgba(127,29,29,.95)',  'rgba(248,113,113,.4)'],
      info:    ['rgba(30,27,75,.95)',   'rgba(139,92,246,.4)'],
    };
    const [bg, border] = colors[type] || colors.info;
    toast.style.background  = bg;
    toast.style.borderColor = border;
    toast.style.color       = '#fff';
    toast.style.opacity     = '1';
    toast.style.transform   = 'translateY(0)';
    toastTimer = setTimeout(() => {
      toast.style.opacity   = '0';
      toast.style.transform = 'translateY(8px)';
    }, 3200);
  }
  window.showToast = showToast;

})();
