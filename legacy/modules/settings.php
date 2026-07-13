<?php
/**
 * Settings module — redesigned.
 * Landing page with card grid linking to: system, smtp, storage
 * Users/Roles/Fields are now top-level pages (linked from cards too)
 */

function handle_index(): void
{
    Perm::require('settings.view');
    $section = $_GET['section'] ?? '';

    if ($section === 'system')  { _settings_render_system();  return; }
    if ($section === 'smtp')    { _settings_render_smtp();    return; }
    if ($section === 'storage') { _settings_render_storage(); return; }

    // Landing
    $s = settings();
    render('settings_index', [
        'pageTitle' => 'Settings',
        's'         => $s,
    ]);
}

function _settings_render_system(): void
{
    $s = settings();
    // Active clients (deleted_at IS NULL) — used by the single-client picker
    // when multiple clients exist in the DB.
    try {
        $clients = DB::all("SELECT id, name, email FROM clients WHERE deleted_at IS NULL ORDER BY name");
    } catch (Throwable $e) {
        $clients = [];
    }
    $singleClient = single_client();
    render('settings_system', [
        'pageTitle'     => 'System Settings',
        's'             => $s,
        'canEdit'       => Perm::can('settings.edit'),
        'clients'       => $clients,
        'singleClient'  => $singleClient,
    ]);
}

function _settings_render_smtp(): void
{
    $s = settings();
    render('settings_smtp', [
        'pageTitle' => 'Email / SMTP',
        's'         => $s,
        'canEdit'   => Perm::can('settings.edit'),
    ]);
}

function _settings_render_storage(): void
{
    $s = settings();
    render('settings_storage', [
        'pageTitle' => 'Storage',
        's'         => $s,
        'canEdit'   => Perm::can('settings.edit'),
    ]);
}

function handle_save_system(): void
{
    Perm::require('settings.edit');
    header('Content-Type: application/json');

    $data = [
        'default_timezone' => trim((string)input('default_timezone', 'UTC')),
    ];

    foreach (['system_logo','sidebar_logo','email_logo','favicon'] as $field) {
        if (!empty($_FILES[$field]['name'])) {
            try {
                $r = Storage::putUpload($_FILES[$field], 'logos');
                $data[$field] = $r['path'];
            } catch (Throwable $e) {
                echo json_encode(['ok'=>false,'message'=>'Upload failed: '.$e->getMessage()]);
                exit;
            }
        } elseif (input($field.'_clear') === '1') {
            $data[$field] = null;
        }
    }

    _settings_upsert($data);
    Audit::log('update','settings',1,'Updated system settings');
    echo json_encode(['ok'=>true,'message'=>'System settings saved.']);
    exit;
}

function handle_save_smtp(): void
{
    Perm::require('settings.edit');
    header('Content-Type: application/json');

    $data = [
        'smtp_host'       => trim((string)input('smtp_host', '')),
        'smtp_username'   => trim((string)input('smtp_username', '')),
        'smtp_port'       => input_int('smtp_port', 587),
        'smtp_encryption' => in_array(input('smtp_encryption'), ['none','ssl','tls']) ? input('smtp_encryption') : 'tls',
        'smtp_from_email' => trim((string)input('smtp_from_email', '')),
        'smtp_from_name'  => trim((string)input('smtp_from_name', '')),
    ];
    $pass = trim((string)input('smtp_password', ''));
    if ($pass !== '') $data['smtp_password'] = $pass;

    _settings_upsert($data);
    Audit::log('update','settings',1,'Updated SMTP settings');
    echo json_encode(['ok'=>true,'message'=>'SMTP settings saved.']);
    exit;
}

function handle_save_storage(): void
{
    Perm::require('settings.edit');
    header('Content-Type: application/json');

    $driver = input('storage_driver', 'local') === 's3' ? 's3' : 'local';
    $data   = ['storage_driver' => $driver];

    if ($driver === 'local') {
        $data['local_upload_path'] = trim((string)input('local_upload_path', 'uploads'));
        $data['local_public_url']  = trim((string)input('local_public_url', ''));
    } else {
        $data['s3_bucket']         = trim((string)input('s3_bucket', ''));
        $data['s3_region']         = trim((string)input('s3_region', ''));
        $data['s3_endpoint']       = trim((string)input('s3_endpoint', ''));
        $data['s3_public_url_base']= trim((string)input('s3_public_url_base', ''));
        $data['s3_use_path_style'] = input('s3_use_path_style') === '1' ? 1 : 0;
        $key    = trim((string)input('s3_access_key', ''));
        $secret = trim((string)input('s3_secret_key', ''));
        if ($key    !== '') $data['s3_access_key'] = $key;
        if ($secret !== '') $data['s3_secret_key'] = $secret;
    }

    _settings_upsert($data);
    Audit::log('update','settings',1,'Updated storage settings');
    echo json_encode(['ok'=>true,'message'=>'Storage settings saved.']);
    exit;
}

function _settings_upsert(array $data): void
{
    $exists = DB::value('SELECT id FROM system_settings WHERE id=1');
    if ($exists) {
        DB::update('system_settings', $data, ['id' => 1]);
    } else {
        $data['id'] = 1;
        DB::insert('system_settings', $data);
    }
    // Bust the per-request settings cache so the rest of THIS request sees
    // the new values (otherwise the JSON response would reflect stale state).
    if (function_exists('settings_bust_cache')) settings_bust_cache();
}

/**
 * Save handler for the Single Client Mode card.
 *
 * Handles all states:
 *  - mode=0  → just turn it off
 *  - mode=1 + pick_client_id given     → existing client becomes the singleton
 *  - mode=1 + new client fields given  → create the new client first, then set as singleton
 *  - mode=1 + edit_client fields given → updating the existing singleton's details
 *
 * The view sends one form payload; we figure out which case we're in by which
 * fields are present.
 */
function handle_save_single_client(): void
{
    Perm::require('settings.edit');
    header('Content-Type: application/json');

    $modeOn  = input('single_client_mode') === '1';
    $action  = (string)input('sc_action', ''); // 'pick' | 'create' | 'edit' | 'off'

    if (!$modeOn || $action === 'off') {
        // Turn it off (keep the single_client_id pointer in case they re-enable)
        _settings_upsert(['single_client_mode' => 0]);
        Audit::log('update','settings',1,'Disabled single-client mode');
        echo json_encode(['ok'=>true,'message'=>'Single-client mode turned off.','reload'=>true]);
        exit;
    }

    // mode is on — figure out which sub-action
    if ($action === 'create') {
        // Create a brand-new client, then commit it as the singleton.
        $name = trim((string)input('sc_new_name', ''));
        if ($name === '') {
            echo json_encode(['ok'=>false,'errors'=>['sc_new_name'=>'Client name is required.']]);
            exit;
        }
        $data = [
            'name'    => $name,
            'email'   => trim((string)input('sc_new_email', '')),
            'phone'   => trim((string)input('sc_new_phone', '')),
            'website' => trim((string)input('sc_new_website', '')),
            'notes'   => trim((string)input('sc_new_notes', '')),
            'created_by' => Auth::id(),
        ];
        $newId = DB::insert('clients', $data);
        Audit::log('create','client',$newId,"Created (single-client mode): $name");

        _settings_upsert(['single_client_mode' => 1, 'single_client_id' => $newId]);
        Audit::log('update','settings',1,"Enabled single-client mode (client #$newId)");
        echo json_encode(['ok'=>true,'message'=>'Single-client mode enabled with new client.','reload'=>true]);
        exit;
    }

    if ($action === 'pick') {
        // Mark an existing client as the singleton.
        $pickId = input_int('sc_pick_client_id', 0);
        if (!$pickId) {
            echo json_encode(['ok'=>false,'errors'=>['sc_pick_client_id'=>'Please choose a client.']]);
            exit;
        }
        $exists = DB::value('SELECT id FROM clients WHERE id=:id AND deleted_at IS NULL', ['id'=>$pickId]);
        if (!$exists) {
            echo json_encode(['ok'=>false,'errors'=>['sc_pick_client_id'=>'That client no longer exists.']]);
            exit;
        }
        _settings_upsert(['single_client_mode' => 1, 'single_client_id' => $pickId]);
        Audit::log('update','settings',1,"Enabled single-client mode (client #$pickId)");
        echo json_encode(['ok'=>true,'message'=>'Single-client mode enabled.','reload'=>true]);
        exit;
    }

    if ($action === 'edit') {
        // Updating the existing singleton's details in place.
        $existingId = single_client_id();
        if (!$existingId) {
            echo json_encode(['ok'=>false,'message'=>'No single client is set yet.']);
            exit;
        }
        $name = trim((string)input('sc_edit_name', ''));
        if ($name === '') {
            echo json_encode(['ok'=>false,'errors'=>['sc_edit_name'=>'Client name is required.']]);
            exit;
        }
        $data = [
            'name'    => $name,
            'email'   => trim((string)input('sc_edit_email', '')),
            'phone'   => trim((string)input('sc_edit_phone', '')),
            'website' => trim((string)input('sc_edit_website', '')),
            'notes'   => trim((string)input('sc_edit_notes', '')),
        ];
        $old = DB::row('SELECT * FROM clients WHERE id=:id AND deleted_at IS NULL', ['id'=>$existingId]);
        if (!$old) {
            echo json_encode(['ok'=>false,'message'=>'The single client record is missing.']);
            exit;
        }
        DB::update('clients', $data, ['id'=>$existingId]);
        Audit::log('update','client',$existingId,"Updated (single-client mode): $name", Audit::diff($old, $data));
        echo json_encode(['ok'=>true,'message'=>'Client details updated.']);
        exit;
    }

    echo json_encode(['ok'=>false,'message'=>'Unknown action.']);
    exit;
}
