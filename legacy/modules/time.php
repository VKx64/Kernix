<?php
/**
 * Time tracking module.
 * Actions:
 *   status      → JSON of current session state (for the topbar widget)
 *   clock_in    → start a new session
 *   clock_out   → end the current session (with optional notes)
 *   break_start → start a break in the current session
 *   break_end   → end the open break
 *   summary     → JSON: today's worked time, task time logged today
 */

function handle_status(): void
{
    header('Content-Type: application/json');
    $uid = Auth::id();
    echo json_encode(_time_session_state($uid));
    exit;
}

function handle_clock_in(): void
{
    header('Content-Type: application/json');
    $uid = Auth::id();
    $open = DB::row('SELECT id FROM time_sessions WHERE user_id=:u AND clock_out_at IS NULL', ['u'=>$uid]);
    if ($open) {
        echo json_encode(['ok'=>false,'message'=>'Already clocked in.']);
        exit;
    }
    // ROUND 26 FIX: write via MySQL NOW() so the timestamp is always consistent
    // with the server's MySQL session timezone (avoids PHP-vs-MySQL TZ drift)
    DB::run('INSERT INTO time_sessions (user_id, clock_in_at) VALUES (:u, NOW())', ['u' => $uid]);
    $id = (int)DB::pdo()->lastInsertId();
    Audit::log('create','time_session',$id,'Clocked in');
    echo json_encode(['ok'=>true,'message'=>'Clocked in.','state'=>_time_session_state($uid)]);
    exit;
}

function handle_clock_out(): void
{
    header('Content-Type: application/json');
    $uid     = Auth::id();
    $notes   = trim((string)input('notes', ''));
    $session = DB::row('SELECT * FROM time_sessions WHERE user_id=:u AND clock_out_at IS NULL', ['u'=>$uid]);
    if (!$session) { echo json_encode(['ok'=>false,'message'=>'No active session.']); exit; }

    // End any open break first
    DB::run('UPDATE time_breaks SET end_at=NOW() WHERE session_id=:s AND end_at IS NULL', [':s'=>$session['id']]);

    // ROUND 26 FIX: use NOW() so the close uses the same TZ as the open
    DB::run(
        'UPDATE time_sessions SET clock_out_at = NOW(), notes = :notes WHERE id = :id',
        ['notes' => $notes ?: null, 'id' => $session['id']]
    );

    Audit::log('update','time_session',$session['id'],'Clocked out');
    echo json_encode(['ok'=>true,'message'=>'Clocked out.','state'=>_time_session_state($uid)]);
    exit;
}

function handle_break_start(): void
{
    header('Content-Type: application/json');
    $uid     = Auth::id();
    $session = DB::row('SELECT * FROM time_sessions WHERE user_id=:u AND clock_out_at IS NULL', ['u'=>$uid]);
    if (!$session) { echo json_encode(['ok'=>false,'message'=>'No active session.']); exit; }

    $openBreak = DB::row('SELECT id FROM time_breaks WHERE session_id=:s AND end_at IS NULL', [':s'=>$session['id']]);
    if ($openBreak) { echo json_encode(['ok'=>false,'message'=>'Already on break.']); exit; }

    // ROUND 26 FIX: write via NOW() — keeps everything in MySQL's clock
    DB::run('INSERT INTO time_breaks (session_id, start_at) VALUES (:s, NOW())', ['s' => $session['id']]);
    Audit::log('create','time_break',$session['id'],'Started break');
    echo json_encode(['ok'=>true,'message'=>'Break started.','state'=>_time_session_state($uid)]);
    exit;
}

function handle_break_end(): void
{
    header('Content-Type: application/json');
    $uid     = Auth::id();
    $session = DB::row('SELECT * FROM time_sessions WHERE user_id=:u AND clock_out_at IS NULL', ['u'=>$uid]);
    if (!$session) { echo json_encode(['ok'=>false,'message'=>'No active session.']); exit; }

    DB::run('UPDATE time_breaks SET end_at=NOW() WHERE session_id=:s AND end_at IS NULL', [':s'=>$session['id']]);
    Audit::log('update','time_break',$session['id'],'Ended break');
    echo json_encode(['ok'=>true,'message'=>'Back to work.','state'=>_time_session_state($uid)]);
    exit;
}

function handle_summary(): void
{
    header('Content-Type: application/json');
    $uid = Auth::id();

    // Time logged on tasks today (sum of actual_minutes for tasks/subtasks updated today by this user)
    // Simpler: sum actual_minutes for tasks where assignee = me AND updated today
    $taskMinutes = (int)DB::value(
        "SELECT COALESCE(SUM(actual_minutes),0) FROM tasks
         WHERE assignee_user_id = :uid AND DATE(updated_at) = CURDATE() AND deleted_at IS NULL",
        ['uid' => $uid]
    );
    $subtaskMinutes = (int)DB::value(
        "SELECT COALESCE(SUM(actual_minutes),0) FROM task_subtasks
         WHERE assignee_user_id = :uid AND DATE(updated_at) = CURDATE() AND deleted_at IS NULL",
        ['uid' => $uid]
    );

    $state = _time_session_state($uid);
    echo json_encode([
        'session'         => $state,
        'task_minutes'    => $taskMinutes + $subtaskMinutes,
        'task_breakdown'  => ['tasks' => $taskMinutes, 'subtasks' => $subtaskMinutes],
    ]);
    exit;
}

/**
 * Compute the current session state for a user.
 * Returns:
 *   status: 'out' | 'working' | 'break'
 *   session_id, clock_in_at, clock_out_at
 *   break_id, break_start_at (if on break)
 *   worked_minutes (in current session, excluding break time)
 *   break_minutes (total break time today)
 *   server_now (so client can sync drift)
 */
function _time_session_state(int $uid): array
{
    // ROUND 26 FIX: all datetime math now happens inside MySQL using
    //   UNIX_TIMESTAMP() and TIMESTAMPDIFF(SECOND, ...)
    // Previously we used PHP strtotime() on DB values, which interprets
    // them in PHP's default timezone — which can differ from MySQL's
    // session timezone on shared hosting, causing 8-12 hour inflation
    // after each break end on certain servers.
    //
    // By doing the diff inside MySQL, both sides of the subtraction
    // use the same reference frame and the result is always correct
    // regardless of timezone settings on either side.

    $session = DB::row(
        'SELECT id, user_id, clock_in_at, clock_out_at,
                UNIX_TIMESTAMP(clock_in_at) AS clock_in_unix,
                TIMESTAMPDIFF(SECOND, clock_in_at, NOW()) AS elapsed_sec,
                UNIX_TIMESTAMP(NOW()) AS server_now_unix
         FROM time_sessions
         WHERE user_id=:u AND clock_out_at IS NULL
         ORDER BY id DESC LIMIT 1',
        ['u'=>$uid]
    );

    // ROUND 35: detect stale session created before the round 26 TZ fix.
    // If clock_in_at is in the future (negative elapsed) or wildly far in the
    // past (more than 48h), the row was written with a different TZ than
    // MySQL's NOW(). Close it out cleanly so the next clock-in is fresh.
    if ($session) {
        $elapsed = (int)$session['elapsed_sec'];
        if ($elapsed < -60 || $elapsed > 172800) {  // < -1min  OR  > 48h
            error_log("[time] auto-closing stale session #{$session['id']} for user $uid (elapsed=$elapsed)");
            // Close any open break first
            DB::run('UPDATE time_breaks SET end_at = NOW() WHERE session_id=:s AND end_at IS NULL', [':s' => $session['id']]);
            // Close the session itself
            DB::run('UPDATE time_sessions SET clock_out_at = NOW(), notes = CONCAT(COALESCE(notes,""), " [auto-closed: stale TZ data]") WHERE id=:id', ['id' => $session['id']]);
            // Pretend there was no open session
            $session = null;
        }
    }

    if (!$session) {
        // ROUND 36: exclude auto-closed sessions and any session with
        // an absurd duration (>24h) — these are stale TZ-mismatched rows
        $closed = DB::row(
            "SELECT *,
                    TIMESTAMPDIFF(SECOND, clock_in_at, clock_out_at) AS total_sec
             FROM time_sessions
             WHERE user_id=:u
               AND DATE(clock_in_at)=CURDATE()
               AND clock_out_at IS NOT NULL
               AND (notes IS NULL OR notes NOT LIKE '%[auto-closed:%')
               AND TIMESTAMPDIFF(SECOND, clock_in_at, clock_out_at) BETWEEN 0 AND 86400
             ORDER BY id DESC LIMIT 1",
            ['u'=>$uid]
        );
        $closedMinutes = 0;
        if ($closed) {
            // Use MySQL-computed total; subtract any break time via MySQL too
            $breakSecClosed = (int)DB::value(
                "SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, start_at, end_at)), 0)
                 FROM time_breaks
                 WHERE session_id = :s AND end_at IS NOT NULL",
                ['s' => $closed['id']]
            );
            $workedSecClosed = max(0, (int)$closed['total_sec'] - $breakSecClosed);
            $closedMinutes   = intdiv($workedSecClosed, 60);
        }
        $userTz = DB::value('SELECT timezone FROM users WHERE id=:u', ['u'=>$uid]);
        return [
            'status'         => 'out',
            'user_timezone'  => $userTz ?: null,
            'server_now'     => date('c'),
            'today_minutes'  => $closedMinutes,
            'last_clock_out' => $closed['clock_out_at'] ?? null,
        ];
    }

    // Open session — pull break info with MySQL-side seconds-diff
    $breaks = DB::all(
        "SELECT id, session_id, start_at, end_at,
                TIMESTAMPDIFF(SECOND, start_at, COALESCE(end_at, NOW())) AS dur_sec,
                TIMESTAMPDIFF(SECOND, start_at, NOW())                   AS started_ago_sec
         FROM time_breaks
         WHERE session_id = :s
         ORDER BY id",
        [':s' => $session['id']]
    );

    $openBreak     = null;
    $totalBreakSec = 0;
    $breakStartedAgo = 0;
    foreach ($breaks as $b) {
        if (empty($b['end_at'])) {
            $openBreak       = $b;
            $breakStartedAgo = max(0, (int)$b['started_ago_sec']);
            // Open break time is NOT counted toward completed break_minutes,
            // it's reported separately so the client can show "On break · X".
        } else {
            $totalBreakSec += max(0, (int)$b['dur_sec']);
        }
    }

    $elapsedSec = max(0, (int)$session['elapsed_sec']);
    $workedSec  = $elapsedSec - $totalBreakSec;
    if ($openBreak) {
        $workedSec -= $breakStartedAgo;
    }
    $workedSec = max(0, $workedSec);

    $userTz = DB::value('SELECT timezone FROM users WHERE id=:u', ['u'=>$uid]);

    return [
        'status'                    => $openBreak ? 'break' : 'working',
        'user_timezone'             => $userTz ?: null,
        'server_now'                => date('c'),
        'session_id'                => (int)$session['id'],
        'clock_in_at'               => $session['clock_in_at'],
        'break_started_seconds_ago' => $breakStartedAgo,
        'worked_minutes'            => intdiv($workedSec, 60),
        'worked_seconds'            => $workedSec,
        'break_minutes'             => intdiv($totalBreakSec, 60),
        'break_id'                  => $openBreak ? (int)$openBreak['id'] : null,
        'break_start_at'            => $openBreak['start_at'] ?? null,
        'today_minutes'             => intdiv($workedSec, 60),
        // ROUND 35: diagnostic fields so we can see if the session has bad data
        'debug_elapsed_sec'         => $elapsedSec,
        'debug_total_break_sec'     => $totalBreakSec,
        'debug_clock_in_unix'       => (int)$session['clock_in_unix'],
        'debug_server_now_unix'     => (int)$session['server_now_unix'],
    ];
}

function _session_worked_minutes(array $session): int
{
    // ROUND 26 FIX: do all math in MySQL — never strtotime() a DB value
    // ROUND 36: reject corrupt sessions (>24h or negative)
    $totalSec = (int)DB::value(
        'SELECT TIMESTAMPDIFF(SECOND, clock_in_at, COALESCE(clock_out_at, NOW()))
         FROM time_sessions WHERE id = :id',
        ['id' => $session['id']]
    );
    if ($totalSec < 0 || $totalSec > 86400) return 0;
    $breakSec = (int)DB::value(
        'SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, start_at, COALESCE(end_at, NOW()))),0)
         FROM time_breaks WHERE session_id=:s',
        ['s' => $session['id']]
    );
    return max(0, intdiv($totalSec - $breakSec, 60));
}

function handle_index(): void
{
    // No standalone page yet — this module is API-only for the topbar widget
    render('_placeholder', ['title' => 'Time Tracking', 'page' => 'time', 'pageTitle' => 'Time']);
}


/* ============================================================
   ROUND 25 — Currently clocked-in users (for topbar widget)
   ============================================================ */
function handle_clocked_users(): void
{
    header('Content-Type: application/json');
    if (!Auth::id()) {
        echo json_encode(['ok' => false, 'users' => []]);
        exit;
    }

    $meId = Auth::id();

    // All users with an open session today (excluding self)
    // ROUND 26: do diff math in MySQL — never strtotime() DB datetimes
    $rows = DB::all(
        "SELECT u.id, u.first_name, u.last_name, u.profile_image,
                s.id AS session_id, s.clock_in_at,
                DATE_FORMAT(s.clock_in_at, '%l:%i %p') AS clock_in_human,
                TIMESTAMPDIFF(SECOND, s.clock_in_at, NOW()) AS clocked_in_sec,
                (SELECT b.start_at FROM time_breaks b
                  WHERE b.session_id = s.id AND b.end_at IS NULL
                  ORDER BY b.start_at DESC LIMIT 1) AS open_break_at,
                (SELECT TIMESTAMPDIFF(SECOND, b.start_at, NOW()) FROM time_breaks b
                  WHERE b.session_id = s.id AND b.end_at IS NULL
                  ORDER BY b.start_at DESC LIMIT 1) AS open_break_sec
         FROM time_sessions s
         INNER JOIN users u ON u.id = s.user_id
         WHERE s.clock_out_at IS NULL
           AND u.id != :me
           AND u.deleted_at IS NULL
         ORDER BY u.first_name ASC, u.last_name ASC"
    , [':me' => $meId]);

    $out = [];
    foreach ($rows as $r) {
        $onBreak      = !empty($r['open_break_at']);
        $clockedInSec = max(0, (int)$r['clocked_in_sec']);
        $breakSec     = $onBreak ? max(0, (int)$r['open_break_sec']) : 0;
        $fullName     = trim($r['first_name'] . ' ' . $r['last_name']);
        $initials     = strtoupper(mb_substr($r['first_name'] ?? '', 0, 1) . mb_substr($r['last_name'] ?? '', 0, 1));
        $out[] = [
            'id'              => (int)$r['id'],
            'name'            => $fullName,
            'initials'        => $initials,
            'image'           => $r['profile_image'] ?: null,
            'on_break'        => $onBreak,
            'clock_in_at'     => $r['clock_in_at'],
            'clock_in_human'  => trim((string)($r['clock_in_human'] ?? '')),
            'break_secs'      => $breakSec,
            'working_secs'    => $clockedInSec,
        ];
    }

    echo json_encode(['ok' => true, 'users' => $out]);
    exit;
}

function _fmt_clock_human(string $ts): string
{
    $t = strtotime($ts);
    if ($t === false) return $ts;
    return date('g:i A', $t);
}
