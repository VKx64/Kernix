<?php

namespace App\Services;

use App\Models\AiTaskGeneration;
use App\Models\FieldValue;
use App\Models\Task;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AiTaskBatchService
{
    /** @param array<int, array<string, mixed>> $drafts @return array<int, Task> */
    public function create(AiTaskGeneration $generation, User $actor, array $drafts, array $allowedAssigneeIds): array
    {
        if (count($drafts) < 1 || count($drafts) > 10) throw new OpenRouterException('AI returned an invalid number of tasks.');
        $total = count($drafts) + array_sum(array_map(fn ($task) => count($task['subtasks'] ?? []), $drafts));
        if ($total > 50) throw new OpenRouterException('AI returned more than 50 tasks and subtasks.');

        $project = $generation->project;
        $pending = $this->field('task_status', 'pending');
        $type = $this->field('task_type', 'task');
        $urgencies = FieldValue::query()->whereHas('field', fn ($q) => $q->where('key_name', 'task_urgency'))->pluck('id', 'key_name');

        return DB::transaction(function () use ($generation, $actor, $drafts, $allowedAssigneeIds, $project, $pending, $type, $urgencies) {
            $tasks = [];
            foreach ($drafts as $draft) {
                $title = trim((string) ($draft['title'] ?? ''));
                if ($title === '') throw new OpenRouterException('AI returned a task without a title.');
                $due = $draft['due_date'] ?? null;
                if ($due && ($due < now()->toDateString() || ($project->due_date && $due > $project->due_date->toDateString()))) {
                    throw ValidationException::withMessages(['due_date' => ['AI returned a due date outside the allowed project dates.']]);
                }
                $requestedAssignee = $actor->canDo('tasks.assign') ? ($draft['assignee_user_id'] ?? null) : null;
                $assignee = in_array((int) $requestedAssignee, $allowedAssigneeIds, true) ? (int) $requestedAssignee : ($allowedAssigneeIds[0] ?? null);
                $subtasks = $actor->canDo('tasks.subtasks') && is_array($draft['subtasks'] ?? null) ? $draft['subtasks'] : [];
                $task = Task::create([
                    'project_id' => $project->id,
                    'task_folder_id' => $generation->task_folder_id,
                    'title' => $title,
                    'description' => filled($draft['description'] ?? null) ? trim((string) $draft['description']) : null,
                    'status_value_id' => $pending,
                    'type_value_id' => $type,
                    'urgency_value_id' => $urgencies[$draft['urgency'] ?? 'normal'] ?? $urgencies['normal'],
                    'due_date' => $due,
                    'assignee_user_id' => $assignee,
                    'estimated_minutes' => $actor->canDo('tasks.estimate') ? ($draft['estimated_minutes'] ?? null) : null,
                    'actual_minutes' => 0,
                    'created_by' => $actor->id,
                    'ai_task_generation_id' => $generation->id,
                ]);
                foreach ($subtasks as $index => $subtaskTitle) {
                    $task->subtasks()->create(['title' => trim((string) $subtaskTitle), 'status_value_id' => $pending, 'sort_order' => ($index + 1) * 10, 'actual_minutes' => 0, 'created_by' => $actor->id]);
                }
                $hash = $this->fingerprint($task);
                $generation->generatedTasks()->create(['task_id' => $task->id, 'baseline_hash' => $hash]);
                $tasks[] = $task;
            }

            return $tasks;
        }, attempts: 3);
    }

    public function fingerprint(Task $task): string
    {
        $task->refresh();
        return hash('sha256', json_encode([
            'attributes' => $task->only(['project_id', 'task_folder_id', 'title', 'description', 'status_value_id', 'type_value_id', 'urgency_value_id', 'due_date', 'assignee_user_id', 'estimated_minutes', 'actual_minutes', 'archived_at', 'updated_at']),
            'subtasks' => $task->subtasks()->orderBy('id')->get()->map->only(['id', 'title', 'status_value_id', 'assignee_user_id', 'due_date', 'estimated_minutes', 'actual_minutes', 'completed_at', 'updated_at'])->all(),
            'notes' => $task->notes()->count(),
        ]));
    }

    private function field(string $field, string $key): int
    {
        return (int) FieldValue::query()->where('key_name', $key)->whereHas('field', fn ($q) => $q->where('key_name', $field))->valueOrFail('id');
    }
}
