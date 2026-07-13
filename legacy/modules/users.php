<?php
/**
 * Users module.
 */

function handle_index(): void
{
    Perm::require('users.view');

    $perPage   = 100;
    $pageNum   = max(1, input_int('page', 1));
    $qName     = trim((string)($_GET['q_name']   ?? ''));
    $qEmail    = trim((string)($_GET['q_email']  ?? ''));
    $fRole     = trim((string)($_GET['f_role']   ?? ''));
    $fStatus   = trim((string)($_GET['f_status'] ?? ''));
    $tArchived = ($_GET['t_archived'] ?? '') === '1';
    $sort      = $_GET['sort'] ?? 'first_name';
    $dir       = ($_GET['dir'] ?? 'asc') === 'desc' ? 'DESC' : 'ASC';
    $allowed   = ['first_name','last_name','username','created_at'];
    if (!in_array($sort, $allowed, true)) $sort = 'first_name';

    $where  = ['u.deleted_at IS NULL'];
    $params = [];
    $where[] = $tArchived ? 'u.archived_at IS NOT NULL' : 'u.archived_at IS NULL';

    if ($qName !== '') {
        $where[] = '(u.first_name LIKE :qn_first OR u.last_name LIKE :qn_last)';
        $params[':qn_first'] = '%'.$qName.'%';
        $params[':qn_last']  = '%'.$qName.'%';
    }
    if ($qEmail !== '') {
        $where[] = '(u.imagic_email LIKE :qe_imagic OR u.personal_email LIKE :qe_personal)';
        $params[':qe_imagic']   = '%'.$qEmail.'%';
        $params[':qe_personal'] = '%'.$qEmail.'%';
    }
    if ($fRole  !== '') {
        $ids = array_filter(explode(',', $fRole));
        if ($ids) {
            $placeholders = [];
            foreach ($ids as $i => $id) {
                $name = ':role_' . $i;
                $placeholders[] = $name;
                $params[$name] = (int)$id;
            }
            $where[] = 'u.role_id IN (' . implode(',', $placeholders) . ')';
        }
    }
    if ($fStatus !== '') { $where[] = 'u.status = :st'; $params[':st'] = $fStatus; }

    $whereSQL = implode(' AND ', $where);
    $total    = (int)DB::value("SELECT COUNT(*) FROM users u WHERE $whereSQL", $params);
    $offset   = ($pageNum - 1) * $perPage;

    $rows = DB::all(
        "SELECT u.*, r.name AS role_name, r.key_name AS role_key
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         WHERE $whereSQL ORDER BY u.`$sort` $dir LIMIT :lim OFFSET :off",
        array_merge($params, [':lim'=>$perPage, ':off'=>$offset])
    );

    $roles = DB::all("SELECT id, name, key_name FROM roles WHERE deleted_at IS NULL ORDER BY sort_order");
    $depts = field_values('user_department');

    render('users_list', [
        'pageTitle'  => 'Users',
        'rows'       => $rows,
        'total'      => $total,
        'perPage'    => $perPage,
        'pageNum'    => $pageNum,
        'sort'       => $sort,
        'dir'        => strtolower($dir),
        'tArchived'  => $tArchived,
        'roles'      => $roles,
        'depts'      => $depts,
    ]);
}

function handle_save(): void
{
    Perm::require('users.create');
    header('Content-Type: application/json');

    $id        = input_int('id', 0);
    $username  = trim((string)input('username', ''));
    $firstName = trim((string)input('first_name', ''));
    $roleId    = input_int('role_id', 0);

    $errors = [];
    if ($username  === '') $errors['username']   = 'Username is required.';
    if ($firstName === '') $errors['first_name'] = 'First name is required.';
    if (!$roleId)          $errors['role_id']    = 'Please select a role.';

    // Username uniqueness
    if ($username !== '') {
        $exists = DB::value(
            'SELECT id FROM users WHERE username=:u AND deleted_at IS NULL AND id != :id',
            ['u'=>$username, 'id'=>$id]
        );
        if ($exists) $errors['username'] = 'Username already taken.';
    }

    if ($errors) { echo json_encode(['ok'=>false,'errors'=>$errors]); exit; }

    $data = [
        'username'             => $username,
        'first_name'           => $firstName,
        'last_name'            => trim((string)input('last_name', '')),
        'role_id'              => $roleId,
        'imagic_email'         => trim((string)input('imagic_email', '')),
        'personal_email'       => trim((string)input('personal_email', '')),
        'phone_1'              => trim((string)input('phone_1', '')),
        'phone_2'              => trim((string)input('phone_2', '')),
        'department_value_id'  => input_int('department_value_id') ?: null,
        'wise_account'         => trim((string)input('wise_account', '')),
        'gcash_account'        => trim((string)input('gcash_account', '')),
        'start_date'           => input('start_date', '') ?: null,
        'birthdate'            => input('birthdate', '') ?: null,
        'status'               => input('status', 'active') === 'inactive' ? 'inactive' : 'active',
        'home_address'         => trim((string)input('home_address', '')),
        'barangay'             => trim((string)input('barangay', '')),
        'city'                 => trim((string)input('city', '')),
        'province'             => trim((string)input('province', '')),
        'zip_code'             => trim((string)input('zip_code', '')),
        'timezone'             => trim((string)input('timezone', '')) ?: null,
    ];

    // Password
    $password = (string)input('password', '');
    if (!$id && $password === '') {
        echo json_encode(['ok'=>false,'errors'=>['password'=>'Password is required for new users.']]); exit;
    }
    if ($password !== '') {
        if (strlen($password) < PASSWORD_MIN_LEN) {
            echo json_encode(['ok'=>false,'errors'=>['password'=>'Password must be at least '.PASSWORD_MIN_LEN.' characters.']]); exit;
        }
        $data['password_hash'] = Auth::hash($password);
    }

    if ($id) {
        Perm::require('users.edit');
        $old = DB::row('SELECT * FROM users WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]);
        if (!$old) { echo json_encode(['ok'=>false,'message'=>'User not found.']); exit; }
        DB::update('users', $data, ['id'=>$id]);
        Audit::log('update','user',$id,"Updated user: $username", Audit::diff($old, array_diff_key($data,['password_hash'=>''])));
        echo json_encode(['ok'=>true,'message'=>'User updated.']);
    } else {
        $newId = DB::insert('users', $data);
        Audit::log('create','user',$newId,"Created user: $username");
        echo json_encode(['ok'=>true,'message'=>'User created.']);
    }
    exit;
}

function handle_delete(): void
{
    Perm::require('users.delete');
    header('Content-Type: application/json');
    if (input_int('id') === Auth::id()) {
        echo json_encode(['ok'=>false,'message'=>'You cannot delete your own account.']); exit;
    }
    $id  = input_int('id', 0);
    $row = $id ? DB::row('SELECT username FROM users WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]) : null;
    if (!$row) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
    DB::softDelete('users', $id);
    Audit::log('delete','user',$id,'Deleted user: '.$row['username']);
    echo json_encode(['ok'=>true,'message'=>'User deleted.']);
    exit;
}

function handle_archive(): void
{
    Perm::require('users.archive');
    header('Content-Type: application/json');
    $id  = input_int('id', 0);
    $row = $id ? DB::row('SELECT username,archived_at FROM users WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]) : null;
    if (!$row) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
    if ($row['archived_at']) {
        DB::unarchive('users', $id);
        Audit::log('unarchive','user',$id,'Unarchived: '.$row['username']);
        echo json_encode(['ok'=>true,'message'=>'User restored.']);
    } else {
        DB::archive('users', $id);
        Audit::log('archive','user',$id,'Archived: '.$row['username']);
        echo json_encode(['ok'=>true,'message'=>'User archived.']);
    }
    exit;
}
