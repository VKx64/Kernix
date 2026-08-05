<?php
$canEdit   = Perm::can('fields.edit');
$canCreate = Perm::can('fields.create');
$canDelete = Perm::can('fields.delete');
$delTpl    = delete_url_template('fields', 'delete_value');
?>

<div class="page-header">
  <a href="<?= e(url('settings')) ?>" class="back-link">← Back to Settings</a>
  <h2>Fields & Dropdowns</h2>
  <p class="muted">Customize the available values for statuses, types, urgencies and other dropdown fields.</p>
</div>

<div class="fields-layout">

  <!-- Field group list -->
  <div class="config-card" style="margin-bottom:0">
    <div class="config-card-header">
      <h3>Field Groups</h3>
    </div>
    <div class="fields-nav">
      <?php foreach ($fields as $f): ?>
        <a href="<?= e(url('fields',['field_id'=>$f['id']])) ?>"
           class="fields-nav-item <?= $selectedId==$f['id']?'active':'' ?>">
          <div style="flex:1;min-width:0">
            <div class="fields-nav-name"><?= e($f['name']) ?></div>
            <div class="fields-nav-meta"><?= e($f['module']??'—') ?> · <?= (int)$f['value_count'] ?> values</div>
          </div>
          <?php if ($selectedId==$f['id']): ?>
            <span style="color:var(--primary-hover);font-size:11px">▶</span>
          <?php endif; ?>
        </a>
      <?php endforeach; ?>
    </div>
  </div>

  <!-- Values panel -->
  <div>
    <?php if ($selectedField): ?>
      <div class="config-card" style="margin-bottom:0">
        <div class="config-card-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <h3><?= e($selectedField['name']) ?></h3>
            <p>Key: <code style="background:var(--popover-input-bg);padding:1px 6px;border-radius:4px;font-size:11px"><?= e($selectedField['key_name']) ?></code> · Module: <?= e($selectedField['module']??'—') ?></p>
          </div>
          <?php if ($canCreate): ?>
            <button class="btn btn-primary btn-sm" data-modal-add="value-modal">
              <svg class="icon"><use href="#i-plus"/></svg> Add Value
            </button>
          <?php endif; ?>
        </div>
        <div class="config-card-body" style="padding:8px 14px">
          <?php if (empty($values)): ?>
            <p class="muted" style="text-align:center;padding:32px 12px">No values yet. Add one to populate this dropdown.</p>
          <?php else: foreach ($values as $v):
              $record = json_encode([
                  'id'         => $v['id'],
                  'field_id'   => $v['field_id'],
                  'label'      => $v['label'],
                  'color'      => $v['color'] ?? '',
                  'status'     => $v['status'] ?? 'active',
                  'sort_order' => $v['sort_order'] ?? 0,
              ]); ?>
            <div class="field-val-row">
              <div class="field-val-color" style="<?= $v['color']?'background:'.e($v['color']):'background:var(--glass-bg-2)' ?>"></div>
              <div class="field-val-label">
                <?= e($v['label']) ?>
              </div>
              <?php if ($v['color']): ?>
                <code style="font-size:10px;color:var(--text-muted);background:var(--popover-input-bg);padding:2px 6px;border-radius:4px"><?= e($v['color']) ?></code>
              <?php endif; ?>
              <div class="field-val-sort" title="Sort order"><?= (int)$v['sort_order'] ?></div>
              <span class="pill <?= $v['status']==='active'?'pill-status-active':'pill-status-inactive' ?>" style="font-size:10px"><?= e(ucfirst($v['status'])) ?></span>
              <div class="row-actions" style="margin-left:8px">
                <?php if ($canEdit): ?>
                  <button class="icon-btn" title="Edit" data-modal-edit="value-modal" data-record='<?= e($record) ?>'>
                    <svg class="icon icon-sm"><use href="#i-pencil"/></svg></button>
                <?php endif; ?>
                <?php if ($canDelete): ?>
                  <button class="icon-btn" title="Delete"
                    data-delete-confirm="<?= e($v['label']) ?>"
                    data-delete-url="<?= e(url('fields',['action'=>'delete_value','id'=>$v['id']])) ?>">
                    <svg class="icon icon-sm"><use href="#i-trash"/></svg></button>
                <?php endif; ?>
              </div>
            </div>
          <?php endforeach; endif; ?>
        </div>
      </div>
    <?php else: ?>
      <div class="subpage-empty"><p class="muted">Select a field group to manage its values.</p></div>
    <?php endif; ?>
  </div>
</div>

<!-- VALUE MODAL -->
<?php if ($canCreate||$canEdit): ?>
<div class="modal-backdrop" id="value-modal">
  <div class="modal">
    <div class="modal-header">
      <h2 class="modal-title" data-add-label="New Value" data-edit-label="Edit Value">New Value</h2>
      <button class="modal-close" data-modal-close>&times;</button>
    </div>
    <div class="modal-body">
      <form data-ajax-form action="<?= e(url('fields',['action'=>'save_value'])) ?>" method="post" id="value-form">
        <?= csrf_field() ?>
        <input type="hidden" name="id" value="">
        <input type="hidden" name="field_id" value="<?= e($selectedId) ?>">
        <div class="form-grid">
          <div class="form-row full">
            <label>Label <span class="required">*</span></label>
            <input type="text" name="label" maxlength="128">
            <span class="field-error" data-error="label"></span>
          </div>
          <div class="form-row">
            <label>Color (hex)</label>
            <input type="text" name="color" placeholder="#8b5cf6" maxlength="32">
          </div>
          <div class="form-row">
            <label>Status</label>
            <select name="status"><option value="active">Active</option><option value="inactive">Inactive</option></select>
          </div>
          <div class="form-row">
            <label>Sort Order</label>
            <input type="number" name="sort_order" value="0" min="0">
          </div>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <div class="modal-footer-left">
        <?php if ($canDelete): ?>
          <button type="button" class="btn btn-danger btn-sm" style="display:none" data-delete-btn
            data-delete-confirm="this value"
            data-delete-template="<?= e($delTpl) ?>">Delete</button>
        <?php endif; ?>
      </div>
      <div class="modal-footer-right">
        <button type="button" class="btn" data-modal-close>Cancel</button>
        <button type="submit" form="value-form" class="btn btn-primary">Save Value</button>
      </div>
    </div>
  </div>
</div>
<?php endif; ?>

<style>
.fields-layout {
  display: grid; grid-template-columns: 280px 1fr; gap: 18px; align-items: start;
}
@media (max-width: 768px) { .fields-layout { grid-template-columns: 1fr; } }

.fields-nav { padding: 6px; max-height: 70vh; overflow-y: auto; }
.fields-nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: var(--radius);
  color: var(--text); text-decoration: none;
  margin-bottom: 2px; transition: background .12s;
}
.fields-nav-item:hover { background: var(--glass-bg-2); text-decoration: none; }
.fields-nav-item.active { background: var(--primary-glow); color: var(--primary-hover); }
.fields-nav-name { font-size: 13px; font-weight: 500; }
.fields-nav-meta { font-size: 10px; color: var(--text-muted); margin-top: 2px; }
.fields-nav-item.active .fields-nav-meta { color: var(--primary-hover); opacity: .8; }
</style>
