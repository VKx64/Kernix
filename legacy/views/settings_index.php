<?php
/** @var array $s */
$cards = [
    [
        'title'  => 'System',
        'desc'   => 'Branding, logos, favicon and timezone',
        'icon'   => 'i-gear',
        'url'    => url('settings', ['section'=>'system']),
        'perm'   => 'settings.view',
        'status' => $s['default_timezone'] ?? 'Not configured',
    ],
    [
        'title'  => 'Email / SMTP',
        'desc'   => 'Outbound mail configuration for client messaging',
        'icon'   => 'i-send',
        'url'    => url('settings', ['section'=>'smtp']),
        'perm'   => 'settings.view',
        'status' => !empty($s['smtp_host']) ? $s['smtp_host'] : 'Not configured',
    ],
    [
        'title'  => 'Storage',
        'desc'   => 'Where uploaded files are stored — local or S3',
        'icon'   => 'i-folder',
        'url'    => url('settings', ['section'=>'storage']),
        'perm'   => 'settings.view',
        'status' => ucfirst($s['storage_driver'] ?? 'local'),
    ],
    [
        'title'  => 'Users',
        'desc'   => 'Manage team members, contact info and access',
        'icon'   => 'i-users',
        'url'    => url('users'),
        'perm'   => 'users.view',
        'status' => DB::value('SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND archived_at IS NULL') . ' active',
    ],
    [
        'title'  => 'Roles & Permissions',
        'desc'   => 'Define roles and what each role can access',
        'icon'   => 'i-check',
        'url'    => url('roles'),
        'perm'   => 'roles.view',
        'status' => DB::value('SELECT COUNT(*) FROM roles WHERE deleted_at IS NULL') . ' roles',
    ],
    [
        'title'  => 'Fields & Dropdowns',
        'desc'   => 'Customize statuses, types, urgencies and other field values',
        'icon'   => 'i-columns',
        'url'    => url('fields'),
        'perm'   => 'fields.view',
        'status' => DB::value('SELECT COUNT(*) FROM fields WHERE deleted_at IS NULL') . ' field groups',
    ],
];
?>

<div class="settings-cards">
  <?php foreach ($cards as $c):
      if (!Perm::can($c['perm'])) continue; ?>
    <a href="<?= e($c['url']) ?>" class="settings-card">
      <div class="settings-card-icon">
        <svg class="icon"><use href="#<?= e($c['icon']) ?>"/></svg>
      </div>
      <div class="settings-card-body">
        <div class="settings-card-title"><?= e($c['title']) ?></div>
        <div class="settings-card-desc"><?= e($c['desc']) ?></div>
        <div class="settings-card-status"><?= e($c['status']) ?></div>
      </div>
      <div class="settings-card-arrow">→</div>
    </a>
  <?php endforeach; ?>
</div>
