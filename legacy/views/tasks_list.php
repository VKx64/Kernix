<?php
$totalPages = max(1, (int)ceil($total / $perPage));
$canEdit    = Perm::can('tasks.edit');
$canDelete  = Perm::can('tasks.delete');
$canArchive = Perm::can('tasks.archive');
$canCreate  = Perm::can('tasks.create');
$isAdmin    = Perm::isAdmin();
$delTpl     = delete_url_template('tasks', 'delete');

$statusOpts   = array_map(fn($v) => ['v'=>$v['id'],'l'=>$v['label']], $statusValues);
$urgOpts      = array_map(fn($v) => ['v'=>$v['id'],'l'=>$v['label']], $urgValues);
$typeOpts     = array_map(fn($v) => ['v'=>$v['id'],'l'=>$v['label']], $typeValues);
// FIX: assignee filter includes ALL users
$assigneeOpts = array_map(fn($u) => [
    'v' => $u['id'],
    'l' => $u['first_name'].' '.$u['last_name'] . ($u['status']==='inactive' ? ' (inactive)' : ''),
], $allUsers);

$mkUrl = fn(array $ov) => APP_BASE . '/index.php?' . http_build_query(array_merge($_GET, $ov));
$pagination = function() use ($pageNum,$totalPages,$total,$mkUrl) {
    if ($totalPages <= 1) return '';
    $p = max(1,$pageNum-1); $n = min($totalPages,$pageNum+1);
    return '<nav class="pagination">'
        .'<a class="page-link'.($pageNum<=1?' disabled':'').'" href="'.e($mkUrl(['page'=>$p])).'">Prev</a>'
        .'<span class="page-info">'.number_format($total).' tasks · Page '.$pageNum.' of '.$totalPages.'</span>'
        .'<a class="page-link'.($pageNum>=$totalPages?' disabled':'').'" href="'.e($mkUrl(['page'=>$n])).'">Next</a>'
        .'</nav>';
};

// For inline-add: do we have a single project scoped?
$inlineProjectId = $fProject !== '' ? (int)$fProject : 0;
?>

<div class="list-page-header">
  <div class="list-page-header-left">
    <h1>Tasks</h1>
    <div class="list-page-meta">
      <span>Showing <strong><?= number_format(count($rows)) ?></strong> of <strong><?= number_format($total) ?></strong> tasks</span>

      <?php if (!is_single_client_mode()): ?>
      <span class="list-scope-dd">
        Client:
        <select id="scope-client" data-scope-param="f_client">
          <option value="">All</option>
          <?php foreach ($allClients as $cl): ?>
            <option value="<?= e($cl['id']) ?>" <?= (string)$fClient===(string)$cl['id']?'selected':'' ?>><?= e($cl['name']) ?></option>
          <?php endforeach; ?>
        </select>
      </span>
      <?php endif; ?>

      <span class="list-scope-dd">
        Project:
        <select id="scope-project" data-scope-param="f_project">
          <option value="">All</option>
          <?php foreach ($projects as $p): ?>
            <option value="<?= e($p['id']) ?>"
                    data-client-id="<?= e($p['client_id'] ?? '') ?>"
                    <?= (string)$fProject===(string)$p['id']?'selected':'' ?>><?= e($p['name']) ?></option>
          <?php endforeach; ?>
        </select>
      </span>
    </div>
  </div>

  <div class="list-page-header-right">
    <?= toggle_pill('Archived', 't_archived', $tArchived, 'danger') ?>
    <?= toggle_pill('My Tasks', 't_mine',     $tMyTasks) ?>
    <?= toggle_pill('Urgent',   't_urgent',   $tUrgent,  'danger') ?>
    <div class="list-page-header-sep"></div>
    <?php $projColLabel = is_single_client_mode() ? 'Project' : 'Project / Client'; ?>
    <?= columns_selector([
        ['id'=>'project',  'label'=>$projColLabel],
        ['id'=>'status',   'label'=>'Status'],
        ['id'=>'urgency',  'label'=>'Urgency'],
        ['id'=>'type',     'label'=>'Type'],
        ['id'=>'assignee', 'label'=>'Assignee'],
        ['id'=>'due',      'label'=>'Due Date'],
        ['id'=>'actions',  'label'=>'Actions'],
    ], 'tasks') ?>
    <?php if ($canCreate): ?>
      <button class="btn btn-primary btn-sm" data-modal-add="task-modal">
        <svg class="icon"><use href="#i-plus"/></svg> New Task
      </button>
    <?php endif; ?>
  </div>
</div>

<div class="grid-meta">
  <div class="grid-active-filters"></div>
</div>

<?= $pagination() ?>

<div class="table-wrap">
<table class="data-table has-col-filters">
  <thead class="sticky-head">
    <tr>
      <?= th(['key'=>'q_title',   'col'=>'title',   'label'=>'Title',          'sortable'=>true, 'sort_key'=>'title',        'filter'=>'text',        'placeholder'=>'Search…']) ?>
      <?= th(['key'=>'q_project', 'col'=>'project', 'label'=>$projColLabel,'sortable'=>false,                            'filter'=>'text',        'placeholder'=>'Search project…']) ?>
      <?= th(['key'=>'f_status',  'col'=>'status',  'label'=>'Status',          'sortable'=>true, 'sort_key'=>'status_sort',  'filter'=>'multiselect', 'options'=>$statusOpts]) ?>
      <?= th(['key'=>'f_urgency', 'col'=>'urgency', 'label'=>'Urgency',         'sortable'=>true, 'sort_key'=>'urgency_sort', 'filter'=>'multiselect', 'options'=>$urgOpts]) ?>
      <?= th(['key'=>'f_type',    'col'=>'type',    'label'=>'Type',            'sortable'=>false,                            'filter'=>'select',      'options'=>$typeOpts]) ?>
      <?= th(['key'=>'f_assignee','col'=>'assignee','label'=>'Assignee',        'sortable'=>false,                            'filter'=>'multiselect', 'options'=>$assigneeOpts]) ?>
      <?= th(['key'=>'due',       'col'=>'due',     'label'=>'Due Date',        'sortable'=>true, 'sort_key'=>'due_date',     'filter'=>'date_range',  'align_right'=>true]) ?>
      <th data-col="actions"><div class="th-inner"><div class="th-label"></div></div></th>
    </tr>
  </thead>
  <tbody>
    <?php if (empty($rows)): ?>
      <tr><td colspan="8" class="empty">
        <?php if ($tMyTasks): ?>
          No tasks assigned to you. <a href="#" onclick="document.querySelector('input[data-toggle-param=t_mine]').click();return false">Turn off "My Tasks"</a> to see all.
        <?php else: ?>
          No tasks found.
          <?php if ($canCreate): ?> <a href="#" data-modal-add="task-modal">Create one.</a><?php endif; ?>
        <?php endif; ?>
      </td></tr>
    <?php else: foreach ($rows as $r):
        $isArchived = !empty($r['archived_at']);
        $urgKey     = $r['urgency_key'] ?? 'normal';
        $record = json_encode([
            'id'=>$r['id'],'project_id'=>$r['project_id'],'title'=>$r['title'],
            'description'=>$r['description']??'','status_value_id'=>$r['status_value_id']??'',
            'type_value_id'=>$r['type_value_id']??'','urgency_value_id'=>$r['urgency_value_id']??'',
            'due_date'=>$r['due_date']??'','assignee_user_id'=>$r['assignee_user_id']??'',
            'estimated_minutes' => $r['estimated_minutes'] ? fmt_duration((int)$r['estimated_minutes']) : '',
            'actual_minutes'    => $r['actual_minutes']    ? fmt_duration((int)$r['actual_minutes'])    : '',
        ]); ?>
      <tr data-task-id="<?= e($r['id']) ?>" class="<?= $isArchived?'archived':'' ?>" style="cursor:pointer">
        <td data-col="title"><strong><?= e($r['title']) ?></strong>
          <?php if ($r['subtask_count']): ?>
            <span style="font-size:10px;color:var(--text-muted);margin-left:6px" title="Subtasks">☑ <?= $r['subtask_done'] ?>/<?= $r['subtask_count'] ?></span>
          <?php endif; ?>
          <?php if ($isArchived): ?><span class="pill pill-archived">Archived</span><?php endif; ?></td>
        <td data-col="project">
          <div><?= e($r['project_name']??'—') ?></div>
          <?php if ($r['client_name']): ?><div style="font-size:11px;color:var(--text-muted)"><?= e($r['client_name']) ?></div><?php endif; ?>
        </td>
        <td data-col="status">
          <button type="button" class="tl-inline-pill" data-tl-edit="status_value_id"
                  data-task-id="<?= e($r['id']) ?>"
                  data-current-id="<?= e($r['status_value_id']??'') ?>">
            <?php if ($r['status_label']): ?>
              <span class="pill tl-current-pill" style="<?= $r['status_color']?'background:'.e($r['status_color']).'22;color:'.e($r['status_color']).';border-color:'.e($r['status_color']).'44':'' ?>"><?= e($r['status_label']) ?></span>
            <?php else: ?><span class="pill tl-current-pill muted">— Set —</span><?php endif; ?>
          </button>
        </td>
        <td data-col="urgency">
          <button type="button" class="tl-inline-pill" data-tl-edit="urgency_value_id"
                  data-task-id="<?= e($r['id']) ?>"
                  data-current-id="<?= e($r['urgency_value_id']??'') ?>">
            <?php if ($r['urgency_label']): ?>
              <span class="pill tl-current-pill pill-urgency-<?= e($urgKey) ?>"><?= e($r['urgency_label']) ?></span>
            <?php else: ?><span class="pill tl-current-pill muted">— Set —</span><?php endif; ?>
          </button>
        </td>
        <td data-col="type">
          <button type="button" class="tl-inline-pill" data-tl-edit="type_value_id"
                  data-task-id="<?= e($r['id']) ?>"
                  data-current-id="<?= e($r['type_value_id']??'') ?>">
            <span class="tl-current-pill"><?= e($r['type_label']??'— Set —') ?></span>
          </button>
        </td>
        <td data-col="assignee">
          <button type="button" class="tl-inline-assignee" data-tl-edit="assignee_user_id"
                  data-task-id="<?= e($r['id']) ?>"
                  data-current-id="<?= e($r['assignee_user_id']??'') ?>"
                  title="<?= e($r['assignee_name'] ?? 'Unassigned') ?>">
            <?php if ($r['assignee_name']): ?>
              <?php if ($r['assignee_image']): ?>
                <img src="<?= e(Storage::url('local',$r['assignee_image'])) ?>"
                     class="assignee-icon-only tl-current-assignee" alt="<?= e($r['assignee_name']) ?>">
              <?php else: ?>
                <span class="avatar assignee-icon-only tl-current-assignee"><?= e(substr($r['assignee_name'],0,2)) ?></span>
              <?php endif; ?>
            <?php else: ?>
              <span class="avatar assignee-icon-only tl-current-assignee tl-assignee-empty">?</span>
            <?php endif; ?>
          </button>
        </td>
        <td data-col="due">
          <button type="button" class="tl-inline-date" data-tl-edit="due_date"
                  data-task-id="<?= e($r['id']) ?>"
                  data-current-value="<?= e($r['due_date']??'') ?>">
            <?php if ($r['due_date']):
                $over = new DateTime($r['due_date']) < new DateTime('today') && !$isArchived;
            ?>
              <span class="tl-current-date" style="<?= $over?'color:var(--danger);font-weight:600':'' ?>"><?= fmt_date($r['due_date']) ?></span>
            <?php else: ?>
              <span class="tl-current-date muted">— Set —</span>
            <?php endif; ?>
          </button>
        </td>
        <td data-col="actions">
          <div class="row-actions" onclick="event.stopPropagation()">
            <?php if ($canEdit): ?>
              <button class="icon-btn" title="Edit" data-modal-edit="task-modal" data-record='<?= e($record) ?>'>
                <svg class="icon icon-sm"><use href="#i-pencil"/></svg></button>
            <?php endif; ?>
            <?php if ($canArchive): ?>
              <button class="icon-btn" title="<?= $isArchived?'Restore':'Archive' ?>"
                data-archive-url="<?= e(url('tasks',['action'=>'archive','id'=>$r['id']])) ?>">
                <svg class="icon icon-sm"><use href="#<?= $isArchived?'i-eye':'i-archive' ?>"/></svg></button>
            <?php endif; ?>
            <?php if ($canDelete): ?>
              <button class="icon-btn" title="Delete"
                data-delete-confirm="<?= e($r['title']) ?>"
                data-delete-url="<?= e(url('tasks',['action'=>'delete','id'=>$r['id']])) ?>">
                <svg class="icon icon-sm"><use href="#i-trash"/></svg></button>
            <?php endif; ?>
          </div>
        </td>
      </tr>
    <?php endforeach; endif; ?>

    <?php /* Inline add-task row */ if ($canCreate): ?>
      <tr class="inline-add-row" id="inline-add-row">
        <td colspan="8">
          <div class="inline-add-wrap">
            <svg class="icon icon-sm" style="opacity:.5"><use href="#i-plus"/></svg>
            <input type="text"
                   class="inline-add-input"
                   id="inline-add-input"
                   placeholder="<?= $inlineProjectId ? 'Add task & press Enter…' : 'Add task… (will open form to pick project)' ?>"
                   data-project-id="<?= e($inlineProjectId) ?>">
            <?php if ($inlineProjectId): ?>
              <span class="inline-add-hint">Status: Pending · You as assignee</span>
            <?php endif; ?>
          </div>
        </td>
      </tr>
    <?php endif; ?>
  </tbody>
</table>
</div>

<?= $pagination() ?>

<?php if (!empty($debug)): ?>
  <div class="debug-panel">
    <h4 style="margin:0 0 8px;font-size:11px;color:var(--primary-hover);text-transform:uppercase;letter-spacing:.07em">Debug Output (admin only)</h4>
    <div style="font-family:monospace;font-size:11px;line-height:1.6">
      <div><strong>Total count:</strong> <?= e($debug['count']) ?> · <strong>Returned rows:</strong> <?= e($debug['rows_count']) ?></div>
      <div style="margin-top:8px"><strong>WHERE:</strong></div>
      <pre style="white-space:pre-wrap;background:var(--popover-input-bg);padding:8px;border-radius:6px;margin:4px 0"><?= e($debug['where_sql']) ?></pre>
      <div><strong>ORDER BY:</strong> <code><?= e($debug['sort_expr']) ?></code></div>
      <div style="margin-top:8px"><strong>Params:</strong></div>
      <pre style="white-space:pre-wrap;background:var(--popover-input-bg);padding:8px;border-radius:6px;margin:4px 0"><?= e(json_encode($debug['params'], JSON_PRETTY_PRINT)) ?></pre>
    </div>
  </div>
<?php endif; ?>

<!-- ROUND 34: Inline edit popover (shared, one instance) -->
<div id="tl-popover" class="tl-popover" style="display:none">
  <div class="tl-popover-list" id="tl-popover-list"></div>
</div>

<script type="application/json" id="tl-options-data"><?= json_encode([
    'status'   => array_map(fn($v) => [
        'id'    => (int)$v['id'],
        'label' => $v['label'],
        'color' => $v['color'] ?? null,
        'key'   => $v['key_name'] ?? null,
    ], $statusValues),
    'urgency'  => array_map(fn($v) => [
        'id'    => (int)$v['id'],
        'label' => $v['label'],
        'color' => $v['color'] ?? null,
        'key'   => $v['key_name'] ?? null,
    ], $urgValues),
    'type'     => array_map(fn($v) => [
        'id'    => (int)$v['id'],
        'label' => $v['label'],
        'color' => $v['color'] ?? null,
        'key'   => $v['key_name'] ?? null,
    ], $typeValues),
    'assignee' => array_map(fn($u) => [
        'id'    => (int)$u['id'],
        'label' => trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? '')),
        'image' => $u['profile_image'] ?? null,
    ], $allUsers),
], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>

<!-- TASK MODAL -->
<?php if ($canCreate||$canEdit): ?>
<div class="modal-backdrop" id="task-modal">
  <div class="modal modal-lg">
    <div class="modal-header">
      <h2 class="modal-title" data-add-label="New Task" data-edit-label="Edit Task">New Task</h2>
      <button class="modal-close" data-modal-close>&times;</button>
    </div>
    <div class="modal-body">
      <form data-ajax-form action="<?= e(url('tasks',['action'=>'save'])) ?>" method="post" id="task-form">
        <?= csrf_field() ?>
        <input type="hidden" name="id" value="">
        <div class="form-grid">
          <div class="form-row full"><label>Title <span class="required">*</span></label>
            <input type="text" name="title" maxlength="255"><span class="field-error" data-error="title"></span></div>
          <div class="form-row full"><label>Project <span class="required">*</span></label>
            <select name="project_id">
              <option value="">— Select Project —</option>
              <?php
              $allProjects = DB::all("SELECT p.id, p.name, p.manager_user_id, cl.name AS client_name FROM projects p LEFT JOIN clients cl ON cl.id=p.client_id WHERE p.deleted_at IS NULL AND p.archived_at IS NULL ORDER BY cl.name, p.name");
              if (is_single_client_mode()):
                // Flat list, no client grouping
                foreach ($allProjects as $proj): ?>
                  <option value="<?= e($proj['id']) ?>" data-manager="<?= e($proj['manager_user_id']??'') ?>"><?= e($proj['name']) ?></option>
                <?php endforeach;
              else:
                $currentClient = null;
                foreach ($allProjects as $proj):
                  if ($proj['client_name'] !== $currentClient):
                    if ($currentClient !== null) echo '</optgroup>';
                    $currentClient = $proj['client_name'];
                    echo '<optgroup label="' . e($currentClient ?: 'No Client') . '">';
                  endif;
                ?>
                  <option value="<?= e($proj['id']) ?>" data-manager="<?= e($proj['manager_user_id']??'') ?>"><?= e($proj['name']) ?></option>
                <?php endforeach;
                if ($currentClient !== null) echo '</optgroup>';
              endif;
              ?>
            </select><span class="field-error" data-error="project_id"></span></div>
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
          <div class="form-row full"><label>Assignee <span style="font-size:10px;color:var(--text-muted)">(defaults to project manager)</span></label>
            <select name="assignee_user_id" id="task-assignee"><option value="">— Auto —</option>
              <?php foreach ($users as $u): ?><option value="<?= e($u['id']) ?>"><?= e($u['first_name'].' '.$u['last_name']) ?></option><?php endforeach; ?>
            </select></div>
          <?php if ($isAdmin): ?>
            <div class="form-row"><label>Estimated <span style="font-size:10px;color:var(--text-muted)">(admin)</span></label>
              <input type="text" name="estimated_minutes" placeholder="e.g. 2h 30m"></div>
          <?php endif; ?>
          <div class="form-row<?= $isAdmin?'':' full' ?>"><label>Actual Time</label>
            <input type="text" name="actual_minutes" placeholder="e.g. 1h 45m"></div>
          <div class="form-row full"><label>Description</label>
            <textarea name="description" style="min-height:100px"></textarea></div>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <div class="modal-footer-left">
        <?php if ($canDelete): ?>
          <button type="button" class="btn btn-danger btn-sm" style="display:none" data-delete-btn
            data-delete-confirm="this task"
            data-delete-template="<?= e($delTpl) ?>">Delete</button>
        <?php endif; ?>
      </div>
      <div class="modal-footer-right">
        <button type="button" class="btn" data-modal-close>Cancel</button>
        <button type="submit" form="task-form" class="btn btn-primary">Save Task</button>
      </div>
    </div>
  </div>
</div>
<?php endif; ?>

<!-- TASK SHELF -->
<div class="task-shelf-wrap" id="task-shelf-wrap">
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

<script>
// Auto-fill assignee from project manager
document.addEventListener('change', function(e) {
  if (e.target?.name === 'project_id') {
    const mgr = e.target.options[e.target.selectedIndex]?.dataset?.manager || '';
    const a   = document.getElementById('task-assignee');
    if (a && mgr && !a.value) a.value = mgr;
  }
});

// Scope dropdowns
document.addEventListener('change', function(e) {
  const sel = e.target.closest('[data-scope-param]');
  if (!sel) return;
  const url = new URL(location.href);
  const key = sel.dataset.scopeParam;
  if (sel.value) url.searchParams.set(key, sel.value);
  else           url.searchParams.delete(key);
  if (key === 'f_client') url.searchParams.delete('f_project');
  // ROUND 42: when a project is picked, auto-assign its client too
  if (key === 'f_project' && sel.value) {
    const opt = sel.options[sel.selectedIndex];
    const cid = opt?.dataset.clientId || '';
    if (cid) {
      url.searchParams.set('f_client', cid);
    }
  }
  url.searchParams.delete('page');
  location.href = url.toString();
});

/* INLINE ADD TASK */
(function() {
  const myId  = parseInt(document.querySelector('meta[name=user-id]')?.content || 0, 10);
  const input = document.getElementById('inline-add-input');
  if (!input) return;

  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return;

    const projectId = parseInt(input.dataset.projectId || 0, 10);

    if (!projectId) {
      // No project scope — open the modal with title prefilled
      const modal = document.getElementById('task-modal');
      const form  = modal?.querySelector('form');
      if (!form) return;
      form.reset();
      form.elements['id'].value = '';
      form.elements['title'].value = title;
      const titleEl = modal.querySelector('.modal-title');
      if (titleEl?.dataset.addLabel) titleEl.textContent = titleEl.dataset.addLabel;
      window.openModal?.('task-modal');
      input.value = '';
      // Focus project select
      setTimeout(() => form.elements['project_id']?.focus(), 100);
      return;
    }

    // Quick-add: project is scoped, no modal needed
    if (!await window.checkClockedIn?.()) return;

    const fd = new FormData();
    fd.append('_csrf', document.querySelector('meta[name=csrf]')?.content || '');
    fd.append('title', title);
    fd.append('project_id', projectId);
    fd.append('assignee_user_id', myId);
    // status omitted → server defaults to 'pending'

    input.disabled = true;
    try {
      const base = document.querySelector('meta[name=app-base]')?.content || '';
      const res  = await fetch(`${base}/index.php?p=tasks&action=save`, {
        method: 'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'}
      });
      const j = await res.json();
      if (j.ok) {
        window.showToast?.('Task added.', 'success');
        location.reload();
      } else if (j.reason === 'not_clocked_in') {
        window.showClockInPrompt?.();
        input.disabled = false;
      } else {
        window.showToast?.(j.message || 'Failed.', 'error');
        input.disabled = false;
      }
    } catch {
      window.showToast?.('Network error.', 'error');
      input.disabled = false;
    }
  });
})();

/* Task form AJAX with clock-in check */
(function() {
  const myId = parseInt(document.querySelector('meta[name=user-id]')?.content || 0, 10);
  const form = document.getElementById('task-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    const btn  = form.querySelector('[type=submit]');
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = 'Saving…'; }

    const fd = new FormData(form);
    try {
      const res  = await fetch(form.action, { method:'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'} });
      const json = await res.json();
      if (json.ok) {
        window.showToast?.(json.message || 'Saved.', 'success');
        if (json.task_id && json.assignee_id && json.assignee_id != myId) {
          const url = new URL(location.href);
          url.searchParams.set('t_mine', '');
          url.searchParams.delete('page');
          location.href = url.toString();
        } else {
          setTimeout(() => location.reload(), 300);
        }
      } else if (json.reason === 'not_clocked_in') {
        window.showClockInPrompt?.();
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
      } else if (json.errors) {
        Object.entries(json.errors).forEach(([f, m]) => {
          const errEl = form.querySelector(`[data-error="${f}"]`);
          if (errEl) errEl.textContent = m;
        });
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
      } else {
        window.showToast?.(json.message || 'Error.', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
      }
    } catch {
      window.showToast?.('Network error.', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
  }, true);

  // ROUND 37: auto-open task shelf when arriving via ?open=N (from a message)
  (function () {
    const params = new URLSearchParams(location.search);
    const openId = params.get('open');
    if (!openId) return;
    // Wait for openTaskShelf to be defined (loaded in app.js, may not be ready when this inline script runs)
    const tryOpen = () => {
      if (typeof window.openTaskShelf === 'function') {
        window.openTaskShelf(openId);
        // Clean the URL so refreshes don't keep re-opening
        const cleanUrl = new URL(location.href);
        cleanUrl.searchParams.delete('open');
        history.replaceState(null, '', cleanUrl.toString());
      } else {
        setTimeout(tryOpen, 50);
      }
    };
    tryOpen();
  })();
})();
</script>
