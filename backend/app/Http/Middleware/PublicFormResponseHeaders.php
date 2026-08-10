<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Attaches the same no-store / no-index / no-referrer headers as
 * PublicFormController::respond() to EVERY response the public forms routes
 * can produce — including the ones the controller never gets to build.
 *
 * `throttle:*` and ResolvePublicForm both reject a request (429, 404) by
 * throwing, before PublicFormController::respond() ever runs, and both sit
 * ahead of the controller in the route's middleware list. Left alone, that
 * throw skips straight past any post-$next code in an outer middleware too
 * — an exception unwinds the stack rather than returning through it — so an
 * unknown-slug 404 or a throttled 429 would otherwise ship with none of
 * these headers: cacheable and referrer-leaking exactly where a valid
 * response is not.
 *
 * This middleware must be the OUTERMOST entry on both public-form routes so
 * it wraps the throttle limiter and ResolvePublicForm as well as the
 * controller. It renders any exception itself (mirroring how the kernel
 * would) purely to get a Response object it can attach headers to before
 * returning it up the stack — it does not change what gets rendered.
 */
class PublicFormResponseHeaders
{
    /** @var array<string, string> */
    private const HEADERS = [
        'Cache-Control' => 'no-store, private',
        'Pragma' => 'no-cache',
        'X-Robots-Tag' => 'noindex, nofollow',
        'Referrer-Policy' => 'no-referrer',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        try {
            $response = $next($request);
        } catch (Throwable $e) {
            $response = app(ExceptionHandler::class)->render($request, $e);
        }

        foreach (self::HEADERS as $key => $value) {
            $response->headers->set($key, $value);
        }

        return $response;
    }
}
