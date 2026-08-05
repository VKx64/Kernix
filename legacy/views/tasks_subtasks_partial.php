<?php
/**
 * Subtasks list partial — round 19
 * Adds data-subtask-id on rows and makes title click-editable.
 * Vars: $subtasks, $isAdmin, $totalEst, $totalAct
 */
?>

<?php if (empty($subtasks)): ?>
  <div class="empty-state">
    No subtasks yet.
  </div>
<?php else: foreach ($subtasks as $s):
    $done    = !empty($s['completed_at']);
    $overdue = $s['due_date'] && !$done && new DateTime($s['due_date']) < new DateTime('today');
?>
  <div class="subtask-row <?= $done?'subtask-done':'' ?>" data-subtask-id="<?= e($s['id']) ?>">
    <input type="checkbox" class="subtask-check" data-subtask-toggle="<?= e($s['id']) ?>" <?= $done?'checked':'' ?>>

    <div class="subtask-main">
      <div class="subtask-title" title="Click to edit"><?= e($s['title']) ?></div>
      <div class="subtask-meta">
        <?php if ($s['assignee_name']): ?>
          <span class="subtask-meta-item">
            <span class="avatar" style="width:16px;height:16px;font-size:8px"><?= e(substr($s['assignee_name'],0,2)) ?></span>
            <?= e($s['assignee_name']) ?>
          </span>
        <?php endif; ?>
        <?php if ($s['status_label']): ?>
          <span class="subtask-meta-item pill" style="font-size:10px;<?= $s['status_color']?'background:'.e($s['status_color']).'22;color:'.e($s['status_color']).';border-color:'.e($s['status_color']).'44':'' ?>">
            <?= e($s['status_label']) ?>
          </span>
        <?php endif; ?>
        <?php if ($s['due_date']): ?>
          <span class="subtask-meta-item" style="<?= $overdue?'color:var(--danger)':'' ?>">
            <svg class="icon icon-sm" style="width:11px;height:11px"><use href="#i-archive"/></svg>
            <?= fmt_date($s['due_date']) ?>
          </span>
        <?php endif; ?>
        <?php if ($s['estimated_minutes']): ?>
          <span class="subtask-meta-item" title="Estimated">
            ⏱ <?= fmt_duration((int)$s['estimated_minutes']) ?>
          </span>
        <?php endif; ?>
        <?php if ($s['actual_minutes']): ?>
          <span class="subtask-meta-item" title="Actual time spent" style="color:var(--primary-hover)">
            ▶ <?= fmt_duration((int)$s['actual_minutes']) ?>
          </span>
        <?php endif; ?>
      </div>
    </div>

    <div class="subtask-actions">
      <button type="button" class="icon-btn" title="Delete"
        data-subtask-delete="<?= e($s['id']) ?>">
        <svg class="icon icon-sm"><use href="#i-trash"/></svg>
      </button>
    </div>
  </div>
<?php endforeach; endif; ?>

<?php if (!empty($totalEst) || !empty($totalAct)): ?>
  <div class="subtask-totals">
    <?php if (!empty($totalEst)): ?><span>Est total: <strong><?= fmt_duration($totalEst) ?></strong></span><?php endif; ?>
    <?php if (!empty($totalAct)): ?><span>Actual total: <strong style="color:var(--primary-hover)"><?= fmt_duration($totalAct) ?></strong></span><?php endif; ?>
  </div>
<?php endif; ?>
