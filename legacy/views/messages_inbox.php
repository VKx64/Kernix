<?php
/**
 * Messages inbox — round 25 redesign
 * Single-pane list. Clicking a row marks it read and jumps to the task.
 * Vars: $filter, $unread
 */
?>

<!-- PAGE HEADER -->
<div class="list-page-header">
  <div class="list-page-header-left">
    <h1>Messages</h1>
    <div class="list-page-meta">
      <span id="msg-count-label" class="muted">
        <?php if ($unread > 0): ?>
          <strong><?= number_format($unread) ?></strong> unread
        <?php else: ?>
          All caught up.
        <?php endif; ?>
      </span>
    </div>
  </div>
  <div class="list-page-header-right">
    <button type="button" class="btn btn-sm" id="msg-mark-all-read" <?= $unread === 0 ? 'disabled' : '' ?>>
      Mark all read
    </button>
  </div>
</div>

<div class="msg-inbox-v2" data-filter="<?= e($filter) ?>">

  <div class="msg-filter-tabs">
    <button type="button" class="msg-filter-tab <?= $filter === 'unread' ? 'active' : '' ?>" data-filter="unread">
      Unread <span class="msg-filter-count" id="msg-tab-unread-count"><?= $unread ?></span>
    </button>
    <button type="button" class="msg-filter-tab <?= $filter === 'all' ? 'active' : '' ?>" data-filter="all">
      All
    </button>
  </div>

  <div class="msg-list-v2" id="msg-list">
    <div class="msg-empty-list muted">Loading…</div>
  </div>

</div>

<script>
(function () {
  const BASE = document.querySelector('meta[name=app-base]')?.content || '';
  const CSRF = document.querySelector('meta[name=csrf]')?.content || '';

  const inbox     = document.querySelector('.msg-inbox-v2');
  const listEl    = document.getElementById('msg-list');
  const tabs      = document.querySelectorAll('.msg-filter-tab');
  const markAllBtn = document.getElementById('msg-mark-all-read');
  const unreadTabBadge = document.getElementById('msg-tab-unread-count');
  const countLabel = document.getElementById('msg-count-label');

  let currentFilter = inbox.dataset.filter || 'unread';
  let currentList = [];

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function updateUnreadBadges(unread) {
    if (unreadTabBadge) unreadTabBadge.textContent = unread;
    if (countLabel) {
      countLabel.innerHTML = unread > 0
        ? `<strong>${unread}</strong> unread`
        : 'All caught up.';
    }
    if (markAllBtn) markAllBtn.disabled = unread === 0;
    const sideBadge = document.querySelector('.sidebar .nav-item[href*="p=messages"] .nav-badge');
    if (sideBadge) {
      if (unread > 0) {
        sideBadge.textContent = unread > 99 ? '99+' : unread;
        sideBadge.style.display = '';
      } else {
        sideBadge.style.display = 'none';
      }
    }
  }

  async function loadList() {
    listEl.innerHTML = '<div class="msg-empty-list muted">Loading…</div>';
    try {
      const res = await fetch(`${BASE}/index.php?p=messages&action=list&f=${encodeURIComponent(currentFilter)}`, {
        headers: {'X-Requested-With':'XMLHttpRequest'}
      });
      const j = await res.json();
      if (!j.ok) {
        listEl.innerHTML = '<div class="msg-empty-list muted">Failed to load.</div>';
        return;
      }
      currentList = j.rows;
      renderList();
      updateUnreadBadges(j.unread);
    } catch {
      listEl.innerHTML = '<div class="msg-empty-list muted">Network error.</div>';
    }
  }

  function renderList() {
    if (currentList.length === 0) {
      listEl.innerHTML = `
        <div class="msg-empty-list">
          <svg class="icon" style="width:32px;height:32px;opacity:.3"><use href="#i-message"/></svg>
          <div style="margin-top:10px;font-size:12px;color:var(--text-muted)">
            ${currentFilter === 'unread' ? 'No unread messages.' : 'No messages.'}
          </div>
        </div>`;
      return;
    }

    listEl.innerHTML = currentList.map(r => {
      const unreadCls = r.is_unread ? 'msg-row-unread' : '';
      const avatar = r.sender_image
        ? `<img src="${BASE}/uploads/${escapeHtml(r.sender_image)}" class="msg-avatar">`
        : `<span class="avatar msg-avatar">${escapeHtml(r.sender_initials)}</span>`;
      const taskLine = r.client_name
        ? `<span class="muted">${escapeHtml(r.client_name)}</span> · ${escapeHtml(r.task_title)}`
        : escapeHtml(r.task_title);
      return `
        <a href="${BASE}/index.php?p=tasks&action=index&open=${r.task_id}"
           class="msg-row-v2 ${unreadCls}"
           data-id="${r.id}"
           data-task-id="${r.task_id}">
          ${avatar}
          <div class="msg-row-body">
            <div class="msg-row-top">
              <span class="msg-row-sender">${escapeHtml(r.sender_name)}</span>
              <span class="msg-row-time">${escapeHtml(r.created_human)}</span>
            </div>
            <div class="msg-row-task">${taskLine}</div>
            <div class="msg-row-preview">${escapeHtml(r.body || '(no message)')}</div>
          </div>
          ${r.is_unread ? '<span class="msg-row-dot"></span>' : ''}
        </a>
      `;
    }).join('');
  }

  // Click a row → mark read in background, navigate via the link
  listEl.addEventListener('click', async (e) => {
    const row = e.target.closest('.msg-row-v2');
    if (!row) return;
    const id = row.dataset.id;
    const isUnread = row.classList.contains('msg-row-unread');
    if (isUnread) {
      const fd = new FormData(); fd.append('_csrf', CSRF); fd.append('id', id);
      fetch(`${BASE}/index.php?p=messages&action=mark_read`, {
        method:'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'},
        keepalive: true
      }).catch(() => {});
    }
  });

  // Filter tabs
  tabs.forEach(t => {
    t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.toggle('active', x === t));
      currentFilter = t.dataset.filter;
      inbox.dataset.filter = currentFilter;
      const u = new URL(location.href);
      u.searchParams.set('f', currentFilter);
      history.replaceState(null, '', u.toString());
      loadList();
    });
  });

  // Mark all read
  if (markAllBtn) {
    markAllBtn.addEventListener('click', async () => {
      const fd = new FormData(); fd.append('_csrf', CSRF);
      const res = await fetch(`${BASE}/index.php?p=messages&action=mark_all_read`, {
        method:'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'}
      });
      const j = await res.json();
      if (j.ok) {
        window.showToast?.('All messages marked read.', 'success');
        currentList.forEach(r => r.is_unread = false);
        renderList();
        updateUnreadBadges(0);
        if (currentFilter === 'unread') loadList();
      }
    });
  }

  loadList();
})();
</script>
