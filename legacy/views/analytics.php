<?php
/**
 * @var array  $tabs       slug => label
 * @var string $activeTab
 * @var string $rangeFrom
 * @var string $rangeTo
 * @var array  $data
 *
 * BUILD-VIEW: 2026-05-22-timeline-tab
 */

function ana_fmt_mins(int $m): string {
    if ($m === 0) return '0m';
    $neg = $m < 0 ? '-' : '';
    $m = abs($m);
    $h = intdiv($m, 60);
    $mm = $m % 60;
    if ($h === 0) return $neg . $mm . 'm';
    if ($mm === 0) return $neg . $h . 'h';
    return $neg . $h . 'h ' . $mm . 'm';
}
?>

<div class="welcome">
  <h2>Analytics</h2>
  <p class="muted">Team activity, time tracking, and productivity reports.</p>
</div>

<?php if (isset($_GET['dump'])): ?>
  <div style="background:#000;color:#0f0;padding:14px;font:12px monospace;border-radius:6px;margin-bottom:14px;white-space:pre-wrap">
<?php
echo "=== PAGE DIAGNOSTIC ===\n";
echo "BUILD-VIEW: 2026-05-22-timeline-tab\n";
echo "activeTab : " . htmlspecialchars($activeTab) . "\n";
echo "rangeFrom : " . htmlspecialchars($rangeFrom) . "\n";
echo "rangeTo   : " . htmlspecialchars($rangeTo) . "\n";
echo "\n--- \$data keys ---\n";
echo implode(", ", array_keys($data ?? [])) . "\n";
echo "\n--- \$data['rows'] count ---\n";
echo count($data['rows'] ?? []) . "\n";
echo "\n--- \$data summary ---\n";
foreach (['total_clocked','total_logged','team_util','active_users','from','to','row_count'] as $k) {
    if (isset($data[$k])) echo "$k = " . (is_scalar($data[$k]) ? $data[$k] : json_encode($data[$k])) . "\n";
}
echo "\n--- first 3 \$data['rows'] (if any) ---\n";
foreach (array_slice($data['rows'] ?? [], 0, 3) as $i => $r) {
    echo "  [$i] " . json_encode($r) . "\n";
}
?>
  </div>
<?php endif; ?>

<!-- Tab strip -->
<div class="ana-tabstrip">
  <?php foreach ($tabs as $slug => $label): ?>
    <a class="ana-tab <?= $slug === $activeTab ? 'active' : '' ?>"
       href="<?= e(url('analytics', ['tab' => $slug, 'from' => $rangeFrom, 'to' => $rangeTo])) ?>"><?= e($label) ?></a>
  <?php endforeach; ?>
</div>

<!-- Range picker -->
<div class="ana-range-bar">
  <div class="dash-range-picker">
    <div class="dash-range-presets">
      <button type="button" class="dash-range-preset" data-preset="this_week">This Week</button>
      <button type="button" class="dash-range-preset" data-preset="this_month">This Month</button>
      <button type="button" class="dash-range-preset" data-preset="last_month">Last Month</button>
      <button type="button" class="dash-range-preset" data-preset="this_year">This Year</button>
      <button type="button" class="dash-range-preset" data-preset="all_time">All Time</button>
    </div>
    <div class="dash-range-inputs">
      <input type="date" id="ana-range-from" value="<?= e($rangeFrom) ?>">
      <span class="muted">→</span>
      <input type="date" id="ana-range-to" value="<?= e($rangeTo) ?>">
    </div>
  </div>
</div>

<!-- Tab content -->
<div class="ana-tab-content" id="ana-tab-content">

  <?php if ($activeTab === 'login_vs_logged'):
    $rows    = $data['rows'] ?? [];
    $tC      = (int)($data['total_clocked'] ?? 0);
    $tL      = (int)($data['total_logged']  ?? 0);
    $tUtil   = (int)($data['team_util']     ?? 0);
    $active  = (int)($data['active_users']  ?? 0);
  ?>
    <!-- Team summary cards -->
    <div class="ana-summary">
      <div class="ana-summary-card">
        <div class="ana-summary-label">Team Clocked Time</div>
        <div class="ana-summary-value"><?= e(ana_fmt_mins($tC)) ?></div>
        <div class="ana-summary-sub">across <?= $active ?> <?= $active === 1 ? 'person' : 'people' ?> with activity</div>
      </div>
      <div class="ana-summary-card">
        <div class="ana-summary-label">Team Logged Work</div>
        <div class="ana-summary-value"><?= e(ana_fmt_mins($tL)) ?></div>
        <div class="ana-summary-sub">recorded against tasks</div>
      </div>
      <div class="ana-summary-card">
        <div class="ana-summary-label">Team Utilization</div>
        <div class="ana-summary-value ana-util-value" data-util="<?= $tUtil ?>"><?= $tUtil ?>%</div>
        <div class="ana-summary-sub">logged ÷ clocked</div>
      </div>
    </div>

    <!-- Per-user breakdown -->
    <div class="ana-card">
      <div class="ana-card-title">By Team Member</div>

      <?php if (empty($rows)): ?>
        <div class="ana-empty">No users to report on.</div>
      <?php else: ?>

      <div class="ana-table-wrap">
      <table class="ana-table" id="ana-lvl-table">
        <thead>
          <tr>
            <th>Team Member</th>
            <th class="ana-th-num">Clocked</th>
            <th class="ana-th-num">Logged</th>
            <th class="ana-th-num">Difference</th>
            <th class="ana-th-bar">Utilization</th>
          </tr>
        </thead>
        <tbody>
          <?php foreach ($rows as $r):
            $isInactive = !$r['has_activity'];
            $diffClass = $r['diff_min'] > 0 ? 'ana-diff-pos' : ($r['diff_min'] < 0 ? 'ana-diff-neg' : '');
            $utilClass = '';
            if ($r['has_activity']) {
                if ($r['util_pct'] < 50)  $utilClass = 'ana-util-low';
                elseif ($r['util_pct'] < 80) $utilClass = 'ana-util-mid';
                else $utilClass = 'ana-util-high';
            }
          ?>
            <tr class="<?= $isInactive ? 'ana-row-inactive' : '' ?>">
              <td>
                <div class="ana-user-cell">
                  <?php if (!empty($r['image'])): ?>
                    <img src="<?= e(Storage::url('local', $r['image'])) ?>" class="ana-avatar" alt="">
                  <?php else: ?>
                    <span class="ana-avatar ana-avatar-initials"><?= e(strtoupper(substr($r['name'], 0, 2))) ?></span>
                  <?php endif; ?>
                  <div>
                    <div class="ana-user-name"><?= e($r['name']) ?: e($r['username']) ?></div>
                    <div class="ana-user-handle">@<?= e($r['username']) ?></div>
                  </div>
                </div>
              </td>
              <td class="ana-num"><?= e(ana_fmt_mins($r['clocked_min'])) ?></td>
              <td class="ana-num"><?= e(ana_fmt_mins($r['logged_min'])) ?></td>
              <td class="ana-num <?= $diffClass ?>"><?= e(ana_fmt_mins($r['diff_min'])) ?></td>
              <td>
                <?php if ($r['has_activity']): ?>
                  <div class="ana-util-cell">
                    <div class="ana-util-bar">
                      <div class="ana-util-bar-fill <?= $utilClass ?>"
                           style="width: <?= min(100, $r['util_pct']) ?>%"></div>
                    </div>
                    <div class="ana-util-pct"><?= $r['util_pct'] ?>%</div>
                  </div>
                <?php else: ?>
                  <span class="muted" style="font-size:11px">No activity</span>
                <?php endif; ?>
              </td>
            </tr>
          <?php endforeach; ?>
        </tbody>
      </table>
      </div>

      <!-- Legend -->
      <div class="ana-legend">
        <div class="ana-legend-item">
          <span class="ana-legend-swatch ana-util-high"></span> 80%+ excellent
        </div>
        <div class="ana-legend-item">
          <span class="ana-legend-swatch ana-util-mid"></span> 50–79% moderate
        </div>
        <div class="ana-legend-item">
          <span class="ana-legend-swatch ana-util-low"></span> &lt;50% needs attention
        </div>
        <div class="ana-legend-item">
          <span style="color: var(--success); font-weight: 600;">+ difference</span> = clocked time not logged
        </div>
        <div class="ana-legend-item">
          <span style="color: var(--danger); font-weight: 600;">− difference</span> = logged more than clocked
        </div>
      </div>

      <?php endif; ?>
    </div>

  <?php endif; ?>

  <?php if ($activeTab === 'timeline'):
    $rows = $data['rows'] ?? [];
  ?>
    <div class="ana-card ana-timeline-card">
      <div class="ana-card-title">
        Timeline — clocked sessions with logged-task fill
      </div>
      <p class="muted" style="font-size:12px;margin:-4px 0 12px">
        Each pill is one clocked-in session. Fill inside shows the % of that session's net time (minus breaks) that was logged on tasks. Red = task time exceeds clocked time.
      </p>

      <?php if (empty($rows)): ?>
        <div class="ana-empty">No users to report on.</div>
      <?php else: ?>
        <div id="ana-timeline-mount"
             class="ana-timeline-mount"
             data-payload='<?= e(json_encode($data, JSON_UNESCAPED_UNICODE)) ?>'>
          <div class="ana-timeline-loading">Rendering timeline…</div>
        </div>

        <!-- Legend -->
        <div class="ana-legend" style="margin-top:14px">
          <div class="ana-legend-item">
            <span class="atl-legend-swatch atl-legend-clocked"></span> Clocked-in (net of breaks)
          </div>
          <div class="ana-legend-item">
            <span class="atl-legend-swatch atl-legend-filled"></span> Logged on tasks (fill)
          </div>
          <div class="ana-legend-item">
            <span class="atl-legend-swatch atl-legend-full"></span> 100% — fully logged
          </div>
          <div class="ana-legend-item">
            <span class="atl-legend-swatch atl-legend-over"></span> Over-logged (more logged than clocked)
          </div>
          <div class="ana-legend-item">
            <span class="atl-legend-swatch atl-legend-break"></span> Break notch
          </div>
        </div>
      <?php endif; ?>
    </div>
  <?php endif; ?>

</div>

<script>
(function () {
  const BASE = document.querySelector('meta[name=app-base]')?.content || '';

  const fromInput  = document.getElementById('ana-range-from');
  const toInput    = document.getElementById('ana-range-to');
  const presetBtns = document.querySelectorAll('.dash-range-preset');

  function presetRange(p) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // IMPORTANT: do not use toISOString() — it produces a UTC string,
    // which formats local-midnight Dates one day earlier (or later) for
    // any timezone east (or west) of UTC. Format in local time instead.
    const fmt = d => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    if (p === 'this_week') {
      // Monday of current week through today
      const day = (today.getDay() + 6) % 7; // 0 = Mon
      const start = new Date(today); start.setDate(today.getDate() - day);
      return [fmt(start), fmt(today)];
    }
    if (p === 'this_month') {
      return [fmt(new Date(now.getFullYear(), now.getMonth(), 1)), fmt(today)];
    }
    if (p === 'last_month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end   = new Date(now.getFullYear(), now.getMonth(), 0);
      return [fmt(start), fmt(end)];
    }
    if (p === 'this_year') {
      return [fmt(new Date(now.getFullYear(), 0, 1)), fmt(today)];
    }
    if (p === 'all_time') {
      return ['2020-01-01', fmt(today)];
    }
    return [fmt(today), fmt(today)];
  }

  function reloadWithRange(from, to) {
    const u = new URL(location.href);
    u.searchParams.set('from', from);
    u.searchParams.set('to', to);
    location.href = u.toString();
  }

  fromInput?.addEventListener('change', () => reloadWithRange(fromInput.value, toInput.value));
  toInput?.addEventListener('change',   () => reloadWithRange(fromInput.value, toInput.value));

  presetBtns.forEach(b => {
    b.addEventListener('click', () => {
      const [f, t] = presetRange(b.dataset.preset);
      presetBtns.forEach(x => x.classList.toggle('active', x === b));
      reloadWithRange(f, t);
    });
  });

  // Mark initial preset active
  (function markInitialPreset() {
    if (!fromInput) return;
    const presets = ['this_week','this_month','last_month','this_year','all_time'];
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
