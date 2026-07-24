<?php

namespace App\Jobs;

use App\Models\FieldValue;
use App\Models\ProjectMemoryLearningRun;
use App\Models\SystemSetting;
use App\Services\AiUsageService;
use App\Services\OpenRouterClient;
use App\Services\ProjectAiContext;
use App\Services\ProjectMemoryPrompt;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Throwable;

class AnalyzeCompletedTaskMemory implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;
    public int $tries = 1;
    public int $timeout = 120;
    public function __construct(public readonly int $runId) {}
    public function middleware(): array { return [(new WithoutOverlapping('project-memory-run-'.$this->runId))->expireAfter(180)]; }

    public function handle(OpenRouterClient $client, ProjectMemoryPrompt $prompt, ProjectAiContext $context, AiUsageService $usage): void
    {
        $run = ProjectMemoryLearningRun::with(['task.project'])->findOrFail($this->runId);
        if ($run->status !== 'queued') return;
        $task = $run->task; $project = $task->project;
        $completeId = (int) FieldValue::query()->where('key_name', 'complete')->whereHas('field', fn ($q) => $q->where('key_name', 'task_status'))->value('id');
        if (! $project->ai_memory_enabled || $project->archived_at || $task->archived_at || (int) $task->status_value_id !== $completeId) { $run->update(['status' => 'stale']); return; }
        $settings = SystemSetting::firstOrFail();
        if (blank($settings->openrouter_api_key) || blank($settings->openrouter_model)) { $run->update(['status' => 'failed', 'error_code' => 'not_configured']); return; }
        if ($usage->spentThisMonth() >= (float) $settings->ai_monthly_budget_usd) { $run->update(['status' => 'budget_blocked', 'error_code' => 'monthly_budget_reached']); return; }
        $run->update(['status' => 'running']);
        try {
            $result = $client->structured($settings, $prompt->learningSystem(), $prompt->learningContext($task, $context->trusted($project)), 'project_memory_lessons', $prompt->learningSchema());
            $usage->record('project_memory', 'project_memory_learning_run', $run->id, $result, $project->id);
            foreach ($result['output']['lessons'] ?? [] as $lesson) {
                $content = trim((string) ($lesson['content'] ?? '')); if ($content === '') continue;
                $hash = hash('sha256', mb_strtolower($content));
                if ($project->memoryEntries()->where('content_hash', $hash)->whereIn('status', ['pending', 'approved'])->exists()) continue;
                $project->memoryEntries()->create(['source_task_id' => $task->id, 'category' => $lesson['category'], 'content' => $content, 'evidence' => trim((string) $lesson['evidence']), 'status' => 'pending', 'importance' => $lesson['importance'], 'proposed_by_type' => 'ai', 'completion_hash' => $run->completion_hash, 'content_hash' => $hash]);
            }
            $run->update(['status' => 'succeeded']);
        } catch (Throwable $exception) {
            $run->update(['status' => 'failed', 'error_code' => 'provider_or_workflow_error', 'error_message' => mb_substr($exception->getMessage(), 0, 2000)]);
        }
    }
}
