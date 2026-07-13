<?php
/**
 * Project shelf partial.
 * Has: $project, $tasks, $users, $statusValues, $urgValues, $typeValues
 */
$canEditProj  = Perm::can('projects.edit');
$canCreateTask= Perm::can('tasks.create');
$taskCount    = count($tasks);
$doneCount    = 0;
foreach ($tasks as $t) {
    // count complete by checking status key — rough but works without extra query
    if (stripos($t['status_label'] ?? '', 'complete') !== false) $doneCount++;
}
$pct = $taskCount > 0 ? round(($doneCount / $taskCount) * 100) : 0;

// Pre-fill JSON for new task modal
$prefill = json_encode([
    'project_id'       => $project['id'],
    'assignee_user_id' => $project['manager_id'] ?? '',
]);
?>

<!-- Project header -->
<div class="proj-detail-header">
  <div>
    <h2 class="proj-detail-title"><?= e($project['name']) ?></h2>
    <div class="proj-detail-meta">
      <?= e($project['client_name'] ?? '—') ?>
      <?php if ($project['manager_name']): ?> &middot; Manager: <?= e($project['manager_name']) ?><?php endif; ?>
    </div>
  </div>
  <div style="display:flex;gap:8px;flex-shrink:0">
    <?php if ($canEditProj): ?>
      <button class="btn btn-sm" data-modal-edit="project-modal"
        data-record='<?= e(json_encode([
            'id'              => $project['id'],
            'name'            => $project['name'],
            'client_id'       => $project['client_id'],
            'description'     => $project['description'] ?? '',
            'status_value_id' => $project['status_value_id'] ?? '',
            'manager_user_id' => $project['manager_user_id'] ?? '',
            'start_date'      => $project['start_date'] ?? '',
            'due_date'        => $project['due_date'] ?? '',
        ])) ?>'>
        <svg class="icon icon-sm"><use href="#i-pencil"/></svg> Edit
      </button>
    <?php endif; ?>
  </div>
</div>

<!-- Project details grid -->
<div class="proj-detail-grid">
  <div>
    <div class="proj-field-label">Status</div>
    <div class="proj-field-value">
      <?php if ($project['status_label']): ?>
        <span class="pill" style="<?= $project['status_color']?'background:'.e($project['status_color']).'22;color:'.e($project['status_color']).';border-color:'.e($project['status_color']).'44':'' ?>">
          <?= e($project['status_label']) ?>
        </span>
      <?php else: ?><span class="muted">—</span><?php endif; ?>
    </div>
  </div>
  <div>
    <div class="proj-field-label">Start Date</div>
    <div class="proj-field-value"><?= $project['start_date'] ? fmt_date($project['start_date']) : '<span class="muted">—</span>' ?></div>
  </div>
  <div>
    <div class="proj-field-label">Due Date</div>
    <div class="proj-field-value">
      <?php if ($project['due_date']):
          $over = new DateTime($project['due_date']) < new DateTime('today');
      ?>
        <span style="<?= $over?'color:var(--danger);font-weight:600':'' ?>"><?= fmt_date($project['due_date']) ?></span>
      <?php else: ?><span class="muted">—</span><?php endif; ?>
    </div>
  </div>
  <?php if ($project['description']): ?>
  <div style="grid-column:1/-1">
    <div class="proj-field-label">Description</div>
    <div class="proj-field-value" style="white-space:pre-wrap;line-height:1.6"><?= e($project['description']) ?></div>
  </div>
  <?php endif; ?>
</div>

<!-- Task progress bar -->
<?php if ($taskCount > 0): ?>
<div style="margin-bottom:20px">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
    <span style="font-size:12px;color:var(--text-muted)">Progress</span>
    <span style="font-size:12px;color:var(--text-muted)"><?= $doneCount ?>/<?= $taskCount ?> complete</span>
  </div>
  <div style="height:6px;background:var(--glass-border);border-radius:3px;overflow:hidden">
    <div style="height:100%;width:<?= $pct ?>%;background:linear-gradient(90deg,var(--primary),var(--accent));border-radius:3px;transition:width .4s"></div>
  </div>
</div>
<?php endif; ?>

<div class="sep"></div>

<!-- Task list -->
<div class="proj-tasks-header">
  <div class="proj-tasks-title">
    Tasks <span style="color:var(--text-muted);font-weight:400">(<?= $taskCount ?>)</span>
  </div>
  <?php if ($canCreateTask): ?>
    <button class="btn btn-primary btn-sm" data-modal-add="task-modal"
      data-prefill='<?= e($prefill) ?>'>
      <svg class="icon"><use href="#i-plus"/></svg> New Task
    </button>
  <?php endif; ?>
</div>

<?php if (empty($tasks)): ?>
  <div style="text-align:center;color:var(--text-muted);font-size:13px;padding:24px 0">
    No tasks yet.
    <?php if ($canCreateTask): ?><br><a href="#" data-modal-add="task-modal" data-prefill='<?= e($prefill) ?>'>Add the first task.</a><?php endif; ?>
  </div>
<?php else: foreach ($tasks as $t):
    $urgKey = $t['urgency_key'] ?? 'normal';
?>
  <div class="proj-task-row" data-task-id="<?= e($t['id']) ?>">
    <div class="proj-task-title">
      <span><?= e($t['title']) ?></span>
    </div>
    <div class="proj-task-meta">
      <?php if ($t['urgency_label']): ?>
        <span class="pill pill-urgency-<?= e($urgKey) ?>" style="font-size:10px"><?= e($t['urgency_label']) ?></span>
      <?php endif; ?>
      <?php if ($t['status_label']): ?>
        <span class="pill" style="font-size:10px;<?= $t['status_color']?'background:'.e($t['status_color']).'22;color:'.e($t['status_color']).';border-color:'.e($t['status_color']).'44':'' ?>"><?= e($t['status_label']) ?></span>
      <?php endif; ?>
      <?php if ($t['due_date']): ?>
        <span style="font-size:11px;color:var(--text-muted)"><?= fmt_date($t['due_date']) ?></span>
      <?php endif; ?>
      <?php if ($t['assignee_name']): ?>
        <span class="avatar" style="width:22px;height:22px;font-size:9px;flex-shrink:0" title="<?= e($t['assignee_name']) ?>">
          <?= e(substr($t['assignee_name'], 0, 2)) ?>
        </span>
      <?php endif; ?>
    </div>
  </div>
<?php endforeach; endif; ?>

<!-- Task modal (needed here since new task button is inside shelf) -->
<?php if ($canCreateTask): ?>
<div class="modal-backdrop" id="task-modal">
  <div class="modal modal-lg">
    <div class="modal-header">
      <h2 class="modal-title" data-add-label="New Task" data-edit-label="Edit Task">New Task</h2>
      <button class="modal-close" data-modal-close>&times;</button>
    </div>
    <div class="modal-body">
      <form data-ajax-form action="<?= e(url('tasks',['action'=>'save'])) ?>" method="post" id="task-form-shelf">
        <?= csrf_field() ?>
        <input type="hidden" name="id" value="">
        <div class="form-grid">
          <div class="form-row full"><label>Title <span class="required">*</span></label>
            <input type="text" name="title" maxlength="255">
            <span class="field-error" data-error="title"></span></div>
          <div class="form-row full">
            <label>Project</label>
            <input type="text" value="<?= e($project['name']) ?>" disabled style="opacity:.7">
            <input type="hidden" name="project_id" value="<?= e($project['id']) ?>">
          </div>
          <div class="form-row"><label>Status</label>
            <select name="status_value_id"><option value="">—</option>
              <?php foreach ($statusValues as $sv): ?><option value="<?= e($sv['id']) ?>"><?= e($sv['label']) ?></option><?php endforeach; ?>
            </select></div>
          <div class="form-row"><label>Type</label>
            <select name="type_value_id"><option value="">—</option>
              <?php foreach ($typeValues as $tv): ?><option value="<?= e($tv['id']) ?>"><?= e($tv['label']) ?></option><?php endforeach; ?>
            </select></div>
          <div class="form-row"><label>Urgency</label>
            <select name="urgency_value_id"><option value="">—</option>
              <?php foreach ($urgValues as $uv): ?><option value="<?= e($uv['id']) ?>"><?= e($uv['label']) ?></option><?php endforeach; ?>
            </select></div>
          <div class="form-row"><label>Due Date</label><input type="date" name="due_date"></div>
          <div class="form-row full"><label>Assignee</label>
            <select name="assignee_user_id" id="task-assignee-shelf">
              <option value="">— Unassigned —</option>
              <?php foreach ($users as $u):
                  $sel = $u['id'] == ($project['manager_id'] ?? 0) ? ' selected' : '';
              ?>
                <option value="<?= e($u['id']) ?>"<?= $sel ?>><?= e($u['first_name'].' '.$u['last_name']) ?></option>
              <?php endforeach; ?>
            </select></div>
          <div class="form-row full"><label>Description</label>
            <textarea name="description" style="min-height:80px"></textarea></div>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <div class="modal-footer-left"></div>
      <div class="modal-footer-right">
        <button type="button" class="btn" data-modal-close>Cancel</button>
        <button type="submit" form="task-form-shelf" class="btn btn-primary">Save Task</button>
      </div>
    </div>
  </div>
</div>
<?php endif; ?>

<!-- Task shelf container (so clicking a task inside project shelf still works) -->
<div class="task-shelf-wrap" id="task-shelf-wrap" style="z-index:160">
  <div class="task-shelf-overlay"></div>
  <div class="task-shelf-peek" title="Close"></div>
  <div class="task-shelf">
    <div class="task-shelf-header">
      <button class="task-shelf-close">&times;</button>
      <span style="font-size:13px;color:var(--text-muted)">Task Detail</span>
    </div>
    <div class="task-shelf-body" id="task-shelf-body"></div>
  </div>
</div>
