<?php

namespace App\Services;

use App\Models\OliverConversation;
use App\Models\SystemSetting;
use App\Models\User;
use App\Support\AiFeatures;
use Throwable;

/**
 * Oliver, answering over WhatsApp.
 *
 * The same conversation as the web client, so a question asked on the way to
 * work is still there on the screen afterwards. What is deliberately missing is
 * the action runner: in the app Oliver can create, assign, and comment, and each
 * of those is shown with an undo. A phone has neither the confirmation nor the
 * undo, and a chat line can be misread, so a WhatsApp turn is recorded as an
 * answer and its proposed actions are dropped rather than run.
 */
class WhatsAppOliverBridge
{
    public function __construct(
        private readonly OliverPrompt $prompt,
        private readonly OpenRouterClient $client,
        private readonly AiUsageService $usage,
    ) {}

    public function available(): bool
    {
        $settings = SystemSetting::query()->find(1);

        return $settings !== null
            && AiFeatures::enabled($settings, AiFeatures::OLIVER)
            && filled($settings->openrouter_api_key)
            && filled($settings->openrouter_model);
    }

    public function answer(User $user, string $question): string
    {
        if (! $user->canDo('messages.view')) {
            return 'Your account does not have permission to use Oliver.';
        }

        $settings = SystemSetting::query()->find(1);
        if (! $this->available() || ! $settings) {
            return 'Oliver is switched off, or has no model configured, so I cannot answer questions here yet.';
        }

        try {
            $this->usage->assertAvailable($settings);
        } catch (Throwable) {
            return 'Oliver has reached this month’s AI budget, so I cannot answer right now.';
        }

        $conversation = OliverConversation::query()->firstOrCreate(
            ['user_id' => $user->id],
            ['title' => 'Oliver'],
        );
        $conversation->messages()->create(['role' => 'user', 'body' => mb_substr(trim($question), 0, 5000)]);
        $conversation->update(['last_message_at' => now()]);

        try {
            $result = $this->client->structured(
                $settings,
                $this->prompt->system($settings),
                $this->prompt->context($conversation, $user),
                'oliver_reply',
                $this->prompt->schema(),
            );
        } catch (Throwable $exception) {
            report($exception);
            $conversation->messages()->create([
                'role' => 'assistant',
                'body' => 'I could not reach my model just now, so nothing was changed.',
                'error_code' => 'provider_error',
            ]);

            return 'I could not reach my model just now. Try again in a moment.';
        }

        $this->usage->record('oliver', 'oliver_conversation', $conversation->id, $result, null, $user->id);

        $reply = trim((string) ($result['output']['reply'] ?? ''));
        if ($reply === '') {
            $reply = 'I have nothing to add to that.';
        }

        // Anything Oliver wanted to *do* is reported rather than performed, so
        // the asker knows the change is waiting for them in the app.
        $wanted = ($result['output']['intent'] ?? 'answer') === 'act' ? count($result['output']['actions'] ?? []) : 0;
        if ($wanted > 0) {
            $reply .= sprintf(
                "\n\n(I did not make %s here — changes over WhatsApp are not run. Open Oliver in Kernix to apply %s.)",
                $wanted === 1 ? 'that change' : 'those changes',
                $wanted === 1 ? 'it' : 'them',
            );
        }

        $conversation->messages()->create(['role' => 'assistant', 'body' => $reply]);

        return $reply;
    }
}
