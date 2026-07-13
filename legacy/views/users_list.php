<?php
$totalPages = max(1, (int)ceil($total / $perPage));
$canEdit    = Perm::can('users.edit');
$canDelete  = Perm::can('users.delete');
$canArchive = Perm::can('users.archive');
$canCreate  = Perm::can('users.create');

$roleOpts   = array_map(fn($r) => ['v'=>$r['id'],'l'=>$r['name']], $roles);
$statusOpts = [['v'=>'active','l'=>'Active'],['v'=>'inactive','l'=>'Inactive']];

$mkUrl = fn(array $ov) => APP_BASE . '/index.php?' . http_build_query(array_merge($_GET, $ov));
$pagination = function() use ($pageNum,$totalPages,$total,$mkUrl) {
    if ($totalPages <= 1) return '';
    $p = max(1,$pageNum-1); $n = min($totalPages,$pageNum+1);
    return '<nav class="pagination">'
        .'<a class="page-link'.($pageNum<=1?' disabled':'').'" href="'.e($mkUrl(['page'=>$p])).'">Prev</a>'
        .'<span class="page-info">'.number_format($total).' users · Page '.$pageNum.' of '.$totalPages.'</span>'
        .'<a class="page-link'.($pageNum>=$totalPages?' disabled':'').'" href="'.e($mkUrl(['page'=>$n])).'">Next</a>'
        .'</nav>';
};

$delTpl = delete_url_template('users');
?>

<!-- PAGE HEADER -->
<div class="list-page-header">
  <div class="list-page-header-left">
    <h1>Users</h1>
    <div class="list-page-meta">
      <span>Showing <strong><?= number_format(count($rows)) ?></strong> of <strong><?= number_format($total) ?></strong> users</span>
    </div>
  </div>
  <div class="list-page-header-right">
    <?= toggle_pill('Archived', 't_archived', $tArchived, 'danger') ?>
    <div class="list-page-header-sep"></div>
    <?= columns_selector([
        ['id'=>'email',      'label'=>'Email'],
        ['id'=>'role',       'label'=>'Role'],
        ['id'=>'dept',       'label'=>'Department'],
        ['id'=>'phone',      'label'=>'Phone'],
        ['id'=>'start_date', 'label'=>'Start Date'],
        ['id'=>'status',     'label'=>'Status'],
        ['id'=>'actions',    'label'=>'Actions'],
    ], 'users') ?>
    <?php if ($canCreate): ?>
      <button class="btn btn-primary btn-sm" data-modal-add="user-modal">
        <svg class="icon"><use href="#i-plus"/></svg> New User
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
      <?= th(['key'=>'q_name',  'col'=>'name',      'label'=>'Name',       'sortable'=>true,'sort_key'=>'first_name','filter'=>'text','placeholder'=>'Search…']) ?>
      <?= th(['key'=>'q_email', 'col'=>'email',     'label'=>'Email',      'sortable'=>false,'filter'=>'text','placeholder'=>'Search…']) ?>
      <?= th(['key'=>'f_role',  'col'=>'role',      'label'=>'Role',       'sortable'=>false,'filter'=>'multiselect','options'=>$roleOpts]) ?>
      <?= th(['key'=>'',        'col'=>'dept',      'label'=>'Department', 'sortable'=>false,'filter'=>'none']) ?>
      <?= th(['key'=>'',        'col'=>'phone',     'label'=>'Phone',      'sortable'=>false,'filter'=>'none']) ?>
      <?= th(['key'=>'',        'col'=>'start_date','label'=>'Start',      'sortable'=>true,'sort_key'=>'created_at','filter'=>'none']) ?>
      <?= th(['key'=>'f_status','col'=>'status',    'label'=>'Status',     'sortable'=>false,'filter'=>'select','options'=>$statusOpts,'align_right'=>true]) ?>
      <th data-col="actions"><div class="th-inner"><div class="th-label"></div></div></th>
    </tr>
  </thead>
  <tbody>
    <?php if (empty($rows)): ?>
      <tr><td colspan="8" class="empty">No users found.</td></tr>
    <?php else: foreach ($rows as $r):
        $isArchived = !empty($r['archived_at']);
        $isSelf     = $r['id'] == Auth::id();
        $record = json_encode([
            'id'                  => $r['id'],
            'username'            => $r['username'],
            'first_name'          => $r['first_name'],
            'last_name'           => $r['last_name'] ?? '',
            'role_id'             => $r['role_id'],
            'imagic_email'        => $r['imagic_email'] ?? '',
            'personal_email'      => $r['personal_email'] ?? '',
            'phone_1'             => $r['phone_1'] ?? '',
            'phone_2'             => $r['phone_2'] ?? '',
            'department_value_id' => $r['department_value_id'] ?? '',
            'wise_account'        => $r['wise_account'] ?? '',
            'gcash_account'       => $r['gcash_account'] ?? '',
            'start_date'          => $r['start_date'] ?? '',
            'birthdate'           => $r['birthdate'] ?? '',
            'status'              => $r['status'] ?? 'active',
            'home_address'        => $r['home_address'] ?? '',
            'barangay'            => $r['barangay'] ?? '',
            'city'                => $r['city'] ?? '',
            'province'            => $r['province'] ?? '',
            'zip_code'            => $r['zip_code'] ?? '',
        ]); ?>
      <tr class="<?= $isArchived?'archived':'' ?>">
        <td data-col="name">
          <div class="user-cell">
            <?php if (!empty($r['profile_image'])): ?>
              <img src="<?= e(Storage::url('local',$r['profile_image'])) ?>" class="user-cell-avatar">
            <?php else: ?>
              <div class="user-cell-avatar initials"><?= e(initials($r['first_name']??'',$r['last_name']??'')) ?></div>
            <?php endif; ?>
            <div>
              <div class="user-cell-name">
                <?= e(trim($r['first_name'].' '.($r['last_name']??''))) ?>
                <?php if ($isSelf): ?><span class="pill" style="font-size:10px;margin-left:4px">You</span><?php endif; ?>
                <?php if ($isArchived): ?><span class="pill pill-archived" style="margin-left:4px">Archived</span><?php endif; ?>
              </div>
              <div class="user-cell-username">@<?= e($r['username']) ?></div>
            </div>
          </div>
        </td>
        <td data-col="email"><?= e($r['imagic_email'] ?: ($r['personal_email']??'—')) ?></td>
        <td data-col="role"><span class="pill <?= $r['role_key']==='admin'?'pill-status-active':'' ?>"><?= e($r['role_name']??'—') ?></span></td>
        <td data-col="dept"><?= e(field_value_label($r['department_value_id']??null) ?: '—') ?></td>
        <td data-col="phone"><?= e($r['phone_1']?:'—') ?></td>
        <td data-col="start_date"><?= $r['start_date'] ? fmt_date($r['start_date']) : '—' ?></td>
        <td data-col="status"><span class="pill <?= $r['status']==='active'?'pill-status-active':'pill-status-inactive' ?>"><?= e(ucfirst($r['status'])) ?></span></td>
        <td data-col="actions">
          <div class="row-actions">
            <?php if ($canEdit): ?>
              <button class="icon-btn" title="Edit" data-modal-edit="user-modal" data-record='<?= e($record) ?>'>
                <svg class="icon icon-sm"><use href="#i-pencil"/></svg></button>
            <?php endif; ?>
            <?php if ($canArchive && !$isSelf): ?>
              <button class="icon-btn" title="<?= $isArchived?'Restore':'Archive' ?>"
                data-archive-url="<?= e(url('users',['action'=>'archive','id'=>$r['id']])) ?>">
                <svg class="icon icon-sm"><use href="#<?= $isArchived?'i-eye':'i-archive' ?>"/></svg></button>
            <?php endif; ?>
            <?php if ($canDelete && !$isSelf): ?>
              <button class="icon-btn" title="Delete"
                data-delete-confirm="@<?= e($r['username']) ?>"
                data-delete-url="<?= e(url('users',['action'=>'delete','id'=>$r['id']])) ?>">
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

<!-- USER MODAL — redesigned with config-card sections -->
<?php if ($canCreate||$canEdit): ?>
<div class="modal-backdrop" id="user-modal">
  <div class="modal modal-lg">
    <div class="modal-header">
      <h2 class="modal-title" data-add-label="New User" data-edit-label="Edit User">New User</h2>
      <button class="modal-close" data-modal-close>&times;</button>
    </div>
    <div class="modal-body">
      <form data-ajax-form action="<?= e(url('users',['action'=>'save'])) ?>" method="post" id="user-form">
        <?= csrf_field() ?>
        <input type="hidden" name="id" value="">

        <div class="modal-section">
          <div class="modal-section-title">Account</div>
          <div class="form-grid">
            <div class="form-row"><label>First Name <span class="required">*</span></label>
              <input type="text" name="first_name"><span class="field-error" data-error="first_name"></span></div>
            <div class="form-row"><label>Last Name</label><input type="text" name="last_name"></div>
            <div class="form-row"><label>Username <span class="required">*</span></label>
              <input type="text" name="username" autocomplete="off"><span class="field-error" data-error="username"></span></div>
            <div class="form-row"><label>Password</label>
              <input type="password" name="password" autocomplete="new-password" placeholder="Leave blank to keep current">
              <span class="field-error" data-error="password"></span></div>
            <div class="form-row"><label>Role <span class="required">*</span></label>
              <select name="role_id"><option value="">— Select —</option>
                <?php foreach ($roles as $r): ?><option value="<?= e($r['id']) ?>"><?= e($r['name']) ?></option><?php endforeach; ?>
              </select><span class="field-error" data-error="role_id"></span></div>
            <div class="form-row"><label>Status</label>
              <select name="status"><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          </div>
        </div>

        <div class="modal-section">
          <div class="modal-section-title">Contact & Work</div>
          <div class="form-grid">
            <div class="form-row"><label>Work Email</label><input type="email" name="imagic_email"></div>
            <div class="form-row"><label>Personal Email</label><input type="email" name="personal_email"></div>
            <div class="form-row"><label>Phone 1</label><input type="tel" name="phone_1"></div>
            <div class="form-row"><label>Phone 2</label><input type="tel" name="phone_2"></div>
            <div class="form-row"><label>Department</label>
              <select name="department_value_id"><option value="">—</option>
                <?php foreach ($depts as $d): ?><option value="<?= e($d['id']) ?>"><?= e($d['label']) ?></option><?php endforeach; ?>
              </select></div>
            <div class="form-row"><label>Start Date</label><input type="date" name="start_date"></div>
            <div class="form-row"><label>Birthdate</label><input type="date" name="birthdate"></div>
            <div class="form-row full"><label>Timezone</label>
              <select name="timezone"><?= timezone_options_html(null) ?></select></div>
          </div>
        </div>

        <div class="modal-section">
          <div class="modal-section-title">Payment</div>
          <div class="form-grid">
            <div class="form-row"><label>Wise Account</label><input type="text" name="wise_account"></div>
            <div class="form-row"><label>GCash Account</label><input type="text" name="gcash_account"></div>
          </div>
        </div>

        <div class="modal-section">
          <div class="modal-section-title">Address</div>
          <div class="form-grid">
            <div class="form-row full"><label>Home Address</label><input type="text" name="home_address"></div>
            <div class="form-row"><label>Barangay</label><input type="text" name="barangay"></div>
            <div class="form-row"><label>City</label><input type="text" name="city"></div>
            <div class="form-row"><label>Province</label><input type="text" name="province"></div>
            <div class="form-row"><label>Zip Code</label><input type="text" name="zip_code"></div>
          </div>
        </div>

      </form>
    </div>
    <div class="modal-footer">
      <div class="modal-footer-left">
        <?php if ($canDelete): ?>
          <button type="button" class="btn btn-danger btn-sm" style="display:none" data-delete-btn
            data-delete-confirm="this user"
            data-delete-template="<?= e($delTpl) ?>">Delete</button>
        <?php endif; ?>
      </div>
      <div class="modal-footer-right">
        <button type="button" class="btn" data-modal-close>Cancel</button>
        <button type="submit" form="user-form" class="btn btn-primary">Save User</button>
      </div>
    </div>
  </div>
</div>
<?php endif; ?>
