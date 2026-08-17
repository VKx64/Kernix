<?php

namespace App\Http\Controllers\Api;

use App\Models\OliverAction;
use App\Models\OliverConversation;
use App\Models\OliverMessage;
use App\Models\SystemSetting;
use App\Services\AiUsageService;
use App\Services\MalformedStructuredOutput;
use App\Services\OliverActionRunner;
use App\Services\OliverInsights;
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
        $data = $request->validate([
            'body' => ['required', 'string', 'max:5000'],
            // The autopilot switch in the interface. It promised "Oliver
            // proposes and waits for you on everything" while living only in
            // localStorage and never reaching the server, so Oliver went on
            // changing work with the switch off. Defaulting to true keeps the
            // existing contract for any caller that does not send it.
            'autopilot' => ['sometimes', 'boolean'],
        ]);
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
            // "Could not reach my model" was told for every failure, including
            // ones where the model answered perfectly well and the problem was
            // on this side. That sent people to check their network over a
            // configuration or format fault, so the two are now distinguished.
            [$body, $code] = $exception instanceof MalformedStructuredOutput
                ? ['My model answered, but not in the format I need to act on. Nothing was changed. Try asking again, or in a different way.', 'malformed_output']
                : ['I could not reach my model just now, so nothing was changed. Try again in a moment.', 'provider_error'];
            $reply = $conversation->messages()->create([
                'role' => 'assistant',
                'body' => $body,
                'error_code' => $code,
            ]);
            report($exception);

            return $this->data(['message' => $reply->toSummary()], 200);
        }

        $usage->record('oliver', 'oliver_conversation', $conversation->id, $result, null, $actor->id);
        // The model's own `actions` array is not trusted on its word: only an
        // `intent` of "act" ever reaches the runner, so a turn it has already
        // marked as an answer cannot mutate anything even if it slipped
        // something into `actions` by mistake. And the default is
        // "answer", not "act" — a reply that arrives without an
        // intent is malformed, and the safe reading of a malformed reply is
        // that it changes nothing; providers that ignore `response_format` drop
        // required fields routinely, so this is reachable in practice.
        $actions = ($result['output']['intent'] ?? 'answer') === 'act' ? ($result['output']['actions'] ?? []) : [];
        $performed = [];
        if ($actions !== [] && ! $request->boolean('autopilot', true)) {
            // Proposed, not run: the switch is off, so the teammate decides.
            $performed = $this->runner->describe($actions);
        } elseif ($actions !== []) {
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
            'body' => $this->reconcile(trim((string) ($result['output']['reply'] ?? 'Done.')), $performed),
            'actions' => $performed,
        ]);
        // The log rows are written as each action runs, so the turn they belong
        // to only exists once the reply does.
        $recorded = array_values(array_filter(array_column($performed, 'action_id')));
        if ($recorded !== []) {
            OliverAction::query()->whereIn('id', $recorded)->update(['message_id' => $reply->id]);
        }
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

    /** What Oliver can say about the requester's own work without changing any of it. */
    public function insights(Request $request, OliverInsights $insights): JsonResponse
    {
        $this->permission($request, 'messages.view');

        return $this->data($insights->for($request->user()));
    }

    /** The rail's "acted today" list: this person's own actions, newest first. */
    public function actions(Request $request): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $limit = max(1, min(100, $request->integer('limit', 20)));

        return $this->data(
            OliverAction::query()
                ->where('user_id', $request->user()->id)
                ->latest('id')
                ->limit($limit)
                ->get()
                ->map(fn (OliverAction $action) => $action->toSummary())
                ->all()
        );
    }

    public function undo(Request $request, OliverAction $action): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $this->runner->undo($action, $request->user());
        $this->audit($request, 'oliver.undo', $action, ['type' => $action->type, 'entity_id' => $action->entity_id]);

        return $this->data($action->toSummary());
    }

    /**
     * Keeps the prose honest about what actually happened.
     *
     * The model writes `reply` before any action runs, so it writes what it
     * intends — "Done, assigned #4 to Rosa" — and then the runner refuses the
     * action for a reason the model could not have known. The refusal is shown
     * in the action rows, but the sentence above them is what people read, and
     * it was claiming work that was never done. A correction is appended rather
     * than the reply being replaced, so the model's own wording still stands
     * for whatever did succeed.
     *
     * @param  array<int, array<string, mixed>>  $performed
     */
    private function reconcile(string $reply, array $performed): string
    {
        $proposed = array_values(array_filter($performed, fn (array $action) => ($action['status'] ?? null) === 'proposed'));
        if ($proposed !== []) {
            return trim($reply)."\n\nAutopilot is off, so nothing was changed. Turn it on, or say go, and I will:\n"
                .implode("\n", array_map(fn (array $action) => '- '.($action['summary'] ?? 'run that change'), $proposed));
        }

        $refused = array_values(array_filter($performed, fn (array $action) => ($action['status'] ?? null) === 'refused'));
        if ($refused === []) {
            return $reply;
        }

        $done = count($performed) - count($refused);
        $reasons = array_values(array_unique(array_filter(array_map(
            fn (array $action) => trim((string) ($action['summary'] ?? '')),
            $refused,
        ))));

        $correction = $done > 0
            ? 'Not everything went through, though — '.count($refused).' of '.count($performed).' changes were refused:'
            : 'That did not go through, though — nothing was changed:';

        return trim($reply)."\n\n".$correction."\n".implode(
            "\n",
            array_map(fn (string $reason) => '- '.($reason !== '' ? $reason : 'refused without a stated reason'), $reasons),
        );
    }

    private function conversation(Request $request): OliverConversation
    {
        return OliverConversation::query()->firstOrCreate(
            ['user_id' => $request->user()->id],
            ['title' => 'Oliver'],
        );
    }
}
