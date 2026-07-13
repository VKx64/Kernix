<?php ob_start(); ?>
<div class="empty-state">
  <h2>404 — Not Found</h2>
  <p class="muted">The page you requested does not exist.</p>
  <a href="<?= e(url('dashboard')) ?>" class="btn">Back to Dashboard</a>
</div>
<?php $content = ob_get_clean();
$pageTitle = 'Not Found';
if (Auth::check()) {
    require VIEWS_PATH . '/layout.php';
} else {
    echo '<!doctype html><html><head><meta charset="utf-8"><title>404</title><link rel="stylesheet" href="'.e(asset('css/app.css')).'"></head><body class="login-body"><div class="login-card"><h2>404 — Not Found</h2><p><a href="'.e(url('login')).'">Go to login</a></p></div></body></html>';
}
