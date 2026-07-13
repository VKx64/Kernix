<?php
/**
 * Messages module — notifications inbox
 * Round 24
 *
 * Backed by task_notes.is_message=1 rows where assigned_user_id = current user.
 * No new tables. Filter, mark read, open task.
 *
 * Routes:
 *   ?p=messages                                 → handle_index    (inbox UI)
 *   ?p=messages&action=list                     → handle_list     (JSON list)
 *   ?p=messages&action=detail&id=N              → handle_detail   (JSON detail + mark read)
 *   ?p=messages&action=mark_read       (POST)   → handle_mark_read
 *   ?p=messages&action=mark_unread     (POST)   → handle_mark_unread
 *   ?p=messages&action=mark_all_read   (POST)   → handle_mark_all_read
 *   ?p=messages&action=unread_count             → handle_unread_count (JSON, for badge)
 */

/* ============================================================
   PUBLIC: counts helper used by other modules (e.g. topbar badge)
   ============================================================ */
function messages_unread_count(?int $userId = null): int
{
    $userId = $userId ?: Auth::id();
    if (!$userId) return 0;
    return (int)DB::value(
        "SELECT COUNT(*) FROM task_notes
         WHERE assigned_user_id = :uid
           AND is_message = 1
           AND read_at IS NULL
           AND deleted_at IS NULL",
        ['uid' => $userId]
    );
}

/* ============================================================
   INDEX — render the inbox page
   ============================================================ */
function handle_index(): void
{
    Perm::require('messages.view');
    $uid    = Auth::id();
    $filter = $_GET['f'] ?? 'unread';
    $unread = messages_unread_count($uid);

    render('messages_inbox', [
        'pageTitle' => 'Messages',
        'filter'    => $filter,
        'unread'    => $unread,
    ]);
}

/* ============================================================
   LIST — JSON: messages for current user, filterable
   ============================================================ */
function handle_list(): void
{
    Perm::require('messages.view');
    header('Content-Type: application/json');

    $uid    = Auth::id();
    $filter = $_GET['f'] ?? 'unread';

    $where  = ['n.assigned_user_id = :uid', 'n.is_message = 1', 'n.deleted_at IS NULL'];
    $params = ['uid' => $uid];

    if ($filter === 'unread') {
        $where[] = 'n.read_at IS NULL';
    }
    // 'all' adds nothing

    $rows = DB::all(
        "SELECT n.id, n.task_id, n.body, n.created_at, n.read_at, n.time_minutes,
                CONCAT(uc.first_name,' ',uc.last_name) AS sender_name,
                uc.profile_image AS sender_image,
                t.title AS task_title,
                cl.name AS client_name,
                p.name AS project_name
         FROM task_notes n
         LEFT JOIN users uc    ON uc.id = n.created_by
         LEFT JOIN tasks t     ON t.id  = n.task_id
         LEFT JOIN projects p  ON p.id  = t.project_id
         LEFT JOIN clients cl  ON cl.id = p.client_id
         WHERE " . implode(' AND ', $where) . "
         ORDER BY n.created_at DESC
         LIMIT 200",
        $params
    );

    $out = [];
    foreach ($rows as $r) {
        $bodyPreview = (string)($r['body'] ?? '');
        if (mb_strlen($bodyPreview) > 100) $bodyPreview = mb_substr($bodyPreview, 0, 100) . '…';
        $out[] = [
            'id'             => (int)$r['id'],
            'task_id'        => (int)$r['task_id'],
            'task_title'     => $r['task_title'] ?? 'Untitled task',
            'client_name'    => $r['client_name'] ?? null,
            'project_name'   => $r['project_name'] ?? null,
            'sender_name'    => trim((string)$r['sender_name']) ?: 'System',
            'sender_image'   => $r['sender_image'] ?? null,
            'sender_initials'=> strtoupper(mb_substr(trim((string)$r['sender_name']) ?: 'S', 0, 2)),
            'body'           => $bodyPreview,
            'time_minutes'   => $r['time_minutes'] ? (int)$r['time_minutes'] : null,
            'created_at'     => $r['created_at'],
            'created_human'  => _msg_humanize_time($r['created_at']),
            'is_unread'      => empty($r['read_at']),
        ];
    }

    echo json_encode([
        'ok'      => true,
        'rows'    => $out,
        'count'   => count($out),
        'unread'  => messages_unread_count($uid),
    ]);
    exit;
}

/* ============================================================
   DETAIL — JSON: full message + auto-mark-read
   ============================================================ */
function handle_detail(): void
{
    Perm::require('messages.view');
    header('Content-Type: application/json');
    $uid = Auth::id();
    $id  = input_int('id', 0);

    $row = DB::row(
        "SELECT n.*,
                CONCAT(uc.first_name,' ',uc.last_name) AS sender_name,
                uc.profile_image AS sender_image,
                t.title AS task_title,
                cl.name AS client_name,
                p.name AS project_name
         FROM task_notes n
         LEFT JOIN users uc    ON uc.id = n.created_by
         LEFT JOIN tasks t     ON t.id  = n.task_id
         LEFT JOIN projects p  ON p.id  = t.project_id
         LEFT JOIN clients cl  ON cl.id = p.client_id
         WHERE n.id = :id
           AND n.assigned_user_id = :uid
           AND n.is_message = 1
           AND n.deleted_at IS NULL",
        ['id' => $id, 'uid' => $uid]
    );

    if (!$row) {
        echo json_encode(['ok' => false, 'message' => 'Not found.']);
        exit;
    }

    // Auto-mark read on open
    $wasUnread = empty($row['read_at']);
    if ($wasUnread) {
        DB::run(
            "UPDATE task_notes SET read_at = NOW(), read_by_user_id = :uid_set
             WHERE id = :id AND assigned_user_id = :uid_where AND read_at IS NULL",
            ['uid_set' => $uid, 'uid_where' => $uid, 'id' => $id]
        );
    }

    // Pull attachments separately
    $atts = DB::all(
        "SELECT id, original_name, file_name, storage_path, storage_driver, mime_type, file_size
         FROM note_attachments
         WHERE note_id = :id",
        ['id' => $id]
    );
    $attUrls = array_map(function ($a) {
        return [
            'name' => $a['original_name'],
            'mime' => $a['mime_type'],
            'size' => (int)$a['file_size'],
            'url'  => Storage::url($a['storage_driver'] ?? 'local', $a['storage_path']),
        ];
    }, $atts);

    echo json_encode([
        'ok'              => true,
        'id'              => (int)$row['id'],
        'task_id'         => (int)$row['task_id'],
        'task_title'      => $row['task_title'] ?? 'Untitled task',
        'client_name'     => $row['client_name'] ?? null,
        'project_name'    => $row['project_name'] ?? null,
        'sender_name'     => trim((string)$row['sender_name']) ?: 'System',
        'sender_image'    => $row['sender_image'] ?? null,
        'sender_initials' => strtoupper(mb_substr(trim((string)$row['sender_name']) ?: 'S', 0, 2)),
        'body'            => $row['body'] ?? '',
        'time_minutes'    => $row['time_minutes'] ? (int)$row['time_minutes'] : null,
        'created_at'      => $row['created_at'],
        'created_human'   => _msg_humanize_time($row['created_at']),
        'attachments'     => $attUrls,
        'unread_total'    => messages_unread_count($uid),
        'was_unread'      => $wasUnread,
    ]);
    exit;
}

/* ============================================================
   MARK READ / UNREAD / ALL READ
   ============================================================ */
function handle_mark_read(): void
{
    Perm::require('messages.view');
    header('Content-Type: application/json');
    $uid = Auth::id();
    $id  = input_int('id', 0);
    if (!$id) { echo json_encode(['ok' => false]); exit; }

    DB::run(
        "UPDATE task_notes SET read_at = NOW(), read_by_user_id = :uid_set
         WHERE id = :id AND assigned_user_id = :uid_where AND read_at IS NULL",
        ['uid_set' => $uid, 'uid_where' => $uid, 'id' => $id]
    );

    echo json_encode(['ok' => true, 'unread_total' => messages_unread_count($uid)]);
    exit;
}

function handle_mark_unread(): void
{
    Perm::require('messages.view');
    header('Content-Type: application/json');
    $uid = Auth::id();
    $id  = input_int('id', 0);
    if (!$id) { echo json_encode(['ok' => false]); exit; }

    DB::run(
        "UPDATE task_notes SET read_at = NULL, read_by_user_id = NULL
         WHERE id = :id AND assigned_user_id = :uid",
        ['uid' => $uid, 'id' => $id]
    );

    echo json_encode(['ok' => true, 'unread_total' => messages_unread_count($uid)]);
    exit;
}

function handle_mark_all_read(): void
{
    Perm::require('messages.view');
    header('Content-Type: application/json');
    $uid = Auth::id();

    DB::run(
        "UPDATE task_notes SET read_at = NOW(), read_by_user_id = :uid_set
         WHERE assigned_user_id = :uid_where
           AND is_message = 1
           AND read_at IS NULL
           AND deleted_at IS NULL",
        ['uid_set' => $uid, 'uid_where' => $uid]
    );

    echo json_encode(['ok' => true, 'unread_total' => 0]);
    exit;
}

/* ============================================================
   UNREAD COUNT — JSON for the topbar/sidebar badge
   ============================================================ */
function handle_unread_count(): void
{
    Perm::require('messages.view');
    header('Content-Type: application/json');
    echo json_encode(['ok' => true, 'unread' => messages_unread_count()]);
    exit;
}

/* ============================================================
   HELPER — humanize a timestamp ("2h ago", "Yesterday", etc.)
   ============================================================ */
function _msg_humanize_time(string $ts): string
{
    $t = strtotime($ts);
    if ($t === false) return $ts;
    $diff = time() - $t;
    if ($diff < 60)      return 'just now';
    if ($diff < 3600)    return floor($diff / 60) . 'm ago';
    if ($diff < 86400)   return floor($diff / 3600) . 'h ago';
    if ($diff < 172800)  return 'Yesterday';
    if ($diff < 604800)  return floor($diff / 86400) . 'd ago';
    return date('M j', $t);
}
