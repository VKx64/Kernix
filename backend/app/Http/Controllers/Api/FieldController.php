<?php

namespace App\Http\Controllers\Api;

use App\Models\Field;
use App\Models\FieldValue;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class FieldController extends ApiController
{
    private const REQUIRED_SYSTEM_VALUES = [
        'task_status' => ['pending', 'complete'],
        'task_type' => ['task'],
        'task_urgency' => ['normal'],
    ];

    public function index(Request $request): JsonResponse
    {
        $this->permission($request, 'fields.view');
        $query = Field::query()->with(['values' => fn ($values) => $values->where('status', 'active')]);
        if ($search = $request->string('search')->trim()->toString()) {
            $query->where('name', 'like', "%{$search}%");
        }
        $page = $query->orderBy('sort_order')->orderBy('name')->paginate($this->perPage($request));
        $page->getCollection()->transform(fn (Field $field) => $this->present($field));

        return $this->paginated($page);
    }

    public function store(Request $request): JsonResponse
    {
        $this->permission($request, 'fields.create');
        $data = $this->validatedField($request);
        $data['key_name'] ??= Str::slug($data['name'], '_');
        if (! $data['key_name'] || Field::withTrashed()->where('key_name', $data['key_name'])->exists()) {
            throw ValidationException::withMessages(['name' => ['Choose a distinct field name.']]);
        }
        $field = Field::create($data + ['is_system' => false, 'sort_order' => 99]);
        $this->audit($request, 'field.create', $field, $data);

        return $this->data($this->present($field), 201);
    }

    public function show(Request $request, Field $field): JsonResponse
    {
        $this->permission($request, 'fields.view');

        return $this->data($this->present($field));
    }

    public function update(Request $request, Field $field): JsonResponse
    {
        $this->permission($request, 'fields.edit');
        $data = $this->validatedField($request, true, $field);
        if ($field->is_system) {
            unset($data['key_name']);
        }
        $field->update($data);
        $this->audit($request, 'field.update', $field, $data);

        return $this->data($this->present($field->fresh()));
    }

    public function destroy(Request $request, Field $field): JsonResponse
    {
        $this->permission($request, 'fields.delete');
        abort_if($field->is_system, 409, 'System fields cannot be deleted.');
        $field->delete();
        $this->audit($request, 'field.delete', $field);

        return response()->json(null, 204);
    }

    public function storeValue(Request $request, Field $field): JsonResponse
    {
        $this->permission($request, 'fields.edit');
        $data = $this->normalizeValue($this->validatedValue($request, $field));
        $data['key_name'] ??= Str::slug($data['label'], '_');
        if (! $data['key_name'] || FieldValue::withTrashed()->where('field_id', $field->id)->where('key_name', $data['key_name'])->exists()) {
            throw ValidationException::withMessages(['label' => ['Choose a distinct value label.']]);
        }
        $data['sort_order'] ??= (int) $field->values()->max('sort_order') + 10;
        $value = $field->values()->create($data);
        $this->audit($request, 'field.value.create', $value, $data);

        return $this->data($this->presentValue($value), 201);
    }

    public function updateValue(Request $request, Field $field, FieldValue $value): JsonResponse
    {
        $this->permission($request, 'fields.edit');
        $this->assertNested($field, $value);
        $data = $this->normalizeValue($this->validatedValue($request, $field, true, $value));
        $this->protectRequiredValue($field, $value, $data);
        $value->update($data);
        $this->audit($request, 'field.value.update', $value, $data);

        return $this->data($this->presentValue($value->fresh()));
    }

    public function destroyValue(Request $request, Field $field, FieldValue $value): JsonResponse
    {
        $this->permission($request, 'fields.delete');
        $this->assertNested($field, $value);
        abort_if($this->isRequiredValue($field, $value), 409, 'This system value is required by the task workflow.');
        abort_if($this->valueInUse($field, $value), 409, 'This value is in use and cannot be deleted. Mark it inactive instead.');
        $value->delete();
        $this->audit($request, 'field.value.delete', $value);

        return response()->json(null, 204);
    }

    private function validatedField(Request $request, bool $partial = false, ?Field $field = null): array
    {
        return $request->validate([
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'max:128'],
            'key_name' => ['sometimes', 'string', 'max:128', 'regex:/^[a-z0-9_]+$/', Rule::unique('fields', 'key_name')->ignore($field?->id)],
            'description' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'sort_order' => ['sometimes', 'integer', 'between:-100000,100000'],
            'is_system' => ['prohibited'],
        ]);
    }

    private function validatedValue(Request $request, Field $field, bool $partial = false, ?FieldValue $value = null): array
    {
        return $request->validate([
            'label' => [$partial ? 'sometimes' : 'required', 'string', 'max:128'],
            'key_name' => ['sometimes', 'string', 'max:128', 'regex:/^[a-z0-9_]+$/', Rule::unique('field_values', 'key_name')->where('field_id', $field->id)->ignore($value?->id)],
            'color' => ['sometimes', 'nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'status' => ['sometimes', Rule::in(['active', 'inactive'])],
            'active' => ['sometimes', 'boolean'],
            'sort_order' => ['sometimes', 'integer', 'between:-100000,100000'],
        ]);
    }

    private function assertNested(Field $field, FieldValue $value): void
    {
        abort_unless((int) $value->field_id === (int) $field->id, 404);
    }

    private function normalizeValue(array $data): array
    {
        if (array_key_exists('active', $data)) {
            $data['status'] = $data['active'] ? 'active' : 'inactive';
            unset($data['active']);
        }

        return $data;
    }

    private function valueInUse(Field $field, FieldValue $value): bool
    {
        $references = match ($field->key_name) {
            'client_status' => [['clients', 'status_value_id']],
            'project_status' => [['projects', 'status_value_id']],
            'task_status' => [['tasks', 'status_value_id'], ['task_subtasks', 'status_value_id']],
            'task_type' => [['tasks', 'type_value_id']],
            'task_urgency' => [['tasks', 'urgency_value_id']],
            'user_department' => [['users', 'department_value_id']],
            default => [],
        };

        foreach ($references as [$table, $column]) {
            if (DB::table($table)->where($column, $value->id)->whereNull('deleted_at')->exists()) {
                return true;
            }
        }

        return false;
    }

    private function protectRequiredValue(Field $field, FieldValue $value, array $changes): void
    {
        if (! $this->isRequiredValue($field, $value)) {
            return;
        }

        $changesKey = isset($changes['key_name']) && $changes['key_name'] !== $value->key_name;
        $deactivates = ($changes['status'] ?? 'active') !== 'active';
        abort_if($changesKey || $deactivates, 409, 'This system value must keep its key and remain active.');
    }

    private function isRequiredValue(Field $field, FieldValue $value): bool
    {
        return $field->is_system
            && in_array($value->key_name, self::REQUIRED_SYSTEM_VALUES[$field->key_name] ?? [], true);
    }

    private function present(Field $field): array
    {
        $field->load(['values' => fn ($values) => $values->where('status', 'active')]);
        $data = $field->toArray();
        $data['key'] = $field->key_name;
        $data['values'] = $field->values->map(fn (FieldValue $value) => $this->presentValue($value))->all();

        return $data;
    }

    private function presentValue(FieldValue $value): array
    {
        $data = $value->toArray();
        $data['key'] = $value->key_name;
        $data['active'] = $value->status === 'active';

        return $data;
    }
}
