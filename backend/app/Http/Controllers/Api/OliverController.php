<?php

namespace App\Http\Controllers\Api;

use App\Models\OliverConversation;
use App\Models\OliverMessage;
use App\Models\SystemSetting;
use App\Services\AiUsageService;
use App\Services\OliverActionRunner;
use App\Services\OliverPrompt;
use App\Services\OpenRouterClient;
use App\Support\AiFeatures;
use App\Support\TaskMutationGuard;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class OliverController extends ApiController
{
    public function __construct(
        private readonly OliverPrompt $prompt,
        private readonly OliverActionRunner $runner,
    ) {}

    /** Oliver is one running conversation per person per workspace. */
    public function show(Request $request): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $conversation = $this->conversation($request);
        $settings = SystemSetting::firstOrFail();

        return $this->data([
            'conversation' => [
                'id' => $conversation->id,
                'title' => $conversation->title,
                'last_message_at' => optional($conversation->last_message_at)->toIso8601String(),
            ],
            'available' => AiFeatures::enabled($settings, AiFeatures::OLIVER)
                && filled($settings->openrouter_api_key)
                && filled($settings->openrouter_model),
            'messages' => $conversation->messages()->oldest('id')->limit(200)->get()
                ->map(fn (OliverMessage $message) => $message->toSummary())->all(),
        ]);
    }

    public function send(Request $request, OpenRouterClient $client, AiUsageService $usage): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $data = $request->validate(['body' => ['required', 'string', 'max:5000']]);
        $settings = SystemSetting::firstOrFail();
        abort_unless(AiFeatures::enabled($settings, AiFeatures::OLIVER), 409, 'Oliver is switched off for this workspace.');
        abort_unless(
            filled($settings->openrouter_api_key) && filled($settings->openrouter_model),
            409,
            'Oliver needs an OpenRouter key and model in Settings before he can reply.',
        );
        $usage->assertAvailable($settings);

        $conversation = $this->conversation($request);
        $actor = $request->user();
        $conversation->messages()->create(['role' => 'user', 'body' => trim($data['body'])]);
        $conversation->update(['last_message_at' => now()]);

        try {
            $result = $client->structured(
                $settings,
                $this->prompt->system($settings),
                $this->prompt->context($conversation, $actor),
                'oliver_reply',
                $this->prompt->schema(),
            );
        } catch (Throwable $exception) {
            $reply = $conversation->messages()->create([
                'role' => 'assistant',
                'body' => 'I could not reach my model just now, so nothing was changed. Try again in a moment.',
                'error_code' => 'provider_error',
            ]);
            report($exception);

            return $this->data(['message' => $reply->toSummary()], 200);
        }

        $usage->record('oliver', 'oliver_conversation', $conversation->id, $result, null, $actor->id);
        $actions = $result['output']['actions'] ?? [];
        $performed = [];
        if ($actions !== []) {
            try {
                // Chat is a task mutation surface too: the clock rules still apply.
                TaskMutationGuard::enforce($request);
                $performed = $this->runner->run($actions, $actor);
            } catch (HttpResponseException $exception) {
                // Refuse the changes but still answer, so the chat explains why.
                $reason = (string) (json_decode((string) $exception->getResponse()->getContent(), true)['message'] ?? 'Clock in before changing task work.');
                $performed = array_map(fn (array $action) => [
                    'type' => (string) ($action['type'] ?? 'unknown'),
                    'status' => 'refused',
                    'summary' => $reason,
                ], $actions);
            }
        }

        $reply = $conversation->messages()->create([
            'role' => 'assistant',
            'body' => trim((string) ($result['output']['reply'] ?? 'Done.')),
            'actions' => $performed,
        ]);
        $conversation->update(['last_message_at' => now()]);
        $this->audit($request, 'oliver.reply', $conversation, ['actions' => count($performed)]);

        return $this->data(['message' => $reply->toSummary()]);
    }

    public function clear(Request $request): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $conversation = $this->conversation($request);
        $conversation->messages()->delete();
        $conversation->update(['last_message_at' => null]);

        return response()->json(null, 204);
    }

    private function conversation(Request $request): OliverConversation
    {
        return OliverConversation::query()->firstOrCreate(
            ['user_id' => $request->user()->id],
            ['title' => 'Oliver'],
        );
    }
}
