<?php /** @var array $s, bool $canEdit */ ?>

<div class="page-header">
  <a href="<?= e(url('settings')) ?>" class="back-link">← Back to Settings</a>
  <h2>File Storage</h2>
  <p class="muted">Where uploaded files are stored. You can switch from local to S3 later — existing files keep working.</p>
</div>

<form data-ajax-form action="<?= e(url('settings',['action'=>'save_storage'])) ?>" method="post" id="form-storage">
  <?= csrf_field() ?>
  <?php $driver = $s['storage_driver'] ?? 'local'; ?>

  <div class="config-card">
    <div class="config-card-header">
      <h3>Storage Driver</h3>
      <p>Choose where uploaded files (logos, profile images, attachments) are stored</p>
    </div>
    <div class="config-card-body">
      <div class="driver-choice">
        <label class="driver-option <?= $driver==='local'?'selected':'' ?>">
          <input type="radio" name="storage_driver" value="local" <?= $driver==='local'?'checked':'' ?>
            onchange="document.getElementById('local-cfg').style.display='';document.getElementById('s3-cfg').style.display='none';this.closest('.driver-choice').querySelectorAll('label').forEach(l=>l.classList.remove('selected'));this.closest('label').classList.add('selected')">
          <div class="driver-option-body">
            <strong>Local Disk</strong>
            <span>Uploads folder on the server</span>
          </div>
        </label>
        <label class="driver-option <?= $driver==='s3'?'selected':'' ?>">
          <input type="radio" name="storage_driver" value="s3" <?= $driver==='s3'?'checked':'' ?>
            onchange="document.getElementById('local-cfg').style.display='none';document.getElementById('s3-cfg').style.display='';this.closest('.driver-choice').querySelectorAll('label').forEach(l=>l.classList.remove('selected'));this.closest('label').classList.add('selected')">
          <div class="driver-option-body">
            <strong>S3 Compatible</strong>
            <span>AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO</span>
          </div>
        </label>
      </div>
    </div>
  </div>

  <div class="config-card" id="local-cfg" style="<?= $driver==='s3'?'display:none':'' ?>">
    <div class="config-card-header">
      <h3>Local Disk Configuration</h3>
    </div>
    <div class="config-card-body">
      <div class="form-grid">
        <div class="form-row">
          <label>Upload Folder</label>
          <input type="text" name="local_upload_path" value="<?= e($s['local_upload_path']??'uploads') ?>" placeholder="uploads">
        </div>
        <div class="form-row">
          <label>Public URL Base (optional)</label>
          <input type="text" name="local_public_url" value="<?= e($s['local_public_url']??'') ?>" placeholder="Leave blank for default">
        </div>
      </div>
    </div>
  </div>

  <div class="config-card" id="s3-cfg" style="<?= $driver!=='s3'?'display:none':'' ?>">
    <div class="config-card-header">
      <h3>S3 Configuration</h3>
      <p>Credentials and bucket settings</p>
    </div>
    <div class="config-card-body">
      <div class="form-grid">
        <div class="form-row"><label>Bucket</label><input type="text" name="s3_bucket" value="<?= e($s['s3_bucket']??'') ?>"></div>
        <div class="form-row"><label>Region</label><input type="text" name="s3_region" value="<?= e($s['s3_region']??'') ?>" placeholder="us-east-1"></div>
        <div class="form-row"><label>Access Key</label><input type="text" name="s3_access_key" value="<?= e($s['s3_access_key']??'') ?>" autocomplete="off"></div>
        <div class="form-row"><label>Secret Key</label><input type="password" name="s3_secret_key" placeholder="Leave blank to keep current" autocomplete="new-password"></div>
        <div class="form-row full"><label>Endpoint (blank for AWS)</label>
          <input type="text" name="s3_endpoint" value="<?= e($s['s3_endpoint']??'') ?>" placeholder="https://....r2.cloudflarestorage.com"></div>
        <div class="form-row full"><label>Public URL Base</label>
          <input type="text" name="s3_public_url_base" value="<?= e($s['s3_public_url_base']??'') ?>" placeholder="https://cdn.yourdomain.com"></div>
        <div class="form-row full">
          <label class="check-row">
            <input type="checkbox" name="s3_use_path_style" value="1" <?= !empty($s['s3_use_path_style'])?'checked':'' ?>>
            <span>Force path-style URLs (required for MinIO and some S3-compatible services)</span>
          </label>
        </div>
      </div>
    </div>
  </div>

  <?php if ($canEdit): ?>
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Save Storage Settings</button>
    </div>
  <?php endif; ?>
</form>
