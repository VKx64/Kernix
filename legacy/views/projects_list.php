<?php
$totalPages = max(1, (int)ceil($total / $perPage));
$canEdit    = Perm::can('projects.edit');
$canDelete  = Perm::can('projects.delete');
$canArchive = Perm::can('projects.archive');
$canCreate  = Perm::can('projects.create');
$delTpl    = delete_url_template('projects', 'delete');
$sort       = $_GET['sort'] ?? 'name';
$dir        = $_GET['dir']  ?? 'asc';

// Topbar toggles
// Topbar actions
// Options
$statusOpts  = array_map(fn($v) => ['v'=>$v['id'],'l'=>$v['label']], $statusValues);
$managerOpts = array_map(fn($u) => ['v'=>$u['id'],'l'=>$u['first_name'].' '.$u['last_name']], $users);

$mkUrl = fn(array $ov) => APP_BASE . '/index.php?' . http_build_query(array_merge($_GET, $ov));
$pagination = function() use ($pageNum,$totalPages,$total,$mkUrl) {
    if ($totalPages <= 1) return '';
    $p = max(1,$pageNum-1); $n = min($totalPages,$pageNum+1);
    return '<nav class="pagination">'
        .'<a class="page-link'.($pageNum<=1?' disabled':'').'" href="'.e($mkUrl(['page'=>$p])).'">Prev</a>'
        .'<span class="page-info">'.number_format($total).' projects · Page '.$pageNum.' of '.$totalPages.'</span>'
        .'<a class="page-link'.($pageNum>=$totalPages?' disabled':'').'" href="'.e($mkUrl(['page'=>$n])).'">Next</a>'
        .'</nav>';
};
?>

<div class="grid-meta"><div class="grid-active-filters"></div></div>


<!-- PAGE HEADER -->
<div class="list-page-header">
  <div class="list-page-header-left">
    <h1>Projects</h1>
    <div class="list-page-meta">
      <span>Showing <strong><?= number_format(count($rows)) ?></strong> of <strong><?= number_format($total) ?></strong> projects</span>
    </div>
  </div>
  <div class="list-page-header-right">
    <?= toggle_pill('Archived', 't_archived', $tArchived, 'danger') ?>
    <?= toggle_pill('My Projects', 't_mine', $tMyProjs, '') ?>
    <div class="list-page-header-sep"></div>
    <?php
    $projCols = [
        ['id'=>'status',  'label'=>'Status'],
        ['id'=>'manager', 'label'=>'Manager'],
        ['id'=>'start',   'label'=>'Start Date'],
        ['id'=>'due',     'label'=>'Due Date'],
        ['id'=>'tasks',   'label'=>'Tasks'],
        ['id'=>'actions', 'label'=>'Actions']
    ];
    if (!is_single_client_mode()) {
        array_unshift($projCols, ['id'=>'client',  'label'=>'Client']);
    }
    ?>
    <?= columns_selector($projCols, 'projects') ?>
    <?php if ($canCreate): ?>
      <button class="btn btn-primary btn-sm" data-modal-add="project-modal">
        <svg class="icon"><use href="#i-plus"/></svg> New Project
      </button>
    <?php endif; ?>

  </div>
</div>

<?= $pagination() ?>

<div class="table-wrap">
<table class="data-table has-col-filters">
  <thead class="sticky-head">
    <tr>
      <?= th(['key'=>'q_name',  'col'=>'name',  'label'=>'Project','sortable'=>true,'sort_key'=>'name','filter'=>'text','placeholder'=>'Search…'], $sort, $dir) ?>
      <?php if (!is_single_client_mode()): ?>
        <?= th(['key'=>'q_client','col'=>'client','label'=>'Client',  'sortable'=>false,'filter'=>'text','placeholder'=>'Search client…'], $sort, $dir) ?>
      <?php endif; ?>
      <?= th(['key'=>'f_status','col'=>'status','label'=>'Status',  'sortable'=>false,'filter'=>'multiselect','options'=>$statusOpts], $sort, $dir) ?>
      <?= th(['key'=>'f_manager','col'=>'manager','label'=>'Manager','sortable'=>false,'filter'=>'multiselect','options'=>$managerOpts], $sort, $dir) ?>
      <?= th(['key'=>'start_date','col'=>'start','label'=>'Start',  'sortable'=>true,'sort_key'=>'start_date','filter'=>'date_range'], $sort, $dir) ?>
      <?= th(['key'=>'due_date',  'col'=>'due',  'label'=>'Due',    'sortable'=>true,'sort_key'=>'due_date',  'filter'=>'date_range'], $sort, $dir) ?>
      <?= th(['key'=>'','col'=>'tasks','label'=>'Tasks','sortable'=>false,'filter'=>'none'], $sort, $dir) ?>
      <th data-col="actions"><div class="th-inner"><div class="th-label"></div></div></th>
    </tr>
  </thead>
  <tbody>
    <?php if (empty($rows)): ?>
      <tr><td colspan="8" class="empty">No projects found.
        <?php if ($canCreate): ?><a href="#" data-modal-add="project-modal">Create one.</a><?php endif; ?>
      </td></tr>
    <?php else: foreach ($rows as $r):
        $isArchived = !empty($r['archived_at']);
        $taskCount  = (int)$r['task_count'];
        $doneCount  = (int)$r['done_count'];
        $pct        = $taskCount > 0 ? round(($doneCount / $taskCount) * 100) : 0;
        $record     = json_encode([
            'id'              => $r['id'],
            'name'            => $r['name'],
            'client_id'       => $r['client_id'],
            'description'     => $r['description'] ?? '',
            'status_value_id' => $r['status_value_id'] ?? '',
            'manager_user_id' => $r['manager_user_id'] ?? '',
            'start_date'      => $r['start_date'] ?? '',
            'due_date'        => $r['due_date'] ?? '',
        ]); ?>
      <tr data-project-id="<?= e($r['id']) ?>" class="<?= $isArchived?'archived':'' ?>" style="cursor:pointer">
        <td data-col="name">
          <strong><?= e($r['name']) ?></strong>
          <?php if ($isArchived): ?><span class="pill pill-archived">Archived</span><?php endif; ?>
        </td>
        <?php if (!is_single_client_mode()): ?>
          <td data-col="client"><?= e($r['client_name'] ?? '—') ?></td>
        <?php endif; ?>
        <td data-col="status">
          <?php if ($r['status_label']): ?>
            <span class="pill" style="<?= $r['status_color']?pill_tint($r['status_color']):'' ?>">
              <?= e($r['status_label']) ?>
            </span>
          <?php else: ?><span class="muted">—</span><?php endif; ?>
        </td>
        <td data-col="manager"><?= e($r['manager_name'] ?? '—') ?></td>
        <td data-col="start"><?= $r['start_date'] ? fmt_date($r['start_date']) : '<span class="muted">—</span>' ?></td>
        <td data-col="due">
          <?php if ($r['due_date']):
              $over = new DateTime($r['due_date']) < new DateTime('today') && !$isArchived;
          ?>
            <span style="<?= $over?'color:var(--danger);font-weight:600':'' ?>"><?= fmt_date($r['due_date']) ?></span>
          <?php else: ?><span class="muted">—</span><?php endif; ?>
        </td>
        <td data-col="tasks">
          <?php if ($taskCount > 0): ?>
            <div style="display:flex;align-items:center;gap:8px;min-width:80px">
              <div style="flex:1;height:4px;background:var(--glass-border);border-radius:2px;overflow:hidden">
                <div style="height:100%;width:<?= $pct ?>%;background:var(--primary);border-radius:2px"></div>
              </div>
              <span style="font-size:11px;color:var(--text-muted);white-space:nowrap"><?= $doneCount ?>/<?= $taskCount ?></span>
            </div>
          <?php else: ?>
            <span class="muted">No tasks</span>
          <?php endif; ?>
        </td>
        <td data-col="actions">
          <div class="row-actions" onclick="event.stopPropagation()">
            <?php if ($canEdit): ?>
              <button class="icon-btn" title="Edit" data-modal-edit="project-modal" data-record='<?= e($record) ?>'>
                <svg class="icon icon-sm"><use href="#i-pencil"/></svg></button>
            <?php endif; ?>
            <?php if ($canArchive): ?>
              <button class="icon-btn" title="<?= $isArchived?'Restore':'Archive' ?>"
                data-archive-url="<?= e(url('projects',['action'=>'archive','id'=>$r['id']])) ?>">
                <svg class="icon icon-sm"><use href="#<?= $isArchived?'i-eye':'i-archive' ?>"/></svg></button>
            <?php endif; ?>
            <?php if ($canDelete): ?>
              <button class="icon-btn" title="Delete"
                data-delete-confirm="<?= e($r['name']) ?>"
                data-delete-url="<?= e(url('projects',['action'=>'delete','id'=>$r['id']])) ?>">
                <svg class="icon icon-sm"><use href="#i-trash"/></svg></button>
            <?php endif; ?>
          </div>
        </td>
      </tr>
    <?php endforeach; endif; ?>
  </tbody>
</table>
</div>

<?= $pagination() ?>

<!-- PROJECT MODAL -->
<?php if ($canCreate||$canEdit): ?>
<div class="modal-backdrop" id="project-modal">
  <div class="modal modal-lg">
    <div class="modal-header">
      <h2 class="modal-title" data-add-label="New Project" data-edit-label="Edit Project">New Project</h2>
      <button class="modal-close" data-modal-close>&times;</button>
    </div>
    <div class="modal-body">
      <form data-ajax-form action="<?= e(url('projects',['action'=>'save'])) ?>" method="post" id="project-form">
        <?= csrf_field() ?>
        <input type="hidden" name="id" value="">
        <div class="form-grid">
          <div class="form-row full">
            <label>Project Name <span class="required">*</span></label>
            <input type="text" name="name" maxlength="191">
            <span class="field-error" data-error="name"></span>
          </div>
          <?php if (is_single_client_mode()): ?>
            <input type="hidden" name="client_id" value="<?= (int)single_client_id() ?>">
          <?php else: ?>
          <div class="form-row full">
            <label>Client <span class="required">*</span></label>
            <select name="client_id">
              <option value="">— Select Client —</option>
              <?php foreach ($clients as $cl): ?>
                <option value="<?= e($cl['id']) ?>"><?= e($cl['name']) ?></option>
              <?php endforeach; ?>
            </select>
            <span class="field-error" data-error="client_id"></span>
          </div>
          <?php endif; ?>
          <div class="form-row">
            <label>Status</label>
            <select name="status_value_id">
              <option value="">—</option>
              <?php foreach ($statusValues as $sv): ?>
                <option value="<?= e($sv['id']) ?>"><?= e($sv['label']) ?></option>
              <?php endforeach; ?>
            </select>
          </div>
          <div class="form-row">
            <label>Manager</label>
            <select name="manager_user_id">
              <option value="">— Unassigned —</option>
              <?php foreach ($users as $u): ?>
                <option value="<?= e($u['id']) ?>" <?= $u['id']==$currentUserId?'selected':'' ?>>
                  <?= e($u['first_name'].' '.$u['last_name']) ?>
                </option>
              <?php endforeach; ?>
            </select>
          </div>
          <div class="form-row">
            <label>Start Date</label>
            <input type="date" name="start_date">
          </div>
          <div class="form-row">
            <label>Due Date</label>
            <input type="date" name="due_date">
          </div>
          <div class="form-row full">
            <label>Description</label>
            <textarea name="description" style="min-height:90px"></textarea>
          </div>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <div class="modal-footer-left">
        <?php if ($canDelete): ?>
          <button type="button" class="btn btn-danger btn-sm" style="display:none" data-delete-btn
            data-delete-confirm="this project"
            data-delete-template="<?= e($delTpl) ?>">Delete</button>
        <?php endif; ?>
      </div>
      <div class="modal-footer-right">
        <button type="button" class="btn" data-modal-close>Cancel</button>
        <button type="submit" form="project-form" class="btn btn-primary">Save Project</button>
      </div>
    </div>
  </div>
</div>
<?php endif; ?>

<!-- PROJECT SHELF CONTAINER -->
<div class="proj-shelf-wrap" id="proj-shelf-wrap">
  <div class="proj-shelf-overlay"></div>
  <div class="proj-shelf-peek" title="Close"></div>
  <div class="proj-shelf">
    <div class="proj-shelf-header">
      <button class="proj-shelf-close">&times;</button>
      <span style="font-size:13px;color:var(--text-muted)">Project Detail</span>
    </div>
    <div class="proj-shelf-body" id="proj-shelf-body"></div>
  </div>
</div>
