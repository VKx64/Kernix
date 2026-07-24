<?php

namespace App\Services;

use App\Models\SystemSetting;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

class OpenRouterClient
{
    private const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

    /** @return array<string, mixed> */
    public function review(SystemSetting $settings, string $systemPrompt, string $context): array
    {
        $result = $this->structured($settings, $systemPrompt, $context, 'task_estimate_review', [
            'type' => 'object',
            'additionalProperties' => false,
            'properties' => [
                'action' => ['type' => 'string', 'enum' => ['challenge', 'approve', 'reject']],
                'message' => ['type' => 'string'],
                'evidence_summary' => ['type' => 'array', 'items' => ['type' => 'string']],
                'approved_additional_minutes' => ['type' => ['integer', 'null'], 'minimum' => 1],
            ],
            'required' => ['action', 'message', 'evidence_summary', 'approved_additional_minutes'],
        ]);
        $decision = $result['output'];
        $action = $decision['action'] ?? null;
        $message = trim((string) ($decision['message'] ?? ''));
        $approved = $decision['approved_additional_minutes'] ?? null;
        if (! in_array($action, ['challenge', 'approve', 'reject'], true) || $message === '') {
            throw new OpenRouterException('OpenRouter returned an incomplete decision.');
        }
        if ($action === 'approve' && (! is_int($approved) || $approved < 1)) {
            throw new OpenRouterException('OpenRouter approved the request without a valid time amount.');
        }
        if ($action !== 'approve') {
            $approved = null;
        }

        return $result + [
            'action' => $action,
            'message' => $message,
            'evidence_summary' => array_values(array_filter(is_array($decision['evidence_summary'] ?? null) ? $decision['evidence_summary'] : [], 'is_string')),
            'approved_additional_minutes' => $approved,
        ];
    }

    /**
     * @param array<string, mixed> $schema
     * @return array<string, mixed>
     */
    public function structured(SystemSetting $settings, string $systemPrompt, string $context, string $schemaName, array $schema): array
    {
        abort_unless(filled($settings->openrouter_api_key) && filled($settings->openrouter_model), 409, 'OpenRouter is not configured.');

        try {
            $response = Http::withToken($settings->openrouter_api_key)
                ->acceptJson()
                ->asJson()
                ->withHeaders([
                    'HTTP-Referer' => config('app.url'),
                    'X-OpenRouter-Title' => config('app.name').' AI Project Manager',
                ])
                ->connectTimeout(min(15, (int) $settings->ai_request_timeout_seconds))
                ->timeout((int) $settings->ai_request_timeout_seconds)
                ->post(self::ENDPOINT, [
                    'model' => $settings->openrouter_model,
                    'messages' => [
                        ['role' => 'system', 'content' => $systemPrompt],
                        ['role' => 'user', 'content' => $context],
                    ],
                    'temperature' => 0.1,
                    'max_tokens' => (int) $settings->ai_max_output_tokens,
                    'provider' => [
                        'zdr' => true,
                        'require_parameters' => true,
                        'allow_fallbacks' => true,
                    ],
                    'plugins' => [],
                    'response_format' => [
                        'type' => 'json_schema',
                        'json_schema' => [
                            'name' => $schemaName,
                            'strict' => true,
                            'schema' => $schema,
                        ],
                    ],
                ]);
        } catch (ConnectionException $exception) {
            throw new OpenRouterException('OpenRouter could not be reached: '.$exception->getMessage(), null);
        }

        if (! $response->successful()) {
            $message = $response->json('error.message') ?: 'OpenRouter returned an error.';
            throw new OpenRouterException((string) $message, $response->status());
        }

        $content = $response->json('choices.0.message.content');
        $output = is_string($content) ? json_decode($content, true) : $content;
        if (! is_array($output)) {
            throw new OpenRouterException('OpenRouter returned invalid structured output.');
        }

        return [
            'output' => $output,
            'generation_id' => $response->json('id'),
            'actual_model' => $response->json('model'),
            'prompt_tokens' => $response->json('usage.prompt_tokens'),
            'completion_tokens' => $response->json('usage.completion_tokens'),
            'total_tokens' => $response->json('usage.total_tokens'),
            'cost_usd' => (float) ($response->json('usage.cost') ?? 0),
        ];
    }
}
