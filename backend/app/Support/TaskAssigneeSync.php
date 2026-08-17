<?php

namespace App\Support;

use App\Models\Task;
use Illuminate\Support\Facades\DB;

/**
 * `task_assignees` is the pivot everything this slice writes through;
 * `tasks.assignee_user_id` is kept in sync as "the first assignee, or null"
 * so every consumer that has not been migrated to the pivot keeps working
 * unchanged.
 *
 * Reads that need to know "is this task assigned to X" (`TaskMutationGuard`,
 * the controller's `mine`/`unassigned`/`'none'` filters) deliberately do NOT
 * trust the pivot alone. Single-assignee writes still happen outside this
 * class (tests, factories, `AiTaskBatchService`, Oliver's undo replay), and a
 * bulk `Builder::update()` never fires an Eloquent model event, so the pivot
 * cannot be kept current for such a path from inside here. So during this
 * transition, "assigned" is defined as **pivot membership OR a matching
 * `assignee_user_id`** everywhere it's checked, not pivot alone. That union
 * is what makes every legacy single-assignee write — synchronous or bulk,
 * inside this slice's files or outside them — visible immediately, even
 * before (or without) the pivot ever catching up.
 *
 * Two directions of sync are funnelled through this class so the rule lives
 * in one place:
 *  - {@see apply()} is the multi-assignee write path (`TaskMutationService`,
 *    `TaskController`): it writes the pivot in the given order and mirrors
 *    the first id onto the column. The column write uses `saveQuietly()`, so
 *    it does not re-trigger the hook below.
 *  - {@see reconcileFromColumn()} is called from `Task`'s `saved()` hook on
 *    every save. It is idempotent: when the pivot's first id already matches
 *    the column (the normal case, including everything written via
 *    `apply()`), it does nothing. When a direct single-assignee column write
 *    (a test, a factory, `AiTaskBatchService`, Oliver's undo replay, ...)
 *    leaves the two disagreeing, the column wins — outside `apply()` it is
 *    still the only thing every caller writes — and the pivot collapses to
 *    that one id. This keeps `Task::assignees()` (and the `task_assignees`
 *    JSON field) reasonably current for the common single-model-save case;
 *    it cannot reach the bulk-update path above, which is exactly why the
 *    read paths do not depend on it.
 */
class TaskAssigneeSync
{
    /**
     * Writes the pivot for $task to exactly, and in exactly the order of,
     * $userIds, then mirrors the first id onto `assignee_user_id`. Returns
     * the deduplicated, ordered ids that were actually applied.
     *
     * @param  array<int, int>  $userIds
     * @return array<int, int>
     */
    public static function apply(Task $task, array $userIds): array
    {
        $ordered = array_values(array_unique(array_map('intval', $userIds)));

        DB::transaction(function () use ($task, $ordered) {
            $task->assignees()->newPivotStatement()->where('task_id', $task->getKey())->delete();
            foreach ($ordered as $userId) {
                $task->assignees()->attach($userId);
            }
            // Quiet: this write must not re-trigger reconcileFromColumn(),
            // which would otherwise immediately collapse the pivot we just
            // wrote back down to a single row.
            $task->forceFill(['assignee_user_id' => $ordered[0] ?? null])->saveQuietly();
        });

        $task->unsetRelation('assignees');

        return $ordered;
    }

    /**
     * Idempotent: no-op when the pivot's first id already matches the
     * column. Otherwise collapses the pivot to that single column value.
     */
    public static function reconcileFromColumn(Task $task): void
    {
        $currentFirstPivotId = (int) ($task->assignees()->newPivotStatement()
            ->where('task_id', $task->getKey())
            ->orderBy('id')
            ->value('user_id') ?? 0);
        $columnId = (int) ($task->assignee_user_id ?? 0);

        if ($currentFirstPivotId === $columnId) {
            return;
        }

        DB::transaction(function () use ($task, $columnId) {
            $task->assignees()->newPivotStatement()->where('task_id', $task->getKey())->delete();
            if ($columnId) {
                $task->assignees()->attach($columnId);
            }
        });

        $task->unsetRelation('assignees');
    }
}
