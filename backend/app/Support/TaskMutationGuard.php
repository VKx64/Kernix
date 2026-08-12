<?php

namespace App\Support;

use App\Models\Task;
use App\Models\TimeSession;
use App\Models\User;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;

class TaskMutationGuard
{
    public static function enforce(Request $request, ?Task $task = null): void
    {
        self::enforceUser($request->user(), $request->boolean('admin_override') && $request->user()->isAdmin(), $task);
    }

    /**
     * For oversight actions — settling proof, deciding an estimate or a work
     * request. The actor is deciding *about* the task rather than working on
     * it, and is never its assignee, so the assignment rule must not apply.
     *
     * Structural rather than permission-based on purpose: making reviewers
     * depend on a tasks.work_unassigned grant would silently break any custom
     * role created after the migration that seeded that grant.
     */
    public static function enforceOversight(Request $request, ?Task $task = null): void
    {
        self::enforceUser(
            $request->user(),
            $request->boolean('admin_override') && $request->user()->isAdmin(),
            $task,
            false,
        );
    }

    public static function enforceUser(User $user, bool $override = false, ?Task $task = null, bool $checkAssignment = true): void
    {
        if ($task?->archived_at) {
            throw new HttpResponseException(response()->json([
                'message' => 'Archived tasks are read-only. Restore this task before changing it.',
                'code' => 'TASK_ARCHIVED',
            ], 409));
        }

        TimeSessionCleanup::closeStale($user->id);
        $session = TimeSession::with(['breaks' => fn ($breaks) => $breaks->whereNull('end_at')])
            ->where('user_id', $user->id)
            ->whereNull('clock_out_at')
            ->whereBetween('clock_in_at', [now()->subDay(), now()->addMinutes(5)])
            ->latest('clock_in_at')
            ->first();

        if ($session?->breaks->isNotEmpty()) {
            throw new HttpResponseException(response()->json([
                'message' => 'End your break before changing task work.',
                'code' => 'BREAK_ACTIVE',
            ], 409));
        }

        if (! $session && ! $override) {
            throw new HttpResponseException(response()->json([
                'message' => 'Clock in before changing task work.',
                'code' => 'CLOCK_IN_REQUIRED',
            ], 409));
        }

        if ($checkAssignment) {
            self::enforceAssignment($user, $task);
        }
    }

    /**
     * Work is limited to your own assignments. Anyone who legitimately acts on
     * someone else's task — a reviewer settling proof, a manager reassigning —
     * holds tasks.work_unassigned and passes straight through.
     *
     * Deliberately last: authorization and the clock gate must answer first, so
     * a caller who lacks permission still sees 403 rather than this 409.
     */
    public static function enforceAssignment(User $user, ?Task $task): void
    {
        if (! $task || $user->isAdmin() || $user->canDo('tasks.work_unassigned')) {
            return;
        }
        if ($task->hasAssignee($user)) {
            return;
        }
        // A task defaults to the project's manager as assignee, so whoever
        // created it is frequently not the assignee. Locking them out of the
        // task they just made would be nonsense.
        if ((int) $task->created_by === (int) $user->id) {
            return;
        }
        // Being handed a subtask is being handed work on its parent; without
        // this the assignee holds a row they cannot touch.
        if ($task->subtasks()->where('assignee_user_id', $user->id)->exists()) {
            return;
        }

        throw new HttpResponseException(response()->json([
            'message' => 'This task is assigned to someone else. Ask to be put on it before working on it.',
            'code' => 'TASK_NOT_ASSIGNED',
        ], 409));
    }
}
