<?php
/**
 * Profile module — user self-service settings
 * Round 23
 *
 * Routes (all require login):
 *   ?p=profile                                 → handle_index    (view profile)
 *   ?p=profile&action=save           (POST)    → handle_save     (save personal/contact details)
 *   ?p=profile&action=change_password (POST)   → handle_change_password
 *   ?p=profile&action=upload_avatar  (POST)    → handle_upload_avatar
 */

function handle_index(): void
{
    // ROUND 33: instrumentation
    ini_set('display_errors', '1');
    ini_set('display_startup_errors', '1');
    error_reporting(E_ALL);
    set_error_handler(function ($severity, $message, $file, $line) {
        if (!(error_reporting() & $severity)) return false;
        throw new ErrorException($message, 0, $severity, $file, $line);
    });

    try {
        $uid = Auth::id();
    $me  = DB::row(
        "SELECT u.*, r.name AS role_name, fv.label AS department_label
         FROM users u
         LEFT JOIN roles r       ON r.id = u.role_id
         LEFT JOIN field_values fv ON fv.id = u.department_value_id
         WHERE u.id = :id",
        ['id' => $uid]
    );
    if (!$me) { Auth::logout(); redirect('login'); }

    // Time-logged stats — last 7 days
    $weekTime = (int)DB::value(
        "SELECT COALESCE(SUM(time_minutes), 0)
         FROM task_notes
         WHERE time_logged_by = :uid
           AND deleted_at IS NULL
           AND time_minutes IS NOT NULL
           AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)",
        ['uid' => $uid]
    );

    // Time-logged today
    $todayTime = (int)DB::value(
        "SELECT COALESCE(SUM(time_minutes), 0)
         FROM task_notes
         WHERE time_logged_by = :uid
           AND deleted_at IS NULL
           AND time_minutes IS NOT NULL
           AND DATE(created_at) = CURDATE()",
        ['uid' => $uid]
    );

    // Recent activity — last 10 notes by this user
    $recentNotes = DB::all(
        "SELECT n.id, n.body, n.time_minutes, n.created_at, n.task_id,
                t.title AS task_title, cl.name AS client_name
         FROM task_notes n
         LEFT JOIN tasks    t  ON t.id = n.task_id
         LEFT JOIN projects p  ON p.id = t.project_id
         LEFT JOIN clients  cl ON cl.id = p.client_id
         WHERE n.created_by = :uid
           AND n.deleted_at IS NULL
         ORDER BY n.created_at DESC
         LIMIT 10",
        ['uid' => $uid]
    );

    // Unread messages (notes assigned to me, not read)
    $unreadMessages = (int)DB::value(
        "SELECT COUNT(*) FROM task_notes
         WHERE assigned_user_id = :uid
           AND read_at IS NULL
           AND deleted_at IS NULL",
        ['uid' => $uid]
    );

    // Open tasks assigned to me
    $myOpenTasks = (int)DB::value(
        "SELECT COUNT(*) FROM tasks t
         LEFT JOIN field_values fv ON fv.id = t.status_value_id
         WHERE t.assignee_user_id = :uid
           AND t.deleted_at IS NULL
           AND t.archived_at IS NULL
           AND (fv.key_name IS NULL OR fv.key_name != 'complete')",
        ['uid' => $uid]
    );

    $tzList = timezone_identifiers_list();

    render('profile', [
        'pageTitle'       => 'My Profile',
        'me'              => $me,
        'tzList'          => $tzList,
        'weekTime'        => $weekTime,
        'todayTime'       => $todayTime,
        'recentNotes'     => $recentNotes,
        'unreadMessages'  => $unreadMessages,
        'myOpenTasks'     => $myOpenTasks,
        'themePresets'    => function_exists('theme_presets')      ? theme_presets()             : [],
        'currentThemeId'  => function_exists('theme_preset_for_user') ? theme_preset_for_user($me) : 'imagic_purple',
    ]);
    } catch (\Throwable $e) {
        while (ob_get_level() > 0) ob_end_clean();
        http_response_code(500);
        echo '<!doctype html><html><head><title>Profile Error</title>';
        echo '<style>body{font-family:system-ui,sans-serif;background:#1a0d2e;color:#fff;padding:30px;max-width:900px;margin:auto}';
        echo 'h1{color:#f87171}pre{background:rgba(0,0,0,.3);padding:14px;border-radius:8px;font-size:11px;white-space:pre-wrap;line-height:1.7}';
        echo '.box{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);padding:14px;border-radius:8px;font-family:ui-monospace,monospace;font-size:12px;line-height:1.7;margin-bottom:14px}';
        echo '</style></head><body>';
        echo '<h1>Profile Error</h1>';
        echo '<div class="box">';
        echo '<div><strong>Type:</strong> ' . htmlspecialchars(get_class($e)) . '</div>';
        echo '<div><strong>Message:</strong> ' . htmlspecialchars($e->getMessage()) . '</div>';
        echo '<div><strong>File:</strong> ' . htmlspecialchars($e->getFile()) . ' line ' . $e->getLine() . '</div>';
        echo '</div>';
        echo '<details open><summary style="cursor:pointer;color:#a78bfa">Stack trace</summary>';
        echo '<pre>' . htmlspecialchars($e->getTraceAsString()) . '</pre></details>';
        echo '</body></html>';
        restore_error_handler();
        exit;
    }
}

function handle_save(): void
{
    header('Content-Type: application/json');
    $uid = Auth::id();
    $me  = DB::row('SELECT * FROM users WHERE id = :id', ['id' => $uid]);
    if (!$me) { echo json_encode(['ok'=>false,'message'=>'Not authenticated.']); exit; }

    // Fields the user can change themselves
    $allowed = [
        'first_name', 'last_name',
        'personal_email', 'imagic_email',
        'phone_1', 'phone_2',
        'home_address', 'barangay', 'city', 'province', 'zip_code',
        'birthdate',
        'wise_account', 'gcash_account',
        'timezone',
        'theme_preset',
    ];

    $errors = [];
    $data = [];
    foreach ($allowed as $f) {
        if (!isset($_POST[$f])) continue;
        $val = trim((string)$_POST[$f]);

        if ($f === 'first_name' || $f === 'last_name') {
            if ($val === '') { $errors[$f] = 'Required.'; continue; }
            if (strlen($val) > 64) { $errors[$f] = 'Too long (max 64).'; continue; }
        }
        if ($f === 'personal_email' || $f === 'imagic_email') {
            if ($val !== '' && !filter_var($val, FILTER_VALIDATE_EMAIL)) {
                $errors[$f] = 'Invalid email.';
                continue;
            }
        }
        if ($f === 'birthdate' && $val !== '') {
            $ts = strtotime($val);
            if ($ts === false) { $errors[$f] = 'Invalid date.'; continue; }
        }
        if ($f === 'timezone' && $val !== '') {
            if (!in_array($val, timezone_identifiers_list(), true)) {
                $errors[$f] = 'Invalid timezone.';
                continue;
            }
        }
        if ($f === 'theme_preset') {
            $validIds = function_exists('theme_preset_ids') ? theme_preset_ids() : ['imagic_purple'];
            if ($val === '' || !in_array($val, $validIds, true)) {
                $val = function_exists('theme_preset_default') ? theme_preset_default() : 'imagic_purple';
            }
            $data[$f] = $val;
            continue;
        }

        $data[$f] = ($val === '') ? null : $val;
    }

    if (!empty($errors)) {
        echo json_encode(['ok'=>false,'message'=>'Please fix the highlighted fields.','errors'=>$errors]);
        exit;
    }

    if (empty($data)) {
        echo json_encode(['ok'=>true,'message'=>'No changes.']);
        exit;
    }

    DB::update('users', $data, ['id' => $uid]);

    // Compute diff for audit log (don't log sensitive fields verbatim)
    $diff = Audit::diff(
        array_intersect_key($me, $data),
        $data
    );
    Audit::log('update', 'user', $uid, 'Updated own profile', $diff);

    echo json_encode(['ok'=>true,'message'=>'Profile saved.']);
    exit;
}

function handle_change_password(): void
{
    header('Content-Type: application/json');
    $uid = Auth::id();
    $me  = DB::row('SELECT * FROM users WHERE id = :id', ['id' => $uid]);
    if (!$me) { echo json_encode(['ok'=>false,'message'=>'Not authenticated.']); exit; }

    $current  = (string)($_POST['current_password'] ?? '');
    $new      = (string)($_POST['new_password']     ?? '');
    $confirm  = (string)($_POST['confirm_password'] ?? '');

    $errors = [];
    if ($current === '') $errors['current_password'] = 'Required.';
    if ($new === '')     $errors['new_password']     = 'Required.';
    elseif (strlen($new) < 8) $errors['new_password'] = 'Must be at least 8 characters.';
    if ($confirm !== $new) $errors['confirm_password'] = 'Does not match new password.';

    if (!$errors && !password_verify($current, $me['password_hash'])) {
        $errors['current_password'] = 'Incorrect current password.';
    }

    if ($errors) {
        echo json_encode(['ok'=>false,'message'=>'Please fix the highlighted fields.','errors'=>$errors]);
        exit;
    }

    $newHash = password_hash($new, PASSWORD_BCRYPT);
    DB::update('users', ['password_hash' => $newHash], ['id' => $uid]);
    Audit::log('update', 'user', $uid, 'Changed own password');

    echo json_encode(['ok'=>true,'message'=>'Password changed.']);
    exit;
}

function handle_upload_avatar(): void
{
    header('Content-Type: application/json');
    $uid = Auth::id();
    $me  = DB::row('SELECT * FROM users WHERE id = :id', ['id' => $uid]);
    if (!$me) { echo json_encode(['ok'=>false,'message'=>'Not authenticated.']); exit; }

    if (empty($_FILES['avatar']) || ($_FILES['avatar']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        echo json_encode(['ok'=>false,'message'=>'No file selected.']);
        exit;
    }

    $file = $_FILES['avatar'];

    // Only images
    $allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    $mime = mime_content_type($file['tmp_name']) ?: '';
    if (!in_array($mime, $allowedMimes, true)) {
        echo json_encode(['ok'=>false,'message'=>'Only JPG, PNG, GIF, or WebP images are allowed.']);
        exit;
    }

    if (($file['size'] ?? 0) > 5 * 1024 * 1024) {
        echo json_encode(['ok'=>false,'message'=>'File too large (max 5 MB).']);
        exit;
    }

    try {
        $r = Storage::putUpload($file, 'avatars');
    } catch (\Throwable $e) {
        echo json_encode(['ok'=>false,'message'=>'Upload failed: ' . $e->getMessage()]);
        exit;
    }

    // Delete the old avatar file if it was a local file
    if (!empty($me['profile_image'])) {
        $oldPath = UPLOAD_PATH . '/' . $me['profile_image'];
        if (is_file($oldPath)) @unlink($oldPath);
    }

    DB::update('users', ['profile_image' => $r['path']], ['id' => $uid]);
    Audit::log('update', 'user', $uid, 'Updated profile image');

    $url = Storage::url($r['driver'] ?? 'local', $r['path']);
    echo json_encode([
        'ok'      => true,
        'message' => 'Avatar updated.',
        'url'     => $url,
        'path'    => $r['path'],
    ]);
    exit;
}

function handle_remove_avatar(): void
{
    header('Content-Type: application/json');
    $uid = Auth::id();
    $me  = DB::row('SELECT * FROM users WHERE id = :id', ['id' => $uid]);
    if (!$me) { echo json_encode(['ok'=>false,'message'=>'Not authenticated.']); exit; }

    if (!empty($me['profile_image'])) {
        $oldPath = UPLOAD_PATH . '/' . $me['profile_image'];
        if (is_file($oldPath)) @unlink($oldPath);
    }

    DB::update('users', ['profile_image' => null], ['id' => $uid]);
    Audit::log('update', 'user', $uid, 'Removed profile image');

    echo json_encode(['ok'=>true,'message'=>'Avatar removed.']);
    exit;
}
