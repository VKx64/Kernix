/**
 * grid-filters.js v2
 * Filters hidden by default. Click column header to open popover.
 * All changes apply instantly via URL + fetch.
 */
(function () {
  'use strict';

  const BASE = document.querySelector('meta[name=app-base]')?.content || '';

  /* -------------------------------------------------------
     URL state
  ------------------------------------------------------- */
  function getParams() { return new URLSearchParams(location.search); }

  function setParam(key, val) {
    const p = getParams();
    if (val === '' || val === null || val === undefined) p.delete(key);
    else p.set(key, String(val));
    p.delete('page');
    pushState(p);
  }

  function setParams(obj) {
    const p = getParams();
    p.delete('page');
    Object.entries(obj).forEach(([k, v]) => {
      if (v === '' || v === null || v === undefined) p.delete(k);
      else p.set(k, String(v));
    });
    pushState(p);
  }

  function pushState(p) {
    history.pushState({}, '', location.pathname + '?' + p.toString());
    fetchGrid();
    updateActiveFilterChips();
  }

  function getParam(key, fallback = '') {
    return getParams().get(key) ?? fallback;
  }

  /* -------------------------------------------------------
     Grid AJAX refresh
  ------------------------------------------------------- */
  let fetchTimer;
  function fetchGrid(delay = 0) {
    clearTimeout(fetchTimer);
    fetchTimer = setTimeout(async () => {
      try {
        const res  = await fetch(BASE + '/index.php?' + getParams().toString(), {
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-Grid-Only': '1' },
        });
        if (!res.ok) return;
        const html = await res.text();
        const doc  = new DOMParser().parseFromString(html, 'text/html');

        const newTbody = doc.querySelector('tbody');
        const tbody    = document.querySelector('.data-table tbody');
        if (tbody && newTbody) tbody.innerHTML = newTbody.innerHTML;

        // Re-bind task/project row click handlers after tbody refresh
        bindRowHandlers();

        doc.querySelectorAll('.pagination').forEach((newPag, i) => {
          const pags = document.querySelectorAll('.pagination');
          if (pags[i]) pags[i].outerHTML = newPag.outerHTML;
        });

        const newMeta = doc.querySelector('.grid-count');
        const meta    = document.querySelector('.grid-count');
        if (meta && newMeta) meta.innerHTML = newMeta.innerHTML;

        applyHiddenColumns();
      } catch (e) { console.warn('Grid fetch:', e); }
    }, delay);
  }

  /* -------------------------------------------------------
     Column filter POPOVER system
  ------------------------------------------------------- */
  let activePopover = null;

  function openPopover(th) {
    const popover = th.querySelector('.col-filter-popover');
    if (!popover) return;
    if (activePopover && activePopover !== popover) {
      closeAllPopovers();
    }
    popover.classList.add('open');
    th.querySelector('.th-label')?.classList.add('filter-open');
    activePopover = popover;

    // Focus first input
    setTimeout(() => {
      const first = popover.querySelector('input, select');
      if (first) first.focus();
    }, 60);
  }

  function closeAllPopovers() {
    document.querySelectorAll('.col-filter-popover.open').forEach(p => p.classList.remove('open'));
    document.querySelectorAll('.th-label.filter-open').forEach(l => l.classList.remove('filter-open'));
    activePopover = null;
  }

  // Click th-label → toggle popover
  document.addEventListener('click', (e) => {
    const label = e.target.closest('.th-label.has-filter');
    if (label) {
      e.stopPropagation();
      const th      = label.closest('th');
      const popover = th?.querySelector('.col-filter-popover');
      if (!popover) return;
      if (popover.classList.contains('open')) {
        closeAllPopovers();
      } else {
        openPopover(th);
      }
      return;
    }
    // Click sort (no filter)
    const sortLabel = e.target.closest('.th-label.sortable:not(.has-filter)');
    if (sortLabel) {
      const col    = sortLabel.dataset.sort;
      const curDir = getParam('dir', 'asc');
      const curSort= getParam('sort');
      setParams({ sort: col, dir: curSort === col && curDir === 'asc' ? 'desc' : 'asc' });
      return;
    }
    // Click outside — close
    if (!e.target.closest('.col-filter-popover') && !e.target.closest('.th-label')) {
      closeAllPopovers();
    }
    // Close columns popover
    if (!e.target.closest('.btn-columns') && !e.target.closest('.columns-popover')) {
      document.querySelectorAll('.columns-popover.open').forEach(p => p.classList.remove('open'));
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllPopovers();
  });

  /* -------------------------------------------------------
     Sort buttons inside popovers
  ------------------------------------------------------- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.col-sort-btn');
    if (!btn) return;
    e.stopPropagation();
    const col = btn.dataset.sortCol;
    const dir = btn.dataset.sortDir;
    if (col) {
      setParams({ sort: col, dir });
      // Update active state
      btn.closest('.col-sort-btns')?.querySelectorAll('.col-sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
  });

  /* -------------------------------------------------------
     Text search (debounced 280ms)
  ------------------------------------------------------- */
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.classList.contains('col-search')) return;
    const key = el.dataset.param;
    if (!key) return;
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      setParam(key, el.value.trim());
      updateDot(el.closest('th'), el.value.trim() !== '');
    }, 280);
  });

  /* -------------------------------------------------------
     Single select
  ------------------------------------------------------- */
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.classList.contains('col-select')) return;
    const key = el.dataset.param;
    if (!key) return;
    setParam(key, el.value);
    updateDot(el.closest('th'), el.value !== '');
  });

  /* -------------------------------------------------------
     Date range
  ------------------------------------------------------- */
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.classList.contains('col-date')) return;
    const key = el.dataset.param;
    if (!key) return;
    setParam(key, el.value);
    // Dot if either date is set
    const th    = el.closest('th');
    const dates = th?.querySelectorAll('.col-date');
    const any   = dates && Array.from(dates).some(d => d.value !== '');
    updateDot(th, any);
  });

  /* -------------------------------------------------------
     Multi-select checkboxes
  ------------------------------------------------------- */
  document.addEventListener('change', (e) => {
    const cb = e.target;
    if (!cb.closest('.col-multi-item')) return;
    const popover = cb.closest('.col-filter-popover');
    if (!popover) return;
    const param = popover.dataset.param;
    const isAll = cb.dataset.allToggle === '1';

    if (isAll) {
      popover.querySelectorAll('.col-multi-item:not(.all-item) input').forEach(i => i.checked = false);
      setParam(param, '');
      updateDot(popover.closest('th'), false);
      updateMultiLabel(popover);
      return;
    }
    const allCb = popover.querySelector('[data-all-toggle="1"]');
    if (allCb) allCb.checked = false;
    const vals = [];
    popover.querySelectorAll('.col-multi-item:not(.all-item) input:checked').forEach(i => vals.push(i.value));
    setParam(param, vals.join(','));
    updateDot(popover.closest('th'), vals.length > 0);
    updateMultiLabel(popover);
  });

  /* Multi-select internal search */
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.closest('.col-multi-search')) return;
    const q    = el.value.toLowerCase();
    const list = el.closest('.col-filter-popover').querySelectorAll('.col-multi-item:not(.all-item)');
    list.forEach(item => {
      const text = item.querySelector('label')?.textContent.toLowerCase() || '';
      item.style.display = text.includes(q) ? '' : 'none';
    });
  });

  function updateMultiLabel(popover) {
    const checked = popover.querySelectorAll('.col-multi-item:not(.all-item) input:checked');
    const label   = popover.querySelector('.multi-current-label');
    if (!label) return;
    if (checked.length === 0) label.textContent = 'All';
    else if (checked.length === 1) label.textContent = checked[0].closest('.col-multi-item').querySelector('label')?.textContent || '1 selected';
    else label.textContent = checked.length + ' selected';
  }

  /* -------------------------------------------------------
     Clear filter button inside popover
  ------------------------------------------------------- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.col-filter-clear');
    if (!btn) return;
    e.stopPropagation();
    const popover = btn.closest('.col-filter-popover');
    if (!popover) return;
    const param = popover.dataset.param;
    // Reset all inputs in this popover
    popover.querySelectorAll('.col-search').forEach(i => i.value = '');
    popover.querySelectorAll('.col-select').forEach(s => s.value = '');
    popover.querySelectorAll('.col-date').forEach(d => d.value = '');
    popover.querySelectorAll('.col-multi-item input').forEach(cb => cb.checked = false);
    popover.querySelectorAll('.col-multi-item.all-item input').forEach(cb => cb.checked = true);
    updateMultiLabel(popover);
    // Clear all params that belong to this column
    const p = getParams();
    if (param) {
      p.delete(param);
      // Also clear from_/to_ variants
      p.delete('from_' + param);
      p.delete('to_'   + param);
      // Any q_ or f_ variants
      p.delete('q_' + param);
      p.delete('f_' + param);
    }
    p.delete('page');
    pushState(p);
    updateDot(popover.closest('th'), false);
  });

  /* -------------------------------------------------------
     Dot indicator on th
  ------------------------------------------------------- */
  function updateDot(th, hasValue) {
    if (!th) return;
    const dot = th.querySelector('.filter-dot');
    if (dot) dot.style.display = hasValue ? '' : 'none';
  }

  /* -------------------------------------------------------
     Toggle pills
  ------------------------------------------------------- */
  document.addEventListener('change', (e) => {
    const sw = e.target;
    if (!sw.closest('.toggle-pill') || !sw.dataset.toggleParam) return;
    const pill = sw.closest('.toggle-pill');
    pill.classList.toggle('active', sw.checked);
    const variant = pill.dataset.activeVariant;
    if (variant === 'danger') pill.classList.toggle('active-danger', sw.checked);
    setParam(sw.dataset.toggleParam, sw.checked ? '1' : '');
  });

  function syncPills() {
    document.querySelectorAll('.toggle-pill input[data-toggle-param]').forEach(sw => {
      const val = getParam(sw.dataset.toggleParam);
      sw.checked = val === '1';
      const pill = sw.closest('.toggle-pill');
      pill.classList.toggle('active', sw.checked);
      if (pill.dataset.activeVariant === 'danger') pill.classList.toggle('active-danger', sw.checked);
    });
  }

  /* -------------------------------------------------------
     Columns selector
  ------------------------------------------------------- */
  const COL_KEY = 'grid_cols_';

  function moduleKey() { return getParam('p', 'unknown'); }

  function getHiddenCols() {
    try { return JSON.parse(localStorage.getItem(COL_KEY + moduleKey()) || '[]'); }
    catch { return []; }
  }

  function applyHiddenColumns() {
    const hidden = getHiddenCols();
    document.querySelectorAll('.data-table th[data-col], .data-table td[data-col]').forEach(cell => {
      cell.classList.toggle('col-hidden', hidden.includes(cell.dataset.col));
    });
    document.querySelectorAll('.col-toggle-item input[data-col-id]').forEach(cb => {
      cb.checked = !hidden.includes(cb.dataset.colId);
    });
  }

  document.addEventListener('change', (e) => {
    const cb = e.target;
    if (!cb.closest('.col-toggle-item') || !cb.dataset.colId) return;
    const hidden = getHiddenCols();
    const col    = cb.dataset.colId;
    if (cb.checked) { const i = hidden.indexOf(col); if (i > -1) hidden.splice(i, 1); }
    else            { if (!hidden.includes(col)) hidden.push(col); }
    localStorage.setItem(COL_KEY + moduleKey(), JSON.stringify(hidden));
    applyHiddenColumns();
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-columns');
    if (btn) {
      e.stopPropagation();
      btn.nextElementSibling?.classList.toggle('open');
    }
  });

  /* -------------------------------------------------------
     Active filter chips bar
  ------------------------------------------------------- */
  const SKIP_KEYS = ['p', 'page', 'sort', 'dir'];
  const LABEL_MAP = {}; // populated by pages via window.gridFilterLabels

  function updateActiveFilterChips() {
    const container = document.querySelector('.grid-active-filters');
    if (!container) return;
    const p     = getParams();
    const chips = [];
    p.forEach((val, key) => {
      if (SKIP_KEYS.includes(key) || !val) return;
      chips.push({ key, val, label: resolveLabel(key, val) });
    });
    if (!chips.length) { container.innerHTML = ''; return; }
    container.innerHTML = chips.map(c =>
      `<span class="filter-chip">${esc(c.label)}<span class="filter-chip-remove" data-clear-param="${esc(c.key)}">&times;</span></span>`
    ).join('') + `<span class="clear-all-filters" id="clear-all">Clear all</span>`;
  }

  function resolveLabel(key, val) {
    const labels = window.gridFilterLabels || {};
    if (labels[key]) return labels[key](val);
    const el = document.querySelector(`[data-param="${key}"]`);
    if (el?.tagName === 'SELECT') {
      const opt = el.querySelector(`option[value="${val}"]`);
      if (opt) return opt.textContent.trim();
    }
    const clean = key.replace(/^(q_|f_|from_|to_|t_)/, '').replace(/_/g, ' ');
    return clean + ': ' + val;
  }

  document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-clear-param]');
    if (chip) {
      const key = chip.dataset.clearParam;
      const p   = getParams();
      p.delete(key); p.delete('from_' + key); p.delete('to_' + key);
      p.delete('page');
      pushState(p);
      // Reset that input
      document.querySelectorAll(`[data-param="${key}"]`).forEach(el => {
        if (el.type === 'checkbox') el.checked = false;
        else el.value = '';
      });
      return;
    }
    if (e.target.id === 'clear-all') {
      const p   = getParams();
      const keep = new URLSearchParams();
      SKIP_KEYS.forEach(k => { if (p.has(k)) keep.set(k, p.get(k)); });
      // Reset all filter inputs
      document.querySelectorAll('.col-search, .col-date').forEach(el => el.value = '');
      document.querySelectorAll('.col-select').forEach(el => el.value = '');
      document.querySelectorAll('.col-multi-item input').forEach(cb => cb.checked = false);
      document.querySelectorAll('.col-multi-item.all-item input').forEach(cb => cb.checked = true);
      document.querySelectorAll('.col-filter-popover').forEach(p => updateMultiLabel(p));
      document.querySelectorAll('.filter-dot').forEach(d => d.style.display = 'none');
      pushState(keep);
    }
  });

  /* -------------------------------------------------------
     Pagination — AJAX intercept
  ------------------------------------------------------- */
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.page-link:not(.disabled)');
    if (!link || !link.href) return;
    e.preventDefault();
    const page = new URL(link.href, location.origin).searchParams.get('page');
    if (page) setParam('page', page);
  });

  /* -------------------------------------------------------
     Row click handlers — task shelf + project shelf
  ------------------------------------------------------- */
  function bindRowHandlers() {
    // Tasks
    document.querySelectorAll('tr[data-task-id]').forEach(tr => {
      if (tr._bound) return;
      tr._bound = true;
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a, button, input, select')) return;
        window.openTaskShelf?.(tr.dataset.taskId);
      });
    });
    // Projects
    document.querySelectorAll('tr[data-project-id]').forEach(tr => {
      if (tr._bound) return;
      tr._bound = true;
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a, button, input, select')) return;
        window.openProjShelf?.(tr.dataset.projectId);
      });
    });
  }

  /* -------------------------------------------------------
     PROJECT SHELF
  ------------------------------------------------------- */
  const projShelfWrap = document.getElementById('proj-shelf-wrap');

  window.openProjShelf = function (projId) {
    if (!projShelfWrap) return;
    projShelfWrap.classList.add('open');
    document.body.style.overflow = 'hidden';
    loadProjShelf(projId);
    const url = new URL(location.href);
    url.searchParams.set('shelf', projId);
    history.pushState({ projShelf: projId }, '', url);
  };

  window.closeProjShelf = function () {
    if (!projShelfWrap) return;
    projShelfWrap.classList.remove('open');
    document.body.style.overflow = '';
    const url = new URL(location.href);
    url.searchParams.delete('shelf');
    history.pushState({}, '', url);
  };

  if (projShelfWrap) {
    projShelfWrap.querySelector('.proj-shelf-overlay')?.addEventListener('click', closeProjShelf);
    projShelfWrap.querySelector('.proj-shelf-peek')?.addEventListener('click', closeProjShelf);
    projShelfWrap.querySelector('.proj-shelf-close')?.addEventListener('click', closeProjShelf);
  }

  async function loadProjShelf(projId) {
    const body = document.getElementById('proj-shelf-body');
    if (!body) return;
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading…</div>';
    try {
      const res  = await fetch(`${BASE}/index.php?p=projects&action=shelf&id=${projId}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      body.innerHTML = await res.text();
      // Bind task rows inside shelf to open task shelf
      body.querySelectorAll('.proj-task-row[data-task-id]').forEach(row => {
        row.addEventListener('click', () => window.openTaskShelf?.(row.dataset.taskId));
      });
    } catch {
      body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--danger)">Failed to load.</div>';
    }
  }

  // Re-open shelf on load if URL has it
  window.addEventListener('load', () => {
    const shelf = new URL(location.href).searchParams.get('shelf');
    if (shelf) {
      if (projShelfWrap) openProjShelf(shelf);
    }
  });

  window.addEventListener('popstate', (e) => {
    if (e.state?.projShelf) openProjShelf(e.state.projShelf);
    else projShelfWrap?.classList.remove('open');
  });

  /* -------------------------------------------------------
     Sync inputs from URL on load
  ------------------------------------------------------- */
  function syncFromURL() {
    const p = getParams();
    p.forEach((val, key) => {
      document.querySelectorAll(`[data-param="${key}"]`).forEach(el => {
        if (el.type === 'checkbox') el.checked = val === '1';
        else el.value = val;
      });
      // Multi-select
      const dd = document.querySelector(`.col-filter-popover[data-param="${key}"]`);
      if (dd && val) {
        const vals = val.split(',');
        dd.querySelectorAll('.col-multi-item:not(.all-item) input').forEach(cb => {
          cb.checked = vals.includes(cb.value);
        });
        const allCb = dd.querySelector('[data-all-toggle="1"]');
        if (allCb) allCb.checked = false;
        updateMultiLabel(dd);
      }
      // Dot indicator
      const th = document.querySelector(`[data-param="${key}"]`)?.closest('th')
               || document.querySelector(`[data-param="from_${key}"]`)?.closest('th')
               || document.querySelector(`.col-filter-popover[data-param="${key}"]`)?.closest('th');
      if (th && val) updateDot(th, true);
    });
    syncPills();
    updateActiveFilterChips();
    // Sync sort buttons
    const curSort = p.get('sort');
    const curDir  = p.get('dir') || 'asc';
    if (curSort) {
      document.querySelectorAll(`.col-sort-btn[data-sort-col="${curSort}"][data-sort-dir="${curDir}"]`)
        .forEach(b => b.classList.add('active'));
    }
  }

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* -------------------------------------------------------
     Init
  ------------------------------------------------------- */
  function init() {
    syncFromURL();
    applyHiddenColumns();
    bindRowHandlers();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
