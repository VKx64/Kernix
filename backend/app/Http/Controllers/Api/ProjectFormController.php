<?php

namespace App\Http\Controllers\Api;

use App\Models\Project;
use App\Models\ProjectForm;
use App\Support\FormFieldCatalogue;
use App\Support\FormPresets;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ProjectFormController extends ApiController
{
    public function index(Request $request, Project $project): JsonResponse
    {
        $this->permission($request, 'forms.view');

        $forms = $project->projectForms()->withCount('submissions')
            ->withCount(['submissions as pending_submissions_count' => fn ($query) => $query->where('status', 'new')])
            ->orderBy('id')->get();

        return $this->data($forms);
    }

    public function store(Request $request, Project $project): JsonResponse
    {
        $this->permission($request, 'forms.manage');

        if ($preset = $request->string('preset')->toString()) {
            abort_unless(in_array($preset, FormPresets::keys(), true), 422, 'Unknown form preset.');
            $form = FormPresets::create($project, $request->user(), $preset);
            $this->audit($request, 'project_form.create', $form, ['preset' => $preset]);

            return $this->data($form, 201);
        }

        $data = $this->validatedForm($request);
        $processed = $this->processFields($data['fields'] ?? [], [], 1);

        $form = ProjectForm::query()->create([
            'project_id' => $project->id,
            'title' => $data['title'],
            'blurb' => $data['blurb'] ?? null,
            'header_line' => $data['header_line'] ?? $project->client?->name,
            'icon' => $data['icon'] ?? null,
            'slug' => FormPresets::uniqueSlug(),
            'state' => $data['state'] ?? 'live',
            'fields' => $processed['fields'],
            'next_field_seq' => $processed['next_field_seq'],
            'require_email' => $data['require_email'] ?? false,
            'auto_convert' => $data['auto_convert'] ?? false,
            'notify' => $data['notify'] ?? true,
            'task_type_key' => $data['task_type_key'] ?? null,
            'closes_on' => $data['closes_on'] ?? null,
            'created_by' => $request->user()->id,
        ]);
        $this->audit($request, 'project_form.create', $form);

        return $this->data($form, 201);
    }

    public function show(Request $request, ProjectForm $projectForm): JsonResponse
    {
        $this->permission($request, 'forms.view');

        return $this->data($projectForm);
    }

    public function update(Request $request, ProjectForm $projectForm): JsonResponse
    {
        $this->permission($request, 'forms.manage');

        $data = $this->validatedForm($request, true);
        $update = [];
        foreach (['title', 'blurb', 'header_line', 'icon', 'state', 'require_email', 'auto_convert', 'notify', 'task_type_key', 'closes_on'] as $key) {
            if (array_key_exists($key, $data)) {
                $update[$key] = $data[$key];
            }
        }
        if (array_key_exists('fields', $data)) {
            $processed = $this->processFields($data['fields'], $projectForm->fields ?? [], $projectForm->next_field_seq);
            $update['fields'] = $processed['fields'];
            $update['next_field_seq'] = $processed['next_field_seq'];
        }
        $projectForm->update($update);
        $this->audit($request, 'project_form.update', $projectForm, $update);

        return $this->data($projectForm->fresh());
    }

    public function destroy(Request $request, ProjectForm $projectForm): JsonResponse
    {
        $this->permission($request, 'forms.manage');
        $projectForm->delete();
        $this->audit($request, 'project_form.delete', $projectForm);

        return response()->json(null, 204);
    }

    public function rotateSlug(Request $request, ProjectForm $projectForm): JsonResponse
    {
        $this->permission($request, 'forms.manage');
        $projectForm->update([
            'slug' => FormPresets::uniqueSlug(),
            'slug_rotated_at' => now(),
        ]);
        $this->audit($request, 'project_form.rotate_slug', $projectForm);

        return $this->data($projectForm->fresh());
    }

    public function duplicate(Request $request, ProjectForm $projectForm): JsonResponse
    {
        $this->permission($request, 'forms.manage');

        $copy = ProjectForm::query()->create([
            'project_id' => $projectForm->project_id,
            'title' => $projectForm->title.' (copy)',
            'blurb' => $projectForm->blurb,
            'header_line' => $projectForm->header_line,
            'icon' => $projectForm->icon,
            'slug' => FormPresets::uniqueSlug(),
            'state' => 'paused',
            'fields' => $projectForm->fields,
            'next_field_seq' => $projectForm->next_field_seq,
            'require_email' => $projectForm->require_email,
            'auto_convert' => $projectForm->auto_convert,
            'notify' => $projectForm->notify,
            'task_type_key' => $projectForm->task_type_key,
            'closes_on' => null,
            'created_by' => $request->user()->id,
        ]);
        $this->audit($request, 'project_form.duplicate', $copy, ['source_id' => $projectForm->id]);

        return $this->data($copy, 201);
    }

    private function validatedForm(Request $request, bool $partial = false): array
    {
        $req = fn (string $rule) => $partial ? 'sometimes' : $rule;

        return $request->validate([
            'title' => [$req('required'), 'string', 'max:191'],
            'blurb' => ['sometimes', 'nullable', 'string'],
            'header_line' => ['sometimes', 'nullable', 'string', 'max:191'],
            'icon' => ['sometimes', 'nullable', 'string', 'max:16'],
            'state' => ['sometimes', Rule::in(['live', 'paused'])],
            'require_email' => ['sometimes', 'boolean'],
            'auto_convert' => ['sometimes', 'boolean'],
            'notify' => ['sometimes', 'boolean'],
            'task_type_key' => ['sometimes', 'nullable', 'string', 'max:32'],
            'closes_on' => ['sometimes', 'nullable', 'date'],
            'fields' => ['sometimes', 'array', 'max:'.FormFieldCatalogue::MAX_FIELDS],
            'fields.*.id' => ['sometimes', 'nullable', 'string', 'max:16'],
            'fields.*.type' => ['required_with:fields', 'string'],
            'fields.*.label' => ['required_with:fields', 'string', 'max:191'],
            'fields.*.help' => ['sometimes', 'nullable', 'string', 'max:500'],
            'fields.*.required' => ['sometimes', 'boolean'],
            'fields.*.maps' => ['sometimes', 'nullable', 'string'],
            'fields.*.choices' => ['sometimes', 'array'],
            'fields.*.choices.*.value' => ['required_with:fields.*.choices', 'string', 'max:64'],
            'fields.*.choices.*.label' => ['required_with:fields.*.choices', 'string', 'max:120'],
            'fields.*.choices.*.caption' => ['sometimes', 'nullable', 'string', 'max:191'],
            'fields.*.choices.*.urgency_key' => ['sometimes', 'nullable', 'string', 'max:32'],
            'fields.*.min' => ['sometimes', 'nullable'],
            'fields.*.max' => ['sometimes', 'nullable'],
        ]);
    }

    /**
     * Validates and rewrites the whole field list: assigns stable ids to new
     * fields off the form's monotonic counter, enforces the 8-type allowlist,
     * and enforces both map rules — exactly one field per exclusive target,
     * and only a type-compatible field may claim one at all.
     *
     * @param  array<int, array<string, mixed>>  $rawFields
     * @param  array<int, array<string, mixed>>  $existingFields
     * @return array{fields: array<int, array<string, mixed>>, next_field_seq: int}
     */
    private function processFields(array $rawFields, array $existingFields, int $nextFieldSeq): array
    {
        abort_if(count($rawFields) > FormFieldCatalogue::MAX_FIELDS, 422, 'A form is capped at '.FormFieldCatalogue::MAX_FIELDS.' fields.');

        $existingIds = array_column($existingFields, 'id');
        $claimedMaps = [];
        $fields = [];

        foreach ($rawFields as $raw) {
            $type = (string) ($raw['type'] ?? '');
            if (! FormFieldCatalogue::isValidType($type)) {
                throw ValidationException::withMessages(['fields' => ["Unknown field type \"{$type}\"."]]);
            }

            $label = trim((string) ($raw['label'] ?? ''));
            abort_if($label === '', 422, 'Every field needs a label.');

            $id = $raw['id'] ?? null;
            if (! is_string($id) || $id === '' || ! in_array($id, $existingIds, true)) {
                $id = 'fl'.$nextFieldSeq;
                $nextFieldSeq++;
            }

            $map = $raw['maps'] ?? null;
            $map = is_string($map) && $map !== '' ? $map : FormFieldCatalogue::MAP_NONE;
            if (! FormFieldCatalogue::isMapAllowed($type, $map)) {
                throw ValidationException::withMessages(['fields' => ["\"{$label}\" cannot map to \"{$map}\"."]]);
            }
            if ($map !== FormFieldCatalogue::MAP_NONE) {
                if (isset($claimedMaps[$map])) {
                    throw ValidationException::withMessages(['fields' => ["More than one field maps to \"{$map}\"."]]);
                }
                $claimedMaps[$map] = $id;
            }

            $choices = [];
            if (FormFieldCatalogue::hasChoices($type)) {
                $rawChoices = is_array($raw['choices'] ?? null) ? $raw['choices'] : [];
                $min = $type === FormFieldCatalogue::SEVERITY ? 2 : 2;
                $max = $type === FormFieldCatalogue::SEVERITY ? 4 : 12;
                abort_if(count($rawChoices) < $min || count($rawChoices) > $max, 422, "\"{$label}\" needs between {$min} and {$max} choices.");
                foreach ($rawChoices as $choice) {
                    $choices[] = [
                        'value' => (string) ($choice['value'] ?? ''),
                        'label' => (string) ($choice['label'] ?? ''),
                        'caption' => $choice['caption'] ?? null,
                        'urgency_key' => $type === FormFieldCatalogue::SEVERITY ? ($choice['urgency_key'] ?? null) : null,
                    ];
                }
            }

            $fields[] = [
                'id' => $id,
                'type' => $type,
                'label' => $label,
                'help' => $raw['help'] ?? null,
                'required' => (bool) ($raw['required'] ?? false),
                'choices' => $choices,
                'maps' => $map,
                'min' => $raw['min'] ?? null,
                'max' => $raw['max'] ?? null,
            ];
        }

        return ['fields' => $fields, 'next_field_seq' => $nextFieldSeq];
    }
}
