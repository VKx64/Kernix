<?php
$cfg = $cfg ?? [];
$columns      = $cfg['columns']      ?? [];
$rows         = $cfg['rows']         ?? [];
$total        = (int)($cfg['total']  ?? 0);
$perPage      = (int)($cfg['per_page'] ?? 100);
$pageNum      = max(1, (int)($cfg['page_num'] ?? 1));
$totalPages   = max(1, (int)ceil($total / $perPage));
$archiveMode  = $cfg['archive_mode'] ?? 'active';
$createUrl    = $cfg['create_url']   ?? null;
$rowUrl       = $cfg['row_url']      ?? null;
$renderCell   = $cfg['render_cell']  ?? null;
$pageKey      = $cfg['page']         ?? '';

$baseQuery = $_GET;
$mkUrl = function(array $overrides) use ($baseQuery) {
    return APP_BASE . '/index.php?' . http_build_query(array_merge($baseQuery, $overrides));
};

$pagination = function() use ($pageNum, $totalPages, $mkUrl, $total) {
    if ($totalPages <= 1) return '';
    $out  = '<nav class="pagination">';
    $prev = max(1, $pageNum - 1);
    $next = min($totalPages, $pageNum + 1);
    $out .= '<a class="page-link'.($pageNum<=1?' disabled':'').'" href="'.e($mkUrl(['page'=>$prev])).'">Prev</a>';
    $out .= '<span class="page-info">Page '.$pageNum.' of '.$totalPages.' &middot; '.number_format($total).' total</span>';
    $out .= '<a class="page-link'.($pageNum>=$totalPages?' disabled':'').'" href="'.e($mkUrl(['page'=>$next])).'">Next</a>';
    $out .= '</nav>';
    return $out;
};
?>
<div class="list-toolbar">
  <form method="get" class="list-filters" action="<?= e(APP_BASE) ?>/index.php">
    <input type="hidden" name="p" value="<?= e($pageKey) ?>">
    <div class="filter-group">
      <label class="filter-label">Search</label>
      <div class="search-input">
        <svg class="icon"><use href="#i-search"/></svg>
        <input type="text" name="q" value="<?= e($_GET['q'] ?? '') ?>" placeholder="Search...">
      </div>
    </div>
    <div class="filter-group">
      <label class="filter-label">Show</label>
      <select name="archive">
        <option value="active"   <?= $archiveMode==='active'?'selected':'' ?>>Active</option>
        <option value="archived" <?= $archiveMode==='archived'?'selected':'' ?>>Archived</option>
        <option value="all"      <?= $archiveMode==='all'?'selected':'' ?>>All</option>
      </select>
    </div>
    <?php foreach ($columns as $col): if (empty($col['filter_values'])) continue; ?>
      <div class="filter-group">
        <label class="filter-label"><?= e($col['label']) ?></label>
        <select name="f_<?= e($col['key']) ?>">
          <option value="">All</option>
          <?php foreach ($col['filter_values'] as $opt):
              $sel = (string)($_GET['f_'.$col['key']] ?? '') === (string)$opt['v'] ? 'selected' : ''; ?>
            <option value="<?= e($opt['v']) ?>" <?= $sel ?>><?= e($opt['l']) ?></option>
          <?php endforeach; ?>
        </select>
      </div>
    <?php endforeach; ?>
    <?php foreach ($columns as $col): if (empty($col['date_range'])) continue; ?>
      <div class="filter-group">
        <label class="filter-label"><?= e($col['label']) ?> from</label>
        <input type="date" name="from_<?= e($col['key']) ?>" value="<?= e($_GET['from_'.$col['key']] ?? '') ?>">
      </div>
      <div class="filter-group">
        <label class="filter-label">to</label>
        <input type="date" name="to_<?= e($col['key']) ?>" value="<?= e($_GET['to_'.$col['key']] ?? '') ?>">
      </div>
    <?php endforeach; ?>
    <div class="filter-group">
      <button type="submit" class="btn">Apply</button>
      <a href="<?= e(url($pageKey)) ?>" class="btn btn-ghost">Clear</a>
    </div>
  </form>
  <?php if ($createUrl): ?>
    <a href="<?= e($createUrl) ?>" class="btn btn-primary">
      <svg class="icon"><use href="#i-plus"/></svg> New
    </a>
  <?php endif; ?>
</div>

<?= $pagination() ?>

<div class="table-wrap">
  <table class="data-table">
    <thead class="sticky-head">
      <tr>
        <?php foreach ($columns as $col): ?>
          <th>
            <?php if (!empty($col['sortable'])):
                $curSort = $_GET['sort'] ?? '';
                $curDir  = $_GET['dir']  ?? 'asc';
                $nextDir = ($curSort === $col['key'] && $curDir === 'asc') ? 'desc' : 'asc'; ?>
              <a href="<?= e($mkUrl(['sort'=>$col['key'],'dir'=>$nextDir])) ?>" class="sort-link">
                <?= e($col['label']) ?>
                <?php if ($curSort === $col['key']): ?>
                  <span class="sort-ind"><?= $curDir === 'asc' ? '▲' : '▼' ?></span>
                <?php endif; ?>
              </a>
            <?php else: ?>
              <?= e($col['label']) ?>
            <?php endif; ?>
          </th>
        <?php endforeach; ?>
      </tr>
    </thead>
    <tbody>
      <?php if (empty($rows)): ?>
        <tr><td colspan="<?= count($columns) ?>" class="empty">No records found.</td></tr>
      <?php else: foreach ($rows as $r):
          $href = $rowUrl ? $rowUrl($r) : null; ?>
        <tr<?= $href ? ' class="clickable" data-href="'.e($href).'"' : '' ?>>
          <?php foreach ($columns as $col):
              $val = $r[$col['key']] ?? '';
              if ($renderCell) {
                  $rendered = $renderCell($r, $col);
                  if ($rendered !== null) { echo '<td>'.$rendered.'</td>'; continue; }
              } ?>
            <td><?= e($val) ?></td>
          <?php endforeach; ?>
        </tr>
      <?php endforeach; endif; ?>
    </tbody>
  </table>
</div>

<?= $pagination() ?>
