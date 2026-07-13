<?php
$canEdit   = Perm::can('roles.edit');
$canDelete = Perm::can('roles.delete');
$canCreate = Perm::can('roles.create');

$allKeys = [];
foreach ($allPerms as $group => $keys) {
    foreach ($keys as $k) $allKeys[] = $k;
}
$delTpl = delete_url_template('roles');
?>

<!-- PAGE HEADER -->
<div class="list-page-header">
  <div class="list-page-header-left">
    <h1>Roles & Permissions</h1>
    <div class="list-page-meta">
      <span class="muted">Define what each role can see and do across the app.</span>
    </div>
  </div>
  <div class="list-page-header-right">
    <?php if ($canCreate): ?>
      <button class="btn btn-primary btn-sm" data-modal-add="role-modal">
        <svg class="icon"><use href="#i-plus"/></svg> New Role
      </button>
    <?php endif; ?>
  </div>
</div>

<div class="config-card">
  <div class="config-card-body" style="padding:0">
    <table class="data-table" style="margin:0">
      <thead>
        <tr>
          <th style="padding:12px 18px">Role</th>
          <th style="padding:12px 18px;width:80px">Users</th>
          <th style="padding:12px 18px">Permissions</th>
          <th style="padding:12px 18px;width:80px">System</th>
          <th style="padding:12px 18px;width:100px"></th>
        </tr>
      </thead>
      <tbody>
        <?php foreach ($rows as $r):
            $perms  = $permsByRole[$r['id']] ?? [];
            $pCount = count($perms);
            $total  = count($allKeys);
            $pct    = $total > 0 ? round($pCount / $total * 100) : 0;
            $record = json_encode(['id'=>$r['id'],'name'=>$r['name'],'permissions'=>$perms]);
        ?>
          <tr>
            <td>
              <strong><?= e($r['name']) ?></strong>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">@<?= e($r['key_name']) ?></div>
            </td>
            <td><span class="pill" style="font-size:11px"><?= (int)$r['user_count'] ?></span></td>
            <td>
              <div style="display:flex;align-items:center;gap:10px;max-width:280px">
                <div style="flex:1;height:5px;background:var(--glass-border);border-radius:3px;overflow:hidden">
                  <div style="height:100%;width:<?= $pct ?>%;background:linear-gradient(90deg,var(--primary),var(--accent));border-radius:3px;transition:width .4s"></div>
                </div>
                <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;min-width:50px;text-align:right"><?= $pCount ?>/<?= $total ?></span>
              </div>
            </td>
            <td><?= $r['is_system'] ? '<span class="pill pill-status-active" style="font-size:10px">System</span>' : '<span class="muted">—</span>' ?></td>
            <td>
              <div class="row-actions">
                <?php if ($canEdit && !$r['is_system']): ?>
                  <button class="icon-btn" title="Edit permissions" data-modal-edit="role-modal" data-record='<?= e($record) ?>'>
                    <svg class="icon icon-sm"><use href="#i-pencil"/></svg></button>
                <?php endif; ?>
                <?php if ($canDelete && !$r['is_system']): ?>
                  <button class="icon-btn" title="Delete"
                    data-delete-confirm="role <?= e($r['name']) ?>"
                    data-delete-url="<?= e(url('roles',['action'=>'delete','id'=>$r['id']])) ?>">
                    <svg class="icon icon-sm"><use href="#i-trash"/></svg></button>
                <?php endif; ?>
              </div>
            </td>
          </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
</div>

<!-- ROLE MODAL -->
<?php if ($canCreate||$canEdit): ?>
<div class="modal-backdrop" id="role-modal">
  <div class="modal modal-lg">
    <div class="modal-header">
      <h2 class="modal-title" data-add-label="New Role" data-edit-label="Edit Role">New Role</h2>
      <button class="modal-close" data-modal-close>&times;</button>
    </div>
    <div class="modal-body">
      <form data-ajax-form action="<?= e(url('roles',['action'=>'save'])) ?>" method="post" id="role-form">
        <?= csrf_field() ?>
        <input type="hidden" name="id" value="">

        <div class="modal-section">
          <div class="modal-section-title">Role</div>
          <div class="form-row">
            <label>Role Name <span class="required">*</span></label>
            <input type="text" name="name" maxlength="64" style="max-width:320px">
            <span class="field-error" data-error="name"></span>
          </div>
        </div>

        <div class="modal-section">
          <div class="modal-section-title">Permissions</div>
          <table class="perms-table">
            <thead>
              <tr>
                <th>Module</th>
                <th>View</th>
                <th>Create</th>
                <th>Edit</th>
                <th>Archive</th>
                <th>Delete</th>
                <th>Assign</th>
              </tr>
            </thead>
            <tbody>
              <?php foreach ($allPerms as $group => $keys):
                  $actions = ['view','create','edit','archive','delete','assign'];
                  $module  = strtolower($group);
              ?>
                <tr>
                  <td><?= e($group) ?></td>
                  <?php foreach ($actions as $act):
                      $key = $module . '.' . $act;
                      $has = in_array($key, $keys, true);
                  ?>
                    <td>
                      <?php if ($has): ?>
                        <input type="checkbox" name="permissions[]" value="<?= e($key) ?>">
                      <?php else: ?>
                        <span style="color:var(--text-soft);font-size:10px">—</span>
                      <?php endif; ?>
                    </td>
                  <?php endforeach; ?>
                </tr>
              <?php endforeach; ?>
            </tbody>
          </table>
        </div>

      </form>
    </div>
    <div class="modal-footer">
      <div class="modal-footer-left">
        <?php if ($canDelete): ?>
          <button type="button" class="btn btn-danger btn-sm" style="display:none" data-delete-btn
            data-delete-confirm="this role"
            data-delete-template="<?= e($delTpl) ?>">Delete</button>
        <?php endif; ?>
      </div>
      <div class="modal-footer-right">
        <button type="button" class="btn" data-modal-close>Cancel</button>
        <button type="submit" form="role-form" class="btn btn-primary">Save Role</button>
      </div>
    </div>
  </div>
</div>
<?php endif; ?>

<script>
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('[data-modal-edit="role-modal"]');
  if (!trigger) return;
  const record = JSON.parse(trigger.dataset.record || '{}');
  setTimeout(() => {
    const form = document.getElementById('role-form');
    if (!form) return;
    form.querySelectorAll('input[name="permissions[]"]').forEach(cb => {
      cb.checked = (record.permissions || []).includes(cb.value);
    });
  }, 60);
});
</script>
