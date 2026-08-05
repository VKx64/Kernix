import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  Folder,
  Inbox,
  Pencil,
  Play,
  Plus,
  Send,
  Sparkles,
  SquareCheck,
  Trash2,
  User,
} from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { useAuth } from '../auth/AuthProvider'
import { useWorkspace } from '../auth/WorkspaceProvider'
import { ClockGate, isClockGate } from '../components/ClockGate'
import { CompletionProofCard, CompletionProofModal } from '../components/CompletionProof'
import { TaskAttachments } from '../components/TaskAttachments'
import { Avatar, EmptyState, ErrorBanner, Minutes, PageHeader, StatusBadge } from '@/components/shared'
import { PageActions } from '@/layout/page-actions'
import { DataTable } from '@/components/data-table'
import { EntityForm, type FormFieldSpec } from '@/components/entity-form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, displayName, fieldLabel, normalizePage, unwrap } from '../lib/api'
import { uploadTaskAttachments } from '../lib/attachments'
import { latestProof, proofState, settleCompletionProof, submitCompletionProof } from '../lib/completionProof'
import { useCollection } from '../lib/useCollection'
import { isAdministrator, useCan } from '../lib/permissions'
import type { ApiEnvelope, CustomField, EntityId, EstimateRequest, FieldValue, FormPayload, Note, Paginated, Project, Subtask, Task, TaskFolder, TaskWorkRequest, UserSummary } from '../types/api'
import { CreateTaskModal, type CreateTaskPayload } from './CreateTaskModal'
import { AiCreateTaskModal } from './AiCreateTaskModal'

function taskStatus(task: Task) { return task.statusValue ?? task.status_value ?? task.status }
function taskUrgency(task: Task) { return task.urgencyValue ?? task.urgency_value ?? task.urgency }
function dueDate(task: Task) { return task.dueDate ?? task.due_date }
function estimated(task: Task) { return task.estimatedMinutes ?? task.estimated_minutes ?? 0 }
function actual(task: Task) { return task.actualMinutes ?? task.actual_minutes ?? 0 }
function taskProjectId(task: Task) { return task.projectId ?? task.project_id ?? task.project?.id }
function taskFolderId(task: Task) { return task.taskFolderId ?? task.task_folder_id ?? task.folder?.id ?? null }
function folderSort(folder: TaskFolder) { return folder.sortOrder ?? folder.sort_order ?? 0 }

/**
 * Task work is restricted to the assignee server-side. This mirrors the
 * exceptions the backend honors so the UI can gate controls the same way
 * instead of letting mutations 409.
 */
function isAssignmentGranted(task: Task, userId: EntityId | undefined, can: (permission: string) => boolean, isAdmin: boolean): boolean {
  return Boolean(
    isAdmin
    || can('tasks.work_unassigned')
    || String(task.creator?.id ?? '') === String(userId ?? '')
    || String(task.assignee?.id ?? '') === String(userId ?? '')
    || (task.subtasks ?? []).some((subtask) => String(subtask.assignee?.id ?? '') === String(userId ?? '')),
  )
}

interface TaskLookups {
  projects: Project[]
  users: UserSummary[]
  fields: CustomField[]
}

interface BootstrapLookups {
  projects?: Project[]
  assignees?: UserSummary[]
  coworkers?: UserSummary[]
  fields?: CustomField[]
}

function lookupValues(fields: CustomField[], key: string) {
  return fields.find((field) => (field.key ?? (field as CustomField & { key_name?: string }).key_name) === key)?.values ?? []
}

function useTaskLookups(enabled = true) {
  const can = useCan()
  const [lookups, setLookups] = useState<TaskLookups>({ projects: [], users: [], fields: [] })
  useEffect(() => {
    if (!enabled) return
    let active = true
    void Promise.allSettled([
      api.get<ApiEnvelope<BootstrapLookups> | BootstrapLookups>('/api/bootstrap'),
      can('projects.view') ? api.get<Paginated<Project> | ApiEnvelope<Paginated<Project>> | Project[]>('/api/projects', { per_page: 100 }) : Promise.resolve(null),
    ]).then(([bootstrapResult, projectResult]) => {
      if (!active) return
      const bootstrap = bootstrapResult.status === 'fulfilled' ? unwrap(bootstrapResult.value) : {}
      setLookups({
        projects: bootstrap.projects?.length
          ? bootstrap.projects
          : projectResult.status === 'fulfilled' && projectResult.value ? normalizePage(projectResult.value).data : [],
        users: bootstrap.assignees ?? bootstrap.coworkers ?? [],
        fields: bootstrap.fields ?? [],
      })
    })
    return () => { active = false }
  }, [can, enabled])
  return lookups
}

type TaskFolderCatalog = Record<string, TaskFolder[]>

function useTaskFolderCatalog(projectIds: EntityId[]) {
  const projectKey = [...new Set(projectIds.map(String).filter(Boolean))].sort().join(',')
  const [foldersByProject, setFoldersByProject] = useState<TaskFolderCatalog>({})
  const [errorsByProject, setErrorsByProject] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(Boolean(projectKey))
  const loadedProjects = useRef(new Set<string>())

  // Only fetch projects that are not cached yet: opening the create modal or
  // picking a project used to refetch folders for every project on screen.
  const load = useCallback(async (isCurrent: () => boolean = () => true, force = false) => {
    const ids = projectKey ? projectKey.split(',') : []
    if (force) loadedProjects.current.clear()
    if (!ids.length) {
      loadedProjects.current.clear()
      if (isCurrent()) {
        setFoldersByProject({})
        setErrorsByProject({})
        setLoading(false)
      }
      return
    }

    const pending = ids.filter((projectId) => !loadedProjects.current.has(projectId))
    if (!pending.length) {
      if (isCurrent()) setLoading(false)
      return
    }

    setLoading(true)
    const results = await Promise.allSettled(pending.map(async (projectId) => {
      const response = await api.get<ApiEnvelope<TaskFolder[]> | TaskFolder[]>(`/api/projects/${projectId}/task-folders`)
      const folders = unwrap(response)
      return (Array.isArray(folders) ? folders : []).slice().sort((left, right) => folderSort(left) - folderSort(right) || left.name.localeCompare(right.name))
    }))
    if (!isCurrent()) return

    const nextFolders: TaskFolderCatalog = {}
    const nextErrors: Record<string, string> = {}
    results.forEach((result, index) => {
      const projectId = pending[index]
      if (result.status === 'fulfilled') {
        nextFolders[projectId] = result.value
        loadedProjects.current.add(projectId)
      } else {
        nextErrors[projectId] = result.reason instanceof Error ? result.reason.message : 'Unable to load task folders.'
      }
    })
    setFoldersByProject((current) => ({ ...current, ...nextFolders }))
    setErrorsByProject((current) => {
      const merged = { ...current, ...nextErrors }
      pending.forEach((projectId) => { if (!nextErrors[projectId]) delete merged[projectId] })
      return merged
    })
    setLoading(false)
  }, [projectKey])

  useEffect(() => {
    let current = true
    void load(() => current)
    return () => { current = false }
  }, [load])

  return { foldersByProject, errorsByProject, loading, error: Object.values(errorsByProject)[0] ?? '', reload: () => load(() => true, true) }
}

type TaskColumnKey = 'title' | 'status' | 'urgency' | 'assignee' | 'due' | 'time'

interface TaskColumnPreferences {
  visible: Record<TaskColumnKey, boolean>
}

const TASK_COLUMN_STORAGE_KEY = 'kernix.task-columns.v2'
const TASK_COLUMN_OPTIONS: Array<{ key: TaskColumnKey; label: string }> = [
  { key: 'title', label: 'Task' },
  { key: 'status', label: 'Status' },
  { key: 'urgency', label: 'Urgency' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'due', label: 'Due date' },
  { key: 'time', label: 'Logged time' },
]
const DEFAULT_TASK_COLUMNS: TaskColumnPreferences = {
  visible: { title: true, status: true, urgency: true, assignee: true, due: true, time: true },
}

function taskColumnPreferences(): TaskColumnPreferences {
  try {
    const stored = window.localStorage.getItem(TASK_COLUMN_STORAGE_KEY)
    if (!stored) return structuredClone(DEFAULT_TASK_COLUMNS)
    const parsed = JSON.parse(stored) as Partial<TaskColumnPreferences>
    return { visible: { ...DEFAULT_TASK_COLUMNS.visible, ...parsed.visible, title: true } }
  } catch {
    return structuredClone(DEFAULT_TASK_COLUMNS)
  }
}

function persistTaskColumnPreferences(preferences: TaskColumnPreferences) {
  try {
    window.localStorage?.setItem(TASK_COLUMN_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Preferences are optional when storage is disabled or unavailable.
  }
}

export function TaskQueueTable({
  tasks,
  columns,
  foldersByProject = {},
  folderErrorsByProject = {},
  loading = false,
  foldersLoading = false,
  canMove = false,
  movingTaskId = null,
  onTaskClick,
  onMoveTask,
}: {
  tasks: Task[]
  columns: ColumnDef<Task>[]
  foldersByProject?: TaskFolderCatalog
  folderErrorsByProject?: Record<string, string>
  loading?: boolean
  foldersLoading?: boolean
  canMove?: boolean
  movingTaskId?: EntityId | null
  onTaskClick?: (task: Task) => void
  onMoveTask?: (task: Task, folderId: EntityId | null) => void
}) {
  const [folderTask, setFolderTask] = useState<Task | null>(null)
  const [folderChoice, setFolderChoice] = useState('')

  const tableColumns = useMemo<ColumnDef<Task>[]>(() => canMove && onMoveTask ? [
    ...columns,
    {
      id: 'folder-move',
      header: 'Folder',
      cell: ({ row }) => {
        const task = row.original
        const projectId = taskProjectId(task)
        const currentFolderId = taskFolderId(task)
        const unavailable = foldersLoading || (projectId !== undefined && Boolean(folderErrorsByProject[String(projectId)])) || String(movingTaskId ?? '') === String(task.id)
        return (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Change folder for ${task.title}`}
            disabled={unavailable}
            onClick={(event) => {
              event.stopPropagation()
              setFolderChoice(currentFolderId === null || currentFolderId === undefined ? '' : String(currentFolderId))
              setFolderTask(task)
            }}
          >
            <Folder /> Change
          </Button>
        )
      },
    },
  ] : columns, [canMove, columns, folderErrorsByProject, foldersLoading, movingTaskId, onMoveTask])

  const folderTaskProjectId = folderTask ? taskProjectId(folderTask) : undefined
  const folderTaskOptions = (folderTaskProjectId === undefined ? [] : foldersByProject[String(folderTaskProjectId)] ?? []).slice()
  if (folderTask?.folder && !folderTaskOptions.some((folder) => String(folder.id) === String(folderTask.folder?.id))) folderTaskOptions.push(folderTask.folder)
  folderTaskOptions.sort((left, right) => folderSort(left) - folderSort(right) || left.name.localeCompare(right.name))
  const currentFolderChoice = folderTask ? String(taskFolderId(folderTask) ?? '') : ''

  return (
    <>
      <DataTable
        columns={tableColumns}
        data={tasks}
        loading={loading}
        emptyTitle="No tasks match this view"
        emptyDescription="Try changing a filter or create the next piece of work."
        onRowClick={onTaskClick}
        showViewOptions={false}
      />
      <Dialog open={Boolean(folderTask)} onOpenChange={(open) => { if (!open) setFolderTask(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change folder</DialogTitle>
            {folderTask && <DialogDescription>Choose where “{folderTask.title}” belongs.</DialogDescription>}
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!folderTask || folderChoice === currentFolderChoice) return
              onMoveTask?.(folderTask, folderChoice || null)
              setFolderTask(null)
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="task-folder-destination">Folder</Label>
              <Select value={folderChoice || '__unset__'} onValueChange={(next) => setFolderChoice(next === '__unset__' ? '' : next)}>
                <SelectTrigger id="task-folder-destination" aria-label="Folder destination" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent aria-label="Folder destination">
                  <SelectItem value="__unset__">Ungrouped</SelectItem>
                  {folderTaskOptions.map((folder) => <SelectItem value={String(folder.id)} key={folder.id}>{folder.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFolderTask(null)}>Cancel</Button>
              <Button type="submit" disabled={!folderTask || folderChoice === currentFolderChoice}>Move task</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function TasksPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const search = params.get('search') ?? ''
  const mine = params.get('mine') === '1'
  const urgent = params.get('urgent') === '1'
  const archived = params.get('archived') === '1'
  const sort = params.get('sort') ?? 'due_date'
  const projectId = params.get('project_id') ?? ''
  const [createOpen, setCreateOpen] = useState(false)
  const [aiCreateOpen, setAiCreateOpen] = useState(false)
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [clockBlocked, setClockBlocked] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<TaskFolder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderActionError, setFolderActionError] = useState('')
  const [movingTaskId, setMovingTaskId] = useState<EntityId | null>(null)
  const [createProjectId, setCreateProjectId] = useState<EntityId | ''>('')
  const [columnPreferences, setColumnPreferences] = useState<TaskColumnPreferences>(taskColumnPreferences)
  const { canMutateTasks, canAdminOverride, adminOverride } = useWorkspace()
  const can = useCan()
  const lookups = useTaskLookups(true)
  const statusOptions = lookupValues(lookups.fields, 'task_status')
  const typeOptions = lookupValues(lookups.fields, 'task_type')
  const urgencyOptions = lookupValues(lookups.fields, 'task_urgency')
  const { data, meta, loading, error, reload } = useCollection<Task>('/api/tasks', {
    search,
    all: true,
    filters: {
      project_id: projectId || undefined,
      mine: mine ? 1 : undefined,
      urgent: urgent ? 1 : undefined,
      archived: archived ? 'only' : undefined,
      sort,
    },
  })
  const folderProjectIds = useMemo<EntityId[]>(() => {
    const ids: EntityId[] = []
    if (projectId) ids.push(projectId)
    else if (can('tasks.edit')) ids.push(...data.map(taskProjectId).filter((id): id is EntityId => id !== undefined))
    if (createOpen && createProjectId !== '') ids.push(createProjectId)
    return [...new Set(ids.map(String))]
  }, [can, createOpen, createProjectId, data, projectId])
  const folderCatalog = useTaskFolderCatalog(folderProjectIds)
  const selectedProject = (projectId
    ? lookups.projects.find((project) => String(project.id) === projectId)
      ?? data.find((task) => String(taskProjectId(task)) === projectId)?.project
    : null) ?? null
  const selectedProjectFolders = projectId ? folderCatalog.foldersByProject[projectId] ?? [] : []
  const createFolders = createProjectId === '' ? [] : folderCatalog.foldersByProject[String(createProjectId)] ?? []
  const createFolderError = createProjectId === '' ? '' : folderCatalog.errorsByProject[String(createProjectId)] ?? ''

  useEffect(() => {
    if (canMutateTasks) setClockBlocked(false)
  }, [canMutateTasks])

  useEffect(() => {
    persistTaskColumnPreferences(columnPreferences)
  }, [columnPreferences])

  const setFilter = (key: string, value?: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const columnRenderers: Record<TaskColumnKey, (task: Task) => React.ReactNode> = {
    title: (task) => {
      const projectName = task.project?.name ?? 'No project'
      const clientName = task.project?.client?.name
      return (
        <div>
          <strong className="block">{task.title}</strong>
          <span className="text-xs text-muted-foreground">{[projectName, clientName && clientName !== projectName ? clientName : null].filter(Boolean).join(' · ')}</span>
        </div>
      )
    },
    status: (task) => <StatusBadge value={taskStatus(task)} />,
    urgency: (task) => <StatusBadge value={taskUrgency(task)} />,
    assignee: (task) => <span>{displayName(task.assignee)}</span>,
    due: (task) => dueDate(task) ? <time className={new Date(dueDate(task)!) < new Date() ? 'text-destructive' : undefined}>{new Date(dueDate(task)!).toLocaleDateString()}</time> : '—',
    time: (task) => <Minutes value={actual(task)} />,
  }
  const columns: ColumnDef<Task>[] = TASK_COLUMN_OPTIONS
    .filter((column) => columnPreferences.visible[column.key])
    .map((column) => ({
      id: column.key,
      header: column.label,
      cell: ({ row }) => columnRenderers[column.key](row.original),
    }))

  const create = async (values: CreateTaskPayload, files: File[] = []) => {
    if (!canMutateTasks && !(canAdminOverride && adminOverride)) { setClockBlocked(true); return }
    setFormBusy(true)
    setFormError('')
    try {
      const response = await api.post<ApiEnvelope<Task> | Task>('/api/tasks', { ...values, admin_override: adminOverride ? 1 : undefined } as Record<string, unknown>)
      const task = unwrap(response)
      // The task exists from here on: a failed upload must not discard it.
      let uploadError = ''
      if (files.length) {
        try {
          await uploadTaskAttachments(task.id, files, adminOverride)
        } catch (reason) {
          uploadError = reason instanceof Error ? reason.message : 'The task was created, but its files could not be uploaded.'
        }
      }
      setClockBlocked(false)
      setCreateOpen(false)
      setCreateProjectId('')
      await reload()
      navigate(`/tasks/${task.id}`, uploadError ? { state: { attachmentError: uploadError } } : undefined)
    } catch (reason) {
      if (isClockGate(reason)) setClockBlocked(true)
      setFormError(reason instanceof Error ? reason.message : 'Unable to create the task.')
    } finally {
      setFormBusy(false)
    }
  }

  const moveTask = async (task: Task, folderId: EntityId | null) => {
    if (!canMutateTasks && !(canAdminOverride && adminOverride)) {
      setClockBlocked(true)
      setFolderActionError('Clock in to move tasks between folders, or enable the administrator override.')
      return
    }
    setMovingTaskId(task.id)
    setFolderActionError('')
    try {
      await api.patch(`/api/tasks/${task.id}`, { task_folder_id: folderId, admin_override: adminOverride ? 1 : undefined })
    } catch (reason) {
      if (isClockGate(reason)) setClockBlocked(true)
      setFolderActionError(reason instanceof Error ? reason.message : 'Unable to move this task.')
      setMovingTaskId(null)
      return
    }
    setClockBlocked(false)
    const [refreshed] = await Promise.allSettled([reload()])
    if (refreshed.status === 'rejected') {
      setFolderActionError('The task was moved, but the list could not be refreshed.')
    }
    setMovingTaskId(null)
  }

  const refreshFolderView = async (successMessage: string) => {
    const results = await Promise.allSettled([folderCatalog.reload(), reload()])
    if (results.some((result) => result.status === 'rejected')) {
      setFolderActionError(`${successMessage}, but this view could not be refreshed.`)
    }
  }

  const openTaskCreator = () => {
    setCreateProjectId(projectId || '')
    setFormError('')
    setCreateOpen(true)
    setClockBlocked(false)
  }

  const closeTaskCreator = () => {
    setCreateOpen(false)
    setCreateProjectId('')
    setFormError('')
  }

  const openNewFolder = () => {
    setEditingFolder(null)
    setFolderActionError('')
    setFolderOpen(true)
  }

  const openRenameFolder = (folder: TaskFolder) => {
    setEditingFolder(folder)
    setFolderActionError('')
    setFolderOpen(true)
  }

  const saveFolder = async (values: FormPayload) => {
    if (!projectId) return
    const name = String(values.name ?? '').trim()
    if (!name) return
    setFolderBusy(true)
    setFolderActionError('')
    const action = editingFolder ? 'renamed' : 'created'
    try {
      if (editingFolder) await api.patch(`/api/projects/${projectId}/task-folders/${editingFolder.id}`, { name })
      else await api.post(`/api/projects/${projectId}/task-folders`, { name })
    } catch (reason) {
      setFolderActionError(reason instanceof Error ? reason.message : `Unable to ${editingFolder ? 'rename' : 'create'} this folder.`)
      setFolderBusy(false)
      return
    }
    setFolderOpen(false)
    setEditingFolder(null)
    await refreshFolderView(`The folder was ${action}`)
    setFolderBusy(false)
  }

  const deleteFolder = async (folder: TaskFolder) => {
    if (!projectId || !window.confirm(`Delete “${folder.name}”? Its tasks will become Ungrouped.`)) return
    setFolderBusy(true)
    setFolderActionError('')
    try {
      await api.delete(`/api/projects/${projectId}/task-folders/${folder.id}`, { admin_override: adminOverride ? 1 : undefined })
    } catch (reason) {
      if (isClockGate(reason)) setClockBlocked(true)
      setFolderActionError(reason instanceof Error ? reason.message : 'Unable to delete this folder.')
      setFolderBusy(false)
      return
    }
    setClockBlocked(false)
    await refreshFolderView('The folder was deleted')
    setFolderBusy(false)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Work queue"
        title="Tasks"
        description={projectId ? `${meta.total} tasks in ${selectedProject?.name ?? 'the selected project'}.` : `${meta.total} tasks across your visible projects.`}
      />
      <PageActions>
        <>
          {projectId && can('projects.edit') && (
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm"><Folder /> Folders</Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <strong className="text-sm">Project folders</strong>
                    <p className="text-xs text-muted-foreground">{selectedProject?.name ?? 'Selected project'}</p>
                  </div>
                  <Button type="button" size="sm" aria-label="New folder" disabled={folderBusy} onClick={openNewFolder}>
                    <Plus /> New
                  </Button>
                </div>
                <div className="mt-3 space-y-1">
                  {selectedProjectFolders.length ? selectedProjectFolders.map((folder) => (
                    <div key={folder.id} className="flex items-center justify-between rounded-md px-1.5 py-1 hover:bg-accent">
                      <span className="flex items-center gap-2 text-sm"><Folder className="size-3.5 text-muted-foreground" /> {folder.name}</span>
                      <div className="flex gap-1">
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Rename ${folder.name}`} onClick={() => openRenameFolder(folder)}><Pencil /></Button>
                        <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" aria-label={`Delete ${folder.name}`} onClick={() => void deleteFolder(folder)}><Trash2 /></Button>
                      </div>
                    </div>
                  )) : <p className="text-sm text-muted-foreground">No folders yet.</p>}
                </div>
              </PopoverContent>
            </Popover>
          )}
          <div className="flex items-center gap-1">
            <Button type="button" variant={mine ? 'secondary' : 'outline'} size="sm" aria-pressed={mine} onClick={() => setFilter('mine', mine ? undefined : '1')}>Mine</Button>
            <Button type="button" variant={urgent ? 'secondary' : 'outline'} size="sm" aria-pressed={urgent} onClick={() => setFilter('urgent', urgent ? undefined : '1')}>Urgent</Button>
            <Button type="button" variant={archived ? 'secondary' : 'outline'} size="sm" aria-pressed={archived} onClick={() => setFilter('archived', archived ? undefined : '1')}>Archived</Button>
          </div>
          <Select value={projectId || '__unset__'} onValueChange={(next) => setFilter('project_id', next === '__unset__' ? undefined : next)}>
            <SelectTrigger size="sm" aria-label="Project filter" className="w-40">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent aria-label="Project filter">
              <SelectItem value="__unset__">All projects</SelectItem>
              {lookups.projects.map((project) => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(next) => setFilter('sort', next === 'due_date' ? undefined : next)}>
            <SelectTrigger size="sm" aria-label="Sort tasks" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent aria-label="Sort tasks">
              <SelectItem value="due_date">Due date</SelectItem>
              <SelectItem value="-created_at">Newest</SelectItem>
              <SelectItem value="urgency">Urgency</SelectItem>
              <SelectItem value="title">Title</SelectItem>
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm"><SquareCheck /> Table columns</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Table columns</p>
              <div className="space-y-2">
                {TASK_COLUMN_OPTIONS.map((column) => (
                  <label key={column.key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      aria-label={column.label}
                      checked={columnPreferences.visible[column.key]}
                      disabled={column.key === 'title'}
                      onCheckedChange={(checked) => setColumnPreferences((current) => ({
                        ...current,
                        visible: { ...current.visible, [column.key]: checked === true },
                      }))}
                    />
                    {column.label}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {can('tasks.create_with_ai') && <Button type="button" variant="outline" size="sm" onClick={() => setAiCreateOpen(true)}><Sparkles /> Create with AI</Button>}
          {can('tasks.create') && <Button type="button" size="sm" onClick={openTaskCreator}><Plus /> New task</Button>}
        </>
      </PageActions>
      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {folderCatalog.error && <ErrorBanner message={folderCatalog.error} onRetry={() => void folderCatalog.reload()} />}
      {folderActionError && !folderOpen && <ErrorBanner message={folderActionError} />}
      {clockBlocked && !createOpen && <ClockGate compact />}
      <Card>
        <CardContent className="space-y-4">
          <TaskQueueTable
            tasks={data}
            columns={columns}
            foldersByProject={folderCatalog.foldersByProject}
            folderErrorsByProject={folderCatalog.errorsByProject}
            loading={loading}
            foldersLoading={folderCatalog.loading}
            canMove={!archived && can('tasks.edit')}
            movingTaskId={movingTaskId}
            onTaskClick={(task) => navigate(`/tasks/${task.id}`)}
            onMoveTask={(task, folderId) => void moveTask(task, folderId)}
          />
        </CardContent>
      </Card>
      <CreateTaskModal
        open={createOpen}
        busy={formBusy}
        error={formError}
        initialProjectId={projectId || undefined}
        projects={lookups.projects}
        folders={createFolders}
        foldersLoading={folderCatalog.loading && createProjectId !== '' && createFolders.length === 0 && !createFolderError}
        folderError={createFolderError}
        users={lookups.users}
        statusOptions={statusOptions}
        typeOptions={typeOptions}
        urgencyOptions={urgencyOptions}
        canAssign={can('tasks.assign')}
        canChangeStatus={can('tasks.change_status')}
        canEstimate={can('tasks.estimate')}
        canCreateSubtasks={can('tasks.subtasks')}
        canAttach={can('tasks.attachments')}
        notice={clockBlocked ? <ClockGate compact showOverride={false} /> : undefined}
        onProjectChange={setCreateProjectId}
        onErrorDismiss={() => setFormError('')}
        onClose={closeTaskCreator}
        onSubmit={create}
      />
      <AiCreateTaskModal open={aiCreateOpen} projects={lookups.projects} initialProjectId={projectId || undefined} onClose={() => setAiCreateOpen(false)} onCreated={reload} />
      <Dialog open={folderOpen} onOpenChange={(open) => { if (!open && !folderBusy) { setFolderOpen(false); setEditingFolder(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFolder ? 'Rename folder' : 'Create a folder'}</DialogTitle>
            <DialogDescription>Folders organize tasks inside this project.</DialogDescription>
          </DialogHeader>
          <EntityForm
            key={`${editingFolder?.id ?? 'new'}-${folderOpen}`}
            fields={[{ name: 'name', label: 'Folder name', required: true, wide: true, placeholder: 'For example, Pre-production' }]}
            initialValues={editingFolder ? { name: editingFolder.name } : undefined}
            busy={folderBusy}
            error={folderActionError}
            submitLabel={editingFolder ? 'Save folder' : 'Create folder'}
            onCancel={() => { setFolderOpen(false); setEditingFolder(null) }}
            onSubmit={saveFolder}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

type DetailTab = 'notes' | 'subtasks' | 'files' | 'emails' | 'activity'

export function TaskDetailPage() {
  const { taskId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const can = useCan()
  const isAdmin = isAdministrator(user)
  const { canMutateTasks, canAdminOverride, adminOverride } = useWorkspace()
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [clockBlocked, setClockBlocked] = useState(false)
  const [tab, setTab] = useState<DetailTab>('notes')
  const [editOpen, setEditOpen] = useState(false)
  const [editProjectId, setEditProjectId] = useState<EntityId | ''>('')
  const [busy, setBusy] = useState(false)
  const [noteBody, setNoteBody] = useState('')
  const [noteMinutes, setNoteMinutes] = useState(0)
  const [notifyUserId, setNotifyUserId] = useState('')
  const [editingNote, setEditingNote] = useState<Note | null>(null)
  const [noteEditBody, setNoteEditBody] = useState('')
  const [noteEditMinutes, setNoteEditMinutes] = useState(0)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [editingSubtask, setEditingSubtask] = useState<Subtask | null>(null)
  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [activity, setActivity] = useState<Array<Record<string, unknown>>>([])
  const [estimateRequests, setEstimateRequests] = useState<EstimateRequest[]>([])
  const [proofOpen, setProofOpen] = useState(false)
  const [proofError, setProofError] = useState('')
  const [estimateRequestOpen, setEstimateRequestOpen] = useState(false)
  const [additionalMinutes, setAdditionalMinutes] = useState(30)
  const [estimateReason, setEstimateReason] = useState('')
  const [workRequests, setWorkRequests] = useState<TaskWorkRequest[]>([])
  const [workRequestOpen, setWorkRequestOpen] = useState(false)
  const [workRequestReason, setWorkRequestReason] = useState('')
  const [workRequestBusy, setWorkRequestBusy] = useState(false)
  const [workRequestError, setWorkRequestError] = useState('')
  const [decliningWorkRequest, setDecliningWorkRequest] = useState<TaskWorkRequest | null>(null)
  const [declineWorkReason, setDeclineWorkReason] = useState('')
  const lookups = useTaskLookups(Boolean(taskId))
  const statusOptions = lookupValues(lookups.fields, 'task_status')
  const typeOptions = lookupValues(lookups.fields, 'task_type')
  const urgencyOptions = lookupValues(lookups.fields, 'task_urgency')
  const detailProjectId = task ? taskProjectId(task) : undefined
  const detailFolderCatalog = useTaskFolderCatalog(editOpen && can('tasks.edit') && editProjectId !== '' ? [editProjectId] : [])
  const detailFolders = editProjectId === '' ? [] : detailFolderCatalog.foldersByProject[String(editProjectId)] ?? []
  const detailFolder = task?.folder ?? detailFolders.find((folder) => String(folder.id) === String(task ? taskFolderId(task) : '')) ?? null

  const loadEstimateRequests = useCallback(async (nextTask: Task, signal?: AbortSignal) => {
    const isAssignee = String(nextTask.assignee?.id ?? '') === String(user?.id ?? '')
    if (!isAdmin && !((can('tasks.request_estimate') && isAssignee) || can('tasks.review_estimate_requests'))) {
      setEstimateRequests([])
      return
    }
    try {
      const response = await api.get<ApiEnvelope<EstimateRequest[]> | EstimateRequest[]>(`/api/tasks/${nextTask.id}/estimate-requests`, undefined, signal)
      setEstimateRequests(unwrap(response))
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setEstimateRequests([])
    }
  }, [can, isAdmin, user?.id])

  const loadWorkRequests = useCallback(async (nextTask: Task, signal?: AbortSignal) => {
    const assigned = isAssignmentGranted(nextTask, user?.id, can, isAdmin)
    const canReview = can('tasks.review_work_requests')
    if (assigned && !canReview) {
      setWorkRequests([])
      return
    }
    try {
      const response = await api.get<ApiEnvelope<TaskWorkRequest[]> | TaskWorkRequest[]>(`/api/tasks/${nextTask.id}/work-requests`, undefined, signal)
      setWorkRequests(unwrap(response))
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setWorkRequests([])
    }
  }, [can, isAdmin, user?.id])

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!taskId) return
    setLoading(true)
    setError('')
    try {
      const response = await api.get<ApiEnvelope<Task> | Task>(`/api/tasks/${taskId}`, undefined, signal)
      const nextTask = unwrap(response)
      setTask(nextTask)
      await loadEstimateRequests(nextTask, signal)
      await loadWorkRequests(nextTask, signal)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(reason instanceof Error ? reason.message : 'Unable to open this task.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [loadEstimateRequests, loadWorkRequests, taskId])

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])

  useEffect(() => { setActivity([]) }, [taskId])

  // A task can be created successfully while its files fail to upload; the
  // creator lands here, so the warning has to travel with the navigation.
  useEffect(() => {
    const message = (location.state as { attachmentError?: string } | null)?.attachmentError
    if (!message) return
    setMutationError(message)
    setTab('files')
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    if (canMutateTasks) setClockBlocked(false)
  }, [canMutateTasks])

  useEffect(() => {
    if (tab !== 'activity' || !taskId || activity.length) return
    void api.get<ApiEnvelope<Array<Record<string, unknown>>> | Array<Record<string, unknown>>>(`/api/tasks/${taskId}/activity`)
      .then((response) => setActivity(unwrap(response)))
      .catch(() => setActivity([]))
  }, [tab, taskId, activity.length])

  const mutate = async (operation: () => Promise<unknown>) => {
    if (!canMutateTasks && !(canAdminOverride && adminOverride)) {
      setClockBlocked(true)
      return false
    }
    setBusy(true)
    setMutationError('')
    try {
      await operation()
      setClockBlocked(false)
      await load()
      return true
    } catch (reason) {
      if (isClockGate(reason)) setClockBlocked(true)
      setMutationError(reason instanceof Error ? reason.message : 'The task could not be updated.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const taskWritePermissions = ['tasks.edit', 'tasks.change_status', 'tasks.comment', 'tasks.log_time', 'tasks.subtasks', 'tasks.assign', 'tasks.estimate', 'tasks.request_estimate', 'tasks.email', 'tasks.archive']
  const canWriteTask = taskWritePermissions.some(can)
  const canEditTaskFields = ['tasks.edit', 'tasks.change_status', 'tasks.assign', 'tasks.estimate'].some(can)
  const canComment = can('tasks.comment')
  const canLogTime = can('tasks.log_time')
  const canManageSubtasks = can('tasks.subtasks')
  const canChangeStatus = can('tasks.change_status')
  const canEmail = can('tasks.email')
  const noteList = task?.notes ?? []
  const subtasks = task?.subtasks ?? []
  const emails = task?.emails ?? []
  const totals = task?.timeTotals
  // `taskActual`/`totalActual` is already inclusive of note time. Never add subtask actual again.
  const actualTotal = totals?.taskActual ?? totals?.totalActual ?? (task ? actual(task) : 0)
  const estimatedTotal = totals?.totalEstimated ?? totals?.taskEstimated ?? (task ? estimated(task) : 0)
  const progress = estimatedTotal > 0 ? Math.min(100, Math.round(actualTotal / estimatedTotal * 100)) : 0
  const isArchived = Boolean(task?.archivedAt ?? task?.archived_at)
  const canRequestEstimate = !isArchived && can('tasks.request_estimate') && String(task?.assignee?.id ?? '') === String(user?.id ?? '')
  const latestEstimateRequest = estimateRequests[0] ?? null
  const pendingEstimateRequest = estimateRequests.find((request) => request.status === 'pending') ?? null
  const attachments = task?.attachments ?? []
  const proof = latestProof(task)
  const proofDetail = proofState(proof)
  const statusKey = (() => {
    const value = taskStatus(task ?? ({} as Task))
    return typeof value === 'object' && value ? (value.key ?? (value as FieldValue & { key_name?: string }).key_name ?? '') : ''
  })()
  const isComplete = statusKey === 'complete'
  const canReviewProof = can('tasks.review_completion')
  const proofPending = proofDetail?.status === 'pending'
  const canSubmitProof = !isArchived && !isComplete && canChangeStatus && !proofPending
  const detailTabs: DetailTab[] = canEmail
    ? ['notes', 'subtasks', 'files', 'emails', 'activity']
    : ['notes', 'subtasks', 'files', 'activity']
  const tabLabels: Record<DetailTab, string> = { notes: 'Notes', subtasks: 'Subtasks', files: 'Files', emails: 'Emails', activity: 'Activity' }
  const ownsRecentNote = (note: Note) => {
    if (isAdmin) return true
    const creator = note.author?.id ?? (typeof note.createdBy === 'object' ? note.createdBy.id : note.createdBy) ?? (typeof note.created_by === 'object' ? note.created_by.id : note.created_by)
    const created = note.createdAt ?? note.created_at
    return String(creator) === String(user?.id) && Boolean(created) && Date.now() - new Date(created!).getTime() <= 86_400_000
  }

  const editFields: FormFieldSpec[] = task ? [
    ...(can('tasks.edit') ? [
      { name: 'title', label: 'Title', required: true, wide: true },
      { name: 'project_id', label: 'Project', type: 'select' as const, required: true, options: lookups.projects.map((project) => ({ label: project.name, value: project.id })), clearOnChange: ['task_folder_id'] },
      { name: 'task_folder_id', label: 'Folder', type: 'select' as const, disabled: editProjectId === '' || (detailFolderCatalog.loading && detailFolders.length === 0), options: detailFolders.map((folder) => ({ label: folder.name, value: folder.id })), help: editProjectId === '' ? 'Choose a project to see its folders.' : detailFolderCatalog.loading && detailFolders.length === 0 ? 'Loading project folders…' : detailFolderCatalog.error ? 'Project folders could not be loaded.' : detailFolders.length ? 'Leave blank to keep the task Ungrouped.' : 'This project has no named folders yet.' },
    ] : []),
    ...(can('tasks.assign') ? [{ name: 'assignee_user_id', label: 'Assignee', type: 'select' as const, options: lookups.users.map((person) => ({ label: displayName(person), value: person.id })) }] : []),
    // Complete is reached by submitting proof, so it is not offered here.
    ...(canChangeStatus && statusOptions.length ? [{
      name: 'status_value_id',
      label: 'Status',
      type: 'select' as const,
      options: statusOptions
        .filter((value) => canReviewProof || (value.key ?? (value as FieldValue & { key_name?: string }).key_name) !== 'complete')
        .map((value) => ({ label: value.label, value: value.id })),
      help: canReviewProof ? undefined : 'Mark this task complete with the Complete task button, which asks for proof.',
    }] : []),
    ...(can('tasks.edit') && typeOptions.length ? [{ name: 'type_value_id', label: 'Type', type: 'select' as const, options: typeOptions.map((value) => ({ label: value.label, value: value.id })) }] : []),
    ...(can('tasks.edit') && urgencyOptions.length ? [{ name: 'urgency_value_id', label: 'Urgency', type: 'select' as const, options: urgencyOptions.map((value) => ({ label: value.label, value: value.id })) }] : []),
    ...(can('tasks.edit') ? [{ name: 'due_date', label: 'Due date', type: 'date' as const }, { name: 'description', label: 'Description', type: 'textarea' as const, wide: true }] : []),
    ...(can('tasks.estimate') ? [{ name: 'estimated_minutes', label: 'Estimated minutes', type: 'number' as const, min: 0 }] : []),
  ] : []

  const subtaskFields: FormFieldSpec[] = editingSubtask ? [
    ...(canManageSubtasks ? [{ name: 'title', label: 'Title', required: true, wide: true }, { name: 'due_date', label: 'Due date', type: 'date' as const }] : []),
    ...(can('tasks.assign') ? [{ name: 'assignee_user_id', label: 'Assignee', type: 'select' as const, options: lookups.users.map((person) => ({ label: displayName(person), value: person.id })) }] : []),
    ...(canChangeStatus && statusOptions.length ? [{ name: 'status_value_id', label: 'Status', type: 'select' as const, options: statusOptions.map((value) => ({ label: value.label, value: value.id })) }] : []),
    ...(can('tasks.estimate') ? [{ name: 'estimated_minutes', label: 'Estimated minutes', type: 'number' as const, min: 0 }] : []),
  ] : []

  if (loading) return <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Clock className="size-4 animate-spin" /> Loading task…</div>
  if (error || !task) return <ErrorBanner message={error || 'Task not found.'} onRetry={() => void load()} />

  const assignmentGranted = isAssignmentGranted(task, user?.id, can, isAdmin)
  const blockedByAssignment = !assignmentGranted
  const myPendingWorkRequest = workRequests.find((request) => request.status === 'pending' && String(request.requester?.id ?? '') === String(user?.id ?? '')) ?? null
  const canReviewWorkRequests = can('tasks.review_work_requests')
  const pendingWorkRequestsForReview = canReviewWorkRequests ? workRequests.filter((request) => request.status === 'pending') : []

  const editInitial: FormPayload = {
    title: task.title,
    project_id: task.projectId ?? task.project_id ?? task.project?.id,
    task_folder_id: taskFolderId(task) ?? '',
    assignee_user_id: task.assignee?.id,
    status_value_id: task.statusValue?.id ?? task.status_value?.id,
    type_value_id: task.typeValue?.id ?? task.type_value?.id,
    urgency_value_id: task.urgencyValue?.id ?? task.urgency_value?.id,
    due_date: dueDate(task) ?? '',
    estimated_minutes: estimated(task),
    description: task.description ?? '',
  }

  const saveTask = async (values: FormPayload) => {
    const okay = await mutate(() => api.patch(`/api/tasks/${task.id}`, { ...values, admin_override: adminOverride ? 1 : undefined }))
    if (okay) setEditOpen(false)
  }

  const addNote = async () => {
    if (!noteBody.trim()) return
    const okay = await mutate(() => api.post(`/api/tasks/${task.id}/notes`, { body: noteBody.trim(), ...(canLogTime ? { time_minutes: noteMinutes || 0 } : {}), assigned_user_id: notifyUserId || undefined, is_message: Boolean(notifyUserId), admin_override: adminOverride ? 1 : undefined }))
    if (okay) { setNoteBody(''); setNoteMinutes(0); setNotifyUserId('') }
  }

  const openNoteEditor = (note: Note) => {
    setEditingNote(note)
    setNoteEditBody(note.body)
    setNoteEditMinutes(Number(note.timeMinutes ?? note.time_minutes ?? 0))
  }

  const saveNote = async () => {
    if (!editingNote || !noteEditBody.trim()) return
    const okay = await mutate(() => api.patch(`/api/tasks/${task.id}/notes/${editingNote.id}`, { body: noteEditBody.trim(), ...(canLogTime ? { time_minutes: noteEditMinutes || 0 } : {}), admin_override: adminOverride ? 1 : undefined }))
    if (okay) setEditingNote(null)
  }

  const deleteNote = async (note: Note) => {
    if (!window.confirm('Delete this note? This cannot be undone.')) return
    await mutate(() => api.delete(`/api/tasks/${task.id}/notes/${note.id}`, { admin_override: adminOverride ? 1 : undefined }))
  }

  const addSubtask = async () => {
    if (!subtaskTitle.trim()) return
    const okay = await mutate(() => api.post(`/api/tasks/${task.id}/subtasks`, { title: subtaskTitle.trim(), admin_override: adminOverride ? 1 : undefined }))
    if (okay) setSubtaskTitle('')
  }

  const completeSubtask = async (subtask: Subtask) => {
    const complete = !(subtask.completedAt ?? subtask.completed_at)
    await mutate(() => api.patch(`/api/tasks/${task.id}/subtasks/${subtask.id}/complete`, { complete, admin_override: adminOverride ? 1 : undefined }))
  }

  const saveSubtask = async (values: FormPayload) => {
    if (!editingSubtask) return
    const okay = await mutate(() => api.patch(`/api/tasks/${task.id}/subtasks/${editingSubtask.id}`, { ...values, admin_override: adminOverride ? 1 : undefined }))
    if (okay) setEditingSubtask(null)
  }

  const deleteSubtask = async (subtask: Subtask) => {
    if (!window.confirm(`Delete “${subtask.title}”?`)) return
    await mutate(() => api.delete(`/api/tasks/${task.id}/subtasks/${subtask.id}`, { admin_override: adminOverride ? 1 : undefined }))
  }

  const moveSubtask = async (subtask: Subtask, direction: -1 | 1) => {
    const index = subtasks.findIndex((item) => String(item.id) === String(subtask.id))
    const adjacent = subtasks[index + direction]
    if (!adjacent) return
    const target = Number(adjacent.sortOrder ?? adjacent.sort_order ?? (index + direction) * 10)
    await mutate(() => api.patch(`/api/tasks/${task.id}/subtasks/${subtask.id}`, { sort_order: target + direction, admin_override: adminOverride ? 1 : undefined }))
  }

  const sendEmail = async () => {
    if (!emailTo.trim() || !emailSubject.trim() || !emailBody.trim()) return
    const okay = await mutate(() => api.post(`/api/tasks/${task.id}/emails`, { to_addresses: emailTo.trim(), subject: emailSubject.trim(), body: emailBody.trim(), admin_override: adminOverride ? 1 : undefined }))
    if (okay) { setEmailTo(''); setEmailSubject(''); setEmailBody('') }
  }

  const deleteEmail = async (email: Note) => {
    if (!window.confirm('Delete this captured email?')) return
    await mutate(() => api.delete(`/api/tasks/${task.id}/emails/${email.id}`, { admin_override: adminOverride ? 1 : undefined }))
  }

  const archiveTask = async () => {
    if (!window.confirm('Archive this task? It will leave active work queues.')) return
    if (!canMutateTasks && !(canAdminOverride && adminOverride)) { setClockBlocked(true); return }
    setBusy(true); setMutationError('')
    try {
      await api.post(`/api/tasks/${task.id}/archive`, { admin_override: adminOverride ? 1 : undefined })
      setClockBlocked(false)
      navigate('/tasks')
    } catch (reason) {
      if (isClockGate(reason)) setClockBlocked(true)
      setMutationError(reason instanceof Error ? reason.message : 'Unable to archive this task.')
    } finally { setBusy(false) }
  }

  const restoreTask = async () => {
    if (!canMutateTasks && !(canAdminOverride && adminOverride)) { setClockBlocked(true); return }
    setBusy(true); setMutationError('')
    try {
      await api.post(`/api/tasks/${task.id}/restore`, { admin_override: adminOverride ? 1 : undefined })
      setClockBlocked(false)
      await load()
    } catch (reason) {
      if (isClockGate(reason)) setClockBlocked(true)
      setMutationError(reason instanceof Error ? reason.message : 'Unable to restore this task.')
    } finally { setBusy(false) }
  }

  const deleteTask = async () => {
    if (!window.confirm('Delete this task? This is intended only for tasks created by mistake.')) return
    if (!canMutateTasks && !(canAdminOverride && adminOverride)) { setClockBlocked(true); return }
    setBusy(true); setMutationError('')
    try {
      await api.delete(`/api/tasks/${task.id}`, { admin_override: adminOverride ? 1 : undefined })
      setClockBlocked(false)
      navigate('/tasks')
    } catch (reason) {
      if (isClockGate(reason)) setClockBlocked(true)
      setMutationError(reason instanceof Error ? reason.message : 'Unable to delete this task.')
    } finally { setBusy(false) }
  }

  const requestMoreTime = async () => {
    if (!estimateReason.trim() || additionalMinutes < 1) return
    const okay = await mutate(() => api.post(`/api/tasks/${task.id}/estimate-requests`, {
      additional_minutes: additionalMinutes,
      reason: estimateReason.trim(),
      admin_override: adminOverride ? 1 : undefined,
    }))
    if (okay) {
      setEstimateRequestOpen(false)
      setEstimateReason('')
      setAdditionalMinutes(30)
    }
  }

  const submitProof = async (summary: string, files: File[]) => {
    if (!canMutateTasks && !(canAdminOverride && adminOverride)) { setClockBlocked(true); return }
    setBusy(true)
    setProofError('')
    try {
      await submitCompletionProof(task.id, summary, files, adminOverride)
      setProofOpen(false)
      await load()
    } catch (reason) {
      if (isClockGate(reason)) setClockBlocked(true)
      setProofError(reason instanceof Error ? reason.message : 'The proof could not be submitted.')
    } finally {
      setBusy(false)
    }
  }

  const settleProof = async (approved: boolean, reason: string) => {
    if (!proof) return
    await mutate(() => settleCompletionProof(task.id, proof.id, approved, reason, adminOverride))
  }

  const submitWorkRequest = async () => {
    const reason = workRequestReason.trim()
    if (reason.length < 10) return
    setWorkRequestBusy(true)
    setWorkRequestError('')
    try {
      await api.post(`/api/tasks/${task.id}/work-requests`, { reason })
      setWorkRequestOpen(false)
      setWorkRequestReason('')
      await load()
    } catch (reason_) {
      setWorkRequestError(reason_ instanceof Error ? reason_.message : 'Unable to send this request.')
    } finally {
      setWorkRequestBusy(false)
    }
  }

  const withdrawWorkRequest = async (request: TaskWorkRequest) => {
    setWorkRequestBusy(true)
    setWorkRequestError('')
    try {
      await api.post(`/api/tasks/${task.id}/work-requests/${request.id}/withdraw`)
      await load()
    } catch (reason) {
      setWorkRequestError(reason instanceof Error ? reason.message : 'Unable to withdraw this request.')
    } finally {
      setWorkRequestBusy(false)
    }
  }

  const approveWorkRequest = async (request: TaskWorkRequest) => {
    setWorkRequestBusy(true)
    setWorkRequestError('')
    try {
      await api.post(`/api/tasks/${task.id}/work-requests/${request.id}/approve`, {})
      await load()
    } catch (reason) {
      setWorkRequestError(reason instanceof Error ? reason.message : 'Unable to approve this request.')
    } finally {
      setWorkRequestBusy(false)
    }
  }

  const declineWorkRequest = async () => {
    if (!decliningWorkRequest || !declineWorkReason.trim()) return
    setWorkRequestBusy(true)
    setWorkRequestError('')
    try {
      await api.post(`/api/tasks/${task.id}/work-requests/${decliningWorkRequest.id}/decline`, { reason: declineWorkReason.trim() })
      setDecliningWorkRequest(null)
      setDeclineWorkReason('')
      await load()
    } catch (reason) {
      setWorkRequestError(reason instanceof Error ? reason.message : 'Unable to decline this request.')
    } finally {
      setWorkRequestBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => navigate('/tasks')}><ArrowLeft /> Back to tasks</Button>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          {task.project?.client?.name && <span>{task.project.client.name}</span>}
          {task.project?.client?.name && <span aria-hidden="true">·</span>}
          {task.project && can('projects.view')
            ? <Link className="hover:underline" to={`/tasks?project_id=${task.project.id}`}>{task.project.name}</Link>
            : <span>{task.project?.name ?? 'No project'}</span>}
          <span aria-hidden="true">·</span>
          <span>{detailFolder?.name ?? 'Ungrouped'}</span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{task.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {canSubmitProof && <Button type="button" disabled={busy || blockedByAssignment} onClick={() => { setProofError(''); setProofOpen(true); setClockBlocked(false) }}><Check /> Complete task</Button>}
            {canEditTaskFields && !isArchived && <Button type="button" variant={canSubmitProof ? 'outline' : 'default'} disabled={blockedByAssignment} onClick={() => { setEditProjectId(detailProjectId ?? ''); setEditOpen(true); setClockBlocked(false) }}><Pencil /> Edit task</Button>}
            {can('tasks.archive') && isArchived && <Button type="button" disabled={busy || blockedByAssignment} onClick={() => void restoreTask()}><Play /> Restore task</Button>}
            {can('tasks.archive') && !isArchived && <Button type="button" variant="outline" disabled={busy || blockedByAssignment} onClick={() => void archiveTask()}>Archive</Button>}
            {can('tasks.archive') && <Button type="button" variant="outline" className="text-destructive hover:text-destructive" disabled={busy || blockedByAssignment} onClick={() => void deleteTask()}><Trash2 /> Delete</Button>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge value={taskStatus(task)} />
          <StatusBadge value={taskUrgency(task)} />
          {isArchived && <Badge variant="outline" className="gap-1"><Inbox className="size-3" /> Archived</Badge>}
          <Badge variant="outline" className="gap-1"><User className="size-3" /> {displayName(task.assignee)}</Badge>
          {dueDate(task) && (
            <Badge variant="outline" className={new Date(dueDate(task)!) < new Date() && !isArchived ? 'gap-1 border-destructive text-destructive' : 'gap-1'}>
              <Calendar className="size-3" /> {new Date(dueDate(task)!).toLocaleDateString()}
            </Badge>
          )}
          {(task.aiTaskGenerationId ?? task.ai_task_generation_id) && <Badge variant="outline" className="gap-1"><Sparkles className="size-3" /> AI batch #{task.aiTaskGenerationId ?? task.ai_task_generation_id}</Badge>}
        </div>
      </header>

      {(clockBlocked || (canWriteTask && !canMutateTasks)) && <ClockGate compact />}
      {mutationError && <ErrorBanner message={mutationError} />}
      {workRequestError && <ErrorBanner message={workRequestError} />}

      {blockedByAssignment && (
        <Card>
          <CardContent>
            {myPendingWorkRequest ? (
              <EmptyState
                icon={User}
                title={myPendingWorkRequest.status === 'pending' ? 'Your request is waiting on a reviewer' : `Your request was ${myPendingWorkRequest.status}`}
                description={myPendingWorkRequest.status === 'pending'
                  ? 'You are not assigned to this task yet. A reviewer will approve or decline your request to work on it.'
                  : (myPendingWorkRequest.decisionReason ?? myPendingWorkRequest.decision_reason) || 'You are not assigned to this task.'}
                action={myPendingWorkRequest.status === 'pending' && (
                  <Button type="button" variant="outline" disabled={workRequestBusy} onClick={() => void withdrawWorkRequest(myPendingWorkRequest)}>Withdraw request</Button>
                )}
              />
            ) : (
              <EmptyState
                icon={User}
                title="You are not assigned to this task"
                description="This task is assigned to someone else. Ask to be put on it before working on it."
                action={can('tasks.request_work') && (
                  <Button type="button" onClick={() => { setWorkRequestError(''); setWorkRequestReason(''); setWorkRequestOpen(true) }}>Request to work on this</Button>
                )}
              />
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        <aside className="space-y-4">
          {canReviewWorkRequests && pendingWorkRequestsForReview.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Work requests</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {pendingWorkRequestsForReview.map((request) => (
                  <div key={request.id} className="space-y-2 rounded-md border p-3">
                    <div>
                      <strong className="flex items-center gap-1.5 text-sm">
                        <Avatar user={request.requester} className="size-5" /> {displayName(request.requester)}
                      </strong>
                      <p className="text-sm text-muted-foreground">{request.reason}</p>
                    </div>
                    {decliningWorkRequest?.id === request.id ? (
                      <div className="space-y-2">
                        <Label htmlFor="decline-work-reason">Why decline?</Label>
                        <Textarea id="decline-work-reason" value={declineWorkReason} disabled={workRequestBusy} onChange={(event) => setDeclineWorkReason(event.target.value)} placeholder="Tell the requester why…" />
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" disabled={workRequestBusy} onClick={() => { setDecliningWorkRequest(null); setDeclineWorkReason('') }}>Cancel</Button>
                          <Button type="button" variant="destructive" size="sm" disabled={workRequestBusy || !declineWorkReason.trim()} onClick={() => void declineWorkRequest()}>Confirm decline</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={workRequestBusy} onClick={() => { setDecliningWorkRequest(request); setDeclineWorkReason('') }}>Decline</Button>
                        <Button type="button" size="sm" disabled={workRequestBusy} onClick={() => void approveWorkRequest(request)}>Approve</Button>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {proof && (
            <Card>
              <CardHeader><CardTitle>Completion proof</CardTitle></CardHeader>
              <CardContent>
                <CompletionProofCard
                  proof={proof}
                  canReview={canReviewProof && !isArchived}
                  busy={busy}
                  onSettle={(approved, reason) => void settleProof(approved, reason)}
                  onResubmit={canSubmitProof ? () => { setProofError(''); setProofOpen(true) } : undefined}
                />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Time</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Progress value={progress} />
                <strong className="text-sm">{estimatedTotal ? `${progress}%` : 'No estimate'}</strong>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-muted-foreground">Estimated</dt><dd><Minutes value={estimatedTotal} /></dd></div>
                <div><dt className="text-muted-foreground">Logged</dt><dd><Minutes value={actualTotal} /></dd></div>
              </dl>
              {(canRequestEstimate || latestEstimateRequest) && (
                <div className="space-y-2 border-t pt-3">
                  {latestEstimateRequest && (
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">Latest request</span>
                        <StatusBadge value={latestEstimateRequest.status} />
                      </div>
                      <strong><Minutes value={latestEstimateRequest.requestedAdditionalMinutes ?? latestEstimateRequest.requested_additional_minutes ?? 0} /> additional</strong>
                      {(latestEstimateRequest.reviewMode ?? latestEstimateRequest.review_mode) === 'ai' && <small className="block text-muted-foreground">AI project manager · {(latestEstimateRequest.aiState ?? latestEstimateRequest.ai_state ?? 'queued').replaceAll('_', ' ')}</small>}
                      {(latestEstimateRequest.conversationId ?? latestEstimateRequest.conversation_id) && <Link className="block text-sm underline" to={`/messages/${latestEstimateRequest.conversationId ?? latestEstimateRequest.conversation_id}?scope=all`}>Open conversation →</Link>}
                    </div>
                  )}
                  {canRequestEstimate && <Button type="button" variant="outline" size="sm" disabled={busy || blockedByAssignment} onClick={() => { setEstimateRequestOpen(true); setClockBlocked(false) }}><Clock /> Request more time</Button>}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Project</dt><dd>{task.project?.name ?? 'No project'}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Folder</dt><dd>{detailFolder?.name ?? 'Ungrouped'}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Type</dt><dd>{fieldLabel(task.typeValue ?? task.type_value ?? task.type)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Assignee</dt><dd className="flex items-center gap-1.5"><Avatar user={task.assignee} className="size-5" /> {displayName(task.assignee)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Due</dt><dd>{dueDate(task) ? new Date(dueDate(task)!).toLocaleDateString() : '—'}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Created by</dt><dd className="flex items-center gap-1.5"><Avatar user={task.creator} className="size-5" /> {displayName(task.creator)}</dd></div>
              </dl>
            </CardContent>
          </Card>
        </aside>

        <div className="min-w-0 space-y-4">
          {task.description && (
            <Card>
              <CardHeader><CardTitle>Brief</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-pretty">{task.description}</p></CardContent>
            </Card>
          )}
          <Card>
            <CardContent>
              <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)}>
                <TabsList>
                  {detailTabs.map((value) => (
                    <TabsTrigger value={value} key={value}>
                      {tabLabels[value]}
                      {value === 'notes' && <Badge variant="secondary" className="ml-1">{noteList.length}</Badge>}
                      {value === 'subtasks' && <Badge variant="secondary" className="ml-1">{subtasks.length}</Badge>}
                      {value === 'files' && <Badge variant="secondary" className="ml-1">{attachments.length}</Badge>}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <TabsContent value="notes" className="pt-4">
                  <NotesTab notes={noteList} body={noteBody} minutes={noteMinutes} notifyUserId={notifyUserId} users={lookups.users} busy={busy || blockedByAssignment} canComment={!isArchived && canComment} canLogTime={canLogTime} canEdit={(note) => !isArchived && canComment && ownsRecentNote(note)} canDelete={(note) => !isArchived && canComment && ownsRecentNote(note) && (Number(note.timeMinutes ?? note.time_minutes ?? 0) === 0 || canLogTime)} onBody={setNoteBody} onMinutes={setNoteMinutes} onNotifyUser={setNotifyUserId} onAdd={() => void addNote()} onEdit={openNoteEditor} onDelete={(note) => void deleteNote(note)} />
                </TabsContent>
                <TabsContent value="subtasks" className="pt-4">
                  <SubtasksTab subtasks={subtasks} title={subtaskTitle} busy={busy || blockedByAssignment} canManage={!isArchived && canManageSubtasks} canComplete={!isArchived && canChangeStatus} canEditAny={!isArchived && (canManageSubtasks || canChangeStatus || can('tasks.assign') || can('tasks.estimate'))} onTitle={setSubtaskTitle} onAdd={() => void addSubtask()} onComplete={(subtask) => void completeSubtask(subtask)} onEdit={setEditingSubtask} onDelete={(subtask) => void deleteSubtask(subtask)} onMove={(subtask, direction) => void moveSubtask(subtask, direction)} />
                </TabsContent>
                <TabsContent value="files" className="pt-4">
                  <TaskAttachments
                    taskId={task.id}
                    attachments={attachments}
                    canManage={can('tasks.attachments')}
                    readOnly={isArchived || blockedByAssignment}
                    adminOverride={adminOverride && canAdminOverride}
                    onChanged={() => load()}
                  />
                </TabsContent>
                {canEmail && (
                  <TabsContent value="emails" className="pt-4">
                    <EmailsTab emails={emails} to={emailTo} subject={emailSubject} body={emailBody} busy={busy || blockedByAssignment} readOnly={isArchived} onTo={setEmailTo} onSubject={setEmailSubject} onBody={setEmailBody} onSend={() => void sendEmail()} onDelete={(email) => void deleteEmail(email)} />
                  </TabsContent>
                )}
                <TabsContent value="activity" className="pt-4">
                  <ActivityList rows={activity} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
      <CompletionProofModal
        open={proofOpen}
        busy={busy}
        error={proofError}
        taskTitle={task.title}
        onClose={() => { if (!busy) setProofOpen(false) }}
        onSubmit={submitProof}
      />
      <Dialog open={editOpen} onOpenChange={(open) => { if (!open) setEditOpen(false) }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Edit task</DialogTitle></DialogHeader>
          {clockBlocked && <ClockGate compact showOverride={false} />}
          <EntityForm fields={editFields} initialValues={editInitial} busy={busy} error={mutationError} onValuesChange={(values) => setEditProjectId((values.project_id ?? '') as EntityId | '')} onCancel={() => setEditOpen(false)} onSubmit={saveTask} />
        </DialogContent>
      </Dialog>
      <Dialog open={estimateRequestOpen} onOpenChange={(open) => { if (!open && !busy) setEstimateRequestOpen(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request more time</DialogTitle>
            <DialogDescription>Ask the project manager to increase this task’s estimate.</DialogDescription>
          </DialogHeader>
          {clockBlocked && <ClockGate compact showOverride={false} />}
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void requestMoreTime() }}>
            {pendingEstimateRequest && (
              <Alert>
                <AlertDescription>Submitting this will replace your pending request for <Minutes value={pendingEstimateRequest.requestedAdditionalMinutes ?? pendingEstimateRequest.requested_additional_minutes ?? 0} />.</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="estimate-request-minutes">Additional minutes needed</Label>
              <Input id="estimate-request-minutes" type="number" min="1" value={additionalMinutes} onChange={(event) => setAdditionalMinutes(Number(event.target.value))} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="estimate-request-reason">Why do you need more time?</Label>
              <Textarea id="estimate-request-reason" value={estimateReason} onChange={(event) => setEstimateReason(event.target.value)} placeholder="Explain what changed or what remains to be done…" required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setEstimateRequestOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || additionalMinutes < 1 || !estimateReason.trim()}>{busy ? 'Sending…' : pendingEstimateRequest ? 'Replace request' : 'Send request'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={workRequestOpen} onOpenChange={(open) => { if (!open && !workRequestBusy) setWorkRequestOpen(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request to work on this task</DialogTitle>
            <DialogDescription>Explain why you should be assigned, then wait for a reviewer to respond.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submitWorkRequest() }}>
            <div className="space-y-1.5">
              <Label htmlFor="work-request-reason">Why do you want this task? <span aria-hidden="true" className="text-destructive">*</span></Label>
              <Textarea id="work-request-reason" value={workRequestReason} disabled={workRequestBusy} onChange={(event) => setWorkRequestReason(event.target.value)} placeholder="At least 10 characters…" required />
              <p className="text-xs text-muted-foreground">Minimum 10 characters.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={workRequestBusy} onClick={() => setWorkRequestOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={workRequestBusy || workRequestReason.trim().length < 10}>{workRequestBusy ? 'Sending…' : 'Send request'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(editingNote)} onOpenChange={(open) => { if (!open) setEditingNote(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit note</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveNote() }}>
            <div className="space-y-1.5">
              <Label htmlFor="note-edit-body">Note</Label>
              <Textarea id="note-edit-body" value={noteEditBody} onChange={(event) => setNoteEditBody(event.target.value)} required />
            </div>
            {canLogTime && (
              <div className="space-y-1.5">
                <Label htmlFor="note-edit-minutes">Time logged</Label>
                <Input id="note-edit-minutes" type="number" min="0" value={noteEditMinutes} onChange={(event) => setNoteEditMinutes(Number(event.target.value))} />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingNote(null)}>Cancel</Button>
              <Button type="submit" disabled={busy || !noteEditBody.trim()}>{busy ? 'Saving…' : 'Save note'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(editingSubtask)} onOpenChange={(open) => { if (!open) setEditingSubtask(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Edit subtask</DialogTitle></DialogHeader>
          {editingSubtask && <EntityForm fields={subtaskFields} initialValues={{ title: editingSubtask.title, due_date: editingSubtask.dueDate ?? editingSubtask.due_date ?? '', assignee_user_id: editingSubtask.assignee?.id, status_value_id: editingSubtask.statusValue?.id ?? editingSubtask.status_value?.id, estimated_minutes: editingSubtask.estimatedMinutes ?? editingSubtask.estimated_minutes ?? 0 }} busy={busy} error={mutationError} onCancel={() => setEditingSubtask(null)} onSubmit={saveSubtask} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function NotesTab({ notes, body, minutes, notifyUserId, users, busy, canComment, canLogTime, canEdit, canDelete, onBody, onMinutes, onNotifyUser, onAdd, onEdit, onDelete }: { notes: Note[]; body: string; minutes: number; notifyUserId: string; users: UserSummary[]; busy: boolean; canComment: boolean; canLogTime: boolean; canEdit: (note: Note) => boolean; canDelete: (note: Note) => boolean; onBody: (value: string) => void; onMinutes: (value: number) => void; onNotifyUser: (value: string) => void; onAdd: () => void; onEdit: (note: Note) => void; onDelete: (note: Note) => void }) {
  return (
    <div className="space-y-4">
      {canComment && (
        <div className="space-y-2 rounded-lg border p-3">
          <Textarea value={body} onChange={(event) => onBody(event.target.value)} placeholder={canLogTime ? 'Share an update or log completed work…' : 'Share an update…'} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {canLogTime && (
                <label className="flex items-center gap-1.5">
                  Time logged
                  <Input type="number" min="0" step="1" className="h-8 w-20" value={minutes} onChange={(event) => onMinutes(Number(event.target.value))} />
                  min
                </label>
              )}
              <label className="flex items-center gap-1.5">
                Notify
                <Select value={notifyUserId || '__unset__'} onValueChange={(next) => onNotifyUser(next === '__unset__' ? '' : next)}>
                  <SelectTrigger aria-label="Notify" size="sm" className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent aria-label="Notify">
                    <SelectItem value="__unset__">No one</SelectItem>
                    {users.map((person) => <SelectItem value={String(person.id)} key={person.id}>{displayName(person)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <Button type="button" size="sm" disabled={busy || !body.trim()} onClick={onAdd}><Send /> Add note</Button>
          </div>
        </div>
      )}
      <NotesList notes={notes} empty="No notes yet." canEdit={canEdit} canDelete={canDelete} onEdit={onEdit} onDelete={onDelete} />
    </div>
  )
}

function NotesList({ notes, empty, canEdit, canDelete, onEdit, onDelete }: { notes: Note[]; empty: string; canEdit: (note: Note) => boolean; canDelete: (note: Note) => boolean; onEdit: (note: Note) => void; onDelete: (note: Note) => void }) {
  if (!notes.length) return <EmptyState title={empty} />
  return (
    <div className="space-y-3">
      {notes.map((note) => (
        <article key={note.id} className="space-y-1.5 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <strong className="flex items-center gap-1.5">
              <Avatar user={note.author ?? (typeof note.createdBy === 'object' ? note.createdBy : undefined)} className="size-6" />
              {displayName(note.author ?? (typeof note.createdBy === 'object' ? note.createdBy : undefined))}
            </strong>
            <time className="text-xs text-muted-foreground">{note.createdAt ?? note.created_at ? new Date((note.createdAt ?? note.created_at)!).toLocaleString() : '—'}</time>
            {Number(note.timeMinutes ?? note.time_minutes ?? 0) > 0 && <Badge variant="outline" className="gap-1"><Clock className="size-3" /><Minutes value={note.timeMinutes ?? note.time_minutes} /></Badge>}
            {(canEdit(note) || canDelete(note)) && (
              <span className="ml-auto flex gap-2">
                {canEdit(note) && <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => onEdit(note)}>Edit</Button>}
                {canDelete(note) && <Button type="button" variant="link" size="sm" className="h-auto p-0 text-destructive" onClick={() => onDelete(note)}>Delete</Button>}
              </span>
            )}
          </div>
          <p className="text-sm text-pretty">{note.body}</p>
          {!!note.attachments?.length && (
            <div className="flex flex-wrap gap-2">
              {note.attachments.map((attachment) => <a className="text-xs underline" href={attachment.url} target="_blank" rel="noreferrer" key={attachment.id}>{attachment.originalName ?? attachment.original_name ?? attachment.name}</a>)}
            </div>
          )}
        </article>
      ))}
    </div>
  )
}

export function SubtasksTab({ subtasks, title, busy, canManage, canComplete, canEditAny, onTitle, onAdd, onComplete, onEdit, onDelete, onMove }: { subtasks: Subtask[]; title: string; busy: boolean; canManage: boolean; canComplete: boolean; canEditAny: boolean; onTitle: (value: string) => void; onAdd: () => void; onComplete: (subtask: Subtask) => void; onEdit: (subtask: Subtask) => void; onDelete: (subtask: Subtask) => void; onMove: (subtask: Subtask, direction: -1 | 1) => void }) {
  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex gap-2">
          <Input value={title} onChange={(event) => onTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (!busy && title.trim()) onAdd() } }} placeholder="Add a subtask…" />
          <Button type="button" disabled={busy || !title.trim()} onClick={onAdd}><Plus /> Add</Button>
        </div>
      )}
      {subtasks.length ? (
        <div className="space-y-2">
          {subtasks.map((subtask, index) => {
            const completed = Boolean(subtask.completedAt ?? subtask.completed_at)
            return (
              <div key={subtask.id} className="flex items-center gap-3 rounded-lg border p-3">
                <Button
                  type="button"
                  variant={completed ? 'default' : 'outline'}
                  size="icon-sm"
                  disabled={busy || !canComplete}
                  onClick={() => onComplete(subtask)}
                  aria-label={`${completed ? 'Reopen' : 'Complete'} ${subtask.title}`}
                  title={canComplete ? completed ? 'Reopen subtask' : 'Complete subtask' : 'Your role cannot change task status'}
                >
                  <Check />
                </Button>
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{subtask.title}</strong>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Avatar user={subtask.assignee} className="size-5" />
                    {displayName(subtask.assignee)}{(subtask.dueDate ?? subtask.due_date) ? ` · Due ${new Date(subtask.dueDate ?? subtask.due_date ?? '').toLocaleDateString()}` : ''}
                  </span>
                </div>
                <StatusBadge value={subtask.statusValue ?? subtask.status_value ?? subtask.status} />
                <span className="text-sm text-muted-foreground"><Minutes value={subtask.actualMinutes ?? subtask.actual_minutes} /></span>
                {(canEditAny || canManage) && (
                  <div className="flex items-center gap-1">
                    {canManage && (
                      <>
                        <Button type="button" variant="ghost" size="icon-sm" disabled={busy || index === 0} aria-label={`Move ${subtask.title} up`} onClick={() => onMove(subtask, -1)}>↑</Button>
                        <Button type="button" variant="ghost" size="icon-sm" disabled={busy || index === subtasks.length - 1} aria-label={`Move ${subtask.title} down`} onClick={() => onMove(subtask, 1)}>↓</Button>
                      </>
                    )}
                    {canEditAny && <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${subtask.title}`} onClick={() => onEdit(subtask)}><Pencil /></Button>}
                    {canManage && <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" aria-label={`Delete ${subtask.title}`} onClick={() => onDelete(subtask)}><Trash2 /></Button>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : <EmptyState title="No subtasks yet" description="Break this task into smaller, assignable steps." />}
    </div>
  )
}

function EmailsTab({ emails, to, subject, body, busy, readOnly, onTo, onSubject, onBody, onSend, onDelete }: { emails: Note[]; to: string; subject: string; body: string; busy: boolean; readOnly: boolean; onTo: (value: string) => void; onSubject: (value: string) => void; onBody: (value: string) => void; onSend: () => void; onDelete: (email: Note) => void }) {
  const rows = emails as Array<Note & { subject?: string; to_addresses?: string; sent_at?: string; status?: string }>
  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input type="email" value={to} onChange={(event) => onTo(event.target.value)} placeholder="To — client@example.com" aria-label="To" />
            <Input value={subject} onChange={(event) => onSubject(event.target.value)} placeholder="Subject" aria-label="Subject" />
          </div>
          <Textarea value={body} onChange={(event) => onBody(event.target.value)} placeholder="Write the email…" aria-label="Message" />
          <div className="flex justify-end">
            <Button type="button" disabled={busy || !to.trim() || !subject.trim() || !body.trim()} onClick={onSend}><Send /> Send email</Button>
          </div>
        </div>
      )}
      {rows.length ? (
        <div className="space-y-3">
          {rows.map((email) => (
            <article key={email.id} className="space-y-1.5 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <strong>{email.subject || 'Task email'}</strong>
                <time className="text-xs text-muted-foreground">{email.sent_at ? new Date(email.sent_at).toLocaleString() : email.createdAt ?? email.created_at ? new Date((email.createdAt ?? email.created_at)!).toLocaleString() : '—'}</time>
                <StatusBadge value={email.status || 'sent'} />
                {!readOnly && <Button type="button" variant="link" size="sm" className="ml-auto h-auto p-0 text-destructive" onClick={() => onDelete(email)}>Delete</Button>}
              </div>
              <p className="text-xs text-muted-foreground">To: {email.to_addresses || 'Recipient hidden'}</p>
              <p className="text-sm text-pretty">{email.body}</p>
            </article>
          ))}
        </div>
      ) : <EmptyState title="No task emails have been captured." />}
    </div>
  )
}

function ActivityList({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <EmptyState title="No activity recorded" description="Task changes will appear here." />
  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={String(row.id ?? index)} className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
          <div>
            <strong className="block text-sm">{String(row.description ?? row.message ?? fieldLabel(row.action) ?? 'Task updated')}</strong>
            <time className="text-xs text-muted-foreground">{row.created_at ? new Date(String(row.created_at)).toLocaleString() : ''}</time>
          </div>
        </div>
      ))}
    </div>
  )
}
