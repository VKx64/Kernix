<?php

// These routes are registered from bootstrap/app.php's `then:` callback, NOT
// through `withRouting(api: ...)`, and deliberately carry NO middleware
// group of any kind — no StartSession, no ValidateCsrfToken, no
// EnsureFrontendRequestsAreStateful, no Sanctum, no cookies. A public form
// has no session to authenticate against and must never receive one.
//
// DO NOT move these into routes/api.php. That file is loaded through
// ->withRouting(api: ...), which applies ->statefulApi() and silently wires
// Sanctum's stateful/CSRF middleware onto every route in it. An anonymous
// visitor's browser has no CSRF cookie and no session, so the very first
// POST here would fail with 419 the moment this file is "tidied up" into
// api.php. This is the exact bug class already fixed once for
// register/login/logout — see bootstrap/app.php's shouldRenderJsonWhen.
//
// The `api/public` prefix is deliberate too: it rides on config/cors.php's
// existing `'paths' => ['api/*']`, bootstrap/app.php's existing
// `shouldRenderJsonWhen` check for `api/*`, and the frontend's existing
// `/api` dev proxy and SPA-fallback exclusion — all for free, with no new
// entries needed anywhere else.
//
// The route constraint on {slug} rejects a malformed slug at the router,
// before a single query runs.

use App\Http\Controllers\Api\PublicFormController;
use App\Http\Middleware\PublicFormResponseHeaders;
use App\Http\Middleware\ResolvePublicForm;
use Illuminate\Support\Facades\Route;

Route::prefix('api/public')->group(function () {
    Route::get('/forms/{slug}', [PublicFormController::class, 'show'])
        ->where('slug', '[A-Za-z0-9]{32}')
        ->middleware([PublicFormResponseHeaders::class, 'throttle:60,1', ResolvePublicForm::class]);

    Route::post('/forms/{slug}/submissions', [PublicFormController::class, 'store'])
        ->where('slug', '[A-Za-z0-9]{32}')
        ->middleware([PublicFormResponseHeaders::class, 'throttle:public-form-submit', ResolvePublicForm::class]);
});
