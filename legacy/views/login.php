<?php /** @var ?string $error */ ?>
<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in — <?= e(APP_NAME) ?></title>
<meta name="app-base" content="<?= e(APP_BASE) ?>">
<link rel="stylesheet" href="<?= e(asset('css/app.css')) ?>">
<script>
  // Apply saved theme immediately before paint
  const t = localStorage.getItem('theme');
  if (t) document.documentElement.setAttribute('data-theme', t);
</script>
</head>
<body class="login-body">
<div class="login-card">
  <div class="login-logo">
    <?php $s = settings(); if (!empty($s['system_logo'])): ?>
      <img src="<?= e(Storage::url($s['storage_driver'] ?? 'local', $s['system_logo'])) ?>" alt="<?= e(APP_NAME) ?>">
    <?php else: ?>
      <h1><?= e(APP_NAME) ?></h1>
      <p>Sign in to continue</p>
    <?php endif; ?>
  </div>
  <?php if (!empty($error)): ?>
    <div class="flash flash-error"><?= e($error) ?></div>
  <?php endif; ?>
  <form method="post" action="<?= e(url('login', ['action' => 'submit'])) ?>">
    <?= csrf_field() ?>
    <input type="hidden" name="back" value="<?= e($_GET['back'] ?? '') ?>">
    <div class="form-row">
      <label for="username">Username</label>
      <input id="username" name="username" type="text" autocomplete="username" required autofocus>
    </div>
    <div class="form-row" style="margin-bottom:20px">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
    </div>
    <button type="submit" class="btn btn-primary btn-block">Sign in</button>
  </form>
</div>
<script src="<?= e(asset('js/app.js')) ?>"></script>
</body>
</html>
