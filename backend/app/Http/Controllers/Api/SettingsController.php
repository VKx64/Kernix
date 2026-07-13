<?php

namespace App\Http\Controllers\Api;

use App\Models\Client;
use App\Models\SystemSetting;
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
        ];
        $data = $request->validate($rules);
        if ($section) {
            $allowed = match ($section) {
                'system' => ['default_timezone', 'system_logo', 'sidebar_logo', 'email_logo', 'favicon', 'single_client_mode', 'single_client_id'],
                'smtp' => ['smtp_host', 'smtp_port', 'smtp_encryption', 'smtp_username', 'smtp_password', 'smtp_from_email', 'smtp_from_name'],
                'storage' => ['storage_driver', 'local_upload_path', 'local_public_url', 's3_bucket', 's3_region', 's3_access_key', 's3_secret_key', 's3_endpoint', 's3_public_url_base', 's3_use_path_style'],
                default => [],
            };
            $data = array_intersect_key($data, array_flip($allowed));
        }
        foreach (['smtp_password', 's3_access_key', 's3_secret_key'] as $secret) {
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
        $secretKeys = array_flip(['smtp_password', 's3_access_key', 's3_secret_key']);
        $before = array_diff_key($settings->getAttributes(), $secretKeys);
        $settings->update($data);
        $this->audit($request, 'settings.update', $settings, [
            'before' => $before,
            'after' => array_diff_key($settings->getAttributes(), $secretKeys),
        ]);

        return $this->data($this->present($settings->fresh(), $request));
    }

    private function present(SystemSetting $settings, ?Request $request = null): array
    {
        $data = array_merge($settings->toArray(), [
            'has_smtp_password' => filled($settings->smtp_password),
            'has_s3_credentials' => filled($settings->s3_access_key) && filled($settings->s3_secret_key),
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
