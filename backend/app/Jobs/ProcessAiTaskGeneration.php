<?php

namespace App\Jobs;

use App\Models\AiTaskGeneration;
use App\Models\AuditLog;
use App\Models\SystemSetting;
use App\Models\User;
use App\Services\AiTaskBatchService;
use App\Services\AiTaskCreationPrompt;
use App\Services\AiUsageService;
use App\Services\OpenRouterClient;
use App\Services\OpenRouterException;
use App\Services\ProjectAiContext;
use App\Support\TaskMutationGuard;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Throwable;

class ProcessAiTaskGeneration implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    public int $tries = 1;
    public int $timeout = 120;

    public function __construct(public readonly int $generationId) {}

    public function middleware(): array
    {
        return [(new WithoutOverlapping('ai-task-generation-'.$this->generationId))->expireAfter(180)];
    }

    public function handle(OpenRouterClient $client, AiTaskCreationPrompt $prompt, ProjectAiContext $context, AiTaskBatchService $batches, AiUsageService $usage): void
    {
        $generation = AiTaskGeneration::with(['project', 'requester.role.permissions', 'folder'])->findOrFail($this->generationId);
        if ($generation->status !== 'queued') return;
        $project = $generation->project;
        $actor = $generation->requester;

        if ($project->archived_at || $actor->status !== 'active' || $actor->archived_at || ! $project->ai_task_creation_enabled || ! $actor->canDo('tasks.create_with_ai')) {
            $this->failGeneration($generation, 'workflow_changed', 'The project or your access changed before task creation.');
            return;
        }
        if ($generation->task_folder_id && (! $generation->folder || (int) $generation->folder->project_id !== (int) $project->id)) {
            $this->failGeneration($generation, 'folder_changed', 'The selected folder is no longer available.');
            return;
        }
        try {
            TaskMutationGuard::enforceUser($actor);
        } catch (HttpResponseException $exception) {
            $code = $exception->getResponse()->getStatusCode() === 409 ? 'clock_blocked' : 'failed';
            $this->failGeneration($generation, $code, 'Clock in and end any active break before AI creates tasks.', $code);
            return;
        }

        $settings = SystemSetting::firstOrFail();
        if (blank($settings->openrouter_api_key) || blank($settings->openrouter_model)) {
            $this->failGeneration($generation, 'not_configured', 'OpenRouter has not been configured.');
            return;
        }
        if ($usage->spentThisMonth() >= (float) $settings->ai_monthly_budget_usd) {
            $this->failGeneration($generation, 'monthly_budget_reached', 'The monthly AI budget has been reached.', 'budget_blocked');
            return;
        }

        $allowedUsers = User::query()->where('status', 'active')->whereNull('archived_at')->where(function ($query) use ($project) {
            $query->whereKey($project->manager_user_id)->orWhereHas('projects', fn ($projects) => $projects->whereKey($project->id));
        })->get(['users.id', 'first_name', 'last_name', 'username']);
        $allowedIds = $allowedUsers->pluck('id')->map(fn ($id) => (int) $id)->all();

        $generation->update(['status' => 'creating', 'error_code' => null, 'error_message' => null]);
        try {
            // One original user message or clarification reply always causes exactly one provider call.
            $result = $client->structured(
                $settings,
                $prompt->system(),
                $prompt->context($generation, $actor, $context->trusted($project), $allowedUsers->map(fn ($user) => ['id' => $user->id, 'name' => trim($user->first_name.' '.$user->last_name) ?: $user->username])->all()),
                'ai_task_generation',
                $prompt->schema(),
            );
            $triggerMessageId = (int) $generation->messages()->where('role', 'user')->latest('id')->value('id');
            $usage->record('task_creation', 'ai_task_generation_message', $triggerMessageId, $result, $project->id, $actor->id);
            $output = $result['output'];
            if (($output['mode'] ?? null) === 'clarify') {
                $question = trim((string) ($output['question'] ?? ''));
                if ($question === '' || $generation->clarification_rounds >= 3) throw new OpenRouterException('AI could not create tasks within the clarification limit.');
                $generation->messages()->create(['role' => 'assistant', 'body' => $question]);
                $generation->update(['status' => 'needs_input', 'result_summary' => $output['summary'] ?? null]);
                return;
            }
            if (($output['mode'] ?? null) !== 'create' || ! is_array($output['tasks'] ?? null)) throw new OpenRouterException('AI returned an invalid creation response.');
            $tasks = $batches->create($generation, $actor, $output['tasks'], $allowedIds);
            $generation->update(['status' => 'created', 'result_summary' => trim((string) ($output['summary'] ?? 'Tasks created with AI.')), 'undo_expires_at' => now()->addMinutes(30)]);
            AuditLog::create(['user_id' => $actor->id, 'action' => 'task.ai_batch.create', 'entity_type' => 'Project', 'entity_id' => $project->id, 'summary' => count($tasks).' tasks created with AI', 'changes_json' => ['generation_id' => $generation->id, 'task_ids' => array_map(fn ($task) => $task->id, $tasks)]]);
        } catch (Throwable $exception) {
            $this->failGeneration($generation, $exception instanceof OpenRouterException ? 'provider_or_output_error' : 'workflow_error', mb_substr($exception->getMessage(), 0, 2000));
        }
    }

    private function failGeneration(AiTaskGeneration $generation, string $code, string $message, string $status = 'failed'): void
    {
        $generation->update(['status' => $status, 'error_code' => $code, 'error_message' => $message]);
    }
}
