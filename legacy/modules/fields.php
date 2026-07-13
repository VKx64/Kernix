<?php
/**
 * Fields module — manage dropdown field groups and their values.
 */

function handle_index(): void
{
    Perm::require('fields.view');

    $fields = DB::all(
        "SELECT f.*, COUNT(fv.id) AS value_count
         FROM fields f
         LEFT JOIN field_values fv ON fv.field_id=f.id AND fv.deleted_at IS NULL
         WHERE f.deleted_at IS NULL
         GROUP BY f.id ORDER BY f.sort_order, f.name"
    );

    // Load values for selected field
    $selectedId = input_int('field_id', $fields[0]['id'] ?? 0);
    $values     = $selectedId ? DB::all(
        "SELECT * FROM field_values WHERE field_id=:fid AND deleted_at IS NULL ORDER BY sort_order, label",
        ['fid' => $selectedId]
    ) : [];
    $selectedField = $selectedId ? DB::row('SELECT * FROM fields WHERE id=:id', ['id'=>$selectedId]) : null;

    render('fields_list', [
        'pageTitle'     => 'Fields',
        'fields'        => $fields,
        'values'        => $values,
        'selectedField' => $selectedField,
        'selectedId'    => $selectedId,
    ]);
}

function handle_save_value(): void
{
    Perm::require('fields.create');
    header('Content-Type: application/json');

    $id      = input_int('id', 0);
    $fieldId = input_int('field_id', 0);
    $label   = trim((string)input('label', ''));

    $errors = [];
    if (!$fieldId) $errors['field_id'] = 'Field is required.';
    if ($label === '') $errors['label'] = 'Label is required.';
    if ($errors) { echo json_encode(['ok'=>false,'errors'=>$errors]); exit; }

    $keyName = strtolower(preg_replace('/[^a-z0-9]+/i', '_', $label));

    $data = [
        'field_id'   => $fieldId,
        'label'      => $label,
        'key_name'   => $keyName,
        'color'      => trim((string)input('color', '')) ?: null,
        'status'     => input('status', 'active') === 'inactive' ? 'inactive' : 'active',
        'sort_order' => input_int('sort_order', 0),
    ];

    if ($id) {
        Perm::require('fields.edit');
        DB::update('field_values', $data, ['id'=>$id]);
        Audit::log('update','field_value',$id,"Updated value: $label");
        echo json_encode(['ok'=>true,'message'=>'Value updated.']);
    } else {
        $newId = DB::insert('field_values', $data);
        Audit::log('create','field_value',$newId,"Created value: $label");
        echo json_encode(['ok'=>true,'message'=>'Value created.']);
    }
    exit;
}

function handle_delete_value(): void
{
    Perm::require('fields.delete');
    header('Content-Type: application/json');
    $id  = input_int('id', 0);
    $row = $id ? DB::row('SELECT label FROM field_values WHERE id=:id AND deleted_at IS NULL', ['id'=>$id]) : null;
    if (!$row) { echo json_encode(['ok'=>false,'message'=>'Not found.']); exit; }
    DB::softDelete('field_values', $id);
    Audit::log('delete','field_value',$id,'Deleted value: '.$row['label']);
    echo json_encode(['ok'=>true,'message'=>'Value deleted.']);
    exit;
}
