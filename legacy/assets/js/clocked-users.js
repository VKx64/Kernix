/**
 * Round 25 — Clocked-in users widget
 * Renders avatars of who's clocked in next to the time tracker.
 * Polls every 30 seconds.
 */
(function () {
  const root = document.getElementById('clocked-users-widget');
  if (!root) return;

  const BASE = document.querySelector('meta[name=app-base]')?.content || '';
  const MAX_VISIBLE = 10;
  const POLL_MS = 30 * 1000;

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function fmtSecHM(sec) {
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.floor(sec / 60) + 'm';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function render(users) {
    if (!users || users.length === 0) {
      root.innerHTML = '';
      root.style.display = 'none';
      return;
    }
    root.style.display = '';

    // Working users first, on-break second (already alphabetical from server within each name)
    const working = users.filter(u => !u.on_break);
    const onBreak = users.filter(u =>  u.on_break);
    const sorted  = [...working, ...onBreak];

    const visible = sorted.slice(0, MAX_VISIBLE);
    const overflow = sorted.length - visible.length;

    const items = visible.map(u => {
      const avatar = u.image
        ? `<img src="${BASE}/uploads/${escapeHtml(u.image)}" alt="">`
        : `<span>${escapeHtml(u.initials)}</span>`;
      const tipStatus = u.on_break
        ? `On break · ${fmtSecHM(u.break_secs)}`
        : `Working · since ${escapeHtml(u.clock_in_human)}`;
      const tip = `${escapeHtml(u.name)} · ${tipStatus}`;
      return `<div class="cu-avatar ${u.on_break ? 'cu-avatar-break' : 'cu-avatar-working'}"
                   title="${tip}"
                   data-name="${escapeHtml(u.name)}"
                   data-status="${tipStatus}">${avatar}</div>`;
    }).join('');

    let html = `<div class="cu-stack">${items}`;
    if (overflow > 0) {
      const moreNames = sorted.slice(MAX_VISIBLE).map(u => u.name).join(', ');
      html += `<div class="cu-avatar cu-avatar-more" title="${escapeHtml(moreNames)}"><span>+${overflow}</span></div>`;
    }
    html += '</div>';
    root.innerHTML = html;
  }

  async function fetchAndRender() {
    try {
      const res = await fetch(`${BASE}/index.php?p=time&action=clocked_users`, {
        headers: {'X-Requested-With':'XMLHttpRequest'},
        cache: 'no-store'
      });
      const j = await res.json();
      if (j.ok) render(j.users);
    } catch { /* silent */ }
  }

  fetchAndRender();
  setInterval(fetchAndRender, POLL_MS);

  // Refresh when tab regains focus (cheap)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) fetchAndRender();
  });
})();
