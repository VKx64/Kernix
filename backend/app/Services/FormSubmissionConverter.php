<?php

namespace App\Services;

use App\Models\FieldValue;
use App\Models\FormSubmission;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Turns a submission into a task. Deliberately HTTP-free: auto-convert runs
 * with no signed-in user and no open clock, so TaskMutationGuard — which
 * demands both — is applied by the controller that calls the manual-convert
 * path, never in here. Callers are responsible for the state-machine lock;
 * this class assumes the caller already holds `lockForUpdate()` inside a
 * transaction and has re-asserted `status === 'new'`.
 *
 * Every mapped value is re-derived from `submission.form_snapshot`, never
 * from the live `project_forms` row, so editing a form later never changes
 * how an old submission converts.
 */
class FormSubmissionConverter
{
    /** Urgency keys the seeded workspace actually has. */
    private const URGENCY_ALIASES = ['critical' => 'urgent'];

    public function convert(FormSubmission $submission, ?User $actor): Task
    {
        $fields = collect($submission->form_snapshot['fields'] ?? []);
        $answers = $submission->answers ?? [];
        $mapped = $this->mappedAnswers($fields, $answers);

        $project = Project::acrossWorkspaces()->findOrFail($submission->project_id);
        $form = $submission->form_snapshot;

        $assignee = $this->resolveAssignee($project, $actor, $form['created_by'] ?? null);
        $pendingStatus = $this->fieldValue('task_status', 'pending');
        $urgencyKey = $this->resolveUrgencyKey($mapped['urgency_key'] ?? null);

        return DB::transaction(function () use ($submission, $mapped, $project, $assignee, $pendingStatus, $urgencyKey, $actor, $form) {
            $task = Task::create([
                'project_id' => $project->id,
                'title' => $mapped['title'] !== '' ? $mapped['title'] : '(untitled report)',
                'description' => $mapped['description'] !== '' ? $mapped['description'] : null,
                'status_value_id' => $pendingStatus,
                'type_value_id' => $this->resolveTypeId($form['task_type_key'] ?? null),
                'urgency_value_id' => $this->fieldValue('task_urgency', $urgencyKey),
                'due_date' => $mapped['due'],
                'assignee_user_id' => $assignee,
                'actual_minutes' => 0,
                'created_by' => $actor?->id,
                'form_submission_id' => $submission->id,
            ]);

            foreach ($this->subtaskTitles($mapped['subtasks']) as $index => $title) {
                $task->subtasks()->create([
                    'title' => $title,
                    'status_value_id' => $pendingStatus,
                    'sort_order' => ($index + 1) * 10,
                    'actual_minutes' => 0,
                    'created_by' => $actor?->id,
                ]);
            }

            $this->copyFiles($submission, $task);

            $submission->update([
                'status' => 'converted',
                'task_id' => $task->id,
                'decided_by' => $actor?->id,
                'decided_at' => now(),
            ]);

            return $task;
        });
    }

    /**
     * The distinct "convert again" path taken after the original task was
     * deleted. The submission never re-enters the queue: it is converted
     * already, this only replaces the dead task it points at.
     */
    public function reconvert(FormSubmission $submission, ?User $actor): Task
    {
        return $this->convert($submission, $actor);
    }

    /** @param  Collection<int, array<string, mixed>>  $fields */
    private function mappedAnswers($fields, array $answers): array
    {
        $mapped = ['title' => '', 'description' => '', 'subtasks' => '', 'due' => null, 'urgency_key' => null];

        foreach ($fields as $field) {
            $map = $field['maps'] ?? 'none';
            if ($map === 'none' || $map === null) {
                continue;
            }
            $answer = $answers[$field['id']] ?? null;

            match ($map) {
                'title' => $mapped['title'] = is_string($answer) ? trim($answer) : '',
                'description' => $mapped['description'] = is_string($answer) ? trim($answer) : '',
                'subtasks' => $mapped['subtasks'] = is_string($answer) ? $answer : '',
                'due' => $mapped['due'] = is_string($answer) && $answer !== '' ? $answer : null,
                'urgency' => $mapped['urgency_key'] = $this->choiceUrgencyKey($field, $answer),
                default => null,
            };
        }

        return $mapped;
    }

    private function choiceUrgencyKey(array $field, mixed $answer): ?string
    {
        if (! is_string($answer)) {
            return null;
        }
        foreach (($field['choices'] ?? []) as $choice) {
            if (($choice['value'] ?? null) === $answer) {
                return $choice['urgency_key'] ?? null;
            }
        }

        return null;
    }

    private function resolveUrgencyKey(?string $key): string
    {
        if ($key === null || $key === '') {
            return 'normal';
        }
        $key = self::URGENCY_ALIASES[$key] ?? $key;
        $exists = FieldValue::query()->where('key_name', $key)
            ->whereHas('field', fn ($query) => $query->where('key_name', 'task_urgency'))
            ->exists();

        return $exists ? $key : 'normal';
    }

    /** @return array<int, string> */
    private function subtaskTitles(string $raw): array
    {
        $lines = preg_split('/\r\n|\r|\n/', $raw) ?: [];
        $titles = array_values(array_filter(array_map('trim', $lines), fn (string $line): bool => $line !== ''));

        return array_slice($titles, 0, 20);
    }

    /**
     * Manual convert assigns the converting user. Auto-convert has no user,
     * so it mirrors TaskController::store's own default: the project's
     * active manager, falling back to whoever authored the form, else
     * nobody.
     */
    private function resolveAssignee(Project $project, ?User $actor, ?int $formCreatedBy): ?int
    {
        if ($actor) {
            return $actor->id;
        }

        $activeManager = User::query()
            ->whereKey($project->manager_user_id)
            ->where('status', 'active')
            ->whereNull('archived_at')
            ->value('id');
        if ($activeManager) {
            return (int) $activeManager;
        }
        if ($formCreatedBy) {
            $exists = User::query()->whereKey($formCreatedBy)
                ->where('status', 'active')->whereNull('archived_at')->exists();
            if ($exists) {
                return (int) $formCreatedBy;
            }
        }

        return null;
    }

    private function resolveTypeId(?string $key): ?int
    {
        return $this->fieldValue('task_type', $key ?: 'task') ?? $this->fieldValue('task_type', 'task');
    }

    private function fieldValue(string $field, string $key): ?int
    {
        return FieldValue::query()->where('key_name', $key)
            ->whereHas('field', fn ($query) => $query->where('key_name', $field))
            ->value('id');
    }

    /**
     * Submission files are copied, not moved: the review drawer must keep
     * showing its own files after conversion, and task_attachments.task_id
     * is NOT NULL so they could never have lived there before now.
     */
    private function copyFiles(FormSubmission $submission, Task $task): void
    {
        foreach ($submission->files as $file) {
            $disk = Storage::disk($file->storage_driver ?: 'local');
            if (! $disk->exists($file->storage_path)) {
                continue;
            }
            $name = Str::ulid()->toBase32().'.'.pathinfo($file->file_name, PATHINFO_EXTENSION);
            $destination = "task-attachments/{$task->id}/{$name}";
            $disk->copy($file->storage_path, $destination);

            $task->attachments()->create([
                'original_name' => $file->original_name,
                'file_name' => $name,
                'storage_path' => $destination,
                'mime_type' => $file->mime_type,
                'file_size' => $file->file_size,
                'storage_driver' => $file->storage_driver,
                'uploaded_by' => null,
            ]);
        }
    }
}
