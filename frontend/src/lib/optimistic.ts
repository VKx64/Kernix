import { toast } from 'sonner'

/**
 * Show the change first, save it second, put it back if the save fails.
 *
 * Kernix screens hold their own state rather than sharing a query cache, so
 * this deliberately owns nothing: the caller applies its change however it
 * likes and hands back a function that undoes it. That keeps the pattern usable
 * from a list, a drawer, or a single row without any of them agreeing on a
 * shape first.
 *
 * When to reach for it: the change is small, the server almost always accepts
 * it, and seeing it land immediately is worth more than being certain. Status
 * changes, assignment, notes, reactions.
 *
 * When not to: anything the server refuses often enough that the flash-and-
 * revert becomes the normal experience, and anything whose failure costs more
 * than a moment's confusion. Completing a task needs proof, archiving is
 * destructive, an estimate decision is somebody's answer to a colleague — those
 * should wait for the server and say so.
 */
export interface OptimisticRun<T> {
  /** Apply the change locally. Return the function that puts it back. */
  apply: () => () => void
  /** Send it. Resolving means the change stuck. */
  commit: () => Promise<T>
  /** Shown when the save fails, above the server's own message. */
  message?: string
  /** Runs after a failed save has been rolled back. */
  onError?: (reason: unknown) => void
  /**
   * Runs once the save succeeds, for anything the local change could not
   * predict — a server-assigned id, a recomputed total.
   */
  onSettled?: (result: T) => void
}

export async function optimistic<T>({ apply, commit, message, onError, onSettled }: OptimisticRun<T>): Promise<T | undefined> {
  const rollback = apply()
  try {
    const result = await commit()
    onSettled?.(result)
    return result
  } catch (reason) {
    // Put the interface back before saying anything, so the sentence and the
    // screen never disagree about what happened.
    rollback()
    const detail = reason instanceof Error ? reason.message : 'That change did not save.'
    toast.error(message ? `${message} ${detail}` : detail)
    onError?.(reason)
    return undefined
  }
}

/**
 * Replaces one row in a list by id, leaving the rest of the array identity
 * alone so React only re-renders the row that moved.
 */
export function replaceById<T extends { id: number | string }>(rows: T[], id: T['id'], change: Partial<T>): T[] {
  return rows.map((row) => (row.id === id ? { ...row, ...change } : row))
}
