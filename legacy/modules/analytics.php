<?php
/**
 * Analytics module — admin-only reporting.
 *
 * Tabs:
 *  - login_vs_logged (default): clocked-in time vs logged work time per user
 *
 * Add new tabs by:
 *   1. Adding a case to the $tab dispatch in handle_index()
 *   2. Writing a _load_<slug>() function that returns the data array
 *   3. Adding a tab partial in views/analytics_tabs/<slug>.php
 *   4. Registering the tab label in analytics_tabs() below
 */

function analytics_tabs(): array
{
    return [
        'login_vs_logged' => 'Login Time vs Logged Work',
        'timeline'        => 'Timeline',
        // Future tabs go here:
        // 'task_throughput' => 'Task Throughput',
        // 'client_hours'    => 'Hours by Client',
        // ...
    ];
}

function handle_index(): void
{
    Perm::require('analytics.view');

    $tabs = analytics_tabs();
    $tab  = (string)($_GET['tab'] ?? 'login_vs_logged');
    if (!isset($tabs[$tab])) $tab = 'login_vs_logged';

    // Date range — timeline defaults to a rolling 14 days for readability,
    // other tabs default to month-to-date.
    if ($tab === 'timeline') {
        $defaultFrom = date('Y-m-d', strtotime('-13 days'));
        $defaultTo   = date('Y-m-d');
    } else {
        $defaultFrom = date('Y-m-01');
        $defaultTo   = date('Y-m-d');
    }
    $from = trim((string)($_GET['from'] ?? $defaultFrom));
    $to   = trim((string)($_GET['to']   ?? $defaultTo));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) $from = $defaultFrom;
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $to))   $to   = $defaultTo;

    $data = [];
    switch ($tab) {
        case 'login_vs_logged':
            $data = _analytics_load_login_vs_logged($from, $to);
            break;
        case 'timeline':
            $data = _analytics_load_timeline($from, $to);
            break;
    }

    render('analytics', [
        'pageTitle' => 'Analytics',
        'tabs'      => $tabs,
        'activeTab' => $tab,
        'rangeFrom' => $from,
        'rangeTo'   => $to,
        'data'      => $data,
    ]);
}

/**
 * Diagnostic: show every timezone-relevant value so we can see TZ drift.
 * Visit ?p=analytics&action=debug_tz
 */
function handle_debug_tz(): void
{
    Perm::require('analytics.view');
    header('Content-Type: text/plain; charset=utf-8');

    echo "=== TIMEZONE DEBUG ===\n";
    echo "BUILD: 2026-05-22-tz-debug-v2\n\n";

    // PHP side
    echo "--- PHP ---\n";
    echo "date_default_timezone_get(): " . date_default_timezone_get() . "\n";
    echo "PHP date('c')               : " . date('c') . "\n";
    echo "PHP time() as UTC string   : " . gmdate('Y-m-d H:i:s', time()) . " UTC\n";
    echo "ini_get('date.timezone')   : " . (ini_get('date.timezone') ?: '(not set)') . "\n";
    echo "APP_TIMEZONE constant      : " . (defined('APP_TIMEZONE') ? APP_TIMEZONE : '(undefined)') . "\n";
    $s = settings();
    echo "settings.default_timezone  : " . ($s['default_timezone'] ?? '(not set)') . "\n\n";

    // MySQL side
    echo "--- MySQL ---\n";
    $rows = DB::row("SELECT
        NOW()                            AS mysql_now,
        UTC_TIMESTAMP()                  AS mysql_utc,
        @@global.time_zone               AS global_tz,
        @@session.time_zone              AS session_tz,
        @@system_time_zone               AS system_tz,
        UNIX_TIMESTAMP()                 AS mysql_unix
    ");
    foreach ($rows as $k => $v) {
        echo str_pad($k, 28) . ": $v\n";
    }
    echo "\n";

    // Column type — critical for knowing whether changing session TZ will fix old rows
    echo "--- COLUMN TYPES ---\n";
    $cols = DB::all(
        "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME IN ('time_sessions','time_breaks','task_notes')
           AND COLUMN_NAME IN ('clock_in_at','clock_out_at','start_at','end_at','created_at','updated_at')
         ORDER BY TABLE_NAME, COLUMN_NAME"
    );
    foreach ($cols as $c) {
        echo "  " . str_pad($c['COLUMN_NAME'], 16) . " " . $c['DATA_TYPE'] . "\n";
    }
    echo "  (DATETIME stores a literal string. TIMESTAMP stores UTC internally and converts on read.)\n\n";

    // Compare what the same row looks like under different MySQL session TZs
    echo "--- SAME ROW UNDER DIFFERENT SESSION TZ ---\n";
    $latestId = (int)DB::value("SELECT MAX(id) FROM time_sessions");
    if (!$latestId) {
        echo "  (no time_sessions rows to test against)\n\n";
    } else {
        // Try each TZ and read the same row
        $tzList = ['+00:00','+08:00','-04:00','SYSTEM'];
        foreach ($tzList as $tz) {
            try {
                DB::run("SET time_zone = :tz", ['tz' => $tz]);
                $r = DB::row(
                    "SELECT id, clock_in_at,
                            UNIX_TIMESTAMP(clock_in_at) AS in_unix,
                            DATE_FORMAT(clock_in_at, '%Y-%m-%d %h:%i %p') AS in_formatted,
                            @@session.time_zone AS confirmed_tz
                     FROM time_sessions WHERE id = :id",
                    ['id' => $latestId]
                );
                echo "  session_tz = " . str_pad($tz, 8) . " (actual=" . str_pad($r['confirmed_tz'], 8) . ") ";
                echo " raw='{$r['clock_in_at']}'  UNIX={$r['in_unix']}  formatted='{$r['in_formatted']}'\n";
            } catch (\Throwable $e) {
                echo "  session_tz = " . str_pad($tz, 8) . " ERROR: " . $e->getMessage() . "\n";
            }
        }
        // Restore default
        DB::run("SET time_zone = SYSTEM");
        echo "  (restored to SYSTEM)\n";
        echo "\n";
        echo "  ↑ if the UNIX timestamp is the SAME under every session TZ, the column is TIMESTAMP and fix is trivial.\n";
        echo "  ↑ if the UNIX timestamp CHANGES per session TZ, the column is DATETIME — fix needs a one-time data correction.\n";
    }
    echo "\n";

    // Sample sessions and how they look
    echo "--- SAMPLE TIME_SESSIONS (last 5, server's current TZ) ---\n";
    $sessions = DB::all(
        "SELECT id, user_id, clock_in_at, clock_out_at,
                UNIX_TIMESTAMP(clock_in_at)  AS in_unix,
                UNIX_TIMESTAMP(clock_out_at) AS out_unix,
                TIMESTAMPDIFF(SECOND, clock_in_at, COALESCE(clock_out_at, NOW())) AS elapsed_sec
         FROM time_sessions
         ORDER BY id DESC LIMIT 5"
    );
    foreach ($sessions as $s) {
        echo "  session #{$s['id']}  user={$s['user_id']}\n";
        echo "    raw clock_in_at  : {$s['clock_in_at']}\n";
        echo "    raw clock_out_at : " . ($s['clock_out_at'] ?? 'OPEN') . "\n";
        echo "    UNIX(in)         : {$s['in_unix']} (" . date('Y-m-d H:i:s T', (int)$s['in_unix']) . " in PHP TZ)\n";
        if ($s['out_unix']) {
            echo "    UNIX(out)        : {$s['out_unix']} (" . date('Y-m-d H:i:s T', (int)$s['out_unix']) . " in PHP TZ)\n";
        }
        echo "    elapsed_sec      : {$s['elapsed_sec']} = " . round($s['elapsed_sec']/60) . " min = " . round($s['elapsed_sec']/3600, 1) . " hours\n";
    }
    exit;
}

/**
 * Diagnostic: dump the timeline payload as plain JSON.
 * Visit ?p=analytics&action=debug_timeline to see what the loader returns.
 */
function handle_debug_timeline(): void
{
    Perm::require('analytics.view');
    header('Content-Type: text/plain; charset=utf-8');

    echo "=== TIMELINE DEBUG ===\n";
    echo "BUILD: 2026-05-22-timeline-tab\n";
    echo "If you don't see that BUILD marker, the new analytics.php didn't upload.\n\n";

    $from = trim((string)($_GET['from'] ?? date('Y-m-d', strtotime('-13 days'))));
    $to   = trim((string)($_GET['to']   ?? date('Y-m-d')));
    echo "Range: $from → $to\n\n";

    // What the user-fetch returns
    $users = DB::all(
        "SELECT id, first_name, last_name, username, status, deleted_at
         FROM users
         WHERE deleted_at IS NULL AND status = 'active'
         ORDER BY first_name, last_name"
    );
    echo "ACTIVE USERS: " . count($users) . "\n";
    foreach ($users as $u) {
        echo "  #{$u['id']}  {$u['first_name']} {$u['last_name']}  @{$u['username']}  status={$u['status']}\n";
    }
    echo "\n";

    // What the session-fetch returns
    $sessions = DB::all(
        "SELECT s.id, s.user_id, s.clock_in_at, s.clock_out_at,
                TIMESTAMPDIFF(MINUTE, s.clock_in_at, COALESCE(s.clock_out_at, NOW())) AS mins
         FROM time_sessions s
         WHERE s.clock_in_at IS NOT NULL
           AND (
                DATE(s.clock_in_at) BETWEEN :f AND :t
             OR DATE(COALESCE(s.clock_out_at, NOW())) BETWEEN :f2 AND :t2
           )
           AND (
                s.clock_out_at IS NULL
             OR TIMESTAMPDIFF(MINUTE, s.clock_in_at, s.clock_out_at) BETWEEN 0 AND 1440
           )
         ORDER BY s.user_id, s.clock_in_at",
        ['f' => $from, 't' => $to, 'f2' => $from, 't2' => $to]
    );
    echo "SESSIONS IN RANGE: " . count($sessions) . "\n";
    foreach ($sessions as $s) {
        echo "  session #{$s['id']}  user={$s['user_id']}  in={$s['clock_in_at']}  out=" . ($s['clock_out_at'] ?? 'OPEN') . "  mins={$s['mins']}\n";
    }
    echo "\n";

    // What the full assembler returns
    $payload = _analytics_load_timeline($from, $to);
    echo "ASSEMBLED PAYLOAD:\n";
    echo "  from:      {$payload['from']}\n";
    echo "  to:        {$payload['to']}\n";
    echo "  row_count: {$payload['row_count']}\n";
    echo "  rows:\n";
    foreach ($payload['rows'] as $r) {
        $sc = count($r['sessions']);
        echo "    user #{$r['user_id']}  {$r['name']}  sessions=$sc  has_activity=" . ($r['has_activity'] ? 'yes' : 'no') . "\n";
    }
    exit;
}

/**
 * Diagnostic: dump raw counts and sample rows from each source table.
 * Visit ?p=analytics&action=debug to see what data exists.
 */
function handle_debug(): void
{
    Perm::require('analytics.view');
    header('Content-Type: text/plain; charset=utf-8');

    echo "=== ANALYTICS DEBUG ===\n\n";

    // time_sessions
    $tsCount  = DB::value('SELECT COUNT(*) FROM time_sessions');
    $tsOpen   = DB::value('SELECT COUNT(*) FROM time_sessions WHERE clock_out_at IS NULL');
    $tsRange  = DB::value("SELECT MIN(clock_in_at), MAX(clock_in_at) FROM time_sessions");
    $tsByUser = DB::all("SELECT user_id, COUNT(*) c, MIN(clock_in_at) mn, MAX(clock_in_at) mx FROM time_sessions GROUP BY user_id");
    echo "time_sessions: $tsCount total, $tsOpen open\n";
    echo "  earliest/latest clock_in_at: \n";
    print_r(DB::all("SELECT MIN(clock_in_at) earliest, MAX(clock_in_at) latest FROM time_sessions"));
    echo "  by user:\n";
    print_r($tsByUser);

    // Sample sessions
    echo "\nLATEST 5 SESSIONS:\n";
    print_r(DB::all("SELECT id, user_id, clock_in_at, clock_out_at,
                            TIMESTAMPDIFF(MINUTE, clock_in_at, COALESCE(clock_out_at, NOW())) AS minutes
                     FROM time_sessions ORDER BY clock_in_at DESC LIMIT 5"));

    // task_notes with time_logged_by
    $nCount = DB::value("SELECT COUNT(*) FROM task_notes WHERE time_logged_by IS NOT NULL AND time_minutes > 0 AND deleted_at IS NULL");
    echo "\n\ntask_notes with time_logged_by: $nCount\n";
    print_r(DB::all("SELECT time_logged_by, COUNT(*) c, SUM(time_minutes) total_mins FROM task_notes
                     WHERE time_logged_by IS NOT NULL AND time_minutes > 0 AND deleted_at IS NULL
                     GROUP BY time_logged_by"));

    // What the analytics query would return for THIS MONTH
    $f = date('Y-m-01');
    $t = date('Y-m-d');
    echo "\n=== Running clocked query for $f to $t ===\n";
    print_r(DB::all(
        "SELECT user_id,
                COALESCE(SUM(TIMESTAMPDIFF(MINUTE, clock_in_at, COALESCE(clock_out_at, NOW()))), 0) AS minutes,
                COUNT(*) AS session_count
         FROM time_sessions
         WHERE clock_in_at IS NOT NULL
           AND DATE(clock_in_at) BETWEEN :f AND :t
           AND (clock_out_at IS NULL OR TIMESTAMPDIFF(MINUTE, clock_in_at, clock_out_at) BETWEEN 0 AND 1440)
         GROUP BY user_id",
        ['f' => $f, 't' => $t]
    ));

    echo "\n=== Running clocked query for ALL TIME ===\n";
    print_r(DB::all(
        "SELECT user_id,
                COALESCE(SUM(TIMESTAMPDIFF(MINUTE, clock_in_at, COALESCE(clock_out_at, NOW()))), 0) AS minutes,
                COUNT(*) AS session_count
         FROM time_sessions
         WHERE clock_in_at IS NOT NULL
           AND (clock_out_at IS NULL OR TIMESTAMPDIFF(MINUTE, clock_in_at, clock_out_at) BETWEEN 0 AND 1440)
         GROUP BY user_id"
    ));

    // Sessions excluded by the >24h filter
    $excluded = DB::all(
        "SELECT id, user_id, clock_in_at, clock_out_at,
                TIMESTAMPDIFF(MINUTE, clock_in_at, clock_out_at) AS minutes
         FROM time_sessions
         WHERE clock_out_at IS NOT NULL
           AND (TIMESTAMPDIFF(MINUTE, clock_in_at, clock_out_at) > 1440
                OR TIMESTAMPDIFF(MINUTE, clock_in_at, clock_out_at) < 0)
         ORDER BY clock_in_at DESC LIMIT 10"
    );
    echo "\n=== Sessions EXCLUDED by 24h sanity filter (max 10 shown) ===\n";
    print_r($excluded);

    exit;
}

/**
 * AJAX endpoint for re-fetching tab data when the range or tab changes.
 * ?p=analytics&action=data&tab=...&from=...&to=...
 */
function handle_data(): void
{
    Perm::require('analytics.view');
    header('Content-Type: application/json');

    $tabs = analytics_tabs();
    $tab  = (string)($_GET['tab'] ?? 'login_vs_logged');
    if (!isset($tabs[$tab])) $tab = 'login_vs_logged';

    $from = trim((string)($_GET['from'] ?? date('Y-m-01')));
    $to   = trim((string)($_GET['to']   ?? date('Y-m-d')));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) $from = date('Y-m-01');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $to))   $to   = date('Y-m-d');

    $data = [];
    switch ($tab) {
        case 'login_vs_logged':
            $data = _analytics_load_login_vs_logged($from, $to);
            break;
        case 'timeline':
            $data = _analytics_load_timeline($from, $to);
            break;
    }

    echo json_encode(['tab' => $tab, 'from' => $from, 'to' => $to, 'data' => $data]);
    exit;
}

/**
 * For each active user, compute clocked-in time and logged work time
 * within the given date range.
 *
 * Clocked-in time:
 *   - Sum of valid time_sessions (started in range OR ended in range)
 *   - Excludes sessions where TIMESTAMPDIFF is negative or > 24h
 *     (those are TZ-broken sessions auto-closed by round 35 cleanup)
 *   - Subtracts break time from time_breaks
 *
 * Logged work time:
 *   - Sum of task_notes.time_minutes where time_logged_by = user
 *     and note created within the date range
 */
function _analytics_load_login_vs_logged(string $from, string $to): array
{
    // Pull every active user (so users with 0 activity still show up)
    $users = DB::all(
        "SELECT id, first_name, last_name, username, profile_image
         FROM users
         WHERE deleted_at IS NULL AND status = 'active'
         ORDER BY first_name, last_name"
    );

    // Clocked-in minutes per user
    $clockedRows = DB::all(
        "SELECT
            user_id,
            COALESCE(SUM(
                TIMESTAMPDIFF(MINUTE, clock_in_at, COALESCE(clock_out_at, NOW()))
            ), 0) AS minutes
         FROM time_sessions
         WHERE clock_in_at IS NOT NULL
           AND DATE(clock_in_at) BETWEEN :f AND :t
           AND (clock_out_at IS NULL OR TIMESTAMPDIFF(MINUTE, clock_in_at, clock_out_at) BETWEEN 0 AND 1440)
         GROUP BY user_id",
        ['f' => $from, 't' => $to]
    );
    $clockedByUser = [];
    foreach ($clockedRows as $r) $clockedByUser[(int)$r['user_id']] = (int)$r['minutes'];

    // Break minutes per user (to subtract)
    $breakRows = DB::all(
        "SELECT
            ts.user_id,
            COALESCE(SUM(
                TIMESTAMPDIFF(MINUTE, tb.start_at, COALESCE(tb.end_at, NOW()))
            ), 0) AS minutes
         FROM time_breaks tb
         INNER JOIN time_sessions ts ON ts.id = tb.session_id
         WHERE tb.start_at IS NOT NULL
           AND DATE(tb.start_at) BETWEEN :f AND :t
           AND (tb.end_at IS NULL OR TIMESTAMPDIFF(MINUTE, tb.start_at, tb.end_at) BETWEEN 0 AND 1440)
         GROUP BY ts.user_id",
        ['f' => $from, 't' => $to]
    );
    $breakByUser = [];
    foreach ($breakRows as $r) $breakByUser[(int)$r['user_id']] = (int)$r['minutes'];

    // Logged work minutes per user
    $loggedRows = DB::all(
        "SELECT
            time_logged_by AS user_id,
            COALESCE(SUM(time_minutes), 0) AS minutes
         FROM task_notes
         WHERE time_logged_by IS NOT NULL
           AND time_minutes IS NOT NULL
           AND time_minutes > 0
           AND deleted_at IS NULL
           AND DATE(created_at) BETWEEN :f AND :t
         GROUP BY time_logged_by",
        ['f' => $from, 't' => $to]
    );
    $loggedByUser = [];
    foreach ($loggedRows as $r) $loggedByUser[(int)$r['user_id']] = (int)$r['minutes'];

    // Build rows
    $rows = [];
    foreach ($users as $u) {
        $uid = (int)$u['id'];
        $clocked = $clockedByUser[$uid] ?? 0;
        $breaks  = $breakByUser[$uid]  ?? 0;
        $netClocked = max(0, $clocked - $breaks);
        $logged  = $loggedByUser[$uid] ?? 0;
        $diff    = $netClocked - $logged;
        $util    = $netClocked > 0 ? round($logged / $netClocked * 100) : 0;

        $rows[] = [
            'user_id'    => $uid,
            'name'       => trim($u['first_name'] . ' ' . $u['last_name']),
            'username'   => $u['username'],
            'image'      => $u['profile_image'] ?? null,
            'clocked_min'=> $netClocked,
            'break_min'  => $breaks,
            'logged_min' => $logged,
            'diff_min'   => $diff,
            'util_pct'   => $util,
            'has_activity' => ($netClocked > 0 || $logged > 0),
        ];
    }

    // Sort by utilization ascending (lowest first surfaces who needs attention),
    // but push users with zero activity to the bottom
    usort($rows, function($a, $b) {
        if ($a['has_activity'] !== $b['has_activity']) {
            return $b['has_activity'] <=> $a['has_activity'];
        }
        return $a['util_pct'] <=> $b['util_pct'];
    });

    // Totals (across users with activity)
    $totalClocked = 0; $totalLogged = 0; $activeCount = 0;
    foreach ($rows as $r) {
        if ($r['has_activity']) {
            $totalClocked += $r['clocked_min'];
            $totalLogged  += $r['logged_min'];
            $activeCount++;
        }
    }
    $teamUtil = $totalClocked > 0 ? round($totalLogged / $totalClocked * 100) : 0;

    return [
        'rows'         => $rows,
        'total_clocked'=> $totalClocked,
        'total_logged' => $totalLogged,
        'team_util'    => $teamUtil,
        'active_users' => $activeCount,
    ];
}

/**
 * Timeline loader — Gantt-style data for the "Timeline" analytics tab.
 *
 * Returns one user row per active user. Each row has zero or more "sessions",
 * which are real time_sessions rows that touch the visible date range.
 *
 * For each session we compute:
 *   - clock_in_at, clock_out_at (or NOW() if still open)
 *   - net_minutes  = total minutes minus break time
 *   - break_minutes
 *   - logged_minutes = sum of task_notes.time_minutes where:
 *         time_logged_by  = session.user_id
 *         created_at      BETWEEN session.clock_in_at AND session.clock_out_at (or NOW())
 *   - pct = logged / net (0..>100). Over 100 means over-logged → bar renders red.
 *
 * We also surface "unattributed" task minutes per user-day: task time logged
 * on a date when the user was never clocked in, or logged outside any session
 * window. These are shown as a chip under the row.
 *
 * Date-range filter: any session whose clock-in OR clock-out date falls in
 * [from, to] is included. Sessions are clipped at render time, not query time,
 * so a session that crosses midnight or extends beyond the visible window
 * still renders correctly.
 *
 * Sanity filter: sessions with negative or >24h duration are excluded
 * (those are auto-closed TZ-broken rows from round 35).
 */
function _analytics_load_timeline(string $from, string $to): array
{
    $users = DB::all(
        "SELECT id, first_name, last_name, username, profile_image
         FROM users
         WHERE deleted_at IS NULL AND status = 'active'
         ORDER BY first_name, last_name"
    );

    // Pull every valid session that touches the visible range.
    // "Touches" = clock_in OR clock_out (or open-session NOW()) falls in [from, to].
    $sessions = DB::all(
        "SELECT
            s.id, s.user_id,
            s.clock_in_at,
            COALESCE(s.clock_out_at, NOW()) AS effective_out_at,
            s.clock_out_at,
            TIMESTAMPDIFF(MINUTE, s.clock_in_at, COALESCE(s.clock_out_at, NOW())) AS gross_minutes
         FROM time_sessions s
         WHERE s.clock_in_at IS NOT NULL
           AND (
                DATE(s.clock_in_at) BETWEEN :f AND :t
             OR DATE(COALESCE(s.clock_out_at, NOW())) BETWEEN :f2 AND :t2
           )
           AND (
                s.clock_out_at IS NULL
             OR TIMESTAMPDIFF(MINUTE, s.clock_in_at, s.clock_out_at) BETWEEN 0 AND 1440
           )
         ORDER BY s.user_id, s.clock_in_at",
        ['f' => $from, 't' => $to, 'f2' => $from, 't2' => $to]
    );

    if (empty($sessions)) {
        // Still return user rows so the chart shows them as empty.
        return _timeline_assemble($users, [], [], $from, $to);
    }

    $sessionIds = array_map(fn($r) => (int)$r['id'], $sessions);
    $placeholders = implode(',', array_fill(0, count($sessionIds), '?'));

    // Break minutes per session
    $breakRows = DB::all(
        "SELECT session_id,
                COALESCE(SUM(TIMESTAMPDIFF(MINUTE, start_at, COALESCE(end_at, NOW()))), 0) AS minutes
         FROM time_breaks
         WHERE session_id IN ($placeholders)
           AND start_at IS NOT NULL
           AND (end_at IS NULL OR TIMESTAMPDIFF(MINUTE, start_at, end_at) BETWEEN 0 AND 1440)
         GROUP BY session_id",
        $sessionIds
    );
    $breakBySession = [];
    foreach ($breakRows as $r) $breakBySession[(int)$r['session_id']] = (int)$r['minutes'];

    // Logged task minutes attributed to each session
    //   created_at between session start and end → that session owns the minutes
    // One query that joins notes against sessions by user_id and time window.
    $loggedRows = DB::all(
        "SELECT s.id AS session_id,
                COALESCE(SUM(n.time_minutes), 0) AS minutes
         FROM time_sessions s
         INNER JOIN task_notes n
            ON n.time_logged_by = s.user_id
           AND n.deleted_at IS NULL
           AND n.time_minutes > 0
           AND n.created_at >= s.clock_in_at
           AND n.created_at <= COALESCE(s.clock_out_at, NOW())
         WHERE s.id IN ($placeholders)
         GROUP BY s.id",
        $sessionIds
    );
    $loggedBySession = [];
    foreach ($loggedRows as $r) $loggedBySession[(int)$r['session_id']] = (int)$r['minutes'];

    // Unattributed task minutes per user per day in range.
    // = task minutes logged in the date range whose created_at does NOT fall
    //   inside any session for that user.
    // We query all task minutes in range, then subtract the per-session sums.
    $totalNotesRows = DB::all(
        "SELECT n.time_logged_by AS user_id,
                DATE(n.created_at) AS d,
                COALESCE(SUM(n.time_minutes), 0) AS minutes
         FROM task_notes n
         WHERE n.time_logged_by IS NOT NULL
           AND n.time_minutes > 0
           AND n.deleted_at IS NULL
           AND DATE(n.created_at) BETWEEN :f AND :t
         GROUP BY n.time_logged_by, DATE(n.created_at)",
        ['f' => $from, 't' => $to]
    );

    return _timeline_assemble($users, $sessions, [
        'break_by_session'  => $breakBySession,
        'logged_by_session' => $loggedBySession,
        'total_notes_rows'  => $totalNotesRows,
    ], $from, $to);
}

/**
 * Assembles the timeline payload from the raw query results.
 * Kept separate so the empty-sessions case still gets user rows.
 */
function _timeline_assemble(array $users, array $sessions, array $maps, string $from, string $to): array
{
    $breakBySession   = $maps['break_by_session']  ?? [];
    $loggedBySession  = $maps['logged_by_session'] ?? [];
    $totalNotesRows   = $maps['total_notes_rows']  ?? [];

    // user_id => day => total task minutes
    $notesByUserDay = [];
    foreach ($totalNotesRows as $n) {
        $uid = (int)$n['user_id'];
        $d   = (string)$n['d'];
        $notesByUserDay[$uid][$d] = (int)$n['minutes'];
    }

    // Group sessions by user, compute per-session fields
    // and accumulate attributed task-minutes by user/day so we can derive unattributed.
    $sessionsByUser = [];
    $attributedByUserDay = []; // user_id => day => minutes attributed to a session that day
    foreach ($sessions as $s) {
        $uid       = (int)$s['user_id'];
        $sid       = (int)$s['id'];
        $gross     = max(0, (int)$s['gross_minutes']);
        $breaks    = $breakBySession[$sid]  ?? 0;
        $logged    = $loggedBySession[$sid] ?? 0;
        $net       = max(0, $gross - $breaks);
        $pct       = $net > 0 ? (int)round($logged / $net * 100) : ($logged > 0 ? 999 : 0);
        $overLog   = $logged > $net;
        $day       = substr((string)$s['clock_in_at'], 0, 10);

        $attributedByUserDay[$uid][$day] = ($attributedByUserDay[$uid][$day] ?? 0) + $logged;

        $sessionsByUser[$uid][] = [
            'id'             => $sid,
            'clock_in_at'    => $s['clock_in_at'],
            'clock_out_at'   => $s['clock_out_at'],          // null if still open
            'effective_out'  => $s['effective_out_at'],
            'is_open'        => empty($s['clock_out_at']),
            'gross_minutes'  => $gross,
            'break_minutes'  => $breaks,
            'net_minutes'    => $net,
            'logged_minutes' => $logged,
            'pct'            => $pct,
            'over_logged'    => $overLog,
        ];
    }

    // Build user rows. Include every active user so the chart shows everyone.
    $rows = [];
    foreach ($users as $u) {
        $uid = (int)$u['id'];
        $userSessions = $sessionsByUser[$uid] ?? [];

        // Unattributed: notes total minus attributed total, per day.
        $unattributed = [];
        $notesDays = $notesByUserDay[$uid] ?? [];
        foreach ($notesDays as $day => $total) {
            $attr = $attributedByUserDay[$uid][$day] ?? 0;
            $gap  = $total - $attr;
            if ($gap > 0) $unattributed[$day] = $gap;
        }
        $unattributedTotal = array_sum($unattributed);

        // Per-user summary totals (over the visible sessions)
        $totalNet      = 0;
        $totalLogged   = 0;
        $totalBreaks   = 0;
        $anyOverLogged = false;
        foreach ($userSessions as $s) {
            $totalNet    += $s['net_minutes'];
            $totalLogged += $s['logged_minutes'];
            $totalBreaks += $s['break_minutes'];
            if ($s['over_logged']) $anyOverLogged = true;
        }

        $rows[] = [
            'user_id'            => $uid,
            'name'               => trim($u['first_name'] . ' ' . $u['last_name']),
            'username'           => $u['username'],
            'image'              => $u['profile_image'] ?? null,
            'sessions'           => $userSessions,
            'unattributed'       => $unattributed,            // day => minutes
            'unattributed_total' => $unattributedTotal,
            'totals'             => [
                'net_minutes'    => $totalNet,
                'logged_minutes' => $totalLogged,
                'break_minutes'  => $totalBreaks,
                'any_over_logged'=> $anyOverLogged,
            ],
            'has_activity'       => !empty($userSessions) || $unattributedTotal > 0,
        ];
    }

    // Range bounds for the renderer
    return [
        'from'     => $from,
        'to'       => $to,
        'rows'     => $rows,
        'row_count'=> count($rows),
    ];
}
