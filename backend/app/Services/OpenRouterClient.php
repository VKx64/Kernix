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
     * @param  array<string, mixed>  $schema
     * @return array<string, mixed>
     */
    public function structured(SystemSetting $settings, string $systemPrompt, string $context, string $schemaName, array $schema): array
    {
        abort_unless(filled($settings->openrouter_api_key) && filled($settings->openrouter_model), 409, 'OpenRouter is not configured.');

        // `response_format` is a request, not a guarantee. OpenRouter routes by
        // model name, and some endpoints behind a given model accept the schema
        // and then answer in prose anyway — Amazon Bedrock serving Anthropic
        // models did exactly that, which took every AI feature down with a
        // "could not reach my model" that had nothing to do with reachability.
        //
        // So the schema is stated in the request *and* in the prompt. Measured
        // against a real 5k-token context on the failing provider: schema alone
        // returned usable JSON 0 times in 3, the instruction in the system
        // prompt 2 times in 3, and the instruction at the end of the user
        // message 3 times in 3. Last thing read wins, so that is where it goes,
        // and it goes there on the first attempt rather than after a wasted
        // round trip.
        try {
            return $this->attempt($settings, $systemPrompt, $this->insistOnJson($context, $schema), $schemaName, $schema);
        } catch (MalformedStructuredOutput $first) {
            // Both positions at once for the retry, since the cheap fix has
            // already failed and a second failure costs the caller the turn.
            return $this->attempt(
                $settings,
                $this->insistOnJson($systemPrompt, $schema),
                $this->insistOnJson($context, $schema),
                $schemaName,
                $schema,
            );
        }
    }

    /**
     * One round trip.
     *
     * @param  array<string, mixed>  $schema
     * @return array<string, mixed>
     */
    private function attempt(SystemSetting $settings, string $systemPrompt, string $context, string $schemaName, array $schema): array
    {
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
                    // No `temperature`. `require_parameters` routes only to
                    // providers advertising support for *every* parameter sent,
                    // and the Anthropic endpoints — including the models this
                    // product suggests by name — do not advertise temperature
                    // alongside a strict json_schema. Sending both matched no
                    // endpoint at all, which took down every AI feature with
                    // "No endpoints found that can handle the requested
                    // parameters". Structured output is load-bearing here and
                    // temperature was only nudging determinism, so the schema
                    // guarantee is the one worth keeping.
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

        // A reply cut off at the token ceiling comes back as empty content
        // with `finish_reason: length`, which then looks exactly like a model
        // answering in prose. It is not: nothing is wrong with the model or the
        // schema, the budget is simply too small — and reasoning tokens are
        // spent from the same budget, so a thinking model can exhaust it before
        // writing a single visible character. Saying so is the difference
        // between changing one setting and hunting a phantom.
        if ($response->json('choices.0.finish_reason') === 'length') {
            throw new OpenRouterException(
                'The model ran out of room before it finished replying. Raise "Maximum response tokens" in Settings → AI (currently '
                .(int) $settings->ai_max_output_tokens.').',
            );
        }

        $content = $response->json('choices.0.message.content');
        $output = is_string($content) ? $this->decode($content) : $content;
        if (! is_array($output)) {
            // Distinct from OpenRouterException on purpose: the model answered,
            // it just answered in the wrong shape, and that is recoverable.
            throw new MalformedStructuredOutput('The model replied in prose rather than the structured format this feature needs.');
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

    /**
     * JSON out of a model's reply, allowing for the markdown fence some
     * endpoints wrap it in even when asked not to.
     *
     * @return array<string, mixed>|null
     */
    private function decode(string $content): ?array
    {
        $decoded = json_decode($content, true);
        if (is_array($decoded)) {
            return $decoded;
        }

        $trimmed = trim($content);
        if (preg_match('/^```(?:json)?\\s*(.+?)\\s*```$/is', $trimmed, $matches)) {
            $decoded = json_decode($matches[1], true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }

        // A reply that leads with prose and ends with the object still carries
        // the answer; the outermost braces are the best guess at where it is.
        $start = strpos($trimmed, '{');
        $end = strrpos($trimmed, '}');
        if ($start !== false && $end !== false && $end > $start) {
            $decoded = json_decode(substr($trimmed, $start, $end - $start + 1), true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }

        return null;
    }

    /**
     * States the schema in prose as well as in `response_format`.
     *
     * @param  array<string, mixed>  $schema
     */
    private function insistOnJson(string $text, array $schema): string
    {
        return $text."\n\nRespond with one JSON object and nothing else — no prose, no markdown fence, no explanation around it. It must match this JSON schema exactly:\n"
            .json_encode($schema, JSON_UNESCAPED_SLASHES);
    }
}
