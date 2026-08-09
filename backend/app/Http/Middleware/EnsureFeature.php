<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Models\Workspace;
use App\Support\CurrentWorkspace;
use App\Support\WorkspaceFeatures;
use Closure;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureFeature
{
    public function handle(Request $request, Closure $next, string $feature): Response
    {
        $user = $request->user();
        $workspaceId = $user instanceof User ? CurrentWorkspace::forUser($user) : CurrentWorkspace::id();
        $workspace = $workspaceId ? Workspace::query()->find($workspaceId) : null;

        if ($workspace && ! WorkspaceFeatures::enabled($workspace, $feature)) {
            throw new HttpResponseException(response()->json([
                'message' => 'This feature is turned off for this workspace.',
                'code' => 'FEATURE_DISABLED',
            ], 403));
        }

        return $next($request);
    }
}
