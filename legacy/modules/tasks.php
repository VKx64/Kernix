<?php
/**
 * Tasks module — round 9 fixes:
 *  - t_mine defaults to OFF (was ON, which hid tasks from other users)
 *  - Assignee filter options include ALL users (not just active), so tasks assigned to inactive users still appear when filtered
 *  - Default sort is due_date ASC then urgency_sort ASC
 *  - ?debug=1 shows the executing SQL + params at bottom of page (admin only)
 *  - Clock-in check on save/delete/archive
 */

function handle_index(): void
{
    // ROUND 27: instrumentation — surface fatal errors instead of blank 500
    ini_set('display_errors', '1');
    ini_set('display_startup_errors', '1');
    error_reporting(E_ALL);
    set_error_handler(function ($severity, $message, $file, $line) {
        if (!(error_reporting() & $severity)) return false;
        throw new ErrorException($message, 0, $severity, $file, $line);
    });

    try {
        Perm::require('tasks.view');

    $me      = Auth::user();
    $uid     = (int)$me['id'];
    $perPage = 100;
    $pageNum = max(1, input_int('page', 1));

    $qTitle    = trim((string)($_GET['q_title']    ?? ''));
    $qProject  = trim((string)($_GET['q_project']  ?? ''));
    $fClient   = trim((string)($_GET['f_client']   ?? ''));
    $fProject  = trim((string)($_GET['f_project']  ?? ''));
    $fStatus   = trim((string)($_GET['f_status']   ?? ''));
    $fUrgency  = trim((string)($_GET['f_urgency']  ?? ''));
    $fType     = trim((string)($_GET['f_type']     ?? ''));
    $fAssignee = trim((string)($_GET['f_assignee'] ?? ''));
    $fromDue   = trim((string)($_GET['from_due']   ?? ''));
    $toDue     = trim((string)($_GET['to_due']     ?? ''));
    $qGlobal   = trim((string)($_GET['q']          ?? ''));

    $tArchived = ($_GET['t_archived'] ?? '') === '1';
    // FIX: My Tasks now defaults to OFF
    $tMyTasks  = ($_GET['t_mine']     ?? '') === '1';
    $tUrgent   = ($_GET['t_urgent']   ?? '') === '1';

    // Default sort: due_date, then urgency
    $sort = $_GET['sort'] ?? 'due_date';
    $dir  = ($_GET['dir'] ?? 'asc') === 'desc' ? 'DESC' : 'ASC';
    $allowed = ['title','due_date','created_at','urgency_sort','status_sort'];
    if (!in_array($sort, $allowed, true)) $sort = 'due_date';

    $where  = ['t.deleted_at IS NULL'];
    $params = [];

    $where[] = $tArchived ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL';
    if ($tMyTasks) { $where[] = 't.assignee_user_id = :myuid'; $params[':myuid'] = $uid; }
    if ($tUrgent)  { $where[] = "sv_u.key_name = 'urgent'"; }

    // FIX (round 32): named placeholders cannot be reused — split into 4 distinct names
    if ($qGlobal  !== '') {
        $where[] = '(t.title LIKE :qg1 OR t.description LIKE :qg2 OR p.name LIKE :qg3 OR cl.name LIKE :qg4)';
        $params[':qg1'] = '%'.$qGlobal.'%';
        $params[':qg2'] = '%'.$qGlobal.'%';
        $params[':qg3'] = '%'.$qGlobal.'%';
        $params[':qg4'] = '%'.$qGlobal.'%';
    }
    if ($qTitle   !== '') { $where[] = 't.title LIKE :qt'; $params[':qt'] = '%'.$qTitle.'%'; }
    if ($qProject !== '') { $where[] = 'p.name LIKE :qp';  $params[':qp'] = '%'.$qProject.'%'; }

    if ($fClient  !== '') { $where[] = 'p.client_id = :fcl'; $params[':fcl'] = (int)$fClient; }
    if ($fProject !== '') { $where[] = 't.project_id = :fp'; $params[':fp']  = (int)$fProject; }

    // FIX (round 13): use named placeholders only — PDO can't mix positional and named in one query
    $phCounter = 0;
    foreach (['f_status'=>'t.status_value_id', 'f_urgency'=>'t.urgency_value_id', 'f_type'=>'t.type_value_id'] as $k => $col) {
        $v = trim((string)($_GET[$k] ?? ''));
        if ($v === '') continue;
        $ids = array_filter(explode(',', $v));
        if (!$ids) continue;
        $placeholders = [];
        foreach ($ids as $id) {
            $name = ':inph_' . (++$phCounter);
            $placeholders[] = $name;
            $params[$name]  = (int)$id;
        }
        $where[] = "$col IN (" . implode(',', $placeholders) . ")";
    }
    if ($fAssignee !== '' && !$tMyTasks) {
        $ids = array_filter(explode(',', $fAssignee));
        if ($ids) {
            $placeholders = [];
            foreach ($ids as $id) {
                $name = ':inph_' . (++$phCounter);
                $placeholders[] = $name;
                $params[$name]  = (int)$id;
            }
            $where[] = "t.assignee_user_id IN (" . implode(',', $placeholders) . ")";
        }
    }
    if ($fromDue !== '') { $where[] = 't.due_date >= :fd'; $params[':fd'] = $fromDue; }
    if ($toDue   !== '') { $where[] = 't.due_date <= :td'; $params[':td'] = $toDue; }

    $whereSQL = implode(' AND ', $where);

    // Compound sort — primary is whatever user picked, secondary is urgency
    $sortExprMap = [
        'title'        => 't.title',
        'due_date'     => 't.due_date',
        'created_at'   => 't.created_at',
        'urgency_sort' => 'sv_u.sort_order',
        'status_sort'  => 'sv_s.sort_order',
    ];
    $sortExpr = $sortExprMap[$sort];
    // Compound: primary user choice, secondary urgency (unless already sorting by urgency)
    $orderBy = ($sort === 'urgency_sort')
        ? "$sortExpr $dir, t.due_date ASC"
        : "$sortExpr $dir, sv_u.sort_order ASC";

    $baseSQL = "FROM tasks t
        LEFT JOIN projects p    ON p.id = t.project_id
        LEFT JOIN clients cl    ON cl.id = p.client_id
        LEFT JOIN field_values sv_s ON sv_s.id = t.status_value_id
        LEFT JOIN field_values sv_u ON sv_u.id = t.urgency_value_id
        LEFT JOIN field_values sv_t ON sv_t.id = t.type_value_id
        LEFT JOIN users u       ON u.id = t.assignee_user_id
        WHERE $whereSQL";

    $countSQL = "SELECT COUNT(*) $baseSQL";
    $rowsSQL  = "SELECT t.*, p.name AS project_name, p.client_id, cl.name AS client_name,
                sv_s.label AS status_label, sv_s.color AS status_color,
                sv_u.label AS urgency_label, sv_u.key_name AS urgency_key, sv_u.sort_order AS urgency_sort,
                sv_t.label AS type_label,
                CONCAT(u.first_name,' ',u.last_name) AS assignee_name,
                u.profile_image AS assignee_image,
                (SELECT COUNT(*) FROM task_subtasks st WHERE st.task_id=t.id AND st.deleted_at IS NULL) AS subtask_count,
                (SELECT COUNT(*) FROM task_subtasks st WHERE st.task_id=t.id AND st.deleted_at IS NULL AND st.completed_at IS NOT NULL) AS subtask_done
         $baseSQL
         ORDER BY $orderBy
         LIMIT :lim OFFSET :off";

    $total  = (int)DB::value($countSQL, $params);
    $offset = ($pageNum - 1) * $perPage;
    $rows   = DB::all($rowsSQL, array_merge($params, [':lim' => $perPage, ':off' => $offset]));

    $clients = DB::all("SELECT id, name FROM clients WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY name");
    $projectQuery = "SELECT id, name, client_id, manager_user_id FROM projects WHERE deleted_at IS NULL AND archived_at IS NULL";
    $projectParams = [];
    if ($fClient !== '') {
        $projectQuery .= " AND client_id = :cl";
        $projectParams[':cl'] = (int)$fClient;
    }
    $projectQuery .= " ORDER BY name";
    $projects = DB::all($projectQuery, $projectParams);

    // FIX: include ALL non-deleted users (not just active) — inactive users still own tasks
    $allUsers    = DB::all("SELECT id, first_name, last_name, status, profile_image FROM users WHERE deleted_at IS NULL ORDER BY status='inactive', first_name");
    // Only active users for the new-task assignee dropdown
    $activeUsers = array_values(array_filter($allUsers, fn($u) => $u['status'] !== 'inactive'));

    $statusValues = field_values('task_status');
    $urgValues    = field_values('task_urgency');
    $typeValues   = field_values('task_type');

    // Debug mode (admin only)
    $debug = null;
    if (isset($_GET['debug']) && Perm::isAdmin()) {
        $debug = [
            'sort_expr'  => $orderBy,
            'where_sql'  => $whereSQL,
            'params'     => $params,
            'count'      => $total,
            'rows_count' => count($rows),
            'count_sql'  => $countSQL,
        ];
    }

    render('tasks_list', [
        'pageTitle'    => 'Tasks',
        'rows'         => $rows,
        'total'        => $total,
        'perPage'      => $perPage,
        'pageNum'      => $pageNum,
        'sort'         => $sort,
        'dir'          => strtolower($dir),
        'tArchived'    => $tArchived,
        'tMyTasks'     => $tMyTasks,
        'tUrgent'      => $tUrgent,
        'fClient'      => $fClient,
        'fProject'     => $fProject,
        'allClients'   => $clients,
        'projects'     => $projects,
        'users'        => $activeUsers,    // for new task assignee dropdown
        'allUsers'     => $allUsers,        // for column filter (includes inactive)
        'statusValues' => $statusValues,
        'urgValues'    => $urgValues,
        'typeValues'   => $typeValues,
        'currentUserId'=> $uid,
        'debug'        => $debug,
    ]);
    } catch (\Throwable $e) {
        while (ob_get_level() > 0) ob_end_clean();
        http_response_code(500);
        echo '<!doctype html><html><head><title>Task List Error</title>';
        echo '<style>body{font-family:system-ui,sans-serif;background:#1a0d2e;color:#fff;padding:30px;max-width:900px;margin:auto}';
        echo 'h1{color:#f87171}pre{background:rgba(0,0,0,.3);padding:14px;border-radius:8px;font-size:11px;white-space:pre-wrap;line-height:1.7}';
        echo '.box{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);padding:14px;border-radius:8px;font-family:ui-monospace,monospace;font-size:12px;line-height:1.7;margin-bottom:14px}';
        echo '</style></head><body>';
        echo '<h1>Task List Error</h1>';
        echo '<div class="box">';
        echo '<div><strong>Type:</strong> ' . htmlspecialchars(get_class($e)) . '</div>';
        echo '<div><strong>Message:</strong> ' . htmlspecialchars($e->getMessage()) . '</div>';
        echo '<div><strong>File:</strong> ' . htmlspecialchars($e->getFile()) . ' line ' . $e->getLine() . '</div>';
        echo '<div><strong>Query string:</strong> ' . htmlspecialchars($_SERVER['QUERY_STRING'] ?? '') . '</div>';
        echo '</div>';
        echo '<details open><summary style="cursor:pointer;color:#a78bfa">Stack trace</summary>';
        echo '<pre>' . htmlspecialchars($e->getTraceAsString()) . '</pre></details>';
        echo '<p style="margin-top:16px;font-size:12px;color:rgba(255,255,255,.6)">Copy this error and share to debug.</p>';
        echo '</body></html>';
        restore_error_handler();
        exit;
    }
}

function handle_save(): void
{
    Perm::require('tasks.create');
    header('Content-Type: application/json');

    if (!_user_is_clocked_in()) {
        echo json_encode(['ok'=>false,'message'=>'You must be clocked in to save tasks.','reason'=>'not_clocked_in']);
        exit;
    }

    $id        = input_int('id', 0);
    $title     = trim((string)input('title', ''));
    $projectId = input_int('project_id', 0);
    $errors    = [];
    if ($title === '') $errors['title']      = 'Task title is required.';
    if (!$projectId)   $errors['project_id'] = 'Please select a project.';
    if ($errors) { echo json_encode(['ok'=>false,'errors'=>$errors]); exit; }

    $assignee = input_int('assignee_user_id') ?: null;
    if (!$assignee) {
        $proj = DB::row('SELECT manager_user_id FROM projects WHERE id=:id', ['id'=>$projectId]);
        $assignee = $proj['manager_user_id'] ?? Auth::id();
    }

    // For inline-add: if no status provided, default to 'pending'
    $statusId = input_int('status_value_id') ?: null;
    if (!$statusId) {
        $pending = DB::value(
            "SELECT fv.id FROM field_values fv
             JOIN fields f ON f.id=fv.field_id
             WHERE f.key_name='task_status' AND fv.key_name='pending' AND fv.deleted_at IS NULL
             LIMIT 1"
        );
        if ($pending) $statusId = (int)$pending;
    }

    $data = [
        'project_id'       => $projectId,
        'title'            => $title,
        'description'      => trim((string)input('description', '')),
        'status_value_id'  => $statusId,
        'type_value_id'    => input_int('type_value_id')    ?: null,
        'urgency_value_id' => input_int('urgency_value_id') ?: null,
        'due_date'         => input('due_date', '') ?: null,
        'assignee_user_id' => $assignee,
        'actual_minutes'   => parse_duration((string)input('actual_minutes', '')) ?? 0,
    ];

    if (Perm::isAdmin()) {
        $data['estimated_minutes'] = parse_duration((string)input('estimated_minutes', ''));
    }

    if ($id) {
        Perm::require('tasks.edit');
        $old = DB::row('SELECT * FROM tasks WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]);
        if (!$old) { echo json_encode(['ok'=>false,'message'=>'Task not found.']); exit; }
        DB::update('tasks', $data, ['id'=>$id]);
        Audit::log('update','task',$id,"Updated: $title", Audit::diff($old,$data));
        echo json_encode(['ok'=>true,'message'=>'Task updated.','task_id'=>$id]);
    } else {
        $data['created_by'] = Auth::id();
        $newId = DB::insert('tasks', $data);
        Audit::log('create','task',$newId,"Created: $title");

        // ROUND 23: auto-message the assignee on creation
        if (!empty($data['assignee_user_id']) && (int)$data['assignee_user_id'] !== Auth::id()) {
            $actor = DB::row('SELECT first_name, last_name FROM users WHERE id=:id', ['id' => Auth::id()]);
            $actorName = $actor
                ? trim(($actor['first_name'] ?? '') . ' ' . ($actor['last_name'] ?? ''))
                : 'Someone';
            DB::insert('task_notes', [
                'task_id'          => $newId,
                'body'             => $actorName . ' assigned this task to you.',
                'assigned_user_id' => (int)$data['assignee_user_id'],
                'created_by'       => Auth::id(),
                'is_message'       => 1,
            ]);
        }

        echo json_encode([
            'ok'          => true,
            'message'     => 'Task created.',
            'task_id'     => $newId,
            'task_title'  => $title,
            'assignee_id' => $assignee,
        ]);
    }
    exit;
}

function handle_delete(): void
{
    Perm::require('tasks.delete');
    header('Content-Type: application/json');
    if (!_user_is_clocked_in()) {
        echo json_encode(['ok'=>false,'message'=>'You must be clocked in.','reason'=>'not_clocked_in']);
        exit;
    }
    $id  = input_int('id', 0);
    $row = $id ? DB::row('SELECT title FROM tasks WHERE id=:id AND deleted_at IS NULL',['id'=>$id]) : null;
    if (!$row) { echo json_encode(['ok'=>false,'message'=>'Task not found.']); exit; }
    DB::softDelete('tasks', $id);
    Audit::log('delete','task',$id,'Deleted: '.$row['title']);
    echo json_encode(['ok'=>true,'message'=>'Task deleted.']);
    exit;
}

function handle_archive(): void
{
    Perm::require('tasks.archive');
    header('Content-Type: application/json');
    if (!_user_is_clocked_in()) {
        echo json_encode(['ok'=>false,'message'=>'You must be clocked in.','reason'=>'not_clocked_in']);
        exit;
    }
    $id  = input_int('id', 0);
    $row = $id ? DB::row('SELECT title,archived_at FROM tasks WHERE id=:id AND deleted_at IS NULL',['id'=>$id]) : null;
    if (!$row) { echo json_encode(['ok'=>false,'message'=>'Task not found.']); exit; }
    if ($row['archived_at']) {
        DB::unarchive('tasks',$id);
        Audit::log('unarchive','task',$id,'Unarchived: '.$row['title']);
        echo json_encode(['ok'=>true,'message'=>'Task restored.']);
    } else {
        DB::archive('tasks',$id);
        Audit::log('archive','task',$id,'Archived: '.$row['title']);
        echo json_encode(['ok'=>true,'message'=>'Task archived.']);
    }
    exit;
}

function handle_shelf(): void
{
    // ROUND 14: force error display for this endpoint so we never get blank 500s
    ini_set('display_errors', '1');
    ini_set('display_startup_errors', '1');
    error_reporting(E_ALL);

    // Convert PHP errors to exceptions so try/catch catches them
    set_error_handler(function($severity, $message, $file, $line) {
        if (!(error_reporting() & $severity)) return false;
        throw new ErrorException($message, 0, $severity, $file, $line);
    });

    try {
        Perm::require('tasks.view');
    $id   = input_int('id', 0);
    $task = $id ? DB::row(
        "SELECT t.*, p.name AS project_name, p.client_id,
                cl.name AS client_name, cl.timezone AS client_timezone,
                sv_s.label AS status_label, sv_s.color AS status_color,
                sv_u.label AS urgency_label, sv_u.key_name AS urgency_key,
                sv_t.label AS type_label,
                CONCAT(u.first_name,' ',u.last_name) AS assignee_name,
                u.profile_image AS assignee_image,
                CONCAT(c.first_name,' ',c.last_name) AS creator_name
         FROM tasks t
         LEFT JOIN projects p   ON p.id = t.project_id
         LEFT JOIN clients cl   ON cl.id = p.client_id
         LEFT JOIN field_values sv_s ON sv_s.id = t.status_value_id
         LEFT JOIN field_values sv_u ON sv_u.id = t.urgency_value_id
         LEFT JOIN field_values sv_t ON sv_t.id = t.type_value_id
         LEFT JOIN users u ON u.id = t.assignee_user_id
         LEFT JOIN users c ON c.id = t.created_by
         WHERE t.id=:id AND t.deleted_at IS NULL", ['id'=>$id]
    ) : null;
    if (!$task) { echo '<div style="padding:40px;text-align:center;color:var(--text-muted)">Task not found.</div>'; exit; }

    $notes    = tasks_get_notes($id);
    $subtasks = DB::all(
        "SELECT s.*, CONCAT(u.first_name,' ',u.last_name) AS assignee_name,
                sv.label AS status_label, sv.color AS status_color, sv.key_name AS status_key
         FROM task_subtasks s
         LEFT JOIN users u        ON u.id = s.assignee_user_id
         LEFT JOIN field_values sv ON sv.id = s.status_value_id
         WHERE s.task_id=:tid AND s.deleted_at IS NULL
         ORDER BY s.sort_order, s.created_at",
        [':tid' => $id]
    );

    $totalEstimated = (int)($task['estimated_minutes'] ?? 0);
    $totalActual    = (int)($task['actual_minutes'] ?? 0);
    foreach ($subtasks as $s) {
        $totalEstimated += (int)($s['estimated_minutes'] ?? 0);
        $totalActual    += (int)($s['actual_minutes']    ?? 0);
    }

    $users        = DB::all("SELECT id,first_name,last_name,profile_image FROM users WHERE deleted_at IS NULL AND status='active' ORDER BY first_name");
    $projects     = DB::all("SELECT id,name FROM projects WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY name");
    $statusValues = field_values('task_status');
    $urgValues    = field_values('task_urgency');
    $typeValues   = field_values('task_type');
    $isAdmin      = Perm::isAdmin();

    // Buffer output so we can show a clean error if the view throws
    ob_start();
    try {
        $_shelfPath = VIEWS_PATH . '/tasks_shelf.php';
        if (!file_exists($_shelfPath)) {
            throw new RuntimeException('tasks_shelf.php is missing from views/ directory.');
        }
        require $_shelfPath;
    } catch (\Throwable $e) {
        ob_end_clean();
        echo '<div style="padding:30px;color:#fff">';
        echo '<h2 style="color:var(--danger);margin:0 0 12px">Task shelf error</h2>';
        echo '<div style="background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);padding:14px;border-radius:8px;font-family:monospace;font-size:12px;line-height:1.6">';
        echo '<strong>Message:</strong> ' . htmlspecialchars($e->getMessage()) . '<br>';
        echo '<strong>File:</strong> ' . htmlspecialchars($e->getFile()) . ':' . $e->getLine() . '<br>';
        echo '<strong>Trace:</strong><pre style="white-space:pre-wrap;margin:8px 0 0;font-size:11px">' . htmlspecialchars($e->getTraceAsString()) . '</pre>';
        echo '</div>';
        echo '<p style="margin-top:14px;font-size:12px;color:var(--text-muted)">Share this message with support to debug.</p>';
        echo '</div>';
        exit;
    }
        ob_end_flush();
        exit;
    } catch (\Throwable $e) {
        // Clean any buffered output
        while (ob_get_level() > 0) ob_end_clean();
        http_response_code(200);  // 200 so JS shows our error UI not browser's
        echo '<div style="padding:30px;color:#fff;font-family:system-ui,sans-serif">';
        echo '<h2 style="color:#f87171;margin:0 0 12px">Task Shelf Fatal Error</h2>';
        echo '<div style="background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);padding:14px;border-radius:8px;font-family:ui-monospace,monospace;font-size:12px;line-height:1.7">';
        echo '<div><strong>Type:</strong> ' . htmlspecialchars(get_class($e)) . '</div>';
        echo '<div><strong>Message:</strong> ' . htmlspecialchars($e->getMessage()) . '</div>';
        echo '<div><strong>File:</strong> ' . htmlspecialchars($e->getFile()) . ' line ' . $e->getLine() . '</div>';
        if (method_exists($e, 'getCode') && $e->getCode()) {
            echo '<div><strong>Code:</strong> ' . htmlspecialchars((string)$e->getCode()) . '</div>';
        }
        echo '<details style="margin-top:10px"><summary style="cursor:pointer;color:#a78bfa">Stack trace</summary>';
        echo '<pre style="white-space:pre-wrap;margin:8px 0 0;font-size:11px;background:rgba(0,0,0,.3);padding:10px;border-radius:6px">';
        echo htmlspecialchars($e->getTraceAsString());
        echo '</pre></details>';
        echo '</div>';
        echo '<p style="margin-top:16px;font-size:12px;color:rgba(255,255,255,.6)">Copy this error and share to debug.</p>';
        echo '</div>';
        restore_error_handler();
        exit;
    }
}

/**
 * ROUND 14 — schema/sanity diagnostics endpoint
 * Visit /index.php?p=tasks&action=diag to see schema status
 */
function handle_diag(): void
{
    Perm::require('tasks.view');
    header('Content-Type: text/html');
    ini_set('display_errors', '1');
    error_reporting(E_ALL);

    $checks = [];

    // Required tables for the task shelf
    $tables = ['tasks', 'projects', 'clients', 'field_values', 'users',
               'task_notes', 'note_attachments', 'task_subtasks',
               'task_emails', 'email_attachments', 'time_sessions',
               'time_breaks', 'audit_logs'];

    foreach ($tables as $t) {
        try {
            $count = DB::value("SELECT COUNT(*) FROM `$t`");
            $checks[] = ['name' => "Table `$t`", 'ok' => true, 'detail' => "$count rows"];
        } catch (\Throwable $e) {
            $checks[] = ['name' => "Table `$t`", 'ok' => false, 'detail' => $e->getMessage()];
        }
    }

    // Required columns
    $cols = [
        'clients.timezone',
        'users.timezone',
        'tasks.estimated_minutes',
        'tasks.actual_minutes',
        'task_subtasks.estimated_minutes',
        'task_subtasks.actual_minutes',
    ];
    foreach ($cols as $c) {
        [$table, $col] = explode('.', $c);
        try {
            DB::value("SELECT `$col` FROM `$table` LIMIT 1");
            $checks[] = ['name' => "Column `$c`", 'ok' => true, 'detail' => 'exists'];
        } catch (\Throwable $e) {
            $checks[] = ['name' => "Column `$c`", 'ok' => false, 'detail' => 'MISSING — ' . $e->getMessage()];
        }
    }

    // Try the actual shelf queries with task id 1 (or any task)
    try {
        $someTaskId = (int)DB::value("SELECT id FROM tasks WHERE deleted_at IS NULL LIMIT 1");
        if ($someTaskId) {
            $task = DB::row(
                "SELECT t.*, p.name AS project_name, p.client_id,
                        cl.name AS client_name, cl.timezone AS client_timezone,
                        sv_s.label AS status_label, sv_s.color AS status_color,
                        sv_u.label AS urgency_label, sv_u.key_name AS urgency_key,
                        sv_t.label AS type_label,
                        CONCAT(u.first_name,' ',u.last_name) AS assignee_name,
                        CONCAT(c.first_name,' ',c.last_name) AS creator_name
                 FROM tasks t
                 LEFT JOIN projects p   ON p.id = t.project_id
                 LEFT JOIN clients cl   ON cl.id = p.client_id
                 LEFT JOIN field_values sv_s ON sv_s.id = t.status_value_id
                 LEFT JOIN field_values sv_u ON sv_u.id = t.urgency_value_id
                 LEFT JOIN field_values sv_t ON sv_t.id = t.type_value_id
                 LEFT JOIN users u ON u.id = t.assignee_user_id
                 LEFT JOIN users c ON c.id = t.created_by
                 WHERE t.id=:id AND t.deleted_at IS NULL", ['id'=>$someTaskId]);
            $checks[] = ['name' => 'Main shelf query', 'ok' => (bool)$task, 'detail' => $task ? 'OK' : 'returned null'];
        }
    } catch (\Throwable $e) {
        $checks[] = ['name' => 'Main shelf query', 'ok' => false, 'detail' => $e->getMessage()];
    }

    // Render
    echo '<!doctype html><html><head><title>Task Shelf Diagnostics</title>';
    echo '<style>body{font-family:system-ui,sans-serif;background:#1a0d2e;color:#fff;padding:30px;max-width:900px;margin:auto}';
    echo 'h1{color:#a78bfa}table{width:100%;border-collapse:collapse;margin-top:20px}';
    echo 'td{padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.1);font-size:13px;vertical-align:top}';
    echo '.ok{color:#22c55e}.bad{color:#f87171}.muted{color:rgba(255,255,255,.5);font-size:11px}';
    echo '</style></head><body>';
    echo '<h1>Task Shelf Diagnostics</h1>';
    echo '<p class="muted">Checks every table, column, and query the task shelf depends on. Red rows show what needs fixing.</p>';
    echo '<table>';
    foreach ($checks as $c) {
        $icon = $c['ok'] ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>';
        echo '<tr><td style="width:30px">' . $icon . '</td>';
        echo '<td><strong>' . htmlspecialchars($c['name']) . '</strong></td>';
        echo '<td class="' . ($c['ok'] ? 'muted' : 'bad') . '">' . htmlspecialchars($c['detail']) . '</td></tr>';
    }
    echo '</table>';
    echo '</body></html>';
    exit;
}

function handle_add_note(): void
{
    Perm::require('tasks.view');
    header('Content-Type: application/json');
    if (!_user_is_clocked_in()) {
        echo json_encode(['ok'=>false,'message'=>'You must be clocked in.','reason'=>'not_clocked_in']);
        exit;
    }
    $taskId    = input_int('task_id', 0);
    $subtaskId = input_int('subtask_id', 0) ?: null;
    $body      = trim((string)input('note_body', ''));
    $timeMin   = parse_duration((string)input('time_spent', ''));
    if ($timeMin !== null && $timeMin <= 0) $timeMin = null;

    if (!$taskId) { echo json_encode(['ok'=>false,'message'=>'Task ID required.']); exit; }
    $task = DB::row('SELECT id FROM tasks WHERE id=:id AND deleted_at IS NULL',['id'=>$taskId]);
    if (!$task) { echo json_encode(['ok'=>false,'message'=>'Task not found.']); exit; }

    if ($subtaskId) {
        $st = DB::row('SELECT id FROM task_subtasks WHERE id=:id AND task_id=:tid AND deleted_at IS NULL',
                      ['id'=>$subtaskId, 'tid'=>$taskId]);
        if (!$st) { $subtaskId = null; }
    }

    $hasAttachments = !empty($_FILES['attachments']['name'][0] ?? '');
    if ($body === '' && !$hasAttachments && $timeMin === null) {
        echo json_encode(['ok'=>false,'message'=>'Add a message, attachment, or time.']);
        exit;
    }

    $assignedTo = input_int('assigned_user_id',0) ?: null;
    $uid = Auth::id();
    $noteId = DB::insert('task_notes',[
        'task_id'          => $taskId,
        'subtask_id'       => $subtaskId,
        'body'             => $body,
        'time_minutes'     => $timeMin,
        'time_logged_by'   => $timeMin ? $uid : null,
        'assigned_user_id' => $assignedTo,
        'created_by'       => $uid,
        'is_message'       => $assignedTo ? 1 : 0,
    ]);

    if ($timeMin) {
        DB::run('UPDATE tasks SET actual_minutes = COALESCE(actual_minutes,0) + :m WHERE id = :id',
                [':m' => $timeMin, ':id' => $taskId]);
        if ($subtaskId) {
            DB::run('UPDATE task_subtasks SET actual_minutes = COALESCE(actual_minutes,0) + :m WHERE id = :id',
                    [':m' => $timeMin, ':id' => $subtaskId]);
        }
    }

    // Handle attachments
    if ($hasAttachments) {
        $files = $_FILES['attachments'];
        $count = count($files['name']);
        for ($i = 0; $i < $count; $i++) {
            if (($files['error'][$i] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
            $single = [
                'name'     => $files['name'][$i],
                'type'     => $files['type'][$i],
                'tmp_name' => $files['tmp_name'][$i],
                'error'    => $files['error'][$i],
                'size'     => $files['size'][$i],
            ];
            try {
                $r = Storage::putUpload($single, 'notes');
                // FIX (round 18): use actual schema column names
                DB::insert('note_attachments', [
                    'note_id'        => $noteId,
                    'original_name'  => $single['name'],
                    'file_name'      => basename($r['path']),
                    'storage_path'   => $r['path'],
                    'mime_type'      => $single['type'],
                    'file_size'      => $single['size'],
                    'storage_driver' => $r['driver'] ?? 'local',
                    'uploaded_by'    => Auth::id(),
                ]);
            } catch (Throwable $e) {
                error_log('[note_attachment_fail] ' . $e->getMessage() . ' for ' . ($single['name'] ?? '?'));
            }
        }
    }

    Audit::log('create','task_note',$taskId,'Added note to task #'.$taskId);

    // ROUND 24: auto-notify the OTHER party if this is a "general note" (not already a directed message).
    // If the current user is the task creator, notify the assignee.
    // If the current user is the assignee, notify the creator.
    // If they're the same person or no assignee, no auto-notify.
    if (!$assignedTo) {
        $taskRec = DB::row('SELECT assignee_user_id, created_by, title FROM tasks WHERE id = :id', ['id' => $taskId]);
        if ($taskRec) {
            $notifyTargetId = null;
            if ((int)$taskRec['created_by'] === $uid && !empty($taskRec['assignee_user_id'])) {
                $notifyTargetId = (int)$taskRec['assignee_user_id'];
            } elseif ((int)($taskRec['assignee_user_id'] ?? 0) === $uid && !empty($taskRec['created_by'])) {
                $notifyTargetId = (int)$taskRec['created_by'];
            }
            // Don't notify yourself
            if ($notifyTargetId && $notifyTargetId !== $uid) {
                $actor = DB::row('SELECT first_name, last_name FROM users WHERE id=:id', ['id' => $uid]);
                $actorName = $actor
                    ? trim(($actor['first_name'] ?? '') . ' ' . ($actor['last_name'] ?? ''))
                    : 'Someone';
                $preview = mb_substr($body, 0, 80);
                if (mb_strlen($body) > 80) $preview .= '…';
                DB::insert('task_notes', [
                    'task_id'          => $taskId,
                    'body'             => $actorName . ' replied: "' . $preview . '"',
                    'assigned_user_id' => $notifyTargetId,
                    'created_by'       => $uid,
                    'is_message'       => 1,
                ]);
            }
        }
    }

    echo json_encode(['ok'=>true,'message'=>'Note added.']);
    exit;
}

function handle_notes_partial(): void
{
    Perm::require('tasks.view');
    $id    = input_int('id', 0);
    $notes = tasks_get_notes($id);
    require VIEWS_PATH . '/tasks_notes_partial.php';
    exit;
}

function handle_delete_note(): void
{
    Perm::require('tasks.edit');
    header('Content-Type: application/json');
    $id = input_int('id', 0);
    $note = $id ? DB::row('SELECT * FROM task_notes WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]) : null;
    if (!$note) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
    if ($note['created_by'] != Auth::id() && !Perm::isAdmin()) {
        echo json_encode(['ok'=>false,'message'=>'You can only delete your own notes.']);
        exit;
    }
    if (!empty($note['time_minutes'])) {
        $delta = (int)$note['time_minutes'];
        DB::run('UPDATE tasks SET actual_minutes = GREATEST(0, COALESCE(actual_minutes,0) - :m) WHERE id = :id',
                [':m' => $delta, ':id' => $note['task_id']]);
        if (!empty($note['subtask_id'])) {
            DB::run('UPDATE task_subtasks SET actual_minutes = GREATEST(0, COALESCE(actual_minutes,0) - :m) WHERE id = :id',
                    [':m' => $delta, ':id' => $note['subtask_id']]);
        }
    }
    DB::softDelete('task_notes', $id);
    Audit::log('delete','task_note',$id,'Deleted note' . (!empty($note['time_minutes']) ? ' (removed ' . fmt_duration((int)$note['time_minutes']) . ')' : ''));
    echo json_encode(['ok'=>true,'message'=>'Note deleted.']);
    exit;
}

function handle_save_subtask(): void
{
    Perm::require('tasks.edit');
    header('Content-Type: application/json');
    if (!_user_is_clocked_in()) {
        echo json_encode(['ok'=>false,'message'=>'You must be clocked in.','reason'=>'not_clocked_in']);
        exit;
    }
    $taskId  = input_int('task_id', 0);
    $id      = input_int('id', 0);
    $title   = trim((string)input('title', ''));
    if (!$taskId || $title === '') { echo json_encode(['ok'=>false,'message'=>'Title required.']); exit; }
    $task = DB::row('SELECT id FROM tasks WHERE id=:id AND deleted_at IS NULL', ['id'=>$taskId]);
    if (!$task) { echo json_encode(['ok'=>false,'message'=>'Task not found.']); exit; }

    // ROUND 19: build data only from fields that were actually submitted
    //   Allows partial updates (e.g. quick-add title only, or inline title edit)
    $data = ['title' => $title];

    if (isset($_POST['status_value_id']))   $data['status_value_id']  = input_int('status_value_id') ?: null;
    if (isset($_POST['assignee_user_id']))  $data['assignee_user_id'] = input_int('assignee_user_id') ?: null;
    if (isset($_POST['due_date']))          $data['due_date']         = input('due_date', '') ?: null;
    if (isset($_POST['actual_minutes']))    $data['actual_minutes']   = parse_duration((string)input('actual_minutes','')) ?? 0;
    if (isset($_POST['sort_order']))        $data['sort_order']       = input_int('sort_order', 0);
    if (isset($_POST['estimated_minutes']) && Perm::isAdmin()) {
        $data['estimated_minutes'] = parse_duration((string)input('estimated_minutes',''));
    }

    if ($id) {
        $old = DB::row('SELECT * FROM task_subtasks WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]);
        if (!$old) { echo json_encode(['ok'=>false,'message'=>'Subtask not found.']); exit; }
        DB::update('task_subtasks', $data, ['id'=>$id]);
        Audit::log('update','subtask',$id,"Updated subtask: $title");
        echo json_encode(['ok'=>true,'message'=>'Subtask updated.','subtask_id'=>$id]);
    } else {
        // For NEW subtasks, ensure task_id is set
        $data['task_id']    = $taskId;
        $data['created_by'] = Auth::id();
        $newId = DB::insert('task_subtasks', $data);
        Audit::log('create','subtask',$newId,"Created subtask: $title");
        echo json_encode(['ok'=>true,'message'=>'Subtask added.','subtask_id'=>$newId]);
    }
    exit;
}

function handle_toggle_subtask(): void
{
    Perm::require('tasks.edit');
    header('Content-Type: application/json');
    if (!_user_is_clocked_in()) {
        echo json_encode(['ok'=>false,'message'=>'You must be clocked in.','reason'=>'not_clocked_in']);
        exit;
    }
    $id  = input_int('id', 0);
    $sub = $id ? DB::row('SELECT * FROM task_subtasks WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]) : null;
    if (!$sub) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
    $done = !$sub['completed_at'];
    DB::update('task_subtasks', [
        'completed_at' => $done ? date('Y-m-d H:i:s') : null,
    ], ['id'=>$id]);
    Audit::log('update','subtask',$id, $done ? 'Marked done' : 'Marked open');
    echo json_encode(['ok'=>true,'completed'=>$done]);
    exit;
}

function handle_delete_subtask(): void
{
    Perm::require('tasks.edit');
    header('Content-Type: application/json');
    $id  = input_int('id', 0);
    $sub = $id ? DB::row('SELECT title FROM task_subtasks WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]) : null;
    if (!$sub) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
    DB::softDelete('task_subtasks', $id);
    Audit::log('delete','subtask',$id,'Deleted: '.$sub['title']);
    echo json_encode(['ok'=>true,'message'=>'Subtask deleted.']);
    exit;
}

function handle_subtasks_partial(): void
{
    Perm::require('tasks.view');
    $taskId = input_int('id', 0);
    $isAdmin = Perm::isAdmin();
    $subtasks = DB::all(
        "SELECT s.*, CONCAT(u.first_name,' ',u.last_name) AS assignee_name,
                sv.label AS status_label, sv.color AS status_color, sv.key_name AS status_key
         FROM task_subtasks s
         LEFT JOIN users u        ON u.id = s.assignee_user_id
         LEFT JOIN field_values sv ON sv.id = s.status_value_id
         WHERE s.task_id=:tid AND s.deleted_at IS NULL
         ORDER BY s.sort_order, s.created_at",
        [':tid' => $taskId]
    );
    $task = DB::row('SELECT estimated_minutes, actual_minutes FROM tasks WHERE id=:id', ['id'=>$taskId]);
    $totalEst = (int)($task['estimated_minutes'] ?? 0);
    $totalAct = (int)($task['actual_minutes'] ?? 0);
    foreach ($subtasks as $s) {
        $totalEst += (int)($s['estimated_minutes'] ?? 0);
        $totalAct += (int)($s['actual_minutes'] ?? 0);
    }
    require VIEWS_PATH . '/tasks_subtasks_partial.php';
    exit;
}

/* ============================================================
   Helpers
   ============================================================ */

function tasks_get_notes(int $taskId): array
{
    $uid = Auth::id();
    // FIX (round 15): named placeholders cannot be reused — use distinct names
    DB::run(
        "UPDATE task_notes SET read_at=NOW(), read_by_user_id=:uid_set
         WHERE task_id=:tid AND assigned_user_id=:uid_where AND read_at IS NULL",
        [':uid_set'=>$uid, ':uid_where'=>$uid, ':tid'=>$taskId]
    );
    $notes = DB::all(
        "SELECT n.*, CONCAT(uc.first_name,' ',uc.last_name) AS author_name,
                uc.profile_image AS author_image,
                CONCAT(ua.first_name,' ',ua.last_name) AS assigned_name,
                CONCAT(ul.first_name,' ',ul.last_name) AS time_logger_name,
                st.title AS subtask_title
         FROM task_notes n
         LEFT JOIN users uc        ON uc.id = n.created_by
         LEFT JOIN users ua        ON ua.id = n.assigned_user_id
         LEFT JOIN users ul        ON ul.id = n.time_logged_by
         LEFT JOIN task_subtasks st ON st.id = n.subtask_id
         WHERE n.task_id=:tid AND n.deleted_at IS NULL
         ORDER BY n.created_at ASC",
        [':tid'=>$taskId]
    );

    if (empty($notes)) return [];

    // Load attachments per note in one query
    $noteIds = array_column($notes, 'id');
    $ph = implode(',', array_fill(0, count($noteIds), '?'));
    $atts = DB::all(
        "SELECT * FROM note_attachments WHERE note_id IN ($ph) ORDER BY id",
        $noteIds
    );
    $attsByNote = [];
    foreach ($atts as $a) $attsByNote[$a['note_id']][] = $a;
    foreach ($notes as &$n) {
        $n['attachments'] = $attsByNote[$n['id']] ?? [];
    }
    return $notes;
}

function _user_is_clocked_in(): bool
{
    // Admins may bypass clock-in (for system admin work)
    if (Perm::isAdmin() && input('admin_override') === '1') return true;
    $uid  = Auth::id();
    $open = DB::value('SELECT id FROM time_sessions WHERE user_id=:u AND clock_out_at IS NULL', ['u'=>$uid]);
    return (bool)$open;
}


/* ============================================================
   ROUND 10 — EMAIL HANDLERS
   ============================================================ */

function handle_email_compose_data(): void
{
    Perm::require('tasks.view');
    header('Content-Type: application/json');
    $taskId = input_int('id', 0);
    $task = $taskId ? DB::row(
        "SELECT t.id, t.title, p.client_id
         FROM tasks t LEFT JOIN projects p ON p.id=t.project_id
         WHERE t.id=:id AND t.deleted_at IS NULL", ['id'=>$taskId]
    ) : null;
    if (!$task) { echo json_encode(['ok'=>false,'message'=>'Task not found.']); exit; }

    $contacts = [];
    if ($task['client_id']) {
        $contacts = DB::all(
            "SELECT id, first_name, last_name, email, title
             FROM contacts WHERE client_id=:cid AND deleted_at IS NULL AND archived_at IS NULL AND email != ''
             ORDER BY first_name",
            ['cid' => $task['client_id']]
        );
    }

    $lastEmail = DB::row(
        "SELECT subject, to_addresses FROM task_emails
         WHERE task_id=:tid AND deleted_at IS NULL AND status='sent'
         ORDER BY id DESC LIMIT 1",
        ['tid'=>$taskId]
    );

    $me = Auth::user();
    $s  = settings();

    echo json_encode([
        'ok'           => true,
        'task_title'   => $task['title'],
        'contacts'     => $contacts,
        'last_subject' => $lastEmail['subject'] ?? '',
        'last_to'      => $lastEmail['to_addresses'] ?? '',
        'from_name'    => $s['smtp_from_name']  ?? '',
        'from_email'   => $s['smtp_from_email'] ?? '',
        'sender_name'  => trim(($me['first_name']??'').' '.($me['last_name']??'')),
        'configured'   => !empty($s['smtp_host']) && !empty($s['smtp_from_email']),
    ]);
    exit;
}

function handle_send_email(): void
{
    Perm::require('tasks.view');
    header('Content-Type: application/json');
    if (!_user_is_clocked_in()) {
        echo json_encode(['ok'=>false,'message'=>'You must be clocked in.','reason'=>'not_clocked_in']);
        exit;
    }

    $taskId  = input_int('task_id', 0);
    $to      = trim((string)input('to', ''));
    $cc      = trim((string)input('cc', ''));
    $bcc     = trim((string)input('bcc', ''));
    $subject = trim((string)input('subject', ''));
    $body    = trim((string)input('body', ''));

    $errors = [];
    if (!$taskId)        $errors['task_id'] = 'Task required.';
    if ($to === '')      $errors['to']      = 'At least one recipient is required.';
    if ($subject === '') $errors['subject'] = 'Subject is required.';
    if ($body === '')    $errors['body']    = 'Email body is required.';
    if ($errors) { echo json_encode(['ok'=>false,'errors'=>$errors]); exit; }

    $attachments = [];
    $stagedPaths = [];
    if (!empty($_FILES['attachments']['name'][0] ?? '')) {
        $files = $_FILES['attachments'];
        $count = count($files['name']);
        for ($i = 0; $i < $count; $i++) {
            if (($files['error'][$i] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
            $single = [
                'name'     => $files['name'][$i],
                'type'     => $files['type'][$i],
                'tmp_name' => $files['tmp_name'][$i],
                'error'    => $files['error'][$i],
                'size'     => $files['size'][$i],
            ];
            try {
                $r = Storage::putUpload($single, 'emails');
                $stagedPaths[] = [
                    'path'      => $r['path'],
                    'driver'    => $r['driver'] ?? 'local',
                    'original'  => $single['name'],
                    'mime'      => $single['type'],
                    'size'      => $single['size'],
                ];
                $attachments[] = [
                    'path' => UPLOADS_PATH . '/' . $r['path'],
                    'name' => $single['name'],
                ];
            } catch (Throwable $e) { /* skip */ }
        }
    }

    $result = Mailer::send([
        'to'          => $to,
        'cc'          => $cc ?: null,
        'bcc'         => $bcc ?: null,
        'subject'     => $subject,
        'body'        => $body,
        'attachments' => $attachments,
        'task_id'     => $taskId,
        'sent_by'     => Auth::id(),
    ]);

    if ($result['email_id']) {
        foreach ($stagedPaths as $sp) {
            DB::insert('email_attachments', [
                'email_id'       => $result['email_id'],
                'file_name'      => basename($sp['path']),
                'original_name'  => $sp['original'],
                'mime_type'      => $sp['mime'],
                'file_size'      => $sp['size'],
                'storage_driver' => $sp['driver'],
                'storage_path'   => $sp['path'],
            ]);
        }
    }

    if ($result['ok']) {
        Audit::log('send','email',$result['email_id'] ?? 0, "Sent email: $subject");
        echo json_encode(['ok'=>true,'message'=>'Email sent.']);
    } else {
        echo json_encode(['ok'=>false,'message'=>'Send failed: '.($result['error']??'Unknown error')]);
    }
    exit;
}

function handle_emails_partial(): void
{
    Perm::require('tasks.view');
    $taskId = input_int('id', 0);
    $emails = DB::all(
        "SELECT e.*, CONCAT(u.first_name,' ',u.last_name) AS sender_name, u.profile_image AS sender_image
         FROM task_emails e
         LEFT JOIN users u ON u.id = e.sent_by
         WHERE e.task_id=:tid AND e.deleted_at IS NULL
         ORDER BY e.created_at DESC",
        ['tid' => $taskId]
    );
    $emailIds = array_column($emails, 'id');
    $attsByEmail = [];
    if ($emailIds) {
        $ph = implode(',', array_fill(0, count($emailIds), '?'));
        $atts = DB::all("SELECT * FROM email_attachments WHERE email_id IN ($ph) AND deleted_at IS NULL", $emailIds);
        foreach ($atts as $a) $attsByEmail[$a['email_id']][] = $a;
    }
    foreach ($emails as &$e) {
        $e['attachments'] = $attsByEmail[$e['id']] ?? [];
    }
    require VIEWS_PATH . '/tasks_emails_partial.php';
    exit;
}

/* ============================================================
   ROUND 10 — ACTIVITY LOG
   ============================================================ */

function handle_activity_partial(): void
{
    Perm::require('tasks.view');
    $taskId = input_int('id', 0);
    if (!$taskId) { echo '<div class="muted" style="text-align:center;padding:20px">No activity.</div>'; exit; }

    // FIX (round 15): named placeholders cannot be reused — use distinct names
    $events = DB::all(
        "SELECT a.*, CONCAT(u.first_name,' ',u.last_name) AS actor_name, u.profile_image AS actor_image
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE (
             (a.entity_type='task'      AND a.entity_id=:tid1)
          OR (a.entity_type='task_note' AND a.entity_id=:tid2)
          OR (a.entity_type='subtask'   AND a.entity_id IN (SELECT id FROM task_subtasks WHERE task_id=:tid3))
          OR (a.entity_type='email'     AND a.entity_id IN (SELECT id FROM task_emails   WHERE task_id=:tid4))
         )
         ORDER BY a.created_at DESC
         LIMIT 50",
        [':tid1' => $taskId, ':tid2' => $taskId, ':tid3' => $taskId, ':tid4' => $taskId]
    );
    require VIEWS_PATH . '/tasks_activity_partial.php';
    exit;
}


/* ============================================================
   ROUND 17 — INLINE FIELD UPDATE (single-field PATCH)
   ============================================================ */
function handle_update_field(): void
{
    Perm::require('tasks.edit');
    header('Content-Type: application/json');

    if (!_user_is_clocked_in()) {
        echo json_encode(['ok'=>false,'message'=>'You must be clocked in.','reason'=>'not_clocked_in']);
        exit;
    }

    $taskId = input_int('task_id', 0);
    $field  = trim((string)input('field', ''));
    $value  = input('value', '');

    if (!$taskId) { echo json_encode(['ok'=>false,'message'=>'Task ID required.']); exit; }

    $allowed = ['title', 'description', 'status_value_id', 'urgency_value_id',
                'type_value_id', 'assignee_user_id', 'due_date',
                'estimated_minutes']; // actual_minutes removed (round 21) — set via notes only
    if (!in_array($field, $allowed, true)) {
        echo json_encode(['ok'=>false,'message'=>'Invalid field.']);
        exit;
    }

    if ($field === 'estimated_minutes' && !Perm::isAdmin()) {
        echo json_encode(['ok'=>false,'message'=>'Admin only.']);
        exit;
    }

    $old = DB::row('SELECT * FROM tasks WHERE id=:id AND deleted_at IS NULL', ['id'=>$taskId]);
    if (!$old) { echo json_encode(['ok'=>false,'message'=>'Task not found.']); exit; }

    $normalized = $value;
    if (in_array($field, ['status_value_id', 'urgency_value_id', 'type_value_id', 'assignee_user_id'], true)) {
        $normalized = ((int)$value) ?: null;
    } elseif ($field === 'due_date') {
        $normalized = trim((string)$value) ?: null;
    } elseif ($field === 'title') {
        $normalized = trim((string)$value);
        if ($normalized === '') { echo json_encode(['ok'=>false,'message'=>'Title cannot be empty.']); exit; }
    } elseif (in_array($field, ['estimated_minutes', 'actual_minutes'], true)) {
        $normalized = parse_duration((string)$value);
        if ($normalized === null && trim((string)$value) !== '') {
            echo json_encode(['ok'=>false,'message'=>'Invalid duration format.']); exit;
        }
    } else {
        $normalized = trim((string)$value);
    }

    DB::update('tasks', [$field => $normalized], ['id' => $taskId]);
    Audit::log('update','task',$taskId,"Updated $field", Audit::diff(
        [$field => $old[$field] ?? null],
        [$field => $normalized]
    ));

    // ROUND 23: when assignee changes, auto-create a message note
    // so the new assignee sees an unread message in their inbox.
    if ($field === 'assignee_user_id'
        && $normalized
        && (int)$normalized !== (int)($old['assignee_user_id'] ?? 0)
    ) {
        $actor = DB::row('SELECT first_name, last_name FROM users WHERE id=:id', ['id' => Auth::id()]);
        $actorName = $actor
            ? trim(($actor['first_name'] ?? '') . ' ' . ($actor['last_name'] ?? ''))
            : 'Someone';
        DB::insert('task_notes', [
            'task_id'          => $taskId,
            'body'             => $actorName . ' assigned this task to you.',
            'assigned_user_id' => (int)$normalized,
            'created_by'       => Auth::id(),
            'is_message'       => 1,
        ]);

        // ROUND 24: also notify the PREVIOUS assignee that they no longer hold this task
        $prev = (int)($old['assignee_user_id'] ?? 0);
        if ($prev && $prev !== Auth::id() && $prev !== (int)$normalized) {
            DB::insert('task_notes', [
                'task_id'          => $taskId,
                'body'             => $actorName . ' reassigned this task. It is no longer yours.',
                'assigned_user_id' => $prev,
                'created_by'       => Auth::id(),
                'is_message'       => 1,
            ]);
        }
    }

    // ROUND 24: when status changes to "complete", notify the creator
    if ($field === 'status_value_id' && $normalized) {
        $newStatusKey = DB::value('SELECT key_name FROM field_values WHERE id = :id', ['id' => $normalized]);
        $oldStatusKey = DB::value('SELECT key_name FROM field_values WHERE id = :id', ['id' => $old[$field] ?? 0]);
        if ($newStatusKey === 'complete' && $oldStatusKey !== 'complete') {
            $taskRec = DB::row('SELECT created_by, title FROM tasks WHERE id = :id', ['id' => $taskId]);
            if ($taskRec && (int)$taskRec['created_by'] !== Auth::id()) {
                $actor = DB::row('SELECT first_name, last_name FROM users WHERE id=:id', ['id' => Auth::id()]);
                $actorName = $actor
                    ? trim(($actor['first_name'] ?? '') . ' ' . ($actor['last_name'] ?? ''))
                    : 'Someone';
                DB::insert('task_notes', [
                    'task_id'          => $taskId,
                    'body'             => $actorName . ' marked this task as complete.',
                    'assigned_user_id' => (int)$taskRec['created_by'],
                    'created_by'       => Auth::id(),
                    'is_message'       => 1,
                ]);
            }
        }
    }

    $display = ['value' => $normalized, 'label' => null, 'color' => null, 'key' => null];
    if (in_array($field, ['status_value_id', 'urgency_value_id', 'type_value_id'], true)) {
        if ($normalized) {
            $fv = DB::row('SELECT label, color, key_name FROM field_values WHERE id=:id', ['id'=>$normalized]);
            if ($fv) {
                $display['label'] = $fv['label'];
                $display['color'] = $fv['color'];
                $display['key']   = $fv['key_name'];
            }
        }
    } elseif ($field === 'assignee_user_id') {
        if ($normalized) {
            $u = DB::row('SELECT first_name, last_name, profile_image FROM users WHERE id=:id', ['id'=>$normalized]);
            if ($u) {
                $display['label'] = trim($u['first_name'] . ' ' . $u['last_name']);
                $display['image'] = $u['profile_image'];
            }
        } else {
            $display['label'] = 'Unassigned';
        }
    } elseif ($field === 'due_date') {
        $display['label'] = $normalized ? date('M j, Y', strtotime($normalized)) : null;
        $display['overdue'] = $normalized && (new DateTime($normalized) < new DateTime('today'));
    } elseif (in_array($field, ['estimated_minutes', 'actual_minutes'], true)) {
        $display['label'] = $normalized ? fmt_duration((int)$normalized) : null;
    }

    echo json_encode(['ok'=>true, 'message'=>'Saved.', 'display'=>$display]);
    exit;
}


/* ============================================================
   ROUND 21 — Note editing (24h grace for author, admin anytime)
   ============================================================ */
function handle_edit_note(): void
{
    Perm::require('tasks.view');
    header('Content-Type: application/json');
    if (!_user_is_clocked_in()) {
        echo json_encode(['ok'=>false,'message'=>'You must be clocked in.','reason'=>'not_clocked_in']);
        exit;
    }

    $id = input_int('id', 0);
    $note = $id ? DB::row('SELECT * FROM task_notes WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]) : null;
    if (!$note) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }

    $uid     = Auth::id();
    $isAuthor = ((int)$note['created_by'] === $uid);
    $isAdmin  = Perm::isAdmin();
    $ageHours = (time() - strtotime($note['created_at'])) / 3600;

    if (!$isAdmin) {
        if (!$isAuthor) {
            echo json_encode(['ok'=>false,'message'=>'Only the author can edit this note.']);
            exit;
        }
        if ($ageHours > 24) {
            echo json_encode(['ok'=>false,'message'=>'Edit window has passed (24 hours). Ask an admin to make the change.']);
            exit;
        }
    }

    $newBody    = input('body', null);
    $newTimeRaw = input('time_spent', null);

    $updates = [];

    if ($newBody !== null) {
        $newBody = trim((string)$newBody);
        $updates['body'] = $newBody;
    }

    $timeDelta = 0;
    if ($newTimeRaw !== null) {
        $oldTime = (int)($note['time_minutes'] ?? 0);
        $newTime = parse_duration((string)$newTimeRaw);
        if ($newTime !== null && $newTime <= 0) $newTime = null;
        $newTimeInt = (int)($newTime ?? 0);
        $timeDelta  = $newTimeInt - $oldTime;
        $updates['time_minutes']   = $newTime;
        if ($newTime && empty($note['time_logged_by'])) {
            $updates['time_logged_by'] = $uid;
        } elseif (!$newTime) {
            $updates['time_logged_by'] = null;
        }
    }

    if (empty($updates)) {
        echo json_encode(['ok'=>false,'message'=>'Nothing to update.']);
        exit;
    }

    DB::update('task_notes', $updates, ['id'=>$id]);

    if ($timeDelta !== 0) {
        DB::run(
            'UPDATE tasks SET actual_minutes = GREATEST(0, COALESCE(actual_minutes,0) + :m) WHERE id = :id',
            [':m' => $timeDelta, ':id' => $note['task_id']]
        );
        if (!empty($note['subtask_id'])) {
            DB::run(
                'UPDATE task_subtasks SET actual_minutes = GREATEST(0, COALESCE(actual_minutes,0) + :m) WHERE id = :id',
                [':m' => $timeDelta, ':id' => $note['subtask_id']]
            );
        }
    }

    $changes = Audit::diff(
        ['body' => $note['body'] ?? '', 'time_minutes' => $note['time_minutes'] ?? null],
        ['body' => $updates['body'] ?? ($note['body'] ?? ''), 'time_minutes' => $updates['time_minutes'] ?? ($note['time_minutes'] ?? null)]
    );
    Audit::log('update','task_note',$id,'Edited note', $changes);

    echo json_encode(['ok'=>true,'message'=>'Note updated.']);
    exit;
}


/* ============================================================
   ROUND 21 — time totals endpoint for strip refresh
   ============================================================ */
function handle_time_totals(): void
{
    Perm::require('tasks.view');
    header('Content-Type: application/json');
    $id = input_int('id', 0);
    if (!$id) { echo json_encode(['ok'=>false]); exit; }
    $task = DB::row('SELECT estimated_minutes, actual_minutes FROM tasks WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]);
    if (!$task) { echo json_encode(['ok'=>false]); exit; }
    $subEst = (int)DB::value('SELECT COALESCE(SUM(estimated_minutes),0) FROM task_subtasks WHERE task_id=:id AND deleted_at IS NULL', ['id'=>$id]);
    $subAct = (int)DB::value('SELECT COALESCE(SUM(actual_minutes),0) FROM task_subtasks WHERE task_id=:id AND deleted_at IS NULL', ['id'=>$id]);
    echo json_encode([
        'ok' => true,
        'task_estimated' => (int)($task['estimated_minutes'] ?? 0),
        'task_actual'    => (int)($task['actual_minutes'] ?? 0),
        'sub_estimated'  => $subEst,
        'sub_actual'     => $subAct,
    ]);
    exit;
}
