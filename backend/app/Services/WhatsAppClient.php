<?php

namespace App\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * The only thing in Kernix that talks to the WhatsApp bridge container.
 *
 * The bridge is not reachable from a browser and holds no permissions of its
 * own: it is a socket and a shared secret. Everything about who may be messaged
 * and what a reply is allowed to do is decided on this side, before a call gets
 * here.
 */
class WhatsAppClient
{
    public function configured(): bool
    {
        return filled(config('services.whatsapp.url')) && filled(config('services.whatsapp.token'));
    }

    /**
     * Connection state, and the pairing QR while one is waiting to be scanned.
     *
     * @return array{state: string, jid: ?string, qr: ?string, pair_code: ?string, last_error: ?string, connected_at: ?string}
     */
    public function status(): array
    {
        $response = $this->request()->get('/status');
        $response->throw();

        /** @var array{state: string, jid: ?string, qr: ?string, pair_code: ?string, last_error: ?string, connected_at: ?string} $payload */
        $payload = $response->json();

        return $payload;
    }

    /** Drop the bridge's stored credentials so a fresh QR is offered. */
    public function pair(): array
    {
        return $this->request()->post('/pair')->throw()->json();
    }

    /**
     * Pair by typing a code into the phone instead of scanning a QR. The bridge
     * waits for WhatsApp to issue the code, so this call is slower than the rest.
     */
    public function pairCode(string $phone): array
    {
        return $this->request()->timeout(30)->post('/pair-code', ['phone' => $phone])->throw()->json();
    }

    public function logout(): array
    {
        return $this->request()->post('/logout')->throw()->json();
    }

    /** @return string the WhatsApp message id, empty when the bridge did not report one */
    public function send(string $to, string $text): string
    {
        $response = $this->request()->post('/send', ['to' => $to, 'text' => $text]);
        $response->throw();

        return (string) ($response->json('wa_message_id') ?? '');
    }

    private function request(): PendingRequest
    {
        if (! $this->configured()) {
            throw new RuntimeException('The WhatsApp bridge is not configured. Set WHATSAPP_BRIDGE_URL and WHATSAPP_BRIDGE_TOKEN.');
        }

        return Http::baseUrl(rtrim((string) config('services.whatsapp.url'), '/'))
            ->withToken((string) config('services.whatsapp.token'))
            ->acceptJson()
            ->timeout((int) config('services.whatsapp.timeout', 15));
    }
}
