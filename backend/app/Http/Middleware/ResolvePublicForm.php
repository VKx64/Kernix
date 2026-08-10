<?php

namespace App\Http\Middleware;

use App\Models\ProjectForm;
use App\Support\CurrentWorkspace;
use App\Support\PublicFormAvailability;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The one thing standing between an anonymous request and
 * BelongsToWorkspace's fallback: with no signed-in user, CurrentWorkspace::id()
 * is null, the global "workspace" scope on every scoped model becomes a
 * no-op, and a naive controller would file a stranger's submission into
 * `Workspace::orderBy('id')->value('id')` — whichever tenant happens to be
 * oldest in the database. See BelongsToWorkspace and RequireWorkspace for
 * the authenticated side of this same hazard.
 *
 * This middleware resolves the form from the route's {slug} ONLY — never
 * request input, which an attacker controls — then runs everything
 * downstream, including the controller, inside CurrentWorkspace::use() so
 * every model creation and query behaves like a properly scoped
 * authenticated request. CurrentWorkspace::use() restores the previous
 * override in a `finally`, so it is safe to nest here.
 *
 * IMPORTANT: response *serialisation* can happen after this middleware
 * unwinds. Never return an Eloquent model or a lazily-loaded relation as a
 * public response body — the controllers reachable from here build plain
 * arrays before returning, so nothing lazy ever resolves outside this
 * window.
 */
class ResolvePublicForm
{
    public function handle(Request $request, Closure $next): Response
    {
        $slug = (string) $request->route('slug');

        // Explicit escape hatch, even though the workspace scope is already
        // a no-op for an unauthenticated request: this keeps the intent
        // legible and stops it from silently depending on that accident.
        $form = ProjectForm::acrossWorkspaces()
            ->where('slug', $slug)
            ->with(['project.client', 'workspace'])
            ->first();
        abort_unless($form, 404);

        return CurrentWorkspace::use($form->workspace_id, function () use ($request, $next, $form) {
            $request->attributes->set('publicForm', $form);
            $request->attributes->set('publicFormClosedMessage', PublicFormAvailability::closedReason($form));

            return $next($request);
        });
    }
}
