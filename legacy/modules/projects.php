<?php
/**
 * Projects module.
 * Actions: index, save, delete, archive, shelf (AJAX)
 */

function handle_index(): void
{
    Perm::require('projects.view');

    $me      = Auth::user();
    $uid     = (int)$me['id'];
    $perPage = 100;
    $pageNum = max(1, input_int('page', 1));
    $qGlobal = trim((string)($_GET['q'] ?? ''));

    // Column filters
    $qName    = trim((string)($_GET['q_name']   ?? ''));
    $qClient  = trim((string)($_GET['q_client'] ?? ''));
    $fStatus  = trim((string)($_GET['f_status'] ?? ''));
    $fManager = trim((string)($_GET['f_manager']?? ''));
    $fromStart= trim((string)($_GET['from_start_date'] ?? ''));
    $toStart  = trim((string)($_GET['to_start_date']   ?? ''));
    $fromDue  = trim((string)($_GET['from_due_date']   ?? ''));
    $toDue    = trim((string)($_GET['to_due_date']     ?? ''));

    // Topbar toggles
    $tArchived = ($_GET['t_archived']  ?? '') === '1';
    $tMyProjs  = ($_GET['t_mine']      ?? '0') === '1'; // default off — show all projects, user can toggle to show only ones they manage

    $sort    = $_GET['sort'] ?? 'name';
    $dir     = ($_GET['dir'] ?? 'asc') === 'desc' ? 'DESC' : 'ASC';
    $allowed = ['name','created_at','start_date','due_date'];
    if (!in_array($sort, $allowed, true)) $sort = 'name';

    // global q injected below
    $where  = ['p.deleted_at IS NULL'];
    $params = [];

    $where[] = $tArchived ? 'p.archived_at IS NOT NULL' : 'p.archived_at IS NULL';
    // FIX (round 32): named placeholders cannot be reused — give each instance a unique name
    if ($qGlobal !== '') {
        $where[] = '(p.name LIKE :qg1 OR p.description LIKE :qg2 OR cl.name LIKE :qg3)';
        $params[':qg1'] = '%'.$qGlobal.'%';
        $params[':qg2'] = '%'.$qGlobal.'%';
        $params[':qg3'] = '%'.$qGlobal.'%';
    }

    if ($tMyProjs) {
        $where[] = 'p.manager_user_id = :myuid';
        $params[':myuid'] = $uid;
    }

    if ($qName   !== '') { $where[] = 'p.name LIKE :qn';  $params[':qn']  = '%'.$qName.'%'; }
    if ($qClient !== '') { $where[] = 'cl.name LIKE :qc'; $params[':qc']  = '%'.$qClient.'%'; }
    if ($fStatus !== '') {
        $ids = array_filter(explode(',', $fStatus));
        if ($ids) {
            $_names = [];
            foreach ($ids as $_i => $id) {
                $_n = ':_inp1_' . $_i;
                $_names[] = $_n;
                $params[$_n] = (int)$id;
            }
            $where[] = "p.status_value_id IN (" . implode(',', $_names) . ")";
        }
    }
    if ($fManager !== '') {
        $ids = array_filter(explode(',', $fManager));
        if ($ids && !$tMyProjs) {
            $_names = [];
            foreach ($ids as $_i => $id) {
                $_n = ':_inp2_' . $_i;
                $_names[] = $_n;
                $params[$_n] = (int)$id;
            }
            $where[] = "p.manager_user_id IN (" . implode(',', $_names) . ")";
        }
    }
    if ($fromStart !== '') { $where[] = 'p.start_date >= :fs'; $params[':fs'] = $fromStart; }
    if ($toStart   !== '') { $where[] = 'p.start_date <= :ts'; $params[':ts'] = $toStart; }
    if ($fromDue   !== '') { $where[] = 'p.due_date >= :fd';   $params[':fd'] = $fromDue; }
    if ($toDue     !== '') { $where[] = 'p.due_date <= :td';   $params[':td'] = $toDue; }

    $whereSQL = implode(' AND ', $where);

    $baseSQL = "FROM projects p
        LEFT JOIN clients cl   ON cl.id = p.client_id
        LEFT JOIN field_values sv ON sv.id = p.status_value_id
        LEFT JOIN users m      ON m.id = p.manager_user_id
        WHERE $whereSQL";

    $total  = (int)DB::value("SELECT COUNT(*) $baseSQL", $params);
    $offset = ($pageNum - 1) * $perPage;

    $rows = DB::all(
        "SELECT p.*,
                cl.name AS client_name,
                sv.label AS status_label, sv.color AS status_color,
                CONCAT(m.first_name,' ',m.last_name) AS manager_name,
                (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.deleted_at IS NULL) AS task_count,
                (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.deleted_at IS NULL
                  AND t.status_value_id IN (SELECT id FROM field_values WHERE key_name='complete')) AS done_count
         $baseSQL
         ORDER BY p.`$sort` $dir
         LIMIT :lim OFFSET :off",
        array_merge($params, [':lim' => $perPage, ':off' => $offset])
    );

    $clients       = DB::all("SELECT id, name FROM clients WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY name");
    $users         = DB::all("SELECT id, first_name, last_name FROM users WHERE deleted_at IS NULL AND status='active' ORDER BY first_name");
    $statusValues  = field_values('project_status');

    render('projects_list', [
        'pageTitle'    => 'Projects',
        'rows'         => $rows,
        'total'        => $total,
        'perPage'      => $perPage,
        'pageNum'      => $pageNum,
        'sort'         => $sort,
        'dir'          => strtolower($dir),
        'tArchived'    => $tArchived,
        'tMyProjs'     => $tMyProjs,
        'clients'      => $clients,
        'users'        => $users,
        'statusValues' => $statusValues,
        'currentUserId'=> $uid,
    ]);
}

function handle_save(): void
{
    Perm::require('projects.create');
    header('Content-Type: application/json');

    $id       = input_int('id', 0);
    $name     = trim((string)input('name', ''));
    $clientId = input_int('client_id', 0);

    // In single-client mode, ignore whatever the form submitted and force
    // the singleton client. The UI submits a hidden field with this value
    // already, but we re-stamp here as a defensive measure.
    if (is_single_client_mode()) {
        $singleId = single_client_id();
        if ($singleId) $clientId = $singleId;
    }

    $errors = [];
    if ($name === '')  $errors['name']      = 'Project name is required.';
    if (!$clientId)    $errors['client_id'] = 'Please select a client.';
    if ($errors) { echo json_encode(['ok'=>false,'errors'=>$errors]); exit; }

    $data = [
        'client_id'       => $clientId,
        'name'            => $name,
        'description'     => trim((string)input('description', '')),
        'status_value_id' => input_int('status_value_id') ?: null,
        'manager_user_id' => input_int('manager_user_id') ?: null,
        'start_date'      => input('start_date', '') ?: null,
        'due_date'        => input('due_date',   '') ?: null,
    ];

    if ($id) {
        Perm::require('projects.edit');
        $old = DB::row('SELECT * FROM projects WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]);
        if (!$old) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
        DB::update('projects', $data, ['id'=>$id]);
        Audit::log('update', 'project', $id, "Updated: $name", Audit::diff($old, $data));
        echo json_encode(['ok'=>true,'message'=>'Project updated.']);
    } else {
        $data['created_by'] = Auth::id();
        $newId = DB::insert('projects', $data);
        Audit::log('create', 'project', $newId, "Created: $name");
        echo json_encode(['ok'=>true,'message'=>'Project created.','project_id'=>$newId]);
    }
    exit;
}

function handle_delete(): void
{
    Perm::require('projects.delete');
    header('Content-Type: application/json');
    $id  = input_int('id', 0);
    $row = $id ? DB::row('SELECT name FROM projects WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]) : null;
    if (!$row) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
    DB::softDelete('projects', $id);
    Audit::log('delete', 'project', $id, 'Deleted: '.$row['name']);
    echo json_encode(['ok'=>true,'message'=>'Project deleted.']);
    exit;
}

function handle_archive(): void
{
    Perm::require('projects.archive');
    header('Content-Type: application/json');
    $id  = input_int('id', 0);
    $row = $id ? DB::row('SELECT name,archived_at FROM projects WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]) : null;
    if (!$row) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
    if ($row['archived_at']) {
        DB::unarchive('projects', $id);
        Audit::log('unarchive', 'project', $id, 'Unarchived: '.$row['name']);
        echo json_encode(['ok'=>true,'message'=>'Project restored.']);
    } else {
        DB::archive('projects', $id);
        Audit::log('archive', 'project', $id, 'Archived: '.$row['name']);
        echo json_encode(['ok'=>true,'message'=>'Project archived.']);
    }
    exit;
}

/** AJAX — project shelf */
function handle_shelf(): void
{
    Perm::require('projects.view');
    $id      = input_int('id', 0);
    $project = $id ? DB::row(
        "SELECT p.*, cl.name AS client_name,
                sv.label AS status_label, sv.color AS status_color,
                CONCAT(m.first_name,' ',m.last_name) AS manager_name,
                m.id AS manager_id
         FROM projects p
         LEFT JOIN clients cl   ON cl.id = p.client_id
         LEFT JOIN field_values sv ON sv.id = p.status_value_id
         LEFT JOIN users m      ON m.id = p.manager_user_id
         WHERE p.id=:id AND p.deleted_at IS NULL",
        ['id'=>$id]
    ) : null;

    if (!$project) {
        echo '<div style="padding:40px;text-align:center;color:var(--text-muted)">Project not found.</div>';
        exit;
    }

    // Tasks for this project
    $tasks = DB::all(
        "SELECT t.*,
                sv_s.label AS status_label, sv_s.color AS status_color,
                sv_u.label AS urgency_label, sv_u.key_name AS urgency_key,
                CONCAT(u.first_name,' ',u.last_name) AS assignee_name
         FROM tasks t
         LEFT JOIN field_values sv_s ON sv_s.id = t.status_value_id
         LEFT JOIN field_values sv_u ON sv_u.id = t.urgency_value_id
         LEFT JOIN users u ON u.id = t.assignee_user_id
         WHERE t.project_id=:pid AND t.deleted_at IS NULL AND t.archived_at IS NULL
         ORDER BY t.due_date ASC, t.created_at ASC",
        [':pid'=>$id]
    );

    $users        = DB::all("SELECT id,first_name,last_name FROM users WHERE deleted_at IS NULL AND status='active' ORDER BY first_name");
    $statusValues = field_values('task_status');
    $urgValues    = field_values('task_urgency');
    $typeValues   = field_values('task_type');

    require VIEWS_PATH . '/projects_shelf.php';
    exit;
}
