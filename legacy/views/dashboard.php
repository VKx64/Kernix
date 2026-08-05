<?php
$me = Auth::user();
$uid = $me['id'];

function dash_fmt_mins(int $m): string {
    if ($m <= 0) return '0m';
    $h = intdiv($m, 60);
    $mm = $m % 60;
    if ($h === 0) return $mm . 'm';
    if ($mm === 0) return $h . 'h';
    return $h . 'h ' . $mm . 'm';
}
?>

<div class="welcome">
  <h2>Welcome back, <?= e($me['first_name'] ?: $me['username']) ?>.</h2>
  <p class="muted">Here's what's on your plate.</p>
</div>

<div class="cards">
  <a class="card" href="<?= e(url('tasks', ['t_mine' => '1'])) ?>">
    <div class="card-label">My Tasks</div>
    <div class="card-value"><?= $myTasks ?></div>
  </a>
  <a class="card" href="<?= e(url('messages')) ?>">
    <div class="card-label">Unread Messages</div>
    <div class="card-value"><?= $unreadMsgs ?></div>
  </a>
  <?php if (Perm::can('projects.view')): ?>
    <a class="card" href="<?= e(url('projects')) ?>">
      <div class="card-label">Active Projects</div>
      <div class="card-value"><?= $openProjects ?></div>
    </a>
  <?php else: ?>
    <div class="card card-static" aria-disabled="true">
      <div class="card-label">Active Projects</div>
      <div class="card-value"><?= $openProjects ?></div>
    </div>
  <?php endif; ?>
  <?php if (Perm::can('clients.view') && !is_single_client_mode()): ?>
    <a class="card" href="<?= e(url('clients')) ?>">
      <div class="card-label">Active Clients</div>
      <div class="card-value"><?= $activeClients ?></div>
    </a>
  <?php elseif (!is_single_client_mode()): ?>
    <div class="card card-static" aria-disabled="true">
      <div class="card-label">Active Clients</div>
      <div class="card-value"><?= $activeClients ?></div>
    </div>
  <?php endif; ?>
</div>

<!-- TIME TRACKING + CHARTS -->
<div class="dash-time-section">

  <!-- HEADER with range picker -->
  <div class="dash-time-header">
    <h3>My Time</h3>
    <div class="dash-range-picker">
      <div class="dash-range-presets">
        <button type="button" class="dash-range-preset" data-preset="this_month">This Month</button>
        <button type="button" class="dash-range-preset" data-preset="last_month">Last Month</button>
        <button type="button" class="dash-range-preset" data-preset="this_year">This Year</button>
        <button type="button" class="dash-range-preset" data-preset="all_time">All Time</button>
      </div>
      <div class="dash-range-inputs">
        <input type="date" id="dash-range-from" value="<?= e($rangeFrom) ?>">
        <span class="muted">→</span>
        <input type="date" id="dash-range-to" value="<?= e($rangeTo) ?>">
      </div>
    </div>
  </div>

  <!-- STATS -->
  <div class="dash-time-stats">
    <div class="dash-time-stat">
      <div class="dash-time-stat-label">Today</div>
      <div class="dash-time-stat-value" id="dash-stat-today"><?= e(dash_fmt_mins($todayMins)) ?></div>
      <div class="dash-time-stat-sub"><?= e(date('l, M j')) ?></div>
    </div>
    <div class="dash-time-stat">
      <div class="dash-time-stat-label">Selected Range</div>
      <div class="dash-time-stat-value" id="dash-stat-range"><?= e(dash_fmt_mins($rangeMins)) ?></div>
      <div class="dash-time-stat-sub" id="dash-stat-range-sub">
        <span id="dash-entries-count"><?= count($entries) ?></span> <?= count($entries) === 1 ? 'entry' : 'entries' ?> shown
      </div>
    </div>
  </div>

  <!-- DONUT CHARTS -->
  <div class="dash-charts">
    <div class="dash-chart-card">
      <div class="dash-chart-title">By Project</div>
      <div class="dash-chart" id="dash-chart-project"></div>
      <div class="dash-chart-legend" id="dash-legend-project"></div>
    </div>
    <?php if (!is_single_client_mode()): ?>
      <div class="dash-chart-card">
        <div class="dash-chart-title">By Client</div>
        <div class="dash-chart" id="dash-chart-client"></div>
        <div class="dash-chart-legend" id="dash-legend-client"></div>
      </div>
    <?php endif; ?>
  </div>

  <!-- ENTRIES LIST -->
  <div class="dash-time-list" id="dash-entries-list">
    <?php if (empty($entries)): ?>
      <div class="dash-time-list-empty">
        No time entries in this range.
      </div>
    <?php else:
      foreach ($entries as $entry):
        $taskTitle = $entry['task_title'] ?? '(deleted task)';
        $context = [];
        if (!empty($entry['client_name']))  $context[] = $entry['client_name'];
        if (!empty($entry['project_name'])) $context[] = $entry['project_name'];
        $contextStr = implode(' › ', $context);

        $createdTs = strtotime($entry['created_at']);
        $today = strtotime('today');
        if ($createdTs >= $today) {
          $dateLabel = date('g:i A', $createdTs);
        } elseif ($createdTs >= strtotime('-7 days')) {
          $dateLabel = date('D g:i A', $createdTs);
        } else {
          $dateLabel = date('M j', $createdTs);
        }
    ?>
      <a class="dash-time-entry"
         href="<?= e(url('tasks', ['open' => $entry['task_id']])) ?>">
        <div>
          <div class="dash-time-entry-task"><?= e($taskTitle) ?></div>
          <?php if ($contextStr): ?>
            <div class="dash-time-entry-context"><?= e($contextStr) ?></div>
          <?php endif; ?>
        </div>
        <div class="dash-time-entry-mins"><?= e(dash_fmt_mins((int)$entry['time_minutes'])) ?></div>
        <div class="dash-time-entry-date"><?= e($dateLabel) ?></div>
      </a>
    <?php endforeach; endif; ?>
  </div>
</div>

<!-- Initial chart data -->
<script type="application/json" id="dash-initial-data"><?= json_encode([
    'projectChart' => $projectChart,
    'clientChart'  => $clientChart,
    'rangeMins'    => $rangeMins,
], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>

<script>
(function () {
  const BASE = document.querySelector('meta[name=app-base]')?.content || '';
  const CSRF = document.querySelector('meta[name=csrf]')?.content || '';

  const fromInput  = document.getElementById('dash-range-from');
  const toInput    = document.getElementById('dash-range-to');
  const presetBtns = document.querySelectorAll('.dash-range-preset');

  // ============================================================
  //  Render a donut chart in SVG
  // ============================================================
  function fmtMins(m) {
    m = Math.max(0, parseInt(m || 0, 10));
    if (m === 0) return '0m';
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h === 0) return mm + 'm';
    if (mm === 0) return h + 'h';
    return h + 'h ' + mm + 'm';
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Achromatic palette — charts are told apart by a lightness ramp
  // (--chart-1 .. --chart-5) rather than a hue, same convention as the
  // token set. Cycle the five stops if there are more series than that.
  function paletteFromTheme(n) {
    const styles = getComputedStyle(document.documentElement);
    const ramp = [1, 2, 3, 4, 5].map(i => (styles.getPropertyValue(`--chart-${i}`) || '').trim());
    const out = [];
    for (let i = 0; i < n; i++) out.push(ramp[i % ramp.length]);
    return out;
  }

  function renderDonut(containerEl, legendEl, items, total) {
    if (!containerEl) return;

    if (!items || items.length === 0 || total === 0) {
      containerEl.innerHTML = `<div class="dash-chart-empty">No data in this range.</div>`;
      if (legendEl) legendEl.innerHTML = '';
      return;
    }

    const size = 220;
    const cx = size / 2, cy = size / 2;
    const rOuter = 90, rInner = 56;
    const colors = paletteFromTheme(items.length);

    // Build SVG path for each slice
    let angle = -Math.PI / 2; // start at top
    let paths = '';
    items.forEach((it, i) => {
      const portion = it.minutes / total;
      const sweep = portion * Math.PI * 2;
      const a0 = angle;
      const a1 = angle + sweep;
      angle = a1;

      // Avoid drawing degenerate slice for very tiny portions
      if (portion < 0.001) return;

      const largeArc = sweep > Math.PI ? 1 : 0;
      // If the slice is essentially the full circle, render as two halves
      // (SVG can't draw a full-360 arc as one path)
      if (portion > 0.999) {
        // Full donut ring
        paths += `<path class="donut-slice" data-i="${i}" fill="${colors[i]}"
          d="M ${cx - rOuter},${cy}
             a ${rOuter},${rOuter} 0 1,0 ${rOuter*2},0
             a ${rOuter},${rOuter} 0 1,0 ${-rOuter*2},0
             M ${cx - rInner},${cy}
             a ${rInner},${rInner} 0 1,1 ${rInner*2},0
             a ${rInner},${rInner} 0 1,1 ${-rInner*2},0 Z"
          fill-rule="evenodd"></path>`;
        return;
      }

      const x0o = cx + rOuter * Math.cos(a0);
      const y0o = cy + rOuter * Math.sin(a0);
      const x1o = cx + rOuter * Math.cos(a1);
      const y1o = cy + rOuter * Math.sin(a1);
      const x0i = cx + rInner * Math.cos(a0);
      const y0i = cy + rInner * Math.sin(a0);
      const x1i = cx + rInner * Math.cos(a1);
      const y1i = cy + rInner * Math.sin(a1);

      paths += `<path class="donut-slice" data-i="${i}"
        d="M ${x0o.toFixed(2)},${y0o.toFixed(2)}
           A ${rOuter},${rOuter} 0 ${largeArc},1 ${x1o.toFixed(2)},${y1o.toFixed(2)}
           L ${x1i.toFixed(2)},${y1i.toFixed(2)}
           A ${rInner},${rInner} 0 ${largeArc},0 ${x0i.toFixed(2)},${y0i.toFixed(2)}
           Z"
        fill="${colors[i]}"></path>`;
    });

    // Defs: drop shadow filter
    const svg = `
      <svg viewBox="0 0 ${size} ${size}" class="donut-svg">
        <defs>
          <filter id="donut-shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="black" flood-opacity="0.35"/>
          </filter>
        </defs>
        <g filter="url(#donut-shadow)">
          ${paths}
        </g>
        <!-- Center total -->
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-center-total">${escapeHtml(fmtMins(total))}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="donut-center-label">Total</text>
      </svg>
    `;
    containerEl.innerHTML = svg;

    // Legend
    let legend = '';
    items.forEach((it, i) => {
      const pct = total > 0 ? Math.round(it.minutes / total * 100) : 0;
      legend += `
        <div class="dash-legend-row" data-i="${i}">
          <span class="dash-legend-swatch" style="background:${colors[i]}"></span>
          <span class="dash-legend-name" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</span>
          <span class="dash-legend-mins">${escapeHtml(fmtMins(it.minutes))}</span>
          <span class="dash-legend-pct">${pct}%</span>
        </div>`;
    });
    legendEl.innerHTML = legend;

    // Slice hover interaction (link slice ↔ legend row)
    const slices = containerEl.querySelectorAll('.donut-slice');
    const rows   = legendEl.querySelectorAll('.dash-legend-row');
    const highlight = (i, on) => {
      slices.forEach(s => s.classList.toggle('donut-slice-hover', on && s.dataset.i === String(i)));
      rows.forEach(r => r.classList.toggle('dash-legend-row-hover', on && r.dataset.i === String(i)));
      slices.forEach(s => s.classList.toggle('donut-slice-dim', on && s.dataset.i !== String(i)));
    };
    slices.forEach(s => {
      s.addEventListener('mouseenter', () => highlight(s.dataset.i, true));
      s.addEventListener('mouseleave', () => highlight(s.dataset.i, false));
      // Tooltip via <title> SVG element
      const i = parseInt(s.dataset.i, 10);
      const it = items[i];
      const pct = total > 0 ? Math.round(it.minutes / total * 100) : 0;
      const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      titleEl.textContent = `${it.name}: ${fmtMins(it.minutes)} (${pct}%)`;
      s.appendChild(titleEl);
    });
    rows.forEach(r => {
      r.addEventListener('mouseenter', () => highlight(r.dataset.i, true));
      r.addEventListener('mouseleave', () => highlight(r.dataset.i, false));
    });
  }

  // ============================================================
  //  Initial render
  // ============================================================
  const initial = JSON.parse(document.getElementById('dash-initial-data').textContent || '{}');
  renderDonut(
    document.getElementById('dash-chart-project'),
    document.getElementById('dash-legend-project'),
    initial.projectChart || [],
    initial.rangeMins || 0
  );
  renderDonut(
    document.getElementById('dash-chart-client'),
    document.getElementById('dash-legend-client'),
    initial.clientChart || [],
    initial.rangeMins || 0
  );

  // ============================================================
  //  Range change → re-fetch + re-render
  // ============================================================
  async function applyRange(from, to) {
    fromInput.value = from;
    toInput.value   = to;

    // Update URL so refresh keeps the range
    const u = new URL(location.href);
    u.searchParams.set('from', from);
    u.searchParams.set('to', to);
    history.replaceState(null, '', u.toString());

    try {
      const res = await fetch(`${BASE}/index.php?p=dashboard&action=time_data&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        headers: {'X-Requested-With':'XMLHttpRequest'}
      });
      const j = await res.json();
      // Update stats
      document.getElementById('dash-stat-range').textContent = fmtMins(j.rangeMins);
      // Update entries count
      document.getElementById('dash-entries-count').textContent = (j.entries || []).length;
      // Render charts
      renderDonut(
        document.getElementById('dash-chart-project'),
        document.getElementById('dash-legend-project'),
        j.projectChart || [],
        j.rangeMins || 0
      );
      renderDonut(
        document.getElementById('dash-chart-client'),
        document.getElementById('dash-legend-client'),
        j.clientChart || [],
        j.rangeMins || 0
      );

      // Re-render entries list
      const listEl = document.getElementById('dash-entries-list');
      if (!j.entries || j.entries.length === 0) {
        listEl.innerHTML = '<div class="dash-time-list-empty">No time entries in this range.</div>';
      } else {
        listEl.innerHTML = j.entries.map(e => {
          const taskTitle = e.task_title || '(deleted task)';
          const ctx = [e.client_name, e.project_name].filter(Boolean).map(escapeHtml).join(' › ');
          const created = new Date(e.created_at.replace(' ', 'T'));
          let dateLabel;
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const weekAgo = new Date(today.getTime() - 7*86400000);
          if (created >= today) dateLabel = created.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
          else if (created >= weekAgo) dateLabel = created.toLocaleDateString([], {weekday:'short'}) + ' ' + created.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
          else dateLabel = created.toLocaleDateString([], {month:'short', day:'numeric'});

          return `<a class="dash-time-entry" href="${BASE}/index.php?p=tasks&open=${e.task_id}">
            <div>
              <div class="dash-time-entry-task">${escapeHtml(taskTitle)}</div>
              ${ctx ? `<div class="dash-time-entry-context">${ctx}</div>` : ''}
            </div>
            <div class="dash-time-entry-mins">${escapeHtml(fmtMins(e.time_minutes))}</div>
            <div class="dash-time-entry-date">${escapeHtml(dateLabel)}</div>
          </a>`;
        }).join('');
      }
    } catch (err) {
      window.showToast?.('Failed to load time data.', 'error');
    }
  }

  // Date input changes
  fromInput.addEventListener('change', () => applyRange(fromInput.value, toInput.value));
  toInput.addEventListener('change',   () => applyRange(fromInput.value, toInput.value));

  // Presets
  function presetRange(p) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fmt = d => d.toISOString().slice(0, 10);
    if (p === 'this_month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return [fmt(start), fmt(today)];
    }
    if (p === 'last_month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end   = new Date(now.getFullYear(), now.getMonth(), 0);  // last day of prev month
      return [fmt(start), fmt(end)];
    }
    if (p === 'this_year') {
      const start = new Date(now.getFullYear(), 0, 1);
      return [fmt(start), fmt(today)];
    }
    if (p === 'all_time') {
      // Pick a very old start date — anything before the company began
      return ['2020-01-01', fmt(today)];
    }
    return [fmt(today), fmt(today)];
  }
  presetBtns.forEach(b => {
    b.addEventListener('click', () => {
      const [f, t] = presetRange(b.dataset.preset);
      // Mark active
      presetBtns.forEach(x => x.classList.toggle('active', x === b));
      applyRange(f, t);
    });
  });

  // Auto-detect which preset matches current range and mark it active
  (function markInitialPreset() {
    const presets = ['this_month','last_month','this_year','all_time'];
    for (const p of presets) {
      const [f, t] = presetRange(p);
      if (f === fromInput.value && t === toInput.value) {
        document.querySelector(`.dash-range-preset[data-preset="${p}"]`)?.classList.add('active');
        return;
      }
    }
  })();
})();
</script>
