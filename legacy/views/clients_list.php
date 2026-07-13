<?php
$totalPages = max(1, (int)ceil($total / $perPage));
$canEdit    = Perm::can('clients.edit');
$canDelete  = Perm::can('clients.delete');
$canArchive = Perm::can('clients.archive');
$canCreate  = Perm::can('clients.create');
$delTpl     = delete_url_template('clients', 'delete');

$statusOpts = array_map(fn($v) => ['v'=>$v['id'],'l'=>$v['label']], $statusValues);

// Build timezone filter options from those in use
$tzOpts = [];
$tzLabels = [];
foreach (common_timezones() as $group => $zones) {
    foreach ($zones as $k => $v) $tzLabels[$k] = $v;
}
foreach ($tzInUse as $t) {
    $tzOpts[] = ['v' => $t['timezone'], 'l' => $tzLabels[$t['timezone']] ?? $t['timezone']];
}

$mkUrl = fn(array $ov) => APP_BASE . '/index.php?' . http_build_query(array_merge($_GET, $ov));
$pagination = function() use ($pageNum,$totalPages,$total,$mkUrl) {
    if ($totalPages <= 1) return '';
    $p = max(1,$pageNum-1); $n = min($totalPages,$pageNum+1);
    return '<nav class="pagination">'
        .'<a class="page-link'.($pageNum<=1?' disabled':'').'" href="'.e($mkUrl(['page'=>$p])).'">Prev</a>'
        .'<span class="page-info">'.number_format($total).' clients · Page '.$pageNum.' of '.$totalPages.'</span>'
        .'<a class="page-link'.($pageNum>=$totalPages?' disabled':'').'" href="'.e($mkUrl(['page'=>$n])).'">Next</a>'
        .'</nav>';
};
?>

<div class="grid-meta"><div class="grid-active-filters"></div></div>


<!-- PAGE HEADER -->
<div class="list-page-header">
  <div class="list-page-header-left">
    <h1>Clients</h1>
    <div class="list-page-meta">
      <span>Showing <strong><?= number_format(count($rows)) ?></strong> of <strong><?= number_format($total) ?></strong> clients</span>
    </div>
  </div>
  <div class="list-page-header-right">
    <?= toggle_pill('Archived', 't_archived', $tArchived, 'danger') ?>
    <div class="list-page-header-sep"></div>
    <?= columns_selector([
        ['id'=>'status',   'label'=>'Status'],
        ['id'=>'timezone', 'label'=>'Timezone / Time'],
        ['id'=>'phone',    'label'=>'Phone'],
        ['id'=>'email',    'label'=>'Email'],
        ['id'=>'contacts', 'label'=>'Contacts'],
        ['id'=>'projects', 'label'=>'Projects'],
        ['id'=>'added',    'label'=>'Date Added'],
        ['id'=>'actions',  'label'=>'Actions']
    ], 'clients') ?>
    <?php if ($canCreate): ?>
      <button class="btn btn-primary btn-sm" data-modal-add="client-modal">
        <svg class="icon"><use href="#i-plus"/></svg> New Client
      </button>
    <?php endif; ?>

  </div>
</div>

<?= $pagination() ?>

<div class="table-wrap">
<table class="data-table has-col-filters">
  <thead class="sticky-head">
    <tr>
      <?= th(['key'=>'q_name',  'col'=>'name',    'label'=>'Name',    'sortable'=>true, 'sort_key'=>'name', 'filter'=>'text', 'placeholder'=>'Search…']) ?>
      <?= th(['key'=>'f_status','col'=>'status',  'label'=>'Status',  'sortable'=>false, 'filter'=>'multiselect','options'=>$statusOpts]) ?>
      <?= th(['key'=>'f_tz',    'col'=>'timezone','label'=>'Timezone','sortable'=>false, 'filter'=>($tzOpts?'multiselect':'none'),'options'=>$tzOpts]) ?>
      <?= th(['key'=>'q_phone', 'col'=>'phone',   'label'=>'Phone',   'sortable'=>false, 'filter'=>'text','placeholder'=>'Search…']) ?>
      <?= th(['key'=>'q_email', 'col'=>'email',   'label'=>'Email',   'sortable'=>false, 'filter'=>'text','placeholder'=>'Search…']) ?>
      <?= th(['key'=>'',        'col'=>'contacts','label'=>'Contacts','sortable'=>false, 'filter'=>'none']) ?>
      <?= th(['key'=>'',        'col'=>'projects','label'=>'Projects','sortable'=>false, 'filter'=>'none']) ?>
      <?= th(['key'=>'created', 'col'=>'added',   'label'=>'Added',   'sortable'=>true, 'sort_key'=>'created_at','filter'=>'date_range','align_right'=>true]) ?>
      <th data-col="actions"><div class="th-inner"><div class="th-label"></div></div></th>
    </tr>
  </thead>
  <tbody>
    <?php if (empty($rows)): ?>
      <tr><td colspan="9" class="empty">No clients found.
        <?php if ($canCreate): ?><a href="#" data-modal-add="client-modal">Add the first one.</a><?php endif; ?>
      </td></tr>
    <?php else: foreach ($rows as $r):
        $isArchived = !empty($r['archived_at']);
        $tzLabel    = !empty($r['timezone']) ? ($tzLabels[$r['timezone']] ?? $r['timezone']) : '';
        $record = json_encode([
            'id'=>$r['id'],'name'=>$r['name'],'website'=>$r['website']??'',
            'email'=>$r['email']??'','phone'=>$r['phone']??'','address'=>$r['address']??'',
            'city'=>$r['city']??'','province'=>$r['province']??'','zip_code'=>$r['zip_code']??'',
            'country'=>$r['country']??'','timezone'=>$r['timezone']??'',
            'notes'=>$r['notes']??'','status_value_id'=>$r['status_value_id']??'',
        ]); ?>
      <tr class="<?= $isArchived?'archived':'' ?>">
        <td data-col="name"><strong><?= e($r['name']) ?></strong>
          <?php if ($isArchived): ?><span class="pill pill-archived">Archived</span><?php endif; ?></td>
        <td data-col="status">
          <?php if (!empty($r['status_label'])): ?>
            <span class="pill" style="<?= $r['status_color']?'background:'.e($r['status_color']).'22;color:'.e($r['status_color']).';border-color:'.e($r['status_color']).'44':'' ?>"><?= e($r['status_label']) ?></span>
          <?php else: ?><span class="muted">—</span><?php endif; ?>
        </td>
        <td data-col="timezone">
          <?php if ($r['timezone']): ?>
            <div class="tz-cell" data-tz="<?= e($r['timezone']) ?>">
              <div class="tz-time">--:--</div>
              <div class="tz-name"><?= e($tzLabel) ?></div>
            </div>
          <?php else: ?><span class="muted">—</span><?php endif; ?>
        </td>
        <td data-col="phone"><?= e($r['phone']?:'—') ?></td>
        <td data-col="email"><?= $r['email']?'<a href="mailto:'.e($r['email']).'">'.e($r['email']).'</a>':'<span class="muted">—</span>' ?></td>
        <td data-col="contacts"><?= (int)$r['contact_count'] ?></td>
        <td data-col="projects"><?= (int)$r['project_count'] ?></td>
        <td data-col="added"><?= fmt_date($r['created_at']) ?></td>
        <td data-col="actions">
          <div class="row-actions">
            <?php if ($canEdit): ?>
              <button class="icon-btn" title="Edit" data-modal-edit="client-modal" data-record='<?= e($record) ?>'>
                <svg class="icon icon-sm"><use href="#i-pencil"/></svg></button>
            <?php endif; ?>
            <?php if ($canArchive): ?>
              <button class="icon-btn" title="<?= $isArchived?'Restore':'Archive' ?>"
                data-archive-url="<?= e(url('clients',['action'=>'archive','id'=>$r['id']])) ?>">
                <svg class="icon icon-sm"><use href="#<?= $isArchived?'i-eye':'i-archive' ?>"/></svg></button>
            <?php endif; ?>
            <?php if ($canDelete): ?>
              <button class="icon-btn" title="Delete"
                data-delete-confirm="<?= e($r['name']) ?>"
                data-delete-url="<?= e(url('clients',['action'=>'delete','id'=>$r['id']])) ?>">
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

<!-- CLIENT MODAL -->
<?php if ($canCreate||$canEdit): ?>
<div class="modal-backdrop" id="client-modal">
  <div class="modal">
    <div class="modal-header">
      <h2 class="modal-title" data-add-label="New Client" data-edit-label="Edit Client">New Client</h2>
      <button class="modal-close" data-modal-close>&times;</button>
    </div>
    <div class="modal-body">
      <form data-ajax-form action="<?= e(url('clients',['action'=>'save'])) ?>" method="post" id="client-form">
        <?= csrf_field() ?>
        <input type="hidden" name="id" value="">

        <div class="modal-section">
          <div class="modal-section-title">Company Info</div>
          <div class="form-grid">
            <div class="form-row full"><label>Company Name <span class="required">*</span></label>
              <input type="text" name="name" maxlength="191"><span class="field-error" data-error="name"></span></div>
            <div class="form-row"><label>Website</label><input type="url" name="website"></div>
            <div class="form-row"><label>Status</label>
              <select name="status_value_id"><option value="">— Select —</option>
                <?php foreach ($statusValues as $sv): ?><option value="<?= e($sv['id']) ?>"><?= e($sv['label']) ?></option><?php endforeach; ?>
              </select></div>
            <div class="form-row"><label>Email</label><input type="email" name="email"></div>
            <div class="form-row"><label>Phone</label><input type="tel" name="phone"></div>
            <div class="form-row full"><label>Timezone</label>
              <select name="timezone"><?= timezone_options_html(null) ?></select>
            </div>
          </div>
        </div>

        <div class="modal-section">
          <div class="modal-section-title">Address</div>
          <div class="form-grid">
            <div class="form-row full"><label>Street</label><input type="text" name="address"></div>
            <div class="form-row"><label>City</label><input type="text" name="city"></div>
            <div class="form-row"><label>Province</label><input type="text" name="province"></div>
            <div class="form-row"><label>Zip</label><input type="text" name="zip_code"></div>
            <div class="form-row"><label>Country</label><input type="text" name="country"></div>
          </div>
        </div>

        <div class="modal-section">
          <div class="modal-section-title">Notes</div>
          <div class="form-row"><textarea name="notes"></textarea></div>
        </div>

      </form>
    </div>
    <div class="modal-footer">
      <div class="modal-footer-left">
        <?php if ($canDelete): ?>
          <button type="button" class="btn btn-danger btn-sm" style="display:none" data-delete-btn
            data-delete-confirm="this client"
            data-delete-template="<?= e($delTpl) ?>">Delete</button>
        <?php endif; ?>
      </div>
      <div class="modal-footer-right">
        <button type="button" class="btn" data-modal-close>Cancel</button>
        <button type="submit" form="client-form" class="btn btn-primary">Save Client</button>
      </div>
    </div>
  </div>
</div>
<?php endif; ?>
