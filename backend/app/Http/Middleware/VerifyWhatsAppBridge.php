<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The only caller of the inbound endpoint is the WhatsApp bridge container,
 * which has no user and no session. It proves itself with the shared secret both
 * sides are configured with, compared in constant time so a wrong token tells an
 * attacker nothing about how wrong it was.
 */
class VerifyWhatsAppBridge
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = (string) config('services.whatsapp.token');
        $presented = (string) $request->bearerToken();

        if ($expected === '' || ! hash_equals($expected, $presented)) {
            return response()->json(['message' => 'Unauthorized.'], 401);
        }

        return $next($request);
    }
}
