<?php
/**
 * Front controller.
 *
 * BUILD: 2026-05-22-clock-bars-2px
 * If you see this string in view-source, the latest index.php is live.
 */

require __DIR__ . '/app/bootstrap.php';

session_boot();
csrf_check();

$s = settings();
if (!empty($s['default_timezone'])) {
    date_default_timezone_set($s['default_timezone']);
}

$page   = $_GET['p']      ?? 'dashboard';
$action = $_GET['action'] ?? 'index';

$public = ['login', 'logout'];

if (!in_array($page, $public, true)) {
    Auth::require_login();
}

$modules = [
    'login'     => 'auth_pages',
    'logout'    => 'auth_pages',
    'dashboard' => 'dashboard',
    'messages'  => 'messages',
    'tasks'     => 'tasks',
    'projects'  => 'projects',
    'clients'   => 'clients',
    'contacts'  => 'contacts',
    'analytics' => 'analytics',
    'settings'  => 'settings',
    'users'     => 'users',
    'roles'     => 'roles',
    'fields'    => 'fields',
    'profile'   => 'profile',
    'time'      => 'time',
];

if (!isset($modules[$page])) {
    http_response_code(404);
    require VIEWS_PATH . '/404.php';
    exit;
}

$moduleFile = MODULES_PATH . '/' . $modules[$page] . '.php';
if (!file_exists($moduleFile)) {
    render('_placeholder', ['title' => ucfirst($page), 'page' => $page, 'pageTitle' => ucfirst($page)]);
    exit;
}

require $moduleFile;

$fn = 'handle_' . preg_replace('/[^a-z_]/', '', strtolower($action));
if (function_exists($fn)) {
    $fn();
} elseif (function_exists('handle_index')) {
    handle_index();
} else {
    http_response_code(404);
    require VIEWS_PATH . '/404.php';
}
