<?php

namespace App\Http\Controllers\Api;

use App\Models\Client;
use App\Models\SystemSetting;
use App\Models\AiUsageEvent;
use App\Models\Workspace;
use App\Support\CurrentWorkspace;
use App\Services\AiEstimateReviewPrompt;
use App\Services\AiTaskCreationPrompt;
use App\Services\AiUsageService;
use App\Services\OliverPrompt;
use App\Services\OpenRouterClient;
use App\Services\ProjectMemoryPrompt;
use App\Services\TaskCompletionAuditPrompt;
use App\Support\AiFeatures;
use App\Support\WorkspaceFeatures;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class SettingsController extends ApiController
{
    public function show(Request $request): JsonResponse
    {
        $this->permission($request, 'settings.view');

        return $this->data($this->present(SystemSetting::firstOrFail(), $request));
    }

    public function context(Request $request): JsonResponse
    {
        $settings = SystemSetting::firstOrFail();
        $activeWorkspaceId = CurrentWorkspace::forUser($request->user());
        $activeWorkspace = $activeWorkspaceId ? Workspace::query()->find($activeWorkspaceId) : null;

        return $this->data([
            'app_name' => config('app.name'),
            'single_client_mode' => $settings->single_client_mode,
            'single_client_id' => $settings->single_client_id,
            'single_client' => $this->clientSummary(
                $settings->single_client_id ? Client::find($settings->single_client_id) : null
            ),
            'default_timezone' => $settings->default_timezone,
            'timezone' => $settings->default_timezone,
            'task_mutations_require_clock_in' => true,
            'permissions' => $request->user()->permissions(),
            'can_admin_override' => $request->user()->isAdmin(),
            'active_workspace' => $activeWorkspace?->toSummary(true),
            // Keyed by feature so an older or erroring server that omits this
            // still lets the frontend default every key to true. Every
            // registry key ships here, not only the RENDERED ones — the app
            // (nav, pickers, columns) needs to react to clients/projects
            // before their own switch is shown on the settings screen.
            'features' => $activeWorkspace
                ? collect(WorkspaceFeatures::keys())
                    ->mapWithKeys(fn (string $key) => [$key => WorkspaceFeatures::enabled($activeWorkspace, $key)])
                    ->all()
                : [],
        ]);
    }

    public function update(Request $request, ?string $section = null): JsonResponse
    {
        $this->permission($request, 'settings.edit');
        $rules = [
            'default_timezone' => ['sometimes', 'timezone'],
            'system_logo' => ['sometimes', 'nullable', 'string', 'max:500'], 'sidebar_logo' => ['sometimes', 'nullable', 'string', 'max:500'],
            'email_logo' => ['sometimes', 'nullable', 'string', 'max:500'], 'favicon' => ['sometimes', 'nullable', 'string', 'max:500'],
            'smtp_host' => ['sometimes', 'nullable', 'string', 'max:255'], 'smtp_port' => ['sometimes', 'integer', 'between:1,65535'],
            'smtp_encryption' => ['sometimes', 'nullable', 'in:tls,ssl,none'], 'smtp_username' => ['sometimes', 'nullable', 'string', 'max:255'],
            'smtp_password' => ['sometimes', 'nullable', 'string', 'max:500'], 'smtp_from_email' => ['sometimes', 'nullable', 'email', 'max:191'],
            'smtp_from_name' => ['sometimes', 'nullable', 'string', 'max:191'], 'storage_driver' => ['sometimes', 'in:local'],
            'local_upload_path' => ['sometimes', 'string', 'max:500'], 'local_public_url' => ['sometimes', 'nullable', 'url', 'max:500'],
            's3_bucket' => ['sometimes', 'nullable', 'string', 'max:255'], 's3_region' => ['sometimes', 'nullable', 'string', 'max:64'],
            's3_access_key' => ['sometimes', 'nullable', 'string', 'max:255'], 's3_secret_key' => ['sometimes', 'nullable', 'string', 'max:500'],
            's3_endpoint' => ['sometimes', 'nullable', 'url', 'max:500'], 's3_public_url_base' => ['sometimes', 'nullable', 'url', 'max:500'],
            's3_use_path_style' => ['sometimes', 'boolean'], 'single_client_mode' => ['sometimes', 'boolean'],
            'single_client_id' => ['sometimes', 'nullable', Rule::exists('clients', 'id')->whereNull('archived_at')->whereNull('deleted_at')],
            'openrouter_api_key' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'openrouter_model' => ['sometimes', 'nullable', 'string', 'max:191'],
            'ai_monthly_budget_usd' => ['sometimes', 'numeric', 'min:0.01', 'max:100000'],
            'ai_max_output_tokens' => ['sometimes', 'integer', 'between:100,10000'],
            'ai_request_timeout_seconds' => ['sometimes', 'integer', 'between:10,180'],
            'ai_inactivity_hours' => ['sometimes', 'integer', 'between:1,720'],
        ];
        foreach (AiFeatures::keys() as $feature) {
            $rules[AiFeatures::enabledColumn($feature)] = ['sometimes', 'boolean'];
            $rules[AiFeatures::promptColumn($feature)] = ['sometimes', 'nullable', 'string', 'max:20000'];
        }
        $data = $request->validate($rules);
        if ($section) {
            $allowed = match ($section) {
                'system' => ['default_timezone', 'system_logo', 'sidebar_logo', 'email_logo', 'favicon', 'single_client_mode', 'single_client_id'],
                'smtp' => ['smtp_host', 'smtp_port', 'smtp_encryption', 'smtp_username', 'smtp_password', 'smtp_from_email', 'smtp_from_name'],
                'storage' => ['storage_driver', 'local_upload_path', 'local_public_url', 's3_bucket', 's3_region', 's3_access_key', 's3_secret_key', 's3_endpoint', 's3_public_url_base', 's3_use_path_style'],
                'ai' => array_merge(
                    ['openrouter_api_key', 'openrouter_model', 'ai_monthly_budget_usd', 'ai_max_output_tokens', 'ai_request_timeout_seconds', 'ai_inactivity_hours'],
                    array_merge(...array_map(
                        fn (string $feature) => [AiFeatures::enabledColumn($feature), AiFeatures::promptColumn($feature)],
                        AiFeatures::keys(),
                    )),
                ),
                default => [],
            };
            $data = array_intersect_key($data, array_flip($allowed));
        }
        foreach (['smtp_password', 's3_access_key', 's3_secret_key', 'openrouter_api_key'] as $secret) {
            if (array_key_exists($secret, $data) && blank($data[$secret])) {
                unset($data[$secret]);
            }
        }
        $settings = SystemSetting::firstOrFail();
        $effectiveMode = array_key_exists('single_client_mode', $data) ? (bool) $data['single_client_mode'] : (bool) $settings->single_client_mode;
        $effectiveClient = array_key_exists('single_client_id', $data) ? $data['single_client_id'] : $settings->single_client_id;
        if ($effectiveMode && empty($effectiveClient)) {
            abort(422, 'Select a client before enabling single-client mode.');
        }
        $secretKeys = array_flip(['smtp_password', 's3_access_key', 's3_secret_key', 'openrouter_api_key']);
        $before = array_diff_key($settings->getAttributes(), $secretKeys);
        $settings->update($data);
        $this->audit($request, 'settings.update', $settings, [
            'before' => $before,
            'after' => array_diff_key($settings->getAttributes(), $secretKeys),
        ]);

        return $this->data($this->present($settings->fresh(), $request));
    }

    public function testAi(Request $request, OpenRouterClient $client, AiUsageService $usage): JsonResponse
    {
        $this->permission($request, 'settings.edit');
        $settings = SystemSetting::firstOrFail();
        abort_unless(filled($settings->openrouter_api_key) && filled($settings->openrouter_model), 409, 'Save an OpenRouter API key and model first.');
        $usage->assertAvailable($settings);
        $result = $client->review(
            $settings,
            'This is a connectivity test. Return action reject, a short message confirming the connection, an empty evidence_summary, and null approved_additional_minutes.',
            'Connectivity test only. Do not evaluate a real employee or task.',
        );
        $usage->record('connection_test', 'connection_test', null, $result, null, $request->user()->id);

        return $this->data([
            'connected' => true,
            'requested_model' => $settings->openrouter_model,
            'actual_model' => $result['actual_model'],
            'message' => $result['message'],
        ]);
    }

    /**
     * The shipped prompts, so the editor can show what a blank box falls back
     * to and offer a one-click restore.
     *
     * @return array<string, string>
     */
    private function defaultPrompts(): array
    {
        $memory = app(ProjectMemoryPrompt::class);

        return [
            AiFeatures::TASK_CREATION => app(AiTaskCreationPrompt::class)->defaultSystem(),
            AiFeatures::ESTIMATE_REVIEW => app(AiEstimateReviewPrompt::class)->defaultSystem(),
            AiFeatures::PROJECT_MEMORY => $memory->defaultLearningSystem(),
            AiFeatures::PROJECT_BRIEF => $memory->defaultBriefSystem(),
            AiFeatures::COMPLETION_AUDIT => app(TaskCompletionAuditPrompt::class)->defaultSystem(),
            AiFeatures::OLIVER => app(OliverPrompt::class)->defaultSystem(),
        ];
    }

    private function present(SystemSetting $settings, ?Request $request = null): array
    {
        $data = array_merge($settings->toArray(), [
            'has_smtp_password' => filled($settings->smtp_password),
            'has_s3_credentials' => filled($settings->s3_access_key) && filled($settings->s3_secret_key),
            'has_openrouter_api_key' => filled($settings->openrouter_api_key),
            'ai_configured' => filled($settings->openrouter_api_key) && filled($settings->openrouter_model),
            'ai_current_month_cost_usd' => (float) AiUsageEvent::query()
                ->where('created_at', '>=', now()->startOfMonth())
                ->sum('cost_usd'),
            'ai_features' => AiFeatures::catalog($settings, $this->defaultPrompts()),
            'ai_current_month_usage_by_feature' => AiUsageEvent::query()
                ->where('created_at', '>=', now()->startOfMonth())
                ->selectRaw('feature, SUM(cost_usd) as cost_usd, COUNT(*) as calls')
                ->groupBy('feature')->get(),
        ]);

        if ($request?->user()?->canDo('settings.edit')) {
            $data['client_options'] = Client::query()
                ->whereNull('archived_at')
                ->orderBy('name')
                ->get()
                ->map(fn (Client $client) => $this->clientSummary($client))
                ->values();
        }

        return $data;
    }
}
