<?php
/**
 * Auth pages: login form, login submit, logout.
 */

function handle_index(): void
{
    $page = $_GET['p'] ?? 'login';
    if ($page === 'logout') { handle_logout(); return; }

    if (Auth::check()) {
        redirect(url('dashboard'));
    }
    render('login', ['error' => null, 'pageTitle' => 'Sign in'], '');
}

function handle_submit(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        redirect(url('login'));
    }
    $u = trim((string)input('username', ''));
    $p = (string)input('password', '');

    if ($u === '' || $p === '') {
        render('login', ['error' => 'Username and password are required.'], '');
        return;
    }

    $user = Auth::attempt($u, $p);
    if (!$user) {
        Audit::log('login_failed', 'user', null, 'Failed login for username: ' . $u);
        usleep(500000);
        render('login', ['error' => 'Invalid username or password.'], '');
        return;
    }

    $back = input('back', '');
    if (is_string($back) && $back !== '' && strpos($back, '/') === 0) {
        redirect($back);
    }
    redirect(url('dashboard'));
}

function handle_logout(): void
{
    Auth::logout();
    redirect(url('login'));
}
