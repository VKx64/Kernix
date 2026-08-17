import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type { Paginated, Task } from '../types/api'
import type { TaskView } from './taskTriage'

export type TaskViewCounts = Record<TaskView, number>

const EMPTY_COUNTS: TaskViewCounts = { mine: 0, all: 0, unassigned: 0, done: 0 }

interface TaskQueueOptions {
  view: TaskView
  search?: string
  archived?: boolean
  filters?: Record<string, string | number | undefined>
}

interface TaskListResponse extends Paginated<Task> {
  counts?: Partial<TaskViewCounts>
}

/**
 * The task list, plus the per-view totals the tab row needs.
 *
 * This exists rather than `useCollection` because the tabs have to show what
 * *every* view would contain under the current filters, not just the one on
 * screen. The server computes all five in one request, so the tab row costs
 * nothing extra and never disagrees with the list beneath it.
 *
 * The list is fetched whole rather than paged: grouping by attention is a
 * judgement over the entire set, and a bucket that only reflects page one is
 * worse than no bucket. The server still caps what it will return, which is
 * what `total` is compared against to decide whether to admit a shortfall.
 */
export function useTaskQueue({ view, search = '', archived = false, filters = {} }: TaskQueueOptions) {
  const [data, setData] = useState<Task[]>([])
  const [counts, setCounts] = useState<TaskViewCounts>(EMPTY_COUNTS)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const filterKey = JSON.stringify(filters)

  /**
   * `quiet` refreshes without raising the loading flag. After an optimistic
   * change the rows on screen are already right; flipping to a skeleton and
   * back is the flash this pattern exists to remove.
   */
  const load = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!quiet) setLoading(true)
    setError('')
    try {
      const response = await api.get<TaskListResponse>('/api/tasks', {
        view,
        per_page: 'all',
        search: search.trim() || undefined,
        archived: archived ? 'only' : undefined,
        ...(JSON.parse(filterKey) as TaskQueueOptions['filters']),
      }, signal)
      const rows = response.data ?? []
      setData(rows)
      setCounts({ ...EMPTY_COUNTS, ...(response.counts ?? {}) })
      const meta = response.meta as { total?: number } | undefined
      setTotal(response.total ?? meta?.total ?? rows.length)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(reason instanceof Error ? reason.message : 'Unable to load your tasks.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [view, search, archived, filterKey])

  useEffect(() => {
    const controller = new AbortController()
    // Typing in the header search should not fire a request per keystroke.
    const timer = window.setTimeout(() => void load(controller.signal), search ? 250 : 0)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [load, search])

  /**
   * Change rows in place and hand back the undo.
   *
   * The caller decides what the change is; this only knows how to put the list
   * back exactly as it was, which is the one thing a rollback must get right.
   */
  const apply = useCallback((change: (rows: Task[]) => Task[]) => {
    let previous: Task[] = []
    setData((current) => {
      previous = current
      return change(current)
    })

    return () => setData(previous)
  }, [])

  return {
    data,
    counts,
    total,
    loading,
    error,
    apply,
    reload: () => load(),
    /** Reconcile with the server without disturbing what is on screen. */
    refresh: () => load(undefined, true),
  }
}
