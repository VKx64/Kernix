<?php
/**
 * Dashboard module — adds time breakdown by project + client.
 * Round 40.
 */

function handle_index(): void
{
    Perm::require('dashboard.view');

    $me  = Auth::user();
    $uid = (int)$me['id'];

    // Date range — default = first day of current month, today
    $defaultFrom = date('Y-m-01');
    $defaultTo   = date('Y-m-d');
    $from = trim((string)($_GET['from'] ?? $defaultFrom));
    $to   = trim((string)($_GET['to']   ?? $defaultTo));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) $from = $defaultFrom;
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $to))   $to   = $defaultTo;

    $data = _dash_load_time_data($uid, $from, $to);

    render('dashboard', array_merge([
        'pageTitle'  => 'Dashboard',
        'rangeFrom'  => $from,
        'rangeTo'    => $to,
    ], $data));
}

/**
 * AJAX endpoint for re-fetching time data when range changes.
 * ?p=dashboard&action=time_data&from=YYYY-MM-DD&to=YYYY-MM-DD
 */
function handle_time_data(): void
{
    Perm::require('dashboard.view');
    header('Content-Type: application/json');

    $uid = (int)Auth::id();
    $from = trim((string)($_GET['from'] ?? date('Y-m-01')));
    $to   = trim((string)($_GET['to']   ?? date('Y-m-d')));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) $from = date('Y-m-01');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $to))   $to   = date('Y-m-d');

    echo json_encode(_dash_load_time_data($uid, $from, $to));
    exit;
}

/**
 * Computes today/range totals + per-project / per-client breakdowns
 * for the given user and date range.
 */
function _dash_load_time_data(int $uid, string $from, string $to): array
{
    // Total today (independent of selected range — always today)
    $todayMins = (int)DB::value(
        "SELECT COALESCE(SUM(time_minutes), 0) FROM task_notes
         WHERE time_logged_by = :u
           AND time_minutes IS NOT NULL
           AND deleted_at IS NULL
           AND DATE(created_at) = CURDATE()",
        ['u' => $uid]
    );

    // Total for selected range
    $rangeMins = (int)DB::value(
        "SELECT COALESCE(SUM(time_minutes), 0) FROM task_notes
         WHERE time_logged_by = :u
           AND time_minutes IS NOT NULL
           AND deleted_at IS NULL
           AND DATE(created_at) BETWEEN :f AND :t",
        ['u' => $uid, 'f' => $from, 't' => $to]
    );

    // Recent entries (newest 30 in range)
    $entries = DB::all(
        "SELECT n.id, n.task_id, n.time_minutes, n.created_at,
                t.title AS task_title,
                p.name  AS project_name,
                cl.name AS client_name
         FROM task_notes n
         LEFT JOIN tasks t      ON t.id  = n.task_id
         LEFT JOIN projects p   ON p.id  = t.project_id
         LEFT JOIN clients cl   ON cl.id = p.client_id
         WHERE n.time_logged_by = :u
           AND n.time_minutes IS NOT NULL
           AND n.time_minutes > 0
           AND n.deleted_at IS NULL
           AND DATE(n.created_at) BETWEEN :f AND :t
         ORDER BY n.created_at DESC
         LIMIT 30",
        ['u' => $uid, 'f' => $from, 't' => $to]
    );

    // BREAKDOWN: per project
    $projectBreakdown = DB::all(
        "SELECT
            COALESCE(p.id, 0)         AS project_id,
            COALESCE(p.name, '(No project)') AS name,
            SUM(n.time_minutes)       AS minutes
         FROM task_notes n
         LEFT JOIN tasks t    ON t.id  = n.task_id
         LEFT JOIN projects p ON p.id  = t.project_id
         WHERE n.time_logged_by = :u
           AND n.time_minutes IS NOT NULL
           AND n.time_minutes > 0
           AND n.deleted_at IS NULL
           AND DATE(n.created_at) BETWEEN :f AND :t
         GROUP BY COALESCE(p.id, 0), COALESCE(p.name, '(No project)')
         ORDER BY minutes DESC",
        ['u' => $uid, 'f' => $from, 't' => $to]
    );

    // BREAKDOWN: per client
    $clientBreakdown = DB::all(
        "SELECT
            COALESCE(cl.id, 0)         AS client_id,
            COALESCE(cl.name, '(No client)') AS name,
            SUM(n.time_minutes)        AS minutes
         FROM task_notes n
         LEFT JOIN tasks t      ON t.id  = n.task_id
         LEFT JOIN projects p   ON p.id  = t.project_id
         LEFT JOIN clients cl   ON cl.id = p.client_id
         WHERE n.time_logged_by = :u
           AND n.time_minutes IS NOT NULL
           AND n.time_minutes > 0
           AND n.deleted_at IS NULL
           AND DATE(n.created_at) BETWEEN :f AND :t
         GROUP BY COALESCE(cl.id, 0), COALESCE(cl.name, '(No client)')
         ORDER BY minutes DESC",
        ['u' => $uid, 'f' => $from, 't' => $to]
    );

    // Collapse to top 8 + "Other"
    $projectChart = _dash_top_n_plus_other($projectBreakdown, 8);
    $clientChart  = _dash_top_n_plus_other($clientBreakdown,  8);

    // Also pull at-a-glance counts (unchanged from previous round)
    $myTasks       = (int)DB::value("SELECT COUNT(*) FROM tasks    WHERE assignee_user_id=:u AND deleted_at IS NULL AND archived_at IS NULL", ['u'=>$uid]);
    $unreadMsgs    = (int)DB::value("SELECT COUNT(*) FROM task_notes WHERE assigned_user_id=:u AND read_at IS NULL AND deleted_at IS NULL", ['u'=>$uid]);
    $openProjects  = (int)DB::value("SELECT COUNT(*) FROM projects WHERE deleted_at IS NULL AND archived_at IS NULL");
    $activeClients = (int)DB::value("SELECT COUNT(*) FROM clients  WHERE deleted_at IS NULL AND archived_at IS NULL");

    return [
        'todayMins'        => $todayMins,
        'rangeMins'        => $rangeMins,
        'entries'          => $entries,
        'projectChart'     => $projectChart,
        'clientChart'      => $clientChart,
        'myTasks'          => $myTasks,
        'unreadMsgs'       => $unreadMsgs,
        'openProjects'     => $openProjects,
        'activeClients'    => $activeClients,
    ];
}

function _dash_top_n_plus_other(array $rows, int $n): array
{
    if (count($rows) <= $n) {
        // Cast minutes to int
        return array_map(fn($r) => [
            'name'    => $r['name'],
            'minutes' => (int)$r['minutes'],
        ], $rows);
    }
    $top    = array_slice($rows, 0, $n);
    $rest   = array_slice($rows, $n);
    $otherM = 0;
    foreach ($rest as $r) $otherM += (int)$r['minutes'];
    $out = array_map(fn($r) => [
        'name'    => $r['name'],
        'minutes' => (int)$r['minutes'],
    ], $top);
    if ($otherM > 0) {
        $out[] = ['name' => 'Other', 'minutes' => $otherM];
    }
    return $out;
}
