<?php

use App\Http\Middleware\ApplyWorkspaceTimezone;
use App\Http\Middleware\EnsureActiveUser;
use App\Http\Middleware\EnsureFeature;
use App\Http\Middleware\EnsurePermission;
use App\Http\Middleware\EnsureWebApiToken;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Laravel\Sanctum\Http\Middleware\CheckAbilities;
use Laravel\Sanctum\Http\Middleware\CheckForAnyAbility;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->statefulApi();
        $middleware->alias([
            'permission' => EnsurePermission::class,
            'feature' => EnsureFeature::class,
            'active' => EnsureActiveUser::class,
            'workspace.timezone' => ApplyWorkspaceTimezone::class,
            'web-api' => EnsureWebApiToken::class,
            'abilities' => CheckAbilities::class,
            'ability' => CheckForAnyAbility::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // These auth routes live in web.php (so the session cookie applies to
        // them) but the client only ever talks to them with fetch/JSON. Left
        // out, a validation failure renders as a redirect-back HTML response,
        // which fetch quietly follows to a 2xx instead of surfacing the error.
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*')
                || $request->is('register')
                || $request->is('login')
                || $request->is('logout'),
        );
    })->create();
