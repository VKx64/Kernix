<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Support\CurrentWorkspace;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Workspace scoping filters by the current workspace, and somebody who belongs
 * to no workspace has none, which would otherwise leave their queries unfiltered
 * and show them every tenant's rows. Until they have onboarded they may reach
 * only their own account and the endpoint that creates their first workspace.
 */
class RequireWorkspace
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if ($user instanceof User && CurrentWorkspace::forUser($user) === null) {
            abort(409, 'Create your workspace before using the rest of the application.');
        }

        return $next($request);
    }
}
