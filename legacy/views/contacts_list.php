<?php
$totalPages = max(1, (int)ceil($total / $perPage));
$canEdit    = Perm::can('contacts.edit');
$canDelete  = Perm::can('contacts.delete');
$canArchive = Perm::can('contacts.archive');
$canCreate  = Perm::can('contacts.create');
$delTpl    = delete_url_template('contacts', 'delete');

$clientOpts = array_map(fn($c) => ['v'=>$c['id'],'l'=>$c['name']], $clients);
$statusOpts = [['v'=>'active','l'=>'Active'],['v'=>'inactive','l'=>'Inactive']];

$mkUrl = fn(array $ov) => APP_BASE . '/index.php?' . http_build_query(array_merge($_GET, $ov));
$pagination = function() use ($pageNum,$totalPages,$total,$mkUrl) {
    if ($totalPages <= 1) return '';
    $p = max(1,$pageNum-1); $n = min($totalPages,$pageNum+1);
    return '<nav class="pagination">'
        .'<a class="page-link'.($pageNum<=1?' disabled':'').'" href="'.e($mkUrl(['page'=>$p])).'">Prev</a>'
        .'<span class="page-info">'.number_format($total).' contacts · Page '.$pageNum.' of '.$totalPages.'</span>'
        .'<a class="page-link'.($pageNum>=$totalPages?' disabled':'').'" href="'.e($mkUrl(['page'=>$n])).'">Next</a>'
        .'</nav>';
};
?>

<div class="grid-meta"><div class="grid-active-filters"></div></div>


<!-- PAGE HEADER -->
<div class="list-page-header">
  <div class="list-page-header-left">
    <h1>Contacts</h1>
    <div class="list-page-meta">
      <span>Showing <strong><?= number_format(count($rows)) ?></strong> of <strong><?= number_format($total) ?></strong> contacts</span>
    </div>
  </div>
  <div class="list-page-header-right">
    <?= toggle_pill('Archived', 't_archived', $tArchived, 'danger') ?>
    <div class="list-page-header-sep"></div>
    <?php
    $contactCols = [
        ['id'=>'title',   'label'=>'Title'],
        ['id'=>'email',   'label'=>'Email'],
        ['id'=>'phone',   'label'=>'Phone'],
        ['id'=>'status',  'label'=>'Status'],
        ['id'=>'added',   'label'=>'Date Added'],
        ['id'=>'actions', 'label'=>'Actions']
    ];
    if (!is_single_client_mode()) {
        array_splice($contactCols, 1, 0, [['id'=>'client', 'label'=>'Client']]);
    }
    ?>
    <?= columns_selector($contactCols, 'contacts') ?>
    <?php if ($canCreate): ?>
      <button class="btn btn-primary btn-sm" data-modal-add="contact-modal">
        <svg class="icon"><use href="#i-plus"/></svg> New Contact
      </button>
    <?php endif; ?>

  </div>
</div>

<?= $pagination() ?>

<div class="table-wrap">
<table class="data-table has-col-filters">
  <thead class="sticky-head">
    <tr>
      <?= th(['key'=>'q_name',  'col'=>'name',  'label'=>'Name',   'sortable'=>true, 'sort_key'=>'last_name', 'filter'=>'text',        'placeholder'=>'Search…']) ?>
      <?= th(['key'=>'q_title', 'col'=>'title', 'label'=>'Title',  'sortable'=>false,                          'filter'=>'text',        'placeholder'=>'Search…']) ?>
      <?php if (!is_single_client_mode()): ?>
        <?= th(['key'=>'f_client','col'=>'client','label'=>'Client', 'sortable'=>false,                          'filter'=>'multiselect', 'options'=>$clientOpts]) ?>
      <?php endif; ?>
      <?= th(['key'=>'q_email', 'col'=>'email', 'label'=>'Email',  'sortable'=>true, 'sort_key'=>'email',      'filter'=>'text',        'placeholder'=>'Search…']) ?>
      <?= th(['key'=>'q_phone', 'col'=>'phone', 'label'=>'Phone',  'sortable'=>false,                          'filter'=>'text',        'placeholder'=>'Search…']) ?>
      <?= th(['key'=>'f_status','col'=>'status','label'=>'Status', 'sortable'=>false,                          'filter'=>'select',      'options'=>$statusOpts]) ?>
      <?= th(['key'=>'created', 'col'=>'added', 'label'=>'Added',  'sortable'=>true, 'sort_key'=>'created_at', 'filter'=>'date_range',  'align_right'=>true]) ?>
      <th data-col="actions"><div class="th-inner"><div class="th-label"></div></div></th>
    </tr>
  </thead>
  <tbody>
    <?php if (empty($rows)): ?>
      <tr><td colspan="8" class="empty">No contacts found.
        <?php if ($canCreate): ?><a href="#" data-modal-add="contact-modal">Add the first one.</a><?php endif; ?>
      </td></tr>
    <?php else: foreach ($rows as $r):
        $isArchived = !empty($r['archived_at']);
        $record = json_encode([
            'id'=>$r['id'],'client_id'=>$r['client_id'],'first_name'=>$r['first_name'],
            'last_name'=>$r['last_name']??'','title'=>$r['title']??'','email'=>$r['email']??'',
            'phone_1'=>$r['phone_1']??'','phone_2'=>$r['phone_2']??'',
            'notes'=>$r['notes']??'','status'=>$r['status']??'active',
        ]); ?>
      <tr class="<?= $isArchived?'archived':'' ?>">
        <td data-col="name"><strong><?= e(trim($r['first_name'].' '.($r['last_name']??''))) ?></strong>
          <?php if ($isArchived): ?><span class="pill pill-archived">Archived</span><?php endif; ?></td>
        <td data-col="title"><?= e($r['title']?:'—') ?></td>
        <?php if (!is_single_client_mode()): ?>
          <td data-col="client"><?= $r['client_name']?'<a href="'.e(url('contacts',['f_client'=>$r['client_id']])).'">'.e($r['client_name']).'</a>':'<span class="muted">—</span>' ?></td>
        <?php endif; ?>
        <td data-col="email"><?= $r['email']?'<a href="mailto:'.e($r['email']).'">'.e($r['email']).'</a>':'<span class="muted">—</span>' ?></td>
        <td data-col="phone"><?= e($r['phone_1']?:'—') ?></td>
        <td data-col="status"><span class="pill <?= $r['status']==='active'?'pill-status-active':'pill-status-inactive' ?>"><?= e(ucfirst($r['status'])) ?></span></td>
        <td data-col="added"><?= fmt_date($r['created_at']) ?></td>
        <td data-col="actions">
          <div class="row-actions">
            <?php if ($canEdit): ?>
              <button class="icon-btn" title="Edit" data-modal-edit="contact-modal" data-record='<?= e($record) ?>'>
                <svg class="icon icon-sm"><use href="#i-pencil"/></svg></button>
            <?php endif; ?>
            <?php if ($canArchive): ?>
              <button class="icon-btn" title="<?= $isArchived?'Restore':'Archive' ?>"
                data-archive-url="<?= e(url('contacts',['action'=>'archive','id'=>$r['id']])) ?>">
                <svg class="icon icon-sm"><use href="#<?= $isArchived?'i-eye':'i-archive' ?>"/></svg></button>
            <?php endif; ?>
            <?php if ($canDelete): ?>
              <button class="icon-btn" title="Delete"
                data-delete-confirm="<?= e($r['first_name']) ?>"
                data-delete-url="<?= e(url('contacts',['action'=>'delete','id'=>$r['id']])) ?>">
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

<!-- CONTACT MODAL -->
<?php if ($canCreate||$canEdit): ?>
<div class="modal-backdrop" id="contact-modal">
  <div class="modal">
    <div class="modal-header">
      <h2 class="modal-title" data-add-label="New Contact" data-edit-label="Edit Contact">New Contact</h2>
      <button class="modal-close" data-modal-close>&times;</button>
    </div>
    <div class="modal-body">
      <form data-ajax-form action="<?= e(url('contacts',['action'=>'save'])) ?>" method="post" id="contact-form">
        <?= csrf_field() ?>
        <input type="hidden" name="id" value="">
        <div class="form-section"><p class="form-section-title">Contact Details</p>
          <div class="form-grid">
            <div class="form-row"><label>First Name <span class="required">*</span></label>
              <input type="text" name="first_name" maxlength="64"><span class="field-error" data-error="first_name"></span></div>
            <div class="form-row"><label>Last Name</label><input type="text" name="last_name" maxlength="64"></div>
            <?php if (is_single_client_mode()): ?>
              <input type="hidden" name="client_id" value="<?= (int)single_client_id() ?>">
            <?php else: ?>
            <div class="form-row full"><label>Client <span class="required">*</span></label>
              <select name="client_id"><option value="">— Select Client —</option>
                <?php foreach ($clients as $cl): ?><option value="<?= e($cl['id']) ?>"><?= e($cl['name']) ?></option><?php endforeach; ?>
              </select><span class="field-error" data-error="client_id"></span></div>
            <?php endif; ?>
            <div class="form-row"><label>Job Title</label><input type="text" name="title" maxlength="128"></div>
            <div class="form-row"><label>Status</label>
              <select name="status"><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          </div>
        </div>
        <div class="form-section"><p class="form-section-title">Contact Info</p>
          <div class="form-grid">
            <div class="form-row full"><label>Email</label><input type="email" name="email"></div>
            <div class="form-row"><label>Phone 1</label><input type="tel" name="phone_1"></div>
            <div class="form-row"><label>Phone 2</label><input type="tel" name="phone_2"></div>
          </div>
        </div>
        <div class="form-section"><p class="form-section-title">Notes</p>
          <div class="form-row"><textarea name="notes"></textarea></div>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <div class="modal-footer-left">
        <?php if ($canDelete): ?>
          <button type="button" class="btn btn-danger btn-sm" style="display:none" data-delete-btn
            data-delete-confirm="this contact"
            data-delete-template="<?= e($delTpl) ?>">Delete</button>
        <?php endif; ?>
      </div>
      <div class="modal-footer-right">
        <button type="button" class="btn" data-modal-close>Cancel</button>
        <button type="submit" form="contact-form" class="btn btn-primary">Save Contact</button>
      </div>
    </div>
  </div>
</div>
<?php endif; ?>
