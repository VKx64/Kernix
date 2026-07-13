<?php
/** Activity log partial — timeline of all events related to this task. */

if (empty($events)): ?>
  <div style="text-align:center;color:var(--text-muted);padding:24px 0;font-size:12px">
    No activity yet.
  </div>
<?php else:
    // Icon and color map for action types
    $iconMap = [
        'create'    => ['icon' => '+',  'color' => '#22c55e'],
        'update'    => ['icon' => '✎',  'color' => 'var(--primary-hover)'],
        'delete'    => ['icon' => '×',  'color' => 'var(--danger)'],
        'archive'   => ['icon' => '📦', 'color' => 'var(--text-muted)'],
        'unarchive' => ['icon' => '↩',  'color' => 'var(--text-muted)'],
        'send'      => ['icon' => '✈',  'color' => 'var(--accent)'],
    ];
?>
  <div class="activity-timeline">
    <?php foreach ($events as $ev):
        $cfg = $iconMap[$ev['action']] ?? ['icon'=>'•', 'color'=>'var(--text-muted)'];
        $changes = $ev['changes_json'] ? json_decode($ev['changes_json'], true) : null;
    ?>
      <div class="activity-item">
        <div class="activity-dot" style="background:<?= $cfg['color'] ?>22;color:<?= $cfg['color'] ?>;border-color:<?= $cfg['color'] ?>66"><?= $cfg['icon'] ?></div>
        <div class="activity-body">
          <div class="activity-summary">
            <strong><?= e($ev['actor_name'] ?: 'System') ?></strong>
            <span style="color:var(--text-muted)"><?= e($ev['summary'] ?: $ev['action']) ?></span>
          </div>
          <?php if ($changes && is_array($changes) && count($changes) > 0): ?>
            <div class="activity-changes">
              <?php foreach ($changes as $field => $diff):
                  if (!is_array($diff) || count($diff) < 2) continue;
                  [$old, $new] = $diff;
                  if ($old === $new) continue;
                  // Truncate long values
                  $oldStr = is_scalar($old) ? (string)$old : json_encode($old);
                  $newStr = is_scalar($new) ? (string)$new : json_encode($new);
                  if (strlen($oldStr) > 60) $oldStr = substr($oldStr, 0, 57) . '…';
                  if (strlen($newStr) > 60) $newStr = substr($newStr, 0, 57) . '…';
              ?>
                <div class="activity-change">
                  <span class="activity-field"><?= e(str_replace('_', ' ', $field)) ?>:</span>
                  <?php if ($oldStr === '' || $old === null): ?>
                    <span class="activity-val activity-val-new"><?= e($newStr) ?></span>
                  <?php elseif ($newStr === '' || $new === null): ?>
                    <span class="activity-val activity-val-old"><?= e($oldStr) ?></span> → <em>cleared</em>
                  <?php else: ?>
                    <span class="activity-val activity-val-old"><?= e($oldStr) ?></span>
                    <span style="opacity:.5;margin:0 4px">→</span>
                    <span class="activity-val activity-val-new"><?= e($newStr) ?></span>
                  <?php endif; ?>
                </div>
              <?php endforeach; ?>
            </div>
          <?php endif; ?>
          <div class="activity-time"><?= fmt_datetime($ev['created_at']) ?></div>
        </div>
      </div>
    <?php endforeach; ?>
  </div>
<?php endif; ?>
