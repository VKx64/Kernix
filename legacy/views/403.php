<?php ob_start(); ?>
<div class="empty-state">
  <h2>403 — Forbidden</h2>
  <p class="muted">You don't have permission to access this page.</p>
  <a href="<?= e(url('dashboard')) ?>" class="btn">Back to Dashboard</a>
</div>
<?php $content = ob_get_clean();
$pageTitle = 'Forbidden';
require VIEWS_PATH . '/layout.php';
