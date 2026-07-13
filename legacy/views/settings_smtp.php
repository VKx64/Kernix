<?php /** @var array $s, bool $canEdit */ ?>

<div class="page-header">
  <a href="<?= e(url('settings')) ?>" class="back-link">← Back to Settings</a>
  <h2>Email / SMTP</h2>
  <p class="muted">Configure outbound email used for messaging clients.</p>
</div>

<form data-ajax-form action="<?= e(url('settings',['action'=>'save_smtp'])) ?>" method="post" id="form-smtp">
  <?= csrf_field() ?>

  <div class="config-card">
    <div class="config-card-header">
      <h3>SMTP Server</h3>
      <p>Connection details for your mail server (Gmail, SendGrid, Mailgun, etc.)</p>
    </div>
    <div class="config-card-body">
      <div class="form-grid">
        <div class="form-row full">
          <label>SMTP Host</label>
          <input type="text" name="smtp_host" value="<?= e($s['smtp_host']??'') ?>" placeholder="smtp.gmail.com">
        </div>
        <div class="form-row">
          <label>Port</label>
          <input type="number" name="smtp_port" value="<?= e($s['smtp_port']??587) ?>" placeholder="587">
        </div>
        <div class="form-row">
          <label>Encryption</label>
          <select name="smtp_encryption">
            <?php foreach (['tls'=>'TLS (STARTTLS)','ssl'=>'SSL / SMTPS','none'=>'None'] as $v=>$l): ?>
              <option value="<?= e($v) ?>" <?= ($s['smtp_encryption']??'tls')===$v?'selected':'' ?>><?= e($l) ?></option>
            <?php endforeach; ?>
          </select>
        </div>
        <div class="form-row">
          <label>Username</label>
          <input type="text" name="smtp_username" value="<?= e($s['smtp_username']??'') ?>" autocomplete="off">
        </div>
        <div class="form-row">
          <label>Password</label>
          <input type="password" name="smtp_password" placeholder="Leave blank to keep current" autocomplete="new-password">
        </div>
      </div>
    </div>
  </div>

  <div class="config-card">
    <div class="config-card-header">
      <h3>Sender Identity</h3>
      <p>How outgoing emails appear in the recipient's inbox</p>
    </div>
    <div class="config-card-body">
      <div class="form-grid">
        <div class="form-row">
          <label>From Email</label>
          <input type="email" name="smtp_from_email" value="<?= e($s['smtp_from_email']??'') ?>" placeholder="hello@example.com">
        </div>
        <div class="form-row">
          <label>From Name</label>
          <input type="text" name="smtp_from_name" value="<?= e($s['smtp_from_name']??'') ?>" placeholder="Kernix">
        </div>
      </div>
    </div>
  </div>

  <?php if ($canEdit): ?>
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Save SMTP Settings</button>
    </div>
  <?php endif; ?>
</form>
