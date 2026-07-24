<?php

namespace App\Services;

use App\Jobs\AnalyzeCompletedTaskMemory;
use App\Models\FieldValue;
use App\Models\ProjectMemoryLearningRun;
use App\Models\Task;

class ProjectMemoryService
{
    public function afterTaskUpdate(Task $task, ?int $previousStatusId): void
    {
        if (! $task->wasChanged('status_value_id') || (int) $previousStatusId === (int) $task->status_value_id) return;
        $completeId = (int) FieldValue::query()->where('key_name', 'complete')->whereHas('field', fn ($q) => $q->where('key_name', 'task_status'))->value('id');
        if ((int) $task->status_value_id !== $completeId) {
            $task->project->memoryEntries()->where('source_task_id', $task->id)->where('status', 'pending')->update(['status' => 'superseded']);
            return;
        }
        if (! $task->project->ai_memory_enabled || $task->archived_at) return;
        $hash = $this->completionHash($task);
        $run = ProjectMemoryLearningRun::query()->firstOrCreate(
            ['task_id' => $task->id, 'completion_hash' => $hash],
            ['project_id' => $task->project_id, 'status' => 'queued'],
        );
        if ($run->wasRecentlyCreated) AnalyzeCompletedTaskMemory::dispatch($run->id)->afterCommit();
    }

    public function completionHash(Task $task): string
    {
        $task->load(['status:id,key_name,label', 'subtasks.status:id,key_name,label']);
        return hash('sha256', json_encode([
            'task' => $task->only(['title', 'description', 'status_value_id', 'due_date', 'estimated_minutes', 'actual_minutes']),
            'subtasks' => $task->subtasks->map->only(['title', 'status_value_id', 'due_date', 'estimated_minutes', 'actual_minutes', 'completed_at'])->all(),
            'notes' => $task->notes()->where('is_message', false)->orderBy('id')->get(['body', 'time_minutes', 'created_at'])->toArray(),
        ]));
    }
}
