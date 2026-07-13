<?php
$pageTitle    = $pageTitle ?? APP_NAME;
$me           = Auth::user();
$currentPage  = $_GET['p'] ?? 'dashboard';
$flashes      = flash_pull();
$s            = settings();

$nav = [
    ['dashboard','Dashboard','i-grid',     'dashboard.view'],
    ['messages', 'Messages', 'i-message',  'messages.view'],
    ['tasks',    'Tasks',    'i-check',    'tasks.view'],
    ['projects', 'Projects', 'i-folder',   'projects.view'],
    ['clients',  'Clients',  'i-building', 'clients.view'],
    ['contacts', 'Contacts', 'i-users',    'contacts.view'],
    ['analytics','Analytics','i-chart',    'analytics.view'],
    ['settings', 'Settings', 'i-gear',     'settings.view'],
];

// In single-client mode, hide the Clients nav item entirely
if (is_single_client_mode()) {
    $nav = array_values(array_filter($nav, fn($n) => $n[0] !== 'clients'));
}

// ROUND 24: unread messages count for sidebar badge
$navUnread = 0;
if ($me && function_exists('messages_unread_count')) {
    $navUnread = messages_unread_count((int)$me['id']);
} elseif ($me) {
    // Inline fallback if messages module isn't loaded yet (it might not be on every page)
    try {
        $navUnread = (int)DB::value(
            "SELECT COUNT(*) FROM task_notes
             WHERE assigned_user_id = :uid AND is_message = 1
               AND read_at IS NULL AND deleted_at IS NULL",
            ['uid' => (int)$me['id']]
        );
    } catch (\Throwable $e) { $navUnread = 0; }
}
?>
<!doctype html>
<html lang="en" data-theme="dark" data-theme-preset="<?= e(function_exists('theme_preset_for_user') ? theme_preset_for_user($me) : 'imagic_purple') ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title><?= e($pageTitle) ?> — <?= e(APP_NAME) ?></title>
<meta name="csrf"     content="<?= e(csrf_token()) ?>">
<meta name="app-base" content="<?= e(APP_BASE) ?>">
<meta name="user-id"  content="<?= e($me['id'] ?? '') ?>">
<script>const t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);</script>
<?php if (!empty($s['favicon'])): ?>
<link rel="icon" href="<?= e(Storage::url($s['storage_driver'] ?? 'local', $s['favicon'])) ?>">
<?php endif; ?>
<link rel="stylesheet" href="<?= e(asset('css/app.css')) ?>">
<link rel="stylesheet" href="<?= e(asset('css/grid-filters.css')) ?>">
<link rel="stylesheet" href="<?= e(asset('css/cards.css')) ?>">
<link rel="stylesheet" href="<?= e(asset('css/modal-sections.css')) ?>">
<link rel="stylesheet" href="<?= e(asset('css/components.css')) ?>">
</head>
<body>

<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="i-grid"         viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/></symbol>
  <symbol id="i-message"      viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 5h16v11H8l-4 4z"/></symbol>
  <symbol id="i-check"        viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 12l5 5L20 6"/></symbol>
  <symbol id="i-folder"       viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V6z"/></symbol>
  <symbol id="i-building"     viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01"/></symbol>
  <symbol id="i-users"        viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></symbol>
  <symbol id="i-chart"        viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18M7 14l4-4 4 4 5-5"/></symbol>
  <symbol id="i-gear"         viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path fill="none" stroke="currentColor" stroke-width="2" d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/></symbol>
  <symbol id="i-sun"          viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></symbol>
  <symbol id="i-moon"         viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></symbol>
  <symbol id="i-search"       viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M21 21l-4.35-4.35"/></symbol>
  <symbol id="i-plus"         viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14"/></symbol>
  <symbol id="i-chevron-down" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></symbol>
  <symbol id="i-pencil"       viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></symbol>
  <symbol id="i-archive"      viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></symbol>
  <symbol id="i-trash"        viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></symbol>
  <symbol id="i-eye"          viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M1 12S5 4 12 4s11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
  <symbol id="i-x"            viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M18 6L6 18M6 6l12 12"/></symbol>
  <symbol id="i-chevron-left" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6"/></symbol>
  <symbol id="i-note"         viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8"/></symbol>
  <symbol id="i-send"         viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></symbol>
  <symbol id="i-columns"      viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 3h7a2 2 0 012 2v14a2 2 0 01-2 2h-7M12 3H5a2 2 0 00-2 2v14a2 2 0 002 2h7M12 3v18"/></symbol>
  <symbol id="i-alert"        viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/></symbol>
  <symbol id="i-clock"        viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 6v6l4 2"/></symbol>
  <symbol id="i-play"         viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></symbol>
  <symbol id="i-pause"        viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></symbol>
  <symbol id="i-stop"         viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" fill="currentColor"/></symbol>
</defs></svg>

<div class="app">
  <!-- Sidebar -->
  <aside class="sidebar">
    <a href="<?= e(url('dashboard')) ?>" class="sidebar-logo" title="<?= e(APP_NAME) ?>">
      <?php if (!empty($s['sidebar_logo'])): ?>
        <img src="<?= e(Storage::url($s['storage_driver'] ?? 'local', $s['sidebar_logo'])) ?>" alt="">
      <?php else: ?>
        <span class="logo-fallback">K</span>
      <?php endif; ?>
    </a>
    <nav class="sidebar-nav">
      <?php foreach ($nav as [$key, $label, $icon, $perm]):
          if (!Perm::can($perm)) continue;
          $active = $currentPage === $key ? ' active' : '';
          $showBadge = ($key === 'messages' && $navUnread > 0);
      ?>
        <a href="<?= e(url($key)) ?>" class="nav-item<?= $active ?>" title="<?= e($label) ?>">
          <svg class="icon" aria-hidden="true"><use href="#<?= e($icon) ?>"/></svg>
          <span class="nav-label"><?= e($label) ?></span>
          <span class="nav-badge" style="<?= $showBadge ? '' : 'display:none' ?>"><?= $showBadge ? ($navUnread > 99 ? '99+' : (int)$navUnread) : '' ?></span>
        </a>
      <?php endforeach; ?>
    </nav>

    <!-- Mini timer at bottom of sidebar -->
    <div class="sidebar-timer" id="sidebar-timer" data-state="loading">
      <div class="mini-timer-clock" id="mini-timer-clock">--:--</div>
      <div class="mini-timer-buttons" id="mini-timer-buttons"></div>
    </div>
  </aside>

  <div class="main">
    <!-- Topbar — search + time tracker + theme + user -->
    <header class="topbar topbar-v2">
      <div class="topbar-search-wrap">
        <svg class="icon icon-sm topbar-search-icon"><use href="#i-search"/></svg>
        <input type="text"
               class="topbar-search-input"
               id="global-search"
               placeholder="Search…"
               autocomplete="off">
      </div>

      <div class="topbar-actions">
        <!-- CLOCKED-IN USERS (round 25) -->
        <div id="clocked-users-widget" style="display:none"></div>

        <!-- TIME TRACKER WIDGET -->
        <div class="time-widget" id="time-widget" data-dropdown>
          <button class="time-widget-trigger" type="button" data-dropdown-toggle>
            <span class="time-widget-state" id="time-widget-state">…</span>
          </button>
          <div class="dropdown-menu time-widget-menu" data-dropdown-menu id="time-widget-menu">
            <!-- Populated by JS -->
          </div>
        </div>

        <button class="icon-btn" id="theme-toggle" title="Toggle theme" type="button">
          <svg class="icon"><use href="#i-moon"/></svg>
        </button>

        <div class="user-menu" data-dropdown>
          <button class="user-trigger" type="button" data-dropdown-toggle>
            <?php if (!empty($me['profile_image'])): ?>
              <img src="<?= e(Storage::url('local', $me['profile_image'])) ?>" alt="">
            <?php else: ?>
              <span class="avatar"><?= e(initials($me['first_name'] ?? '', $me['last_name'] ?? '')) ?></span>
            <?php endif; ?>
            <svg class="icon icon-sm"><use href="#i-chevron-down"/></svg>
          </button>
          <div class="dropdown-menu" data-dropdown-menu>
            <div class="dropdown-header">
              <div class="user-name"><?= e(trim(($me['first_name'] ?? '') . ' ' . ($me['last_name'] ?? ''))) ?></div>
              <div class="user-username">@<?= e($me['username'] ?? '') ?></div>
            </div>
            <a href="<?= e(url('profile')) ?>" class="dropdown-item">Profile</a>
            <?php if (Perm::can('settings.view')): ?>
              <a href="<?= e(url('settings')) ?>" class="dropdown-item">Settings</a>
            <?php endif; ?>
            <a href="<?= e(url('logout')) ?>" class="dropdown-item">Logout</a>
          </div>
        </div>
      </div>
    </header>

    <?php if (!empty($flashes)): ?>
      <div class="flash-wrap">
        <?php foreach ($flashes as $f): ?>
          <div class="flash flash-<?= e($f['type']) ?>"><?= e($f['msg']) ?></div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>

    <main class="content">
      <?= $content ?>
    </main>
  </div>
</div>

<!-- CLOCK OUT MODAL -->
<div class="modal-backdrop" id="clockout-modal">
  <div class="modal" style="max-width:480px">
    <div class="modal-header">
      <h2 class="modal-title">Clock Out</h2>
      <button class="modal-close" data-modal-close>&times;</button>
    </div>
    <div class="modal-body" id="clockout-body">
      <!-- Filled by JS with worked/task summary -->
    </div>
    <div class="modal-footer">
      <div class="modal-footer-left"></div>
      <div class="modal-footer-right">
        <button type="button" class="btn" data-modal-close>Cancel</button>
        <button type="button" class="btn btn-primary" id="clockout-confirm">Confirm Clock Out</button>
      </div>
    </div>
  </div>
</div>

<script src="<?= e(asset('js/app.js')) ?>"></script>
<script src="<?= e(asset('js/grid-filters.js')) ?>"></script>
<script src="<?= e(asset('js/time-tracker.js')) ?>"></script>
<script src="<?= e(asset('js/components.js')) ?>"></script>
<script src="<?= e(asset('js/clocked-users.js')) ?>"></script>
<script src="<?= e(asset('js/analytics-timeline.js')) ?>"></script>
</body>
</html>
