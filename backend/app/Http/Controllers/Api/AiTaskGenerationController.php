<?php

namespace App\Http\Controllers\Api;

use App\Jobs\ProcessAiTaskGeneration;
use App\Models\AiTaskGeneration;
use App\Models\AuditLog;
use App\Models\Project;
use App\Models\TaskFolder;
use App\Services\AiTaskBatchService;
use App\Support\TaskMutationGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AiTaskGenerationController extends ApiController
{
    public function store(Request $request, Project $project): JsonResponse
    {
        $this->permission($request, 'tasks.create_with_ai');
        TaskMutationGuard::enforce($request);
        abort_if($project->archived_at, 409, 'Archived projects cannot create tasks.');
        abort_unless($project->ai_task_creation_enabled, 409, 'AI task creation is disabled for this project.');
        $data = $request->validate(['prompt' => ['required', 'string', 'max:10000'], 'task_folder_id' => ['sometimes', 'nullable', 'integer', Rule::exists('task_folders', 'id')]]);
        if (! empty($data['task_folder_id'])) abort_unless(TaskFolder::query()->whereKey($data['task_folder_id'])->where('project_id', $project->id)->exists(), 422, 'The folder does not belong to this project.');

        $generation = DB::transaction(function () use ($request, $project, $data) {
            $generation = AiTaskGeneration::create(['project_id' => $project->id, 'task_folder_id' => $data['task_folder_id'] ?? null, 'requested_by' => $request->user()->id, 'status' => 'queued', 'initial_prompt' => trim($data['prompt'])]);
            $generation->messages()->create(['role' => 'user', 'body' => trim($data['prompt']), 'created_by' => $request->user()->id]);
            ProcessAiTaskGeneration::dispatch($generation->id)->afterCommit();
            return $generation;
        });

        return $this->data($this->present($generation), 202);
    }

    public function show(Request $request, AiTaskGeneration $generation): JsonResponse
    {
        $this->permission($request, 'tasks.create_with_ai');
        abort_unless($request->user()->isAdmin() || (int) $generation->requested_by === (int) $request->user()->id || (int) $generation->project->manager_user_id === (int) $request->user()->id, 403);
        return $this->data($this->present($generation));
    }

    public function reply(Request $request, AiTaskGeneration $generation): JsonResponse
    {
        $this->permission($request, 'tasks.create_with_ai');
        TaskMutationGuard::enforce($request);
        abort_unless((int) $generation->requested_by === (int) $request->user()->id, 403);
        abort_unless($generation->status === 'needs_input', 409, 'This AI request is not waiting for a reply.');
        abort_if($generation->clarification_rounds >= 3, 409, 'The clarification limit has been reached.');
        $data = $request->validate(['message' => ['required', 'string', 'max:10000']]);
        DB::transaction(function () use ($generation, $request, $data) {
            $locked = AiTaskGeneration::query()->lockForUpdate()->findOrFail($generation->id);
            abort_unless($locked->status === 'needs_input', 409, 'This AI request is no longer waiting for a reply.');
            $locked->messages()->create(['role' => 'user', 'body' => trim($data['message']), 'created_by' => $request->user()->id]);
            $locked->update(['status' => 'queued', 'clarification_rounds' => $locked->clarification_rounds + 1]);
            ProcessAiTaskGeneration::dispatch($locked->id)->afterCommit();
        });
        return $this->data($this->present($generation->fresh()), 202);
    }

    public function undo(Request $request, AiTaskGeneration $generation, AiTaskBatchService $batches): JsonResponse
    {
        TaskMutationGuard::enforce($request);
        $generation->load('project');
        $authorized = $request->user()->isAdmin()
            || (int) $generation->requested_by === (int) $request->user()->id
            || ((int) $generation->project->manager_user_id === (int) $request->user()->id && $request->user()->canDo('tasks.archive'));
        abort_unless($authorized, 403);
        abort_unless($generation->status === 'created' && $generation->undo_expires_at?->isFuture(), 409, 'This AI batch can no longer be undone.');
        DB::transaction(function () use ($generation, $batches, $request) {
            $links = $generation->generatedTasks()->with('task')->lockForUpdate()->get();
            abort_if($links->isEmpty() || $links->contains(fn ($link) => ! $link->task || ! hash_equals($link->baseline_hash, $batches->fingerprint($link->task))), 409, 'One or more generated tasks were changed, so the batch cannot be undone.');
            foreach ($links as $link) $link->task->delete();
            $generation->update(['status' => 'undone']);
            AuditLog::create(['user_id' => $request->user()->id, 'action' => 'task.ai_batch.undo', 'entity_type' => 'Project', 'entity_id' => $generation->project_id, 'summary' => 'AI-created task batch undone', 'changes_json' => ['generation_id' => $generation->id, 'task_ids' => $links->pluck('task_id')->all()]]);
        });
        return $this->data($this->present($generation->fresh()));
    }

    /** @return array<string, mixed> */
    private function present(AiTaskGeneration $generation): array
    {
        $generation->load(['messages:id,generation_id,role,body,created_at', 'generatedTasks.task:id,title,archived_at,deleted_at']);
        return $generation->toArray();
    }
}
