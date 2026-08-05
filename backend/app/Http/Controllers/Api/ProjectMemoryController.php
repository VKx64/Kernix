<?php

namespace App\Http\Controllers\Api;

use App\Models\Project;
use App\Models\ProjectAiProfile;
use App\Models\ProjectMemoryEntry;
use App\Models\SystemSetting;
use App\Services\AiUsageService;
use App\Services\OpenRouterClient;
use App\Services\ProjectMemoryPrompt;
use App\Support\AiFeatures;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProjectMemoryController extends ApiController
{
    public function show(Request $request, Project $project): JsonResponse
    {
        $this->permission($request, 'projects.view');
        $canManage = $this->canManage($request, $project);
        $entries = $project->memoryEntries()->with(['sourceTask:id,title', 'reviewer:id,first_name,last_name,username'])
            ->when(! $canManage, fn ($query) => $query->where('status', 'approved'))
            ->orderByRaw("FIELD(status, 'pending', 'approved', 'rejected', 'superseded', 'archived')")
            ->orderByDesc('importance')->orderByDesc('id')->get();

        return $this->data([
            'project' => $project->only(['id', 'name', 'description', 'ai_memory_enabled']),
            'profile' => ProjectAiProfile::query()->firstOrCreate(['project_id' => $project->id], ['brief_status' => 'empty', 'version' => 0]),
            'entries' => $entries,
            'can_manage' => $canManage,
        ]);
    }

    public function draftBrief(Request $request, Project $project, OpenRouterClient $client, ProjectMemoryPrompt $prompt, AiUsageService $usage): JsonResponse
    {
        $this->assertCanManage($request, $project);
        abort_unless($project->ai_memory_enabled, 409, 'AI project memory is disabled for this project.');
        $settings = SystemSetting::firstOrFail();
        abort_unless(AiFeatures::enabled($settings, AiFeatures::PROJECT_BRIEF), 409, 'AI brief drafting is switched off for this workspace.');
        $usage->assertAvailable($settings);
        $completed = $project->tasks()->whereHas('status', fn ($q) => $q->where('key_name', 'complete'))->latest('updated_at')->limit(30)->get(['title', 'description', 'estimated_minutes', 'actual_minutes'])->toArray();
        $context = json_encode(['project_name' => $project->name, 'project_description' => $project->description, 'recent_completed_work' => $completed], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        $result = $client->structured($settings, $prompt->briefSystem($settings), $context, 'project_brief', $prompt->briefSchema());
        $usage->record('project_brief', 'project_brief_draft', null, $result, $project->id, $request->user()->id);
        $profile = ProjectAiProfile::query()->firstOrCreate(['project_id' => $project->id], ['brief_status' => 'empty', 'version' => 0]);
        $profile->update(['draft_brief' => trim((string) $result['output']['brief']), 'brief_status' => 'draft']);
        $this->audit($request, 'project.ai_memory.brief_draft', $project);
        return $this->data($profile->fresh());
    }

    public function updateBrief(Request $request, Project $project): JsonResponse
    {
        $this->assertCanManage($request, $project);
        $data = $request->validate(['brief' => ['required', 'string', 'max:10000'], 'approve' => ['sometimes', 'boolean']]);
        $profile = ProjectAiProfile::query()->firstOrCreate(['project_id' => $project->id], ['brief_status' => 'empty', 'version' => 0]);
        $approve = $request->boolean('approve');
        $profile->update($approve ? [
            'draft_brief' => trim($data['brief']), 'approved_brief' => trim($data['brief']), 'brief_status' => 'approved',
            'version' => $profile->version + 1, 'approved_by' => $request->user()->id, 'approved_at' => now(),
        ] : ['draft_brief' => trim($data['brief']), 'brief_status' => 'draft']);
        $this->audit($request, $approve ? 'project.ai_memory.brief_approve' : 'project.ai_memory.brief_edit', $project, ['version' => $profile->version]);
        return $this->data($profile->fresh());
    }

    public function updateEntry(Request $request, Project $project, ProjectMemoryEntry $entry): JsonResponse
    {
        $this->assertCanManage($request, $project);
        abort_unless((int) $entry->project_id === (int) $project->id, 404);
        $data = $request->validate([
            'action' => ['required', 'in:approve,reject,edit,archive'],
            'content' => ['required_if:action,edit', 'string', 'max:1000'],
            'category' => ['sometimes', 'in:rule,workflow,estimating,client_preference,lesson'],
            'reason' => ['required_if:action,reject', 'nullable', 'string', 'max:2000'],
        ]);
        $changes = ['reviewed_by' => $request->user()->id, 'reviewed_at' => now()];
        if ($data['action'] === 'approve') $changes['status'] = 'approved';
        elseif ($data['action'] === 'reject') { $changes['status'] = 'rejected'; $changes['rejection_reason'] = trim((string) $data['reason']); }
        elseif ($data['action'] === 'archive') $changes['status'] = 'archived';
        else {
            $changes += ['content' => trim($data['content']), 'content_hash' => hash('sha256', mb_strtolower(trim($data['content']))), 'category' => $data['category'] ?? $entry->category, 'status' => 'approved'];
        }
        $entry->update($changes);
        $this->audit($request, 'project.ai_memory.entry_'.$data['action'], $project, ['entry_id' => $entry->id]);
        return $this->data($entry->fresh(['sourceTask:id,title', 'reviewer:id,first_name,last_name,username']));
    }

    private function assertCanManage(Request $request, Project $project): void
    {
        $this->permission($request, 'projects.manage_ai_memory');
        abort_unless($this->canManage($request, $project), 403, 'Only this project manager or an administrator can manage AI memory.');
    }

    private function canManage(Request $request, Project $project, bool $checkPermission = true): bool
    {
        return ($request->user()->isAdmin() || (int) $project->manager_user_id === (int) $request->user()->id)
            && (! $checkPermission || $request->user()->canDo('projects.manage_ai_memory'));
    }
}
