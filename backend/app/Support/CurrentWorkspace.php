<?php

namespace App\Support;

use App\Models\User;
use App\Models\Workspace;

/**
 * The workspace every scoped query is filtered by. Resolved from the signed-in
 * user's active workspace, and overridable so jobs and tests can run work in a
 * specific tenant without a request.
 */
final class CurrentWorkspace
{
    private static ?int $override = null;

    private static bool $disabled = false;

    public static function id(): ?int
    {
        if (self::$disabled) {
            return null;
        }
        if (self::$override !== null) {
            return self::$override;
        }

        $user = auth()->user();

        return $user instanceof User ? self::forUser($user) : null;
    }

    public static function forUser(User $user): ?int
    {
        if ($user->active_workspace_id && $user->workspaces()->whereKey($user->active_workspace_id)->exists()) {
            return (int) $user->active_workspace_id;
        }

        $fallback = $user->workspaces()->orderBy('workspaces.id')->value('workspaces.id');
        if ($fallback) {
            $user->forceFill(['active_workspace_id' => $fallback])->save();

            return (int) $fallback;
        }

        return null;
    }

    /** Run a callback inside a specific workspace, e.g. from a queued job. */
    public static function use(int|Workspace|null $workspace, callable $callback): mixed
    {
        $previous = self::$override;
        self::$override = $workspace instanceof Workspace ? (int) $workspace->id : $workspace;
        try {
            return $callback();
        } finally {
            self::$override = $previous;
        }
    }

    /** Escape hatch for maintenance code that must see every tenant. */
    public static function withoutScope(callable $callback): mixed
    {
        $previous = self::$disabled;
        self::$disabled = true;
        try {
            return $callback();
        } finally {
            self::$disabled = $previous;
        }
    }

    public static function reset(): void
    {
        self::$override = null;
        self::$disabled = false;
    }
}
