<?php

namespace App\Jobs;

use App\Models\WhatsAppMessage;
use App\Services\WhatsAppClient;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * Delivery happens on the queue, never in the request that caused it: the bridge
 * may be reconnecting, and a person saving a task should not wait on somebody
 * else's phone.
 *
 * The log row is the unit of work. It is written before the job is dispatched,
 * so a message is never lost by a worker that dies, and a failed send leaves the
 * reason on the row rather than only in the log file.
 */
class SendWhatsAppMessage implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    /** Seconds between attempts: a reconnecting bridge is usually back inside a minute. */
    public array $backoff = [10, 60];

    public function __construct(public readonly int $messageId) {}

    public function handle(WhatsAppClient $client): void
    {
        $message = WhatsAppMessage::query()->find($this->messageId);
        if (! $message || $message->status === 'sent') {
            return;
        }

        try {
            $waMessageId = $client->send((string) $message->jid, (string) $message->body);
            $message->update([
                'status' => 'sent',
                'wa_message_id' => $waMessageId !== '' ? $waMessageId : null,
                'error' => null,
            ]);
        } catch (Throwable $exception) {
            $message->update([
                'status' => 'failed',
                'error' => mb_substr($exception->getMessage(), 0, 2000),
            ]);

            throw $exception;
        }
    }

    public function failed(?Throwable $exception): void
    {
        WhatsAppMessage::query()->whereKey($this->messageId)->update([
            'status' => 'failed',
            'error' => mb_substr((string) $exception?->getMessage(), 0, 2000),
        ]);
    }
}
