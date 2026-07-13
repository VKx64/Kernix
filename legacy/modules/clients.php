<?php
/**
 * Clients module — timezone field + global q search.
 */

/**
 * When single-client mode is on, the Clients page is disabled — the single
 * client is managed inline from Settings → System instead. Call this from
 * every handler in this module. If JSON action, returns JSON; otherwise
 * redirects to dashboard with a flash message.
 */
function _clients_guard_single_client_mode(): void
{
    if (!is_single_client_mode()) return;

    // Is this an AJAX/JSON action? (save/delete/archive return JSON)
    $isJson = in_array($_GET['action'] ?? '', ['save','delete','archive'], true);
    if ($isJson) {
        header('Content-Type: application/json');
        http_response_code(403);
        echo json_encode([
            'ok'      => false,
            'message' => 'Clients page is disabled — single-client mode is on. Manage the client in Settings → System.',
        ]);
        exit;
    }

    flash('info', 'Clients page is disabled — single-client mode is on. Manage the client in Settings → System.');
    header('Location: ' . url('settings', ['section' => 'system']));
    exit;
}

function handle_index(): void
{
    _clients_guard_single_client_mode();

    // ROUND 33: instrumentation
    ini_set('display_errors', '1');
    ini_set('display_startup_errors', '1');
    error_reporting(E_ALL);
    set_error_handler(function ($severity, $message, $file, $line) {
        if (!(error_reporting() & $severity)) return false;
        throw new ErrorException($message, 0, $severity, $file, $line);
    });

    try {
        Perm::require('clients.view');

    $perPage = 100;
    $pageNum = max(1, input_int('page', 1));

    $qName    = trim((string)($_GET['q_name']   ?? ''));
    $qEmail   = trim((string)($_GET['q_email']  ?? ''));
    $qPhone   = trim((string)($_GET['q_phone']  ?? ''));
    $qGlobal  = trim((string)($_GET['q']        ?? ''));
    $fStatus  = trim((string)($_GET['f_status'] ?? ''));
    $fTz      = trim((string)($_GET['f_tz']     ?? ''));
    $fromDate = trim((string)($_GET['from_created'] ?? ''));
    $toDate   = trim((string)($_GET['to_created']   ?? ''));

    $tArchived = ($_GET['t_archived'] ?? '') === '1';

    $sort = $_GET['sort'] ?? 'name';
    $dir  = ($_GET['dir'] ?? 'asc') === 'desc' ? 'DESC' : 'ASC';
    $allowed = ['name','created_at'];
    if (!in_array($sort, $allowed, true)) $sort = 'name';

    $where  = ['c.deleted_at IS NULL'];
    $params = [];

    $where[] = $tArchived ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL';

    // FIX (round 32): named placeholders cannot be reused — give each instance a unique name
    if ($qGlobal !== '') {
        $where[] = '(c.name LIKE :qg1 OR c.email LIKE :qg2 OR c.phone LIKE :qg3 OR c.city LIKE :qg4)';
        $params[':qg1'] = '%'.$qGlobal.'%';
        $params[':qg2'] = '%'.$qGlobal.'%';
        $params[':qg3'] = '%'.$qGlobal.'%';
        $params[':qg4'] = '%'.$qGlobal.'%';
    }
    if ($qName   !== '') { $where[] = 'c.name LIKE :qn';  $params[':qn']  = '%'.$qName.'%'; }
    if ($qEmail  !== '') { $where[] = 'c.email LIKE :qe'; $params[':qe']  = '%'.$qEmail.'%'; }
    if ($qPhone  !== '') { $where[] = 'c.phone LIKE :qph';$params[':qph'] = '%'.$qPhone.'%'; }
    if ($fStatus !== '') {
        $ids = array_filter(explode(',', $fStatus));
        if ($ids) {
            $names = [];
            foreach ($ids as $i => $id) {
                $n = ':st_' . $i;
                $names[] = $n;
                $params[$n] = (int)$id;
            }
            $where[] = "c.status_value_id IN (" . implode(',', $names) . ")";
        }
    }
    if ($fTz !== '') {
        $tzs = array_filter(explode(',', $fTz));
        if ($tzs) {
            $names = [];
            foreach ($tzs as $i => $tz) {
                $n = ':tz_' . $i;
                $names[] = $n;
                $params[$n] = $tz;
            }
            $where[] = "c.timezone IN (" . implode(',', $names) . ")";
        }
    }
    if ($fromDate !== '') { $where[] = 'DATE(c.created_at) >= :fd'; $params[':fd'] = $fromDate; }
    if ($toDate   !== '') { $where[] = 'DATE(c.created_at) <= :td'; $params[':td'] = $toDate; }

    $whereSQL = implode(' AND ', $where);
    $total = (int)DB::value("SELECT COUNT(*) FROM clients c WHERE $whereSQL", $params);

    $offset = ($pageNum - 1) * $perPage;
    $rows   = DB::all(
        "SELECT c.*, fv.label AS status_label, fv.color AS status_color,
                (SELECT COUNT(*) FROM contacts ct WHERE ct.client_id=c.id AND ct.deleted_at IS NULL) AS contact_count,
                (SELECT COUNT(*) FROM projects p WHERE p.client_id=c.id AND p.deleted_at IS NULL) AS project_count
         FROM clients c
         LEFT JOIN field_values fv ON fv.id = c.status_value_id
         WHERE $whereSQL
         ORDER BY c.`$sort` $dir
         LIMIT :lim OFFSET :off",
        array_merge($params, [':lim' => $perPage, ':off' => $offset])
    );

    $statusValues = field_values('client_status');
    $tzInUse = DB::all("SELECT DISTINCT timezone FROM clients WHERE timezone IS NOT NULL AND timezone != '' AND deleted_at IS NULL ORDER BY timezone");

    render('clients_list', [
        'pageTitle'    => 'Clients',
        'rows'         => $rows,
        'total'        => $total,
        'perPage'      => $perPage,
        'pageNum'      => $pageNum,
        'sort'         => $sort,
        'dir'          => strtolower($dir),
        'tArchived'    => $tArchived,
        'statusValues' => $statusValues,
        'tzInUse'      => $tzInUse,
    ]);
    } catch (\Throwable $e) {
        while (ob_get_level() > 0) ob_end_clean();
        http_response_code(500);
        echo '<!doctype html><html><head><title>Clients Error</title>';
        echo '<style>body{font-family:system-ui,sans-serif;background:#1a0d2e;color:#fff;padding:30px;max-width:900px;margin:auto}';
        echo 'h1{color:#f87171}pre{background:rgba(0,0,0,.3);padding:14px;border-radius:8px;font-size:11px;white-space:pre-wrap;line-height:1.7}';
        echo '.box{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);padding:14px;border-radius:8px;font-family:ui-monospace,monospace;font-size:12px;line-height:1.7;margin-bottom:14px}';
        echo '</style></head><body>';
        echo '<h1>Clients Error</h1>';
        echo '<div class="box">';
        echo '<div><strong>Type:</strong> ' . htmlspecialchars(get_class($e)) . '</div>';
        echo '<div><strong>Message:</strong> ' . htmlspecialchars($e->getMessage()) . '</div>';
        echo '<div><strong>File:</strong> ' . htmlspecialchars($e->getFile()) . ' line ' . $e->getLine() . '</div>';
        echo '<div><strong>Query string:</strong> ' . htmlspecialchars($_SERVER['QUERY_STRING'] ?? '') . '</div>';
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
    _clients_guard_single_client_mode();
    Perm::require('clients.create');
    header('Content-Type: application/json');
    $id   = input_int('id', 0);
    $name = trim((string)input('name', ''));
    $errors = [];
    if ($name === '') $errors['name'] = 'Client name is required.';
    if ($errors) { echo json_encode(['ok'=>false,'errors'=>$errors]); exit; }
    $data = [
        'name'            => $name,
        'website'         => trim((string)input('website','')),
        'email'           => trim((string)input('email','')),
        'phone'           => trim((string)input('phone','')),
        'address'         => trim((string)input('address','')),
        'city'            => trim((string)input('city','')),
        'province'        => trim((string)input('province','')),
        'zip_code'        => trim((string)input('zip_code','')),
        'country'         => trim((string)input('country','')),
        'timezone'        => trim((string)input('timezone','')) ?: null,
        'notes'           => trim((string)input('notes','')),
        'status_value_id' => input_int('status_value_id') ?: null,
    ];
    if ($id) {
        Perm::require('clients.edit');
        $old = DB::row('SELECT * FROM clients WHERE id=:id AND deleted_at IS NULL',['id'=>$id]);
        if (!$old) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
        DB::update('clients',$data,['id'=>$id]);
        Audit::log('update','client',$id,"Updated: $name",Audit::diff($old,$data));
        echo json_encode(['ok'=>true,'message'=>'Client updated.']);
    } else {
        $data['created_by'] = Auth::id();
        $newId = DB::insert('clients',$data);
        Audit::log('create','client',$newId,"Created: $name");
        echo json_encode(['ok'=>true,'message'=>'Client created.']);
    }
    exit;
}

function handle_delete(): void
{
    _clients_guard_single_client_mode();
    Perm::require('clients.delete');
    header('Content-Type: application/json');
    $id  = input_int('id', 0);
    $row = $id ? DB::row('SELECT name FROM clients WHERE id=:id AND deleted_at IS NULL',['id'=>$id]) : null;
    if (!$row) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
    DB::softDelete('clients',$id);
    Audit::log('delete','client',$id,'Deleted: '.$row['name']);
    echo json_encode(['ok'=>true,'message'=>'Client deleted.']);
    exit;
}

function handle_archive(): void
{
    _clients_guard_single_client_mode();
    Perm::require('clients.archive');
    header('Content-Type: application/json');
    $id  = input_int('id', 0);
    $row = $id ? DB::row('SELECT name,archived_at FROM clients WHERE id=:id AND deleted_at IS NULL',['id'=>$id]) : null;
    if (!$row) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
    if ($row['archived_at']) {
        DB::unarchive('clients',$id);
        Audit::log('unarchive','client',$id,'Unarchived: '.$row['name']);
        echo json_encode(['ok'=>true,'message'=>'Client restored.']);
    } else {
        DB::archive('clients',$id);
        Audit::log('archive','client',$id,'Archived: '.$row['name']);
        echo json_encode(['ok'=>true,'message'=>'Client archived.']);
    }
    exit;
}
