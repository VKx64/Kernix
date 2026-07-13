<?php
/**
 * Roles module.
 */

// All permission keys in the system
const ALL_PERMISSIONS = [
    'Dashboard'   => ['dashboard.view'],
    'Messages'    => ['messages.view'],
    'Analytics'   => ['analytics.view'],
    'Tasks'       => ['tasks.view','tasks.create','tasks.edit','tasks.archive','tasks.delete','tasks.assign'],
    'Projects'    => ['projects.view','projects.create','projects.edit','projects.archive','projects.delete'],
    'Clients'     => ['clients.view','clients.create','clients.edit','clients.archive','clients.delete'],
    'Contacts'    => ['contacts.view','contacts.create','contacts.edit','contacts.archive','contacts.delete'],
    'Users'       => ['users.view','users.create','users.edit','users.archive','users.delete'],
    'Roles'       => ['roles.view','roles.create','roles.edit','roles.delete'],
    'Settings'    => ['settings.view','settings.edit'],
    'Fields'      => ['fields.view','fields.create','fields.edit','fields.delete'],
];

function handle_index(): void
{
    Perm::require('roles.view');

    $rows = DB::all(
        "SELECT r.*, COUNT(u.id) AS user_count
         FROM roles r
         LEFT JOIN users u ON u.role_id=r.id AND u.deleted_at IS NULL AND u.archived_at IS NULL
         WHERE r.deleted_at IS NULL
         GROUP BY r.id ORDER BY r.sort_order, r.name"
    );

    // Load permissions per role
    $allPerms = DB::all("SELECT role_id, permission_key FROM role_permissions");
    $permsByRole = [];
    foreach ($allPerms as $p) {
        $permsByRole[$p['role_id']][] = $p['permission_key'];
    }

    render('roles_list', [
        'pageTitle'    => 'Roles',
        'rows'         => $rows,
        'permsByRole'  => $permsByRole,
        'allPerms'     => ALL_PERMISSIONS,
    ]);
}

function handle_save(): void
{
    Perm::require('roles.create');
    header('Content-Type: application/json');

    $id   = input_int('id', 0);
    $name = trim((string)input('name', ''));
    if ($name === '') { echo json_encode(['ok'=>false,'errors'=>['name'=>'Role name is required.']]); exit; }

    $keyName = strtolower(preg_replace('/[^a-z0-9]+/i', '_', $name));

    // Permissions — sent as array of checked permission keys
    $perms = [];
    if (isset($_POST['permissions']) && is_array($_POST['permissions'])) {
        $flat = array_keys(array_merge(...array_values(ALL_PERMISSIONS)));
        foreach ($_POST['permissions'] as $key) {
            if (in_array($key, $flat, true)) $perms[] = $key;
        }
    }

    DB::begin();
    try {
        if ($id) {
            Perm::require('roles.edit');
            $old = DB::row('SELECT * FROM roles WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]);
            if (!$old || $old['is_system']) { DB::rollback(); echo json_encode(['ok'=>false,'message'=>'Cannot edit system roles.']); exit; }
            DB::update('roles', ['name'=>$name, 'key_name'=>$keyName], ['id'=>$id]);
        } else {
            $id = DB::insert('roles', ['name'=>$name,'key_name'=>$keyName,'sort_order'=>99]);
        }
        // Replace permissions
        DB::run('DELETE FROM role_permissions WHERE role_id=:id', ['id'=>$id]);
        foreach ($perms as $perm) {
            DB::insert('role_permissions', ['role_id'=>$id, 'permission_key'=>$perm]);
        }
        DB::commit();
        Audit::log('update','role',$id,"Saved role: $name");
        echo json_encode(['ok'=>true,'message'=>'Role saved.']);
    } catch (Throwable $e) {
        DB::rollback();
        echo json_encode(['ok'=>false,'message'=>'Save failed: '.$e->getMessage()]);
    }
    exit;
}

function handle_delete(): void
{
    Perm::require('roles.delete');
    header('Content-Type: application/json');
    $id  = input_int('id', 0);
    $row = $id ? DB::row('SELECT name,is_system FROM roles WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]) : null;
    if (!$row) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
    if ($row['is_system']) { echo json_encode(['ok'=>false,'message'=>'Cannot delete system roles.']); exit; }
    $inUse = DB::value('SELECT COUNT(*) FROM users WHERE role_id=:id AND deleted_at IS NULL', ['id'=>$id]);
    if ($inUse) { echo json_encode(['ok'=>false,'message'=>'Role is in use by '.$inUse.' user(s). Reassign them first.']); exit; }
    DB::softDelete('roles', $id);
    Audit::log('delete','role',$id,'Deleted role: '.$row['name']);
    echo json_encode(['ok'=>true,'message'=>'Role deleted.']);
    exit;
}
