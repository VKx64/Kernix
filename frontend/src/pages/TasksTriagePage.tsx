import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ListFilter, Plus, Rows2, Rows3, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider'
import { useWorkspace } from '@/auth/WorkspaceProvider'
import { ClockGate, isClockGate } from '@/components/ClockGate'
import { InlineMenu, type InlineMenuItem, type InlineMenuState } from '@/components/tasks/InlineMenu'
import { TaskBulkBar, type TaskBulkAction } from '@/components/tasks/TaskBulkBar'
import { TaskDrawer, type FeedEntry, type TaskDrawerField } from '@/components/tasks/TaskDrawer'
import { TaskGroupHeader } from '@/components/tasks/TaskGroupHeader'
import { TaskRow, type TaskRowDensity } from '@/components/tasks/TaskRow'
import { EmptyState, ErrorBanner } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageActions } from '@/layout/page-actions'
import { usePageFill } from '@/layout/page-fill'
import { api, displayName, fieldLabel, unwrap } from '@/lib/api'
import { uploadTaskAttachments } from '@/lib/attachments'
import { useCan } from '@/lib/permissions'
import { useTimerContext } from '@/lib/useTimer'
import { activityPhrase } from '@/lib/taskActivity'
import {
  dueMeta,
  isTaskDone,
  statusColor,
  statusRole,
  taskDueDate,
  taskProjectId,
  taskStatusValue,
  taskUrgencyValue,
  urgencyColor,
  urgencyRank,
} from '@/lib/taskSignals'
import {
  TASK_GROUP_OPTIONS,
  TASK_SORT_OPTIONS,
  TASK_VIEWS,
  flatTaskIds,
  groupTasks,
  sortTasks,
  type TaskGroupBy,
  type TaskSort,
  type TaskView,
} from '@/lib/taskTriage'
import { useTaskQueue } from '@/lib/useTaskQueue'
import { useTaskFolderCatalog } from '@/lib/useTaskFolders'
import { useTaskLookups } from '@/lib/useTaskLookups'
import { cn } from '@/lib/utils'
import type { ApiEnvelope, EntityId, FieldValue, Note, Subtask, Task, TaskFolder } from '@/types/api'
import { AiCreateTaskModal } from './AiCreateTaskModal'
import { CreateTaskModal, type CreateTaskPayload } from './CreateTaskModal'

/**
 * Tasks — the Triage screen.
 *
 * The list opens on a judgement rather than an inventory: `Triage` is the
 * default view and it holds only what is blocked, late, due today, in review, or
 * urgent with nobody on it. `All` is one keystroke away and rarely needed.
 *
 * Three things about the shape of this file. The server owns which tasks are in
 * a view and what the tab counts are, because those are questions about the
 * whole workspace. Grouping, ordering and selection are local, because they are
 * questions about what is on screen. And every mutation goes through one
 * `patch()` so an inline menu, a bulk change, a keyboard shortcut and the drawer
 * cannot drift apart in what they send or what they toast.
 */

interface MenuTarget {
  /** Empty means the menu is acting on the current selection. */
  taskIds: EntityId[]
}

type MenuKind =
  | 'status'
  | 'urgency'
  | 'assignee'
  | 'due'
  | 'row'
  | 'folder'
  | 'group'
  | 'sort'
  | 'filter'
  | 'filter-project'
  | 'filter-assignee'
  | 'filter-status'
  | 'filter-urgency'

interface OpenMenu extends InlineMenuState {
  kind: MenuKind
  target: MenuTarget
}

const DUE_PRESETS: Array<[label: string, days: number | null]> = [
  ['Today', 0],
  ['Tomorrow', 1],
  ['In 3 days', 3],
  ['Next week', 7],
  ['In two weeks', 14],
  ['No date', null],
]

function isoInDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function TasksTriagePage() {
  usePageFill()
  const navigate = useNavigate()
  const { user } = useAuth()
  const can = useCan()
  const { canMutateTasks, canAdminOverride, adminOverride } = useWorkspace()
  const timer = useTimerContext()
  const [params, setParams] = useSearchParams()

  const view = (params.get('view') as TaskView) ?? 'triage'
  const groupBy = (params.get('group') as TaskGroupBy) ?? 'smart'
  const sort = (params.get('sort') as TaskSort) ?? 'smart'
  const density: TaskRowDensity = params.get('density') === 'compact' ? 'compact' : 'comfortable'
  const search = params.get('search') ?? ''
  const archived = params.get('archived') === '1'
  const openId = params.get('open')

  const filters = useMemo(() => ({
    project_id: params.get('project_id') || undefined,
    assignee_user_id: params.get('assignee_user_id') || undefined,
    status_value_id: params.get('status_value_id') || undefined,
    urgency_value_id: params.get('urgency_value_id') || undefined,
  }), [params])

  const lookups = useTaskLookups()
  const { data, counts, total, loading, error, reload } = useTaskQueue({ view, search, archived, filters })

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [cursor, setCursor] = useState(0)
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  // Bumped after every successful mutation; the drawer refetches its detail on
  // change so a status set from an inline menu shows there too.
  const [revision, setRevision] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [aiCreateOpen, setAiCreateOpen] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createProjectId, setCreateProjectId] = useState<EntityId | ''>('')
  const [clockBlocked, setClockBlocked] = useState(false)
  const [width, setWidth] = useState(1200)
  const listRef = useRef<HTMLDivElement>(null)

  // Folders are per project. Only the projects actually on screen — plus
  // whichever the create form is pointed at — are worth fetching.
  const [menuProjectId, setMenuProjectId] = useState<EntityId | null>(null)
  const folderProjectIds = useMemo<EntityId[]>(() => {
    const ids: EntityId[] = []
    if (filters.project_id) ids.push(filters.project_id)
    if (createOpen && createProjectId !== '') ids.push(createProjectId)
    if (menuProjectId) ids.push(menuProjectId)
    return [...new Set(ids.map(String))]
  }, [filters.project_id, createOpen, createProjectId, menuProjectId])
  const folderCatalog = useTaskFolderCatalog(folderProjectIds)
  const createFolders = createProjectId === '' ? [] : folderCatalog.foldersByProject[String(createProjectId)] ?? []
  // AI drafting is opt-in per project, so the button only appears where at
  // least one project has it switched on.
  const aiProjects = useMemo(
    () => lookups.projects.filter((project) => project.aiTaskCreationEnabled ?? project.ai_task_creation_enabled),
    [lookups.projects],
  )

  // Responsive decisions measure the content column, not the window — the
  // sidebar takes 236px of it and a media query would not know that.
  useEffect(() => {
    const element = listRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (canMutateTasks) setClockBlocked(false)
  }, [canMutateTasks])

  const setParam = useCallback((key: string, value?: string | null) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }, [setParams])

  const groups = useMemo(() => {
    const sorted = sortTasks(data, sort)
    return groupTasks(sorted, groupBy, {
      statusOptions: lookups.statusOptions,
      urgencyOptions: lookups.urgencyOptions,
      people: lookups.users,
    }).filter((group) => group.tasks.length > 0)
  }, [data, sort, groupBy, lookups.statusOptions, lookups.urgencyOptions, lookups.users])

  const orderedIds = useMemo(() => flatTaskIds(groups, collapsed), [groups, collapsed])
  const taskById = useMemo(() => new Map(data.map((task) => [String(task.id), task])), [data])

  // The cursor is an index, so it has to be pulled back in bounds whenever the
  // list shrinks — switching view, applying a filter, completing the last row.
  useEffect(() => {
    setCursor((current) => Math.min(current, Math.max(0, orderedIds.length - 1)))
  }, [orderedIds.length])

  const openTask = openId ? taskById.get(openId) ?? null : null

  // --- mutation ------------------------------------------------------------

  const guardClock = () => {
    if (canMutateTasks || (canAdminOverride && adminOverride)) return true
    setClockBlocked(true)
    return false
  }

  const patch = useCallback(async (ids: EntityId[], body: Record<string, unknown>, message?: string) => {
    if (!ids.length) return
    if (!guardClock()) return
    const payload = { ...body, admin_override: adminOverride ? 1 : undefined }
    try {
      await Promise.all(ids.map((id) => api.patch(`/api/tasks/${id}`, payload)))
      await reload()
      // The drawer holds a detail payload the list does not carry, so it cannot
      // be refreshed by reloading the list alone.
      setRevision((current) => current + 1)
      if (message) toast(message)
    } catch (reason) {
      if (isClockGate(reason)) setClockBlocked(true)
      toast.error(reason instanceof Error ? reason.message : 'That change did not save.')
    }
    // guardClock reads render-scope state that changes with the same inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminOverride, canAdminOverride, canMutateTasks, reload])

  /**
   * Completing a task is a status change, but "done" is a role rather than a
   * fixed value, so the workspace's own done and open values have to be found
   * before anything can be sent.
   */
  const doneValue = useMemo(
    () => lookups.statusOptions.find((option) => statusRole(option) === 'done'),
    [lookups.statusOptions],
  )
  const openValue = useMemo(
    () => lookups.statusOptions.find((option) => statusRole(option) === 'open'),
    [lookups.statusOptions],
  )

  const toggleDone = useCallback((task: Task) => {
    const done = isTaskDone(task)
    const target = done ? openValue : doneValue
    if (!target) {
      toast.error(`This workspace has no ${done ? 'open' : 'done'} status configured.`)
      return
    }
    void patch([task.id], { status_value_id: target.id }, done ? 'Reopened' : 'Marked done')
  }, [doneValue, openValue, patch])

  const toggleSelected = useCallback((task: Task) => {
    const id = String(task.id)
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }, [])

  // --- menus ---------------------------------------------------------------

  const openMenu = (kind: MenuKind, anchor: HTMLElement, taskIds: EntityId[] = []) => {
    setMenu({ kind, anchor, target: { taskIds } })
  }

  const menuTargets = menu ? (menu.target.taskIds.length ? menu.target.taskIds : selected) : []
  const bulk = Boolean(menu && !menu.target.taskIds.length)

  const closeMenu = () => setMenu(null)

  const applyAndClose = (body: Record<string, unknown>, message?: string) => {
    const ids = menuTargets
    closeMenu()
    void patch(ids, body, message)
  }

  const menuContent = useMemo<{ title?: string; items: InlineMenuItem[] }>(() => {
    if (!menu) return { items: [] }

    const valueItems = (options: FieldValue[], field: string, color: (option: FieldValue) => string, noun: string) =>
      options.map((option) => ({
        key: String(option.id),
        label: fieldLabel(option),
        color: color(option),
        onSelect: () => applyAndClose({ [field]: option.id }, bulk ? `${noun} updated` : undefined),
      }))

    switch (menu.kind) {
      case 'status':
        return { title: 'Status', items: valueItems(lookups.statusOptions, 'status_value_id', statusColor, 'Status') }
      case 'urgency':
        return { title: 'Urgency', items: valueItems(lookups.urgencyOptions, 'urgency_value_id', urgencyColor, 'Urgency') }
      case 'assignee':
        return {
          title: 'Assignee',
          items: [
            ...lookups.users.map((person) => ({
              key: String(person.id),
              label: displayName(person),
              hint: String(person.id) === String(user?.id ?? '') ? 'you' : undefined,
              onSelect: () => applyAndClose({ assignee_user_id: person.id }, bulk ? 'Reassigned' : undefined),
            })),
            {
              key: 'none',
              label: 'Unassign',
              separated: true,
              onSelect: () => applyAndClose({ assignee_user_id: null }, bulk ? 'Unassigned' : undefined),
            },
          ],
        }
      case 'due':
        return {
          title: 'Due',
          items: DUE_PRESETS.map(([label, days]) => ({
            key: label,
            label,
            separated: days === null,
            hint: days === null ? undefined : new Date(isoInDays(days)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            onSelect: () => applyAndClose({ due_date: days === null ? null : isoInDays(days) }, bulk ? 'Dates updated' : undefined),
          })),
        }
      case 'row': {
        const task = taskById.get(String(menu.target.taskIds[0] ?? ''))
        if (!task) return { items: [] }
        return {
          items: [
            { key: 'open', label: 'Open', hint: '↵', onSelect: () => { closeMenu(); setParam('open', String(task.id)) } },
            { key: 'full', label: 'Open full page', onSelect: () => { closeMenu(); navigate(`/tasks/${task.id}`) } },
            { key: 'urgency', label: 'Urgency', hint: '›', keepOpen: true, onSelect: () => setMenu({ ...menu, kind: 'urgency' }) },
            { key: 'assignee', label: 'Assignee', hint: '›', keepOpen: true, onSelect: () => setMenu({ ...menu, kind: 'assignee' }) },
            { key: 'due', label: 'Due', hint: '›', keepOpen: true, onSelect: () => setMenu({ ...menu, kind: 'due' }) },
            // Folders used to be a column in the queue. They are a menu now,
            // like every other change to a task.
            ...(can('tasks.edit') && taskProjectId(task)
              ? [{ key: 'folder', label: 'Move to folder', hint: '›', keepOpen: true, onSelect: () => setMenu({ ...menu, kind: 'folder' }) }]
              : []),
            ...(can('tasks.archive')
              ? [{
                  key: 'archive',
                  label: 'Archive',
                  danger: true,
                  separated: true,
                  onSelect: () => {
                    closeMenu()
                    void archiveTasks([task.id])
                  },
                }]
              : []),
          ],
        }
      }
      case 'folder': {
        const task = taskById.get(String(menu.target.taskIds[0] ?? ''))
        const projectId = task ? taskProjectId(task) : undefined
        const key = String(projectId ?? '')
        const folderError = folderCatalog.errorsByProject[key]
        if (folderError) {
          return { title: 'Move to folder', items: [{ key: 'error', label: folderError, onSelect: closeMenu }] }
        }
        const folders: TaskFolder[] = folderCatalog.foldersByProject[key] ?? []
        if (folderCatalog.loading && !folders.length) {
          return { title: 'Move to folder', items: [{ key: 'loading', label: 'Loading folders…', onSelect: () => undefined }] }
        }
        return {
          title: 'Move to folder',
          items: [
            ...folders.map((folder) => ({
              key: String(folder.id),
              label: folder.name,
              onSelect: () => applyAndClose({ task_folder_id: folder.id }, 'Moved'),
            })),
            {
              key: 'none',
              label: folders.length ? 'No folder' : 'This project has no folders',
              separated: folders.length > 0,
              onSelect: () => folders.length ? applyAndClose({ task_folder_id: null }, 'Moved') : closeMenu(),
            },
          ],
        }
      }
      case 'group':
        return {
          title: 'Group by',
          items: TASK_GROUP_OPTIONS.map((option) => ({
            key: option.value,
            label: option.label,
            hint: groupBy === option.value ? '✓' : undefined,
            onSelect: () => { closeMenu(); setParam('group', option.value === 'smart' ? null : option.value) },
          })),
        }
      case 'sort':
        return {
          title: 'Sort by',
          items: TASK_SORT_OPTIONS.map((option) => ({
            key: option.value,
            label: option.label,
            hint: sort === option.value ? '✓' : undefined,
            onSelect: () => { closeMenu(); setParam('sort', option.value === 'smart' ? null : option.value) },
          })),
        }
      case 'filter':
        return {
          title: 'Filter by',
          items: [
            { key: 'project', label: 'Project', hint: '›', keepOpen: true, onSelect: () => setMenu({ ...menu, kind: 'filter-project' }) },
            { key: 'assignee', label: 'Assignee', hint: '›', keepOpen: true, onSelect: () => setMenu({ ...menu, kind: 'filter-assignee' }) },
            { key: 'status', label: 'Status', hint: '›', keepOpen: true, onSelect: () => setMenu({ ...menu, kind: 'filter-status' }) },
            { key: 'urgency', label: 'Urgency', hint: '›', keepOpen: true, onSelect: () => setMenu({ ...menu, kind: 'filter-urgency' }) },
            {
              key: 'archived',
              label: archived ? 'Hide archived' : 'Show archived only',
              separated: true,
              onSelect: () => { closeMenu(); setParam('archived', archived ? null : '1') },
            },
          ],
        }
      case 'filter-project':
        return {
          title: 'Project',
          items: lookups.projects.map((project) => ({
            key: String(project.id),
            label: project.name,
            hint: project.client?.name,
            onSelect: () => { closeMenu(); setParam('project_id', String(project.id)) },
          })),
        }
      case 'filter-assignee':
        return {
          title: 'Assignee',
          items: [
            ...lookups.users.map((person) => ({
              key: String(person.id),
              label: displayName(person),
              onSelect: () => { closeMenu(); setParam('assignee_user_id', String(person.id)) },
            })),
            { key: 'none', label: 'Unassigned', separated: true, onSelect: () => { closeMenu(); setParam('assignee_user_id', 'none') } },
          ],
        }
      case 'filter-status':
        return {
          title: 'Status',
          items: lookups.statusOptions.map((option) => ({
            key: String(option.id),
            label: fieldLabel(option),
            color: statusColor(option),
            onSelect: () => { closeMenu(); setParam('status_value_id', String(option.id)) },
          })),
        }
      case 'filter-urgency':
        return {
          title: 'Urgency',
          items: lookups.urgencyOptions.map((option) => ({
            key: String(option.id),
            label: fieldLabel(option),
            color: urgencyColor(option),
            onSelect: () => { closeMenu(); setParam('urgency_value_id', String(option.id)) },
          })),
        }
      default:
        return { items: [] }
    }
    // The menu builders close over render-scope helpers that are stable for a
    // given menu and lookup set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, bulk, lookups, groupBy, sort, archived, taskById, user?.id])

  const archiveTasks = async (ids: EntityId[]) => {
    if (!guardClock()) return
    try {
      await Promise.all(ids.map((id) => api.post(`/api/tasks/${id}/archive`, { admin_override: adminOverride ? 1 : undefined })))
      setSelected([])
      await reload()
      toast(ids.length === 1 ? 'Task archived' : `${ids.length} tasks archived`, {
        action: {
          label: 'Undo',
          onClick: () => {
            void Promise.all(ids.map((id) => api.post(`/api/tasks/${id}/restore`, { admin_override: adminOverride ? 1 : undefined })))
              .then(reload)
              .catch(() => toast.error('Those tasks could not be restored.'))
          },
        },
      })
    } catch (reason) {
      if (isClockGate(reason)) setClockBlocked(true)
      toast.error(reason instanceof Error ? reason.message : 'Unable to archive.')
    }
  }

  // --- keyboard ------------------------------------------------------------

  /*
   * The shortcut handler is held in a ref and the listener is registered once.
   * Binding it directly would re-register on every render — the ordered id list
   * and the lookup catalogue both change identity constantly — and a keypress
   * arriving between the teardown and the re-add is silently dropped, which
   * makes fast `j j j` lose presses.
   */
  const handleKeyRef = useRef<(event: KeyboardEvent) => void>(() => undefined)

  const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName.toLowerCase()
      const typing = tag === 'input' || tag === 'textarea' || target?.isContentEditable

      if (event.key === 'Escape') {
        // Escape backs out one layer at a time.
        if (typing && (target as HTMLInputElement).value) { target!.blur(); return }
        if (menu) { setMenu(null); return }
        if (createOpen) { setCreateOpen(false); return }
        if (openId) { setParam('open', null); return }
        if (selected.length) { setSelected([]); return }
        if (typing) target!.blur()
        return
      }

      if (typing || event.metaKey || event.ctrlKey || event.altKey) return

      // Anything on top of the list owns the keyboard. Without this a keypress
      // that misses a field inside the create modal would still reach the list
      // underneath — and `d` there completes a task.
      if (createOpen || aiCreateOpen || openId || menu) return

      const key = event.key.toLowerCase()

      if (key === 'n' && can('tasks.create')) {
        event.preventDefault()
        setCreateOpen(true)
        return
      }
      // Break and resume are the same key: on a break it returns you to work,
      // otherwise it opens the sidebar's break menu to pick a kind.
      if (key === 'b' && timer.state !== 'idle') {
        event.preventDefault()
        if (timer.state === 'break') void timer.resume()
        else timer.setBreakMenuOpen(!timer.breakMenuOpen)
        return
      }
      if (key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault()
        setCursor((current) => Math.min(orderedIds.length - 1, current + 1))
        return
      }
      if (key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault()
        setCursor((current) => Math.max(0, current - 1))
        return
      }
      if (key === 'x') {
        event.preventDefault()
        const id = orderedIds[cursor]
        if (id) setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const id = orderedIds[cursor]
        if (id) setParam('open', id)
        return
      }
      if (key === 'd') {
        event.preventDefault()
        const task = taskById.get(orderedIds[cursor] ?? '')
        if (task) toggleDone(task)
        return
      }
      if (['1', '2', '3', '4', '5'].includes(event.key)) {
        event.preventDefault()
        const next = TASK_VIEWS[Number(event.key) - 1]
        if (next) {
          setSelected([])
          setCursor(0)
          setParam('view', next.value === 'triage' ? null : next.value)
        }
      }
  }

  // No dependency list: the ref is refreshed after every commit so the single
  // listener below always calls the current closure.
  useLayoutEffect(() => {
    handleKeyRef.current = handleKey
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyRef.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // Keep the keyboard cursor visible as it moves.
  useEffect(() => {
    const id = orderedIds[cursor]
    if (!id) return
    // Optional call: jsdom has no scrollIntoView, and keeping the cursor in
    // view is a nicety that must not break the list.
    listRef.current?.querySelector<HTMLElement>(`[data-task-id="${id}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [cursor, orderedIds])

  // --- create --------------------------------------------------------------

  const create = async (values: CreateTaskPayload, files: File[] = []) => {
    if (!guardClock()) return
    setCreateBusy(true)
    setCreateError('')
    try {
      const response = await api.post<ApiEnvelope<Task> | Task>('/api/tasks', {
        ...values,
        admin_override: adminOverride ? 1 : undefined,
      } as Record<string, unknown>)
      const task = unwrap(response)
      // The task exists from here on, so a failed upload must not discard it —
      // it is reported against the created task instead.
      if (files.length) {
        try {
          await uploadTaskAttachments(task.id, files, adminOverride)
        } catch (reason) {
          toast.error(reason instanceof Error ? reason.message : 'The task was created, but its files could not be uploaded.')
        }
      }
      setCreateOpen(false)
      await reload()
      setParam('open', String(task.id))
    } catch (reason) {
      if (isClockGate(reason)) setClockBlocked(true)
      setCreateError(reason instanceof Error ? reason.message : 'Unable to create the task.')
    } finally {
      setCreateBusy(false)
    }
  }

  // --- header --------------------------------------------------------------

  const activeFilters = useMemo(() => {
    const chips: Array<{ key: string; label: string }> = []
    if (filters.project_id) {
      const project = lookups.projects.find((row) => String(row.id) === filters.project_id)
      chips.push({ key: 'project_id', label: project?.name ?? 'Project' })
    }
    if (filters.assignee_user_id) {
      const person = lookups.users.find((row) => String(row.id) === filters.assignee_user_id)
      chips.push({ key: 'assignee_user_id', label: filters.assignee_user_id === 'none' ? 'Unassigned' : displayName(person) })
    }
    if (filters.status_value_id) {
      const option = lookups.statusOptions.find((row) => String(row.id) === filters.status_value_id)
      chips.push({ key: 'status_value_id', label: fieldLabel(option) })
    }
    if (filters.urgency_value_id) {
      const option = lookups.urgencyOptions.find((row) => String(row.id) === filters.urgency_value_id)
      chips.push({ key: 'urgency_value_id', label: fieldLabel(option) })
    }
    if (archived) chips.push({ key: 'archived', label: 'Archived only' })
    return chips
  }, [filters, archived, lookups])

  const viewTitle = TASK_VIEWS.find((option) => option.value === view)?.label ?? 'Tasks'

  /**
   * The line under the heading. It names what is wrong rather than how many
   * tasks exist, and each count is a link into the view that shows them.
   */
  const pulse = useMemo(() => {
    const open = data.filter((task) => !isTaskDone(task))
    const entries: Array<{ key: string; count: number; label: string; color: string; apply: () => void }> = []
    const overdue = open.filter((task) => {
      const days = dueMeta(taskDueDate(task)).tone
      return days === 'over'
    }).length
    const unowned = open.filter((task) => !task.assignee && urgencyRank(taskUrgencyValue(task)) <= 1).length
    const blocked = open.filter((task) => statusRole(taskStatusValue(task)) === 'blocked').length
    if (overdue) entries.push({ key: 'overdue', count: overdue, label: 'overdue', color: 'text-danger', apply: () => { setParam('view', 'all'); setParam('sort', 'due') } })
    if (unowned) entries.push({ key: 'unowned', count: unowned, label: 'need an owner', color: 'text-brand', apply: () => setParam('view', 'unassigned') })
    if (blocked) entries.push({ key: 'blocked', count: blocked, label: 'blocked', color: 'text-warn', apply: () => setParam('group', 'smart') })
    return entries
  }, [data, setParam])

  const showStatus = width >= 720
  const showMeta = width >= 560

  const bulkActions: TaskBulkAction[] = [
    { key: 'status', label: 'Status', onSelect: (anchor) => openMenu('status', anchor) },
    { key: 'assignee', label: 'Assignee', onSelect: (anchor) => openMenu('assignee', anchor) },
    { key: 'due', label: 'Due', onSelect: (anchor) => openMenu('due', anchor) },
    { key: 'urgency', label: 'Urgency', onSelect: (anchor) => openMenu('urgency', anchor) },
    ...(can('tasks.archive')
      ? [{ key: 'archive', label: 'Archive', danger: true, onSelect: () => void archiveTasks(selected) }]
      : []),
  ]

  return (
    <>
      <PageActions>
        <div className="flex flex-1 items-center justify-end gap-1.5">
          {/* Two of the design's three creation paths: the detailed form for
              when you already know everything, and AI drafting for when you
              know nothing. The third — single-line quick add — is not built. */}
          {can('tasks.create_with_ai') && aiProjects.length > 0 && (
            <Button variant="outline" onClick={() => setAiCreateOpen(true)}>
              <Sparkles />
              Draft with AI
            </Button>
          )}
          {can('tasks.create') && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              New task
            </Button>
          )}
        </div>
      </PageActions>

      <div className="-mx-4 flex min-h-0 flex-1 flex-col md:-mx-7">
        <header className="flex-none px-4 md:px-7">
          <div className="flex items-start gap-5">
            <div className="min-w-0 flex-1">
              <h1 className="text-h1 text-title-strong">{viewTitle}</h1>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-1.5 text-body text-t3">
                {pulse.length === 0 && !loading && <span>Nothing is overdue or unowned.</span>}
                {pulse.map((entry, index) => (
                  <span key={entry.key} className="inline-flex items-baseline gap-1">
                    <button type="button" onClick={entry.apply} className="inline-flex items-baseline gap-1.5 hover:underline">
                      <span className={cn('text-body-lg font-[650] tabular-nums', entry.color)}>{entry.count}</span>
                      {entry.label}
                    </button>
                    {index < pulse.length - 1 && <span className="text-t5">,</span>}
                  </span>
                ))}
              </p>
            </div>
          </div>

          {/* Views. `1`–`5` reach the same five. */}
          <div className="mt-2.5 flex items-center gap-0.5 border-b border-soft">
            {TASK_VIEWS.map((option) => {
              const active = option.value === view
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setSelected([])
                    setCursor(0)
                    setParam('view', option.value === 'triage' ? null : option.value)
                  }}
                  className={cn(
                    '-mb-px inline-flex h-8 items-center gap-[7px] border-b-2 px-2.5 text-body transition-colors',
                    active ? 'border-t1 font-semibold text-t1' : 'border-transparent font-[450] text-t3 hover:text-t1',
                  )}
                >
                  {option.label}
                  <span className={cn('font-mono text-[11px] tabular-nums', active ? 'text-t2' : 'text-t3')}>
                    {counts[option.value]}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-0.5 gap-y-1.5 py-1.5">
            <ToolButton onClick={(anchor) => openMenu('group', anchor)}>
              Group <strong className="font-[550] text-t1">{TASK_GROUP_OPTIONS.find((o) => o.value === groupBy)?.label}</strong>
            </ToolButton>
            <ToolButton onClick={(anchor) => openMenu('sort', anchor)}>
              Sort <strong className="font-[550] text-t1">{TASK_SORT_OPTIONS.find((o) => o.value === sort)?.label}</strong>
            </ToolButton>

            {activeFilters.map((chip) => (
              <span
                key={chip.key}
                className="ml-0.5 inline-flex h-[26px] items-center gap-1.5 rounded-[7px] bg-[#1b1c2c] pr-[3px] pl-[9px] text-meta text-[#b6b8fa]"
              >
                {chip.label}
                <button
                  type="button"
                  aria-label={`Remove the ${chip.label} filter`}
                  onClick={() => setParam(chip.key, null)}
                  className="grid size-[17px] place-items-center rounded-sm text-[#7276c9] hover:bg-[#262848] hover:text-white"
                >
                  <span aria-hidden="true" className="text-[10px] leading-none">✕</span>
                </button>
              </span>
            ))}

            <ToolButton onClick={(anchor) => openMenu('filter', anchor)}>
              <ListFilter className="size-[11px]" />
              Filter
            </ToolButton>

            <span className="flex-1" />

            <button
              type="button"
              aria-label={density === 'compact' ? 'Use comfortable rows' : 'Use compact rows'}
              onClick={() => setParam('density', density === 'compact' ? null : 'compact')}
              className="grid size-[27px] place-items-center rounded-[7px] text-t3 hover:bg-sidebar-accent hover:text-t1"
            >
              {density === 'compact' ? <Rows3 className="size-[13px]" /> : <Rows2 className="size-[13px]" />}
            </button>
          </div>
        </header>

        <div ref={listRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-28 md:px-7">
          {clockBlocked && <div className="pt-2 pb-4"><ClockGate /></div>}
          {error && <div className="pt-2"><ErrorBanner message={error} onRetry={() => void reload()} /></div>}

          {loading && !data.length && (
            <div className="flex flex-col gap-1 pt-4">
              {Array.from({ length: 8 }, (_, index) => <Skeleton className="h-[46px]" key={index} />)}
            </div>
          )}

          {!loading && !groups.length && !error && (
            <div className="pt-24">
              <EmptyState
                title={activeFilters.length ? 'Nothing matches' : view === 'triage' ? 'All clear' : 'Nothing here'}
                description={
                  activeFilters.length
                    ? 'No tasks fit this combination. Loosen a filter and try again.'
                    : view === 'triage'
                      ? 'Nothing is blocked, late, or urgent without an owner. This is the good outcome.'
                      : 'No tasks in this view yet.'
                }
                action={activeFilters.length
                  ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setParams((current) => {
                            const next = new URLSearchParams(current)
                            for (const key of ['project_id', 'assignee_user_id', 'status_value_id', 'urgency_value_id', 'archived']) next.delete(key)
                            return next
                          }, { replace: true })
                        }}
                      >
                        Clear filters
                      </Button>
                    )
                  : undefined}
              />
            </div>
          )}

          {groups.map((group, index) => {
            const groupIds = group.tasks.map((task) => String(task.id))
            const allSelected = groupIds.length > 0 && groupIds.every((id) => selected.includes(id))
            return (
              <section key={group.key}>
                {groupBy !== 'none' && (
                  <TaskGroupHeader
                    label={group.label}
                    count={group.tasks.length}
                    color={group.color}
                    hint={group.hint}
                    collapsed={Boolean(collapsed[group.key])}
                    first={index === 0}
                    allSelected={allSelected}
                    onToggle={() => setCollapsed((current) => ({ ...current, [group.key]: !current[group.key] }))}
                    onSelectGroup={() => setSelected((current) => allSelected
                      ? current.filter((id) => !groupIds.includes(id))
                      : [...current, ...groupIds.filter((id) => !current.includes(id))])}
                    onAdd={can('tasks.create') ? () => setCreateOpen(true) : undefined}
                  />
                )}
                {!collapsed[group.key] && (
                  <div className="flex flex-col">
                    {group.tasks.map((task) => {
                      const id = String(task.id)
                      return (
                        <div key={id} data-task-id={id}>
                          <TaskRow
                            task={task}
                            density={density}
                            cursor={orderedIds[cursor] === id}
                            selected={selected.includes(id)}
                            showStatus={showStatus}
                            showMeta={showMeta}
                            onOpen={(row, event: MouseEvent) => {
                              if (event.metaKey || event.ctrlKey || event.shiftKey) {
                                event.preventDefault()
                                toggleSelected(row)
                                return
                              }
                              setCursor(Math.max(0, orderedIds.indexOf(id)))
                              setParam('open', id)
                            }}
                            onToggleDone={toggleDone}
                            onToggleSelected={toggleSelected}
                            onStatusMenu={(row, anchor) => openMenu('status', anchor, [row.id])}
                            onDueMenu={(row, anchor) => openMenu('due', anchor, [row.id])}
                            onAssigneeMenu={(row, anchor) => openMenu('assignee', anchor, [row.id])}
                            onRowMenu={(row, anchor) => {
                              // Warm the folder catalogue for this task's
                              // project so the submenu is not empty on open.
                              setMenuProjectId(taskProjectId(row) ?? null)
                              openMenu('row', anchor, [row.id])
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}

          {/* Grouping is a judgement over the whole set, so a truncated set has
              to say so rather than quietly group a page. */}
          {data.length > 0 && (
            <p className="mt-10 text-meta-sm text-t4">
              {total > data.length
                ? `${data.length} shown of ${total} — narrow the filters to group the rest`
                : `${data.length} ${data.length === 1 ? 'task' : 'tasks'}`}
            </p>
          )}
        </div>
      </div>

      <TaskBulkBar count={selected.length} actions={bulkActions} onClear={() => setSelected([])} />

      <InlineMenu state={menu} title={menuContent.title} items={menuContent.items} onClose={closeMenu} />

      {openTask && (
        <TaskDrawerConnected
          task={openTask}
          revision={revision}
          orderedIds={orderedIds}
          onNavigate={(id) => setParam('open', id)}
          onClose={() => setParam('open', null)}
          onOpenMenu={openMenu}
          onReload={reload}
          onToggleDone={toggleDone}
        />
      )}

      {createOpen && (
        <CreateTaskModal
          open={createOpen}
          projects={lookups.projects}
          folders={createFolders}
          foldersLoading={folderCatalog.loading}
          folderError={createProjectId ? folderCatalog.errorsByProject[String(createProjectId)] ?? '' : ''}
          onProjectChange={(projectId) => setCreateProjectId(projectId ?? '')}
          users={lookups.users}
          statusOptions={lookups.statusOptions}
          typeOptions={lookups.typeOptions}
          urgencyOptions={lookups.urgencyOptions}
          busy={createBusy}
          error={createError}
          canAssign={can('tasks.assign')}
          canChangeStatus={can('tasks.change_status')}
          canEstimate={can('tasks.estimate')}
          canCreateSubtasks={can('tasks.subtasks')}
          canAttach={can('tasks.attachments')}
          onErrorDismiss={() => setCreateError('')}
          onClose={() => setCreateOpen(false)}
          onSubmit={create}
        />
      )}

      {aiCreateOpen && (
        <AiCreateTaskModal
          open={aiCreateOpen}
          projects={lookups.projects}
          initialProjectId={filters.project_id}
          onClose={() => setAiCreateOpen(false)}
          onCreated={async () => { await reload() }}
        />
      )}
    </>
  )
}

function ToolButton({ children, onClick }: { children: React.ReactNode; onClick: (anchor: HTMLElement) => void }) {
  return (
    <button
      type="button"
      onClick={(event: MouseEvent<HTMLButtonElement>) => onClick(event.currentTarget)}
      className="inline-flex h-[27px] items-center gap-1.5 rounded-[7px] px-[9px] text-body-sm text-t3 hover:bg-sidebar-accent hover:text-t1"
    >
      {children}
    </button>
  )
}

/**
 * Loads the full task once the drawer opens. The list payload is deliberately
 * thin — it carries subtask counts, not subtask rows — so the drawer fetches the
 * detail and its activity, and shows the row it already has in the meantime.
 */
function TaskDrawerConnected({
  task: listTask,
  revision,
  orderedIds,
  onNavigate,
  onClose,
  onOpenMenu,
  onReload,
  onToggleDone,
}: {
  task: Task
  /** Changes whenever the page mutates a task, forcing a detail refetch. */
  revision: number
  orderedIds: string[]
  onNavigate: (id: string) => void
  onClose: () => void
  onOpenMenu: (kind: MenuKind, anchor: HTMLElement, taskIds: EntityId[]) => void
  onReload: () => Promise<void> | void
  onToggleDone: (task: Task) => void
}) {
  const can = useCan()
  const { adminOverride } = useWorkspace()
  const timer = useTimerContext()
  // The footer button acts on this task only. A timer running on some other
  // task still reads as "Start timer" here, and starting moves it across.
  const timerRunning = timer.state === 'working' && String(timer.task?.id ?? '') === String(listTask.id)
  const [detail, setDetail] = useState<Task | null>(null)
  const [activity, setActivity] = useState<Array<Record<string, unknown>>>([])
  const [showEvents, setShowEvents] = useState(true)
  const [loading, setLoading] = useState(true)
  const [commentBusy, setCommentBusy] = useState(false)
  const id = String(listTask.id)

  const load = useCallback(async () => {
    // `revision` is not read here; it is a dependency so a mutation elsewhere
    // on the page reruns this fetch.
    void revision
    setLoading(true)
    try {
      const [taskResponse, activityResponse] = await Promise.allSettled([
        api.get<ApiEnvelope<Task> | Task>(`/api/tasks/${id}`),
        can('tasks.view') ? api.get<ApiEnvelope<Array<Record<string, unknown>>>>(`/api/tasks/${id}/activity`) : Promise.resolve(null),
      ])
      if (taskResponse.status === 'fulfilled') setDetail(unwrap(taskResponse.value))
      if (activityResponse.status === 'fulfilled' && activityResponse.value) {
        setActivity(unwrap(activityResponse.value) ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [can, id, revision])

  useEffect(() => { void load() }, [load])

  const task = detail && String(detail.id) === id ? detail : listTask
  const index = orderedIds.indexOf(id)

  const fields: TaskDrawerField[] = [
    {
      key: 'status',
      label: 'Status',
      value: fieldLabel(taskStatusValue(task)),
      color: statusColor(taskStatusValue(task)),
      disabled: !can('tasks.change_status'),
      onOpen: (anchor) => onOpenMenu('status', anchor, [task.id]),
    },
    {
      key: 'urgency',
      label: 'Urgency',
      value: fieldLabel(taskUrgencyValue(task)),
      color: urgencyColor(taskUrgencyValue(task)),
      disabled: !can('tasks.edit'),
      onOpen: (anchor) => onOpenMenu('urgency', anchor, [task.id]),
    },
    {
      key: 'assignee',
      label: 'Assignee',
      value: task.assignee ? displayName(task.assignee) : 'Nobody yet',
      user: task.assignee,
      disabled: !can('tasks.assign'),
      onOpen: (anchor) => onOpenMenu('assignee', anchor, [task.id]),
    },
    {
      key: 'due',
      label: 'Due',
      value: dueMeta(taskDueDate(task)).label,
      disabled: !can('tasks.edit'),
      onOpen: (anchor) => onOpenMenu('due', anchor, [task.id]),
    },
    {
      key: 'project',
      label: 'Project',
      value: task.project?.name ?? 'No project',
      disabled: true,
      onOpen: () => undefined,
    },
  ]

  /**
   * Comments and events in one thread, newest last so it reads as a
   * conversation. An event carries no body, which is what tells them apart.
   */
  const feed: FeedEntry[] = useMemo(() => {
    const comments: FeedEntry[] = (task.notes ?? [])
      .filter((note: Note) => !(note.isMessage ?? note.is_message))
      .map((note: Note) => ({
        key: `note-${note.id}`,
        who: displayName(note.author ?? (typeof note.createdBy === 'object' ? note.createdBy : undefined)),
        user: note.author ?? (typeof note.createdBy === 'object' ? note.createdBy : undefined),
        what: 'commented',
        when: relativeTime(note.createdAt ?? note.created_at),
        body: note.body,
        at: new Date(note.createdAt ?? note.created_at ?? 0).getTime(),
      }))

    const events: FeedEntry[] = showEvents
      ? activity.map((row, position) => {
          const actor = row.user as Task['assignee']
          const at = String(row.created_at ?? row.createdAt ?? '')
          return {
            key: `event-${row.id ?? position}`,
            who: displayName(actor),
            user: actor,
            what: activityPhrase(String(row.action ?? row.event ?? '')),
            when: relativeTime(at),
            at: new Date(at || 0).getTime(),
          }
        })
      : []

    return [...comments, ...events].sort((a, b) => a.at - b.at)
  }, [task.notes, activity, showEvents])

  const comment = async (body: string) => {
    setCommentBusy(true)
    try {
      await api.post(`/api/tasks/${id}/notes`, { body, admin_override: adminOverride ? 1 : undefined })
      await load()
      await onReload()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'That comment did not send.')
    } finally {
      setCommentBusy(false)
    }
  }

  const toggleSubtask = async (subtask: Subtask) => {
    try {
      await api.patch(`/api/tasks/${id}/subtasks/${subtask.id}/complete`, {
        completed: !(subtask.completedAt ?? subtask.completed_at),
        admin_override: adminOverride ? 1 : undefined,
      })
      await load()
      await onReload()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'That step did not change.')
    }
  }

  return (
    <TaskDrawer
      task={task}
      loading={loading}
      fields={fields}
      feed={feed}
      showEvents={showEvents}
      commentCount={(task.notes ?? []).filter((note) => !(note.isMessage ?? note.is_message)).length}
      canComment={can('tasks.comment')}
      canComplete={can('tasks.change_status')}
      commentBusy={commentBusy}
      hasPrevious={index > 0}
      hasNext={index >= 0 && index < orderedIds.length - 1}
      onToggleEvents={() => setShowEvents((current) => !current)}
      onClose={onClose}
      onPrevious={() => onNavigate(orderedIds[index - 1])}
      onNext={() => onNavigate(orderedIds[index + 1])}
      onToggleSubtask={(subtask) => void toggleSubtask(subtask)}
      onComment={comment}
      onComplete={() => onToggleDone(task)}
      timerRunning={timerRunning}
      timerBusy={timer.busy}
      canTrackTime={can('time.track')}
      onToggleTimer={() => void (timerRunning ? timer.stop() : timer.start(task.id))}
    />
  )
}

/** Short relative time — the drawer has no room for a full timestamp. */
function relativeTime(value: string | null | undefined): string {
  if (!value) return ''
  const at = new Date(value).getTime()
  if (Number.isNaN(at)) return ''
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
