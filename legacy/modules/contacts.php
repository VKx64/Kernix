<?php
/**
 * Contacts module — column-filter aware.
 */

function handle_index(): void
{
    Perm::require('contacts.view');

    $perPage = 100;
    $pageNum = max(1, input_int('page', 1));
    $qGlobal = trim((string)($_GET['q'] ?? ''));

    $qName    = trim((string)($_GET['q_name']   ?? ''));
    $qTitle   = trim((string)($_GET['q_title']  ?? ''));
    $qEmail   = trim((string)($_GET['q_email']  ?? ''));
    $qPhone   = trim((string)($_GET['q_phone']  ?? ''));
    $fClient  = trim((string)($_GET['f_client'] ?? ''));
    $fStatus  = trim((string)($_GET['f_status'] ?? ''));
    $fromDate = trim((string)($_GET['from_created'] ?? ''));
    $toDate   = trim((string)($_GET['to_created']   ?? ''));

    $tArchived = ($_GET['t_archived'] ?? '') === '1';

    $sort = $_GET['sort'] ?? 'last_name';
    $dir  = ($_GET['dir'] ?? 'asc') === 'desc' ? 'DESC' : 'ASC';
    $allowed = ['last_name','first_name','email','created_at'];
    if (!in_array($sort, $allowed, true)) $sort = 'last_name';
    $sortCol = "ct.$sort";

    // global q injected below
    $where  = ['ct.deleted_at IS NULL'];
    $params = [];

    $where[] = $tArchived ? 'ct.archived_at IS NOT NULL' : 'ct.archived_at IS NULL';
    // FIX (round 32): named placeholders cannot be reused — give each instance a unique name
    if ($qGlobal !== '') {
        $where[] = '(ct.first_name LIKE :qg1 OR ct.last_name LIKE :qg2 OR ct.title LIKE :qg3 OR ct.email LIKE :qg4 OR cl.name LIKE :qg5)';
        $params[':qg1'] = '%'.$qGlobal.'%';
        $params[':qg2'] = '%'.$qGlobal.'%';
        $params[':qg3'] = '%'.$qGlobal.'%';
        $params[':qg4'] = '%'.$qGlobal.'%';
        $params[':qg5'] = '%'.$qGlobal.'%';
    }

    if ($qName !== '') {
        $where[] = '(ct.first_name LIKE :qn_first OR ct.last_name LIKE :qn_last)';
        $params[':qn_first'] = '%'.$qName.'%';
        $params[':qn_last']  = '%'.$qName.'%';
    }
    if ($qTitle !== '') { $where[] = 'ct.title LIKE :qt'; $params[':qt'] = '%'.$qTitle.'%'; }
    if ($qEmail !== '') { $where[] = 'ct.email LIKE :qe'; $params[':qe'] = '%'.$qEmail.'%'; }
    if ($qPhone !== '') {
        $where[] = '(ct.phone_1 LIKE :qp_primary OR ct.phone_2 LIKE :qp_secondary)';
        $params[':qp_primary']   = '%'.$qPhone.'%';
        $params[':qp_secondary'] = '%'.$qPhone.'%';
    }
    if ($fClient !== '') {
        $ids = array_filter(explode(',', $fClient));
        if ($ids) {
            $_names = [];
            foreach ($ids as $_i => $id) {
                $_n = ':_inp1_' . $_i;
                $_names[] = $_n;
                $params[$_n] = (int)$id;
            }
            $where[] = "ct.client_id IN (" . implode(',', $_names) . ")";
        }
    }
    if ($fStatus !== '') {
        $ids = array_filter(explode(',', $fStatus));
        if ($ids) {
            $_names = [];
            foreach ($ids as $_i => $_v) {
                $_n = ':cstat_' . $_i;
                $_names[] = $_n;
                $params[$_n] = $_v;
            }
            $where[] = "ct.status IN (" . implode(',', $_names) . ")";
        }
    }
    if ($fromDate !== '') { $where[] = 'DATE(ct.created_at) >= :fd'; $params[':fd'] = $fromDate; }
    if ($toDate   !== '') { $where[] = 'DATE(ct.created_at) <= :td'; $params[':td'] = $toDate; }

    $whereSQL = implode(' AND ', $where);

    $total = (int)DB::value(
        "SELECT COUNT(*) FROM contacts ct LEFT JOIN clients cl ON cl.id=ct.client_id WHERE $whereSQL", $params
    );

    $offset = ($pageNum - 1) * $perPage;
    $rows   = DB::all(
        "SELECT ct.*, cl.name AS client_name
         FROM contacts ct LEFT JOIN clients cl ON cl.id=ct.client_id
         WHERE $whereSQL ORDER BY $sortCol $dir LIMIT :lim OFFSET :off",
        array_merge($params, [':lim'=>$perPage, ':off'=>$offset])
    );

    $clients = DB::all("SELECT id, name FROM clients WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY name");

    render('contacts_list', [
        'pageTitle' => 'Contacts',
        'rows'      => $rows,
        'total'     => $total,
        'perPage'   => $perPage,
        'pageNum'   => $pageNum,
        'sort'      => $sort,
        'dir'       => strtolower($dir),
        'tArchived' => $tArchived,
        'clients'   => $clients,
    ]);
}

function handle_save(): void
{
    Perm::require('contacts.create');
    header('Content-Type: application/json');
    $id        = input_int('id', 0);
    $firstName = trim((string)input('first_name', ''));
    $clientId  = input_int('client_id', 0);

    // In single-client mode, auto-attach to the singleton client.
    if (is_single_client_mode()) {
        $singleId = single_client_id();
        if ($singleId) $clientId = $singleId;
    }

    $errors    = [];
    if ($firstName === '') $errors['first_name'] = 'First name is required.';
    if (!$clientId)        $errors['client_id']  = 'Please select a client.';
    if ($errors) { echo json_encode(['ok'=>false,'errors'=>$errors]); exit; }
    $data = [
        'client_id'  => $clientId,
        'first_name' => $firstName,
        'last_name'  => trim((string)input('last_name','')),
        'title'      => trim((string)input('title','')),
        'email'      => trim((string)input('email','')),
        'phone_1'    => trim((string)input('phone_1','')),
        'phone_2'    => trim((string)input('phone_2','')),
        'notes'      => trim((string)input('notes','')),
        'status'     => input('status','active') === 'inactive' ? 'inactive' : 'active',
    ];
    if ($id) {
        Perm::require('contacts.edit');
        $old = DB::row('SELECT * FROM contacts WHERE id=:id AND deleted_at IS NULL',['id'=>$id]);
        if (!$old) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
        DB::update('contacts',$data,['id'=>$id]);
        Audit::log('update','contact',$id,"Updated: $firstName",Audit::diff($old,$data));
        echo json_encode(['ok'=>true,'message'=>'Contact updated.']);
    } else {
        $data['created_by'] = Auth::id();
        $newId = DB::insert('contacts',$data);
        Audit::log('create','contact',$newId,"Created: $firstName");
        echo json_encode(['ok'=>true,'message'=>'Contact created.']);
    }
    exit;
}

function handle_delete(): void
{
    Perm::require('contacts.delete');
    header('Content-Type: application/json');
    $id  = input_int('id',0);
    $row = $id ? DB::row('SELECT first_name,last_name FROM contacts WHERE id=:id AND deleted_at IS NULL',['id'=>$id]) : null;
    if (!$row) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
    DB::softDelete('contacts',$id);
    Audit::log('delete','contact',$id,'Deleted: '.$row['first_name']);
    echo json_encode(['ok'=>true,'message'=>'Contact deleted.']);
    exit;
}

function handle_archive(): void
{
    Perm::require('contacts.archive');
    header('Content-Type: application/json');
    $id  = input_int('id',0);
    $row = $id ? DB::row('SELECT first_name,archived_at FROM contacts WHERE id=:id AND deleted_at IS NULL',['id'=>$id]) : null;
    if (!$row) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
    if ($row['archived_at']) {
        DB::unarchive('contacts',$id);
        Audit::log('unarchive','contact',$id,'Unarchived: '.$row['first_name']);
        echo json_encode(['ok'=>true,'message'=>'Contact restored.']);
    } else {
        DB::archive('contacts',$id);
        Audit::log('archive','contact',$id,'Archived: '.$row['first_name']);
        echo json_encode(['ok'=>true,'message'=>'Contact archived.']);
    }
    exit;
}
