import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useWorkspace } from '../auth/WorkspaceProvider'
import { ClockGate, isClockGate } from '../components/ClockGate'
import { Icon } from '../components/Icon'
import { CompletionProofCard, CompletionProofModal } from '../components/CompletionProof'
import { TaskAttachments } from '../components/TaskAttachments'
import { Select } from '../components/fields'
import { DataTable, EmptyState, EntityForm, ErrorBanner, Minutes, Modal, PageHeader, Pagination, Panel, SearchToolbar, StatusBadge, type Column, type FormFieldSpec } from '../components/ui'
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
  widths: Record<TaskColumnKey, number>
}

const TASK_COLUMN_STORAGE_KEY = 'kernix.task-columns.v1'
const TASK_COLUMN_OPTIONS: Array<{ key: TaskColumnKey; label: string; min: number; max: number }> = [
  { key: 'title', label: 'Task', min: 220, max: 520 },
  { key: 'status', label: 'Status', min: 110, max: 240 },
  { key: 'urgency', label: 'Urgency', min: 100, max: 220 },
  { key: 'assignee', label: 'Assignee', min: 120, max: 300 },
  { key: 'due', label: 'Due date', min: 100, max: 220 },
  { key: 'time', label: 'Logged time', min: 80, max: 180 },
]
const DEFAULT_TASK_COLUMNS: TaskColumnPreferences = {
  visible: { title: true, status: true, urgency: true, assignee: true, due: true, time: true },
  widths: { title: 280, status: 130, urgency: 120, assignee: 150, due: 120, time: 90 },
}

function taskColumnPreferences(): TaskColumnPreferences {
  try {
    const stored = window.localStorage.getItem(TASK_COLUMN_STORAGE_KEY)
    if (!stored) return structuredClone(DEFAULT_TASK_COLUMNS)
    const parsed = JSON.parse(stored) as Partial<TaskColumnPreferences>
    return {
      visible: { ...DEFAULT_TASK_COLUMNS.visible, ...parsed.visible, title: true },
      widths: { ...DEFAULT_TASK_COLUMNS.widths, ...parsed.widths },
    }
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
  columns: Column<Task>[]
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

  const tableColumns = useMemo<Column<Task>[]>(() => canMove && onMoveTask ? [
    ...columns,
    {
      key: 'folder-move',
      header: 'Folder',
      className: 'task-folder-move-cell',
      width: 118,
      minWidth: 104,
      render: (task) => {
        const projectId = taskProjectId(task)
        const currentFolderId = taskFolderId(task)
        const unavailable = foldersLoading || (projectId !== undefined && Boolean(folderErrorsByProject[String(projectId)])) || String(movingTaskId ?? '') === String(task.id)
        return (
          <button
            type="button"
            className="btn btn-quiet task-folder-change"
            aria-label={`Change folder for ${task.title}`}
            disabled={unavailable}
            onClick={(event) => {
              event.stopPropagation()
              setFolderChoice(currentFolderId === null || currentFolderId === undefined ? '' : String(currentFolderId))
              setFolderTask(task)
            }}
          >
            <Icon name="folder" size={14} /> Change
          </button>
        )
      },
    },
  ] : columns, [canMove, columns, folderErrorsByProject, foldersLoading, movingTaskId, onMoveTask])

  const folderTaskProjectId = folderTask ? taskProjectId(folderTask) : undefined
  const folderTaskOptions = (folderTaskProjectId === undefined ? [] : foldersByProject[String(folderTaskProjectId)] ?? []).slice()
  if (folderTask?.folder && !folderTaskOptions.some((folder) => String(folder.id) === String(folderTask.folder?.id))) folderTaskOptions.push(folderTask.folder)
  folderTaskOptions.sort((left, right) => folderSort(left) - folderSort(right) || left.name.localeCompare(right.name))
  const currentFolderChoice = folderTask ? String(taskFolderId(folderTask) ?? '') : ''
  const moveDialog = (
    <Modal
      open={Boolean(folderTask)}
      onClose={() => setFolderTask(null)}
      title="Change folder"
      description={folderTask ? `Choose where “${folderTask.title}” belongs.` : undefined}
      size="sm"
      className="task-folder-dialog"
    >
      <form
        className="entity-form task-folder-dialog-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!folderTask || folderChoice === currentFolderChoice) return
          onMoveTask?.(folderTask, folderChoice || null)
          setFolderTask(null)
        }}
      >
        <div className="form-grid">
          <label className="form-field wide">
            <span className="field-label">Folder</span>
            <select aria-label="Folder destination" value={folderChoice} onChange={(event) => setFolderChoice(event.target.value)}>
              <option value="">Ungrouped</option>
              {folderTaskOptions.map((folder) => <option value={String(folder.id)} key={folder.id}>{folder.name}</option>)}
            </select>
          </label>
        </div>
        <footer className="form-footer">
          <button type="button" className="btn btn-quiet" onClick={() => setFolderTask(null)}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!folderTask || folderChoice === currentFolderChoice}>Move task</button>
        </footer>
      </form>
    </Modal>
  )

  return (
    <>
      <DataTable
        columns={tableColumns}
        data={tasks}
        rowKey={(task) => task.id}
        loading={loading}
        emptyTitle="No tasks match this view"
        emptyDescription="Try changing a filter or create the next piece of work."
        onRowClick={onTaskClick}
      />
      {moveDialog}
    </>
  )
}

export function TasksPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const search = params.get('search') ?? ''
  const [page, setPage] = useState(1)
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
    page,
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
    setPage(1)
  }

  const columnRenderers: Record<TaskColumnKey, (task: Task) => React.ReactNode> = {
    title: (task) => {
      const projectName = task.project?.name ?? 'No project'
      const clientName = task.project?.client?.name
      return <div className="primary-cell"><strong>{task.title}</strong><span>{[projectName, clientName && clientName !== projectName ? clientName : null].filter(Boolean).join(' · ')}</span></div>
    },
    status: (task) => <StatusBadge value={taskStatus(task)} />,
    urgency: (task) => <StatusBadge value={taskUrgency(task)} />,
    assignee: (task) => <span>{displayName(task.assignee)}</span>,
    due: (task) => dueDate(task) ? <time className={new Date(dueDate(task)!) < new Date() ? 'overdue' : ''}>{new Date(dueDate(task)!).toLocaleDateString()}</time> : '—',
    time: (task) => <Minutes value={actual(task)} />,
  }
  const columns: Column<Task>[] = TASK_COLUMN_OPTIONS
    .filter((column) => columnPreferences.visible[column.key])
    .map((column) => ({
      key: column.key,
      header: column.label,
      render: columnRenderers[column.key],
      width: columnPreferences.widths[column.key],
      minWidth: column.min,
      className: column.key === 'time' ? 'numeric-cell' : undefined,
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
    <div className="page-fixed">
      <PageHeader
        eyebrow="Work queue"
        title="Tasks"
        description={projectId ? `${meta.total} tasks in ${selectedProject?.name ?? 'the selected project'}.` : `${meta.total} tasks across your visible projects.`}
        actions={<>{projectId && can('projects.edit') && (
          <details className="task-folder-settings">
            <summary className="btn btn-quiet"><Icon name="folder" size={16} /> Folders</summary>
            <div className="task-folder-menu">
              <header><div><strong>Project folders</strong><span>{selectedProject?.name ?? 'Selected project'}</span></div><button type="button" className="btn btn-primary" aria-label="New folder" disabled={folderBusy} onClick={openNewFolder}><Icon name="plus" size={14} /> New</button></header>
              <div className="task-folder-menu-list">
                {selectedProjectFolders.length ? selectedProjectFolders.map((folder) => (
                  <div key={folder.id}>
                    <span><Icon name="folder" size={15} /> {folder.name}</span>
                    <div>
                      <button type="button" className="icon-button" aria-label={`Rename ${folder.name}`} onClick={() => openRenameFolder(folder)}><Icon name="edit" size={14} /></button>
                      <button type="button" className="icon-button danger" aria-label={`Delete ${folder.name}`} onClick={() => void deleteFolder(folder)}><Icon name="trash" size={14} /></button>
                    </div>
                  </div>
                )) : <p>No folders yet.</p>}
              </div>
            </div>
          </details>
        )}{can('tasks.create_with_ai') && <button className="btn btn-quiet" onClick={() => setAiCreateOpen(true)}><Icon name="sparkles" size={16} /> Create with AI</button>}{can('tasks.create') && <button className="btn btn-primary" onClick={openTaskCreator}><Icon name="plus" size={16} /> New task</button>}</>}
      />
      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {folderCatalog.error && <ErrorBanner message={folderCatalog.error} onRetry={() => void folderCatalog.reload()} />}
      {folderActionError && !folderOpen && <ErrorBanner message={folderActionError} />}
      {clockBlocked && !createOpen && <ClockGate compact />}
      <Panel className="list-panel">
        <SearchToolbar search={search} onSearch={(value) => setFilter('search', value || undefined)} placeholder="Search task title or project…">
          <div className="filter-segment">
            <label className={`filter-chip ${mine ? 'active' : ''}`}><input type="checkbox" checked={mine} onChange={(event) => setFilter('mine', event.target.checked ? '1' : undefined)} />Mine</label>
            <label className={`filter-chip ${urgent ? 'active' : ''}`}><input type="checkbox" checked={urgent} onChange={(event) => setFilter('urgent', event.target.checked ? '1' : undefined)} />Urgent</label>
            <label className={`filter-chip ${archived ? 'active' : ''}`}><input type="checkbox" checked={archived} onChange={(event) => setFilter('archived', event.target.checked ? '1' : undefined)} />Archived</label>
          </div>
          <Select
            className={`filter-select ${projectId ? 'has-value' : ''}`.trim()}
            icon="briefcase"
            label="Project filter"
            value={projectId}
            options={[{ value: '', label: 'All projects' }, ...lookups.projects.map((project) => ({ value: String(project.id), label: project.name }))]}
            placeholder="All projects"
            onChange={(next) => setFilter('project_id', next || undefined)}
          />
          <Select
            className="filter-select"
            icon="field"
            label="Sort tasks"
            value={sort}
            options={[
              { value: 'due_date', label: 'Due date' },
              { value: '-created_at', label: 'Newest' },
              { value: 'urgency', label: 'Urgency' },
              { value: 'title', label: 'Title' },
            ]}
            onChange={(next) => setFilter('sort', next === 'due_date' ? undefined : next)}
          />
          <details className="task-column-settings">
            <summary className="btn btn-quiet"><Icon name="field" size={15} /> Columns</summary>
            <div className="task-column-menu">
              <header><strong>Table columns</strong><span>Choose what appears and how wide it is.</span></header>
              {TASK_COLUMN_OPTIONS.map((column) => (
                <div className="task-column-option" key={column.key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={columnPreferences.visible[column.key]}
                      disabled={column.key === 'title'}
                      onChange={(event) => setColumnPreferences((current) => ({
                        ...current,
                        visible: { ...current.visible, [column.key]: event.target.checked },
                      }))}
                    />
                    <span>{column.label}</span>
                  </label>
                  <input
                    type="range"
                    aria-label={`${column.label} column width`}
                    min={column.min}
                    max={column.max}
                    step={10}
                    value={columnPreferences.widths[column.key]}
                    onChange={(event) => setColumnPreferences((current) => ({
                      ...current,
                      widths: { ...current.widths, [column.key]: Number(event.target.value) },
                    }))}
                  />
                  <output>{columnPreferences.widths[column.key]}px</output>
                </div>
              ))}
              <button type="button" className="text-link" onClick={() => setColumnPreferences(structuredClone(DEFAULT_TASK_COLUMNS))}>Reset columns</button>
            </div>
          </details>
        </SearchToolbar>
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
        <Pagination meta={meta} onPage={setPage} />
      </Panel>
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
      <Modal open={folderOpen} onClose={() => { if (!folderBusy) { setFolderOpen(false); setEditingFolder(null) } }} title={editingFolder ? 'Rename folder' : 'Create a folder'} description="Folders organize tasks inside this project." closeDisabled={folderBusy}>
        <EntityForm key={`${editingFolder?.id ?? 'new'}-${folderOpen}`} fields={[{ name: 'name', label: 'Folder name', required: true, wide: true, placeholder: 'For example, Pre-production' }]} initialValues={editingFolder ? { name: editingFolder.name } : undefined} busy={folderBusy} error={folderActionError} submitLabel={editingFolder ? 'Save folder' : 'Create folder'} onCancel={() => { setFolderOpen(false); setEditingFolder(null) }} onSubmit={saveFolder} />
      </Modal>
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

  if (loading) return <div className="full-page-loading"><span className="spinner" /> Loading task…</div>
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
    <div className="task-detail-page">
      <button className="back-link" onClick={() => navigate('/tasks')}><Icon name="arrow-left" size={17} /> Back to tasks</button>
      <header className="task-hero">
        <div className="task-breadcrumb">
          {task.project?.client?.name && <span>{task.project.client.name}</span>}
          {task.project && can('projects.view')
            ? <Link to={`/tasks?project_id=${task.project.id}`}>{task.project.name}</Link>
            : <span>{task.project?.name ?? 'No project'}</span>}
          <span>{detailFolder?.name ?? 'Ungrouped'}</span>
        </div>
        <div className="task-hero-top">
          <h1>{task.title}</h1>
          <div className="page-actions">
            {canSubmitProof && <button className="btn btn-primary" disabled={busy || blockedByAssignment} onClick={() => { setProofError(''); setProofOpen(true); setClockBlocked(false) }}><Icon name="check" size={16} /> Complete task</button>}
            {canEditTaskFields && !isArchived && <button className={`btn ${canSubmitProof ? 'btn-quiet' : 'btn-primary'}`} disabled={blockedByAssignment} onClick={() => { setEditProjectId(detailProjectId ?? ''); setEditOpen(true); setClockBlocked(false) }}><Icon name="edit" size={16} /> Edit task</button>}
            {can('tasks.archive') && isArchived && <button className="btn btn-primary" disabled={busy || blockedByAssignment} onClick={() => void restoreTask()}><Icon name="play" size={16} /> Restore task</button>}
            {can('tasks.archive') && !isArchived && <button className="btn btn-quiet" disabled={busy || blockedByAssignment} onClick={() => void archiveTask()}>Archive</button>}
            {can('tasks.archive') && <button className="btn btn-danger-quiet" disabled={busy || blockedByAssignment} onClick={() => void deleteTask()}><Icon name="trash" size={16} /> Delete</button>}
          </div>
        </div>
        <div className="task-hero-chips">
          <StatusBadge value={taskStatus(task)} />
          <StatusBadge value={taskUrgency(task)} />
          {isArchived && <span className="task-chip is-warning"><Icon name="inbox" size={13} /> Archived</span>}
          <span className="task-chip"><Icon name="user" size={13} /> {displayName(task.assignee)}</span>
          {dueDate(task) && <span className={`task-chip ${new Date(dueDate(task)!) < new Date() && !isArchived ? 'is-danger' : ''}`.trim()}><Icon name="calendar" size={13} /> {new Date(dueDate(task)!).toLocaleDateString()}</span>}
          {(task.aiTaskGenerationId ?? task.ai_task_generation_id) && <span className="task-chip ai-generated-badge"><Icon name="sparkles" size={13} /> AI batch #{task.aiTaskGenerationId ?? task.ai_task_generation_id}</span>}
        </div>
      </header>

      {(clockBlocked || (canWriteTask && !canMutateTasks)) && <ClockGate compact />}
      {mutationError && <ErrorBanner message={mutationError} />}
      {workRequestError && <ErrorBanner message={workRequestError} />}

      {blockedByAssignment && (
        <section className="panel assignment-gate">
          {myPendingWorkRequest ? (
            <EmptyState
              icon="user"
              title={myPendingWorkRequest.status === 'pending' ? 'Your request is waiting on a reviewer' : `Your request was ${myPendingWorkRequest.status}`}
              description={myPendingWorkRequest.status === 'pending'
                ? 'You are not assigned to this task yet. A reviewer will approve or decline your request to work on it.'
                : (myPendingWorkRequest.decisionReason ?? myPendingWorkRequest.decision_reason) || 'You are not assigned to this task.'}
              action={myPendingWorkRequest.status === 'pending' && (
                <button type="button" className="btn btn-quiet" disabled={workRequestBusy} onClick={() => void withdrawWorkRequest(myPendingWorkRequest)}>Withdraw request</button>
              )}
            />
          ) : (
            <EmptyState
              icon="user"
              title="You are not assigned to this task"
              description="This task is assigned to someone else. Ask to be put on it before working on it."
              action={can('tasks.request_work') && (
                <button type="button" className="btn btn-primary" onClick={() => { setWorkRequestError(''); setWorkRequestReason(''); setWorkRequestOpen(true) }}>Request to work on this</button>
              )}
            />
          )}
        </section>
      )}

      <div className="task-detail-grid">
        <aside className="task-side">
          {canReviewWorkRequests && pendingWorkRequestsForReview.length > 0 && (
            <section className="task-side-card work-request-review">
              <h2>Work requests</h2>
              {pendingWorkRequestsForReview.map((request) => (
                <div className="work-request-row" key={request.id}>
                  <div>
                    <strong>{displayName(request.requester)}</strong>
                    <p>{request.reason}</p>
                  </div>
                  {decliningWorkRequest?.id === request.id ? (
                    <div>
                      <label className="form-field wide">
                        <span className="field-label">Why decline?</span>
                        <textarea value={declineWorkReason} disabled={workRequestBusy} onChange={(event) => setDeclineWorkReason(event.target.value)} placeholder="Tell the requester why…" />
                      </label>
                      <div className="proof-review-actions">
                        <button type="button" className="btn btn-quiet" disabled={workRequestBusy} onClick={() => { setDecliningWorkRequest(null); setDeclineWorkReason('') }}>Cancel</button>
                        <button type="button" className="btn btn-danger-quiet" disabled={workRequestBusy || !declineWorkReason.trim()} onClick={() => void declineWorkRequest()}>Confirm decline</button>
                      </div>
                    </div>
                  ) : (
                    <div className="proof-review-actions">
                      <button type="button" className="btn btn-quiet" disabled={workRequestBusy} onClick={() => { setDecliningWorkRequest(request); setDeclineWorkReason('') }}>Decline</button>
                      <button type="button" className="btn btn-primary" disabled={workRequestBusy} onClick={() => void approveWorkRequest(request)}>Approve</button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}
          {proof && (
            <section className="task-side-card">
              <h2>Completion proof</h2>
              <CompletionProofCard
                proof={proof}
                canReview={canReviewProof && !isArchived}
                busy={busy}
                onSettle={(approved, reason) => void settleProof(approved, reason)}
                onResubmit={canSubmitProof ? () => { setProofError(''); setProofOpen(true) } : undefined}
              />
            </section>
          )}
          <section className="task-side-card">
            <h2>Time</h2>
            <div className="task-progress-meter">
              <div className="time-progress"><span style={{ width: `${progress}%` }} /></div>
              <strong>{estimatedTotal ? `${progress}%` : 'No estimate'}</strong>
            </div>
            <dl className="task-facts">
              <div><dt>Estimated</dt><dd><Minutes value={estimatedTotal} /></dd></div>
              <div><dt>Logged</dt><dd><Minutes value={actualTotal} /></dd></div>
            </dl>
            {(canRequestEstimate || latestEstimateRequest) && (
              <div className="task-side-extra">
                {latestEstimateRequest && (
                  <div className="task-estimate-request-summary">
                    <div>
                      <span className="eyebrow">Latest request</span>
                      <strong><Minutes value={latestEstimateRequest.requestedAdditionalMinutes ?? latestEstimateRequest.requested_additional_minutes ?? 0} /> additional</strong>
                      {(latestEstimateRequest.reviewMode ?? latestEstimateRequest.review_mode) === 'ai' && <small>AI project manager · {(latestEstimateRequest.aiState ?? latestEstimateRequest.ai_state ?? 'queued').replaceAll('_', ' ')}</small>}
                    </div>
                    <StatusBadge value={latestEstimateRequest.status} />
                    {(latestEstimateRequest.conversationId ?? latestEstimateRequest.conversation_id) && <Link className="text-link" to={`/messages/${latestEstimateRequest.conversationId ?? latestEstimateRequest.conversation_id}?scope=all`}>Open conversation →</Link>}
                  </div>
                )}
                {canRequestEstimate && <button className="btn btn-quiet" disabled={busy || blockedByAssignment} onClick={() => { setEstimateRequestOpen(true); setClockBlocked(false) }}><Icon name="clock" size={16} /> Request more time</button>}
              </div>
            )}
          </section>

          <section className="task-side-card">
            <h2>Details</h2>
            <dl className="task-facts">
              <div><dt>Project</dt><dd>{task.project?.name ?? 'No project'}</dd></div>
              <div><dt>Folder</dt><dd>{detailFolder?.name ?? 'Ungrouped'}</dd></div>
              <div><dt>Type</dt><dd>{fieldLabel(task.typeValue ?? task.type_value ?? task.type)}</dd></div>
              <div><dt>Assignee</dt><dd>{displayName(task.assignee)}</dd></div>
              <div><dt>Due</dt><dd>{dueDate(task) ? new Date(dueDate(task)!).toLocaleDateString() : '—'}</dd></div>
              <div><dt>Created by</dt><dd>{displayName(task.creator)}</dd></div>
            </dl>
          </section>
        </aside>

        <div className="task-main">
          {task.description && (
            <section className="task-brief panel">
              <h2>Brief</h2>
              <div className="prose">{task.description}</div>
            </section>
          )}
          <section className="task-workspace panel">
            <div className="detail-tabs">
              {detailTabs.map((value) => <button className={tab === value ? 'active' : ''} onClick={() => setTab(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}{value === 'notes' ? <b>{noteList.length}</b> : value === 'subtasks' ? <b>{subtasks.length}</b> : value === 'files' ? <b>{attachments.length}</b> : null}</button>)}
            </div>
            <div className="tab-content">
              {tab === 'notes' && <NotesTab notes={noteList} body={noteBody} minutes={noteMinutes} notifyUserId={notifyUserId} users={lookups.users} busy={busy || blockedByAssignment} canComment={!isArchived && canComment} canLogTime={canLogTime} canEdit={(note) => !isArchived && canComment && ownsRecentNote(note)} canDelete={(note) => !isArchived && canComment && ownsRecentNote(note) && (Number(note.timeMinutes ?? note.time_minutes ?? 0) === 0 || canLogTime)} onBody={setNoteBody} onMinutes={setNoteMinutes} onNotifyUser={setNotifyUserId} onAdd={() => void addNote()} onEdit={openNoteEditor} onDelete={(note) => void deleteNote(note)} />}
              {tab === 'subtasks' && <SubtasksTab subtasks={subtasks} title={subtaskTitle} busy={busy || blockedByAssignment} canManage={!isArchived && canManageSubtasks} canComplete={!isArchived && canChangeStatus} canEditAny={!isArchived && (canManageSubtasks || canChangeStatus || can('tasks.assign') || can('tasks.estimate'))} onTitle={setSubtaskTitle} onAdd={() => void addSubtask()} onComplete={(subtask) => void completeSubtask(subtask)} onEdit={setEditingSubtask} onDelete={(subtask) => void deleteSubtask(subtask)} onMove={(subtask, direction) => void moveSubtask(subtask, direction)} />}
              {tab === 'files' && (
                <TaskAttachments
                  taskId={task.id}
                  attachments={attachments}
                  canManage={can('tasks.attachments')}
                  readOnly={isArchived || blockedByAssignment}
                  adminOverride={adminOverride && canAdminOverride}
                  onChanged={() => load()}
                />
              )}
              {tab === 'emails' && canEmail && <EmailsTab emails={emails} to={emailTo} subject={emailSubject} body={emailBody} busy={busy || blockedByAssignment} readOnly={isArchived} onTo={setEmailTo} onSubject={setEmailSubject} onBody={setEmailBody} onSend={() => void sendEmail()} onDelete={(email) => void deleteEmail(email)} />}
              {tab === 'activity' && <ActivityList rows={activity} />}
            </div>
          </section>
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
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit task" size="lg">
        {clockBlocked && <ClockGate compact showOverride={false} />}
        <EntityForm fields={editFields} initialValues={editInitial} busy={busy} error={mutationError} onValuesChange={(values) => setEditProjectId((values.project_id ?? '') as EntityId | '')} onCancel={() => setEditOpen(false)} onSubmit={saveTask} />
      </Modal>
      <Modal open={estimateRequestOpen} onClose={() => { if (!busy) setEstimateRequestOpen(false) }} title="Request more time" description="Ask the project manager to increase this task’s estimate." size="md" closeDisabled={busy}>
        {clockBlocked && <ClockGate compact showOverride={false} />}
        <form className="entity-form" onSubmit={(event) => { event.preventDefault(); void requestMoreTime() }}>
          {pendingEstimateRequest && <div className="warning-banner">Submitting this will replace your pending request for <Minutes value={pendingEstimateRequest.requestedAdditionalMinutes ?? pendingEstimateRequest.requested_additional_minutes ?? 0} />.</div>}
          <div className="form-grid">
            <label className="form-field"><span className="field-label">Additional minutes needed</span><input type="number" min="1" value={additionalMinutes} onChange={(event) => setAdditionalMinutes(Number(event.target.value))} required /></label>
            <label className="form-field wide"><span className="field-label">Why do you need more time?</span><textarea value={estimateReason} onChange={(event) => setEstimateReason(event.target.value)} placeholder="Explain what changed or what remains to be done…" required /></label>
          </div>
          <footer className="form-footer"><button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setEstimateRequestOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy || additionalMinutes < 1 || !estimateReason.trim()}>{busy ? 'Sending…' : pendingEstimateRequest ? 'Replace request' : 'Send request'}</button></footer>
        </form>
      </Modal>
      <Modal open={workRequestOpen} onClose={() => { if (!workRequestBusy) setWorkRequestOpen(false) }} title="Request to work on this task" description="Explain why you should be assigned, then wait for a reviewer to respond." size="md" closeDisabled={workRequestBusy}>
        <form className="entity-form" onSubmit={(event) => { event.preventDefault(); void submitWorkRequest() }}>
          <div className="form-grid">
            <label className="form-field wide">
              <span className="field-label">Why do you want this task? <b aria-hidden="true">*</b></span>
              <textarea value={workRequestReason} disabled={workRequestBusy} onChange={(event) => setWorkRequestReason(event.target.value)} placeholder="At least 10 characters…" required />
              <span className="field-help">Minimum 10 characters.</span>
            </label>
          </div>
          <footer className="form-footer"><button type="button" className="btn btn-quiet" disabled={workRequestBusy} onClick={() => setWorkRequestOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={workRequestBusy || workRequestReason.trim().length < 10}>{workRequestBusy ? 'Sending…' : 'Send request'}</button></footer>
        </form>
      </Modal>
      <Modal open={Boolean(editingNote)} onClose={() => setEditingNote(null)} title="Edit note" size="md">
        <form className="entity-form" onSubmit={(event) => { event.preventDefault(); void saveNote() }}><div className="form-grid"><label className="form-field wide"><span className="field-label">Note</span><textarea value={noteEditBody} onChange={(event) => setNoteEditBody(event.target.value)} required /></label>{canLogTime && <label className="form-field"><span className="field-label">Time logged</span><input type="number" min="0" value={noteEditMinutes} onChange={(event) => setNoteEditMinutes(Number(event.target.value))} /></label>}</div><footer className="form-footer"><button type="button" className="btn btn-quiet" onClick={() => setEditingNote(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || !noteEditBody.trim()}>{busy ? 'Saving…' : 'Save note'}</button></footer></form>
      </Modal>
      <Modal open={Boolean(editingSubtask)} onClose={() => setEditingSubtask(null)} title="Edit subtask" size="md">
        {editingSubtask && <EntityForm fields={subtaskFields} initialValues={{ title: editingSubtask.title, due_date: editingSubtask.dueDate ?? editingSubtask.due_date ?? '', assignee_user_id: editingSubtask.assignee?.id, status_value_id: editingSubtask.statusValue?.id ?? editingSubtask.status_value?.id, estimated_minutes: editingSubtask.estimatedMinutes ?? editingSubtask.estimated_minutes ?? 0 }} busy={busy} error={mutationError} onCancel={() => setEditingSubtask(null)} onSubmit={saveSubtask} />}
      </Modal>
    </div>
  )
}

export function NotesTab({ notes, body, minutes, notifyUserId, users, busy, canComment, canLogTime, canEdit, canDelete, onBody, onMinutes, onNotifyUser, onAdd, onEdit, onDelete }: { notes: Note[]; body: string; minutes: number; notifyUserId: string; users: UserSummary[]; busy: boolean; canComment: boolean; canLogTime: boolean; canEdit: (note: Note) => boolean; canDelete: (note: Note) => boolean; onBody: (value: string) => void; onMinutes: (value: number) => void; onNotifyUser: (value: string) => void; onAdd: () => void; onEdit: (note: Note) => void; onDelete: (note: Note) => void }) {
  return <div>{canComment && <div className="note-composer"><textarea value={body} onChange={(event) => onBody(event.target.value)} placeholder={canLogTime ? 'Share an update or log completed work…' : 'Share an update…'} /><div className="note-controls">{canLogTime && <label>Time logged <input type="number" min="0" step="1" value={minutes} onChange={(event) => onMinutes(Number(event.target.value))} /> min</label>}<label>Notify <select value={notifyUserId} onChange={(event) => onNotifyUser(event.target.value)}><option value="">No one</option>{users.map((person) => <option value={person.id} key={person.id}>{displayName(person)}</option>)}</select></label><button className="btn btn-primary" disabled={busy || !body.trim()} onClick={onAdd}><Icon name="send" size={15} /> Add note</button></div></div>}<NotesList notes={notes} empty="No notes yet." canEdit={canEdit} canDelete={canDelete} onEdit={onEdit} onDelete={onDelete} /></div>
}

function NotesList({ notes, empty, canEdit, canDelete, onEdit, onDelete }: { notes: Note[]; empty: string; canEdit: (note: Note) => boolean; canDelete: (note: Note) => boolean; onEdit: (note: Note) => void; onDelete: (note: Note) => void }) {
  if (!notes.length) return <EmptyState title={empty} />
  return <div className="notes-list">{notes.map((note) => <article key={note.id}><div className="note-meta"><strong>{displayName(note.author ?? (typeof note.createdBy === 'object' ? note.createdBy : undefined))}</strong><time>{note.createdAt ?? note.created_at ? new Date((note.createdAt ?? note.created_at)!).toLocaleString() : '—'}</time>{Number(note.timeMinutes ?? note.time_minutes ?? 0) > 0 && <span><Icon name="clock" size={13} /><Minutes value={note.timeMinutes ?? note.time_minutes} /></span>}{(canEdit(note) || canDelete(note)) && <span className="note-actions">{canEdit(note) && <button className="text-link" onClick={() => onEdit(note)}>Edit</button>}{canDelete(note) && <button className="text-link danger-text" onClick={() => onDelete(note)}>Delete</button>}</span>}</div><div className="note-body">{note.body}</div>{!!note.attachments?.length && <div className="attachment-row">{note.attachments.map((attachment) => <a href={attachment.url} target="_blank" rel="noreferrer" key={attachment.id}>{attachment.originalName ?? attachment.original_name ?? attachment.name}</a>)}</div>}</article>)}</div>
}

export function SubtasksTab({ subtasks, title, busy, canManage, canComplete, canEditAny, onTitle, onAdd, onComplete, onEdit, onDelete, onMove }: { subtasks: Subtask[]; title: string; busy: boolean; canManage: boolean; canComplete: boolean; canEditAny: boolean; onTitle: (value: string) => void; onAdd: () => void; onComplete: (subtask: Subtask) => void; onEdit: (subtask: Subtask) => void; onDelete: (subtask: Subtask) => void; onMove: (subtask: Subtask, direction: -1 | 1) => void }) {
  return <div>{canManage && <div className="quick-add"><input value={title} onChange={(event) => onTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (!busy && title.trim()) onAdd() } }} placeholder="Add a subtask…" /><button type="button" className="btn btn-primary" disabled={busy || !title.trim()} onClick={onAdd}><Icon name="plus" size={15} /> Add</button></div>}{subtasks.length ? <div className="subtask-list">{subtasks.map((subtask, index) => { const completed = Boolean(subtask.completedAt ?? subtask.completed_at); return <div key={subtask.id}><button className={`subtask-check ${completed ? 'completed' : ''}`} disabled={busy || !canComplete} onClick={() => onComplete(subtask)} aria-label={`${completed ? 'Reopen' : 'Complete'} ${subtask.title}`} title={canComplete ? completed ? 'Reopen subtask' : 'Complete subtask' : 'Your role cannot change task status'}><Icon name="check" size={14} /></button><div><strong>{subtask.title}</strong><span>{displayName(subtask.assignee)}{(subtask.dueDate ?? subtask.due_date) ? ` · Due ${new Date(subtask.dueDate ?? subtask.due_date ?? '').toLocaleDateString()}` : ''}</span></div><StatusBadge value={subtask.statusValue ?? subtask.status_value ?? subtask.status} /><span><Minutes value={subtask.actualMinutes ?? subtask.actual_minutes} /></span>{(canEditAny || canManage) && <div className="subtask-actions">{canManage && <><button className="icon-button" disabled={busy || index === 0} aria-label={`Move ${subtask.title} up`} onClick={() => onMove(subtask, -1)}>↑</button><button className="icon-button" disabled={busy || index === subtasks.length - 1} aria-label={`Move ${subtask.title} down`} onClick={() => onMove(subtask, 1)}>↓</button></>}{canEditAny && <button className="icon-button" aria-label={`Edit ${subtask.title}`} onClick={() => onEdit(subtask)}><Icon name="edit" size={14} /></button>}{canManage && <button className="icon-button danger" aria-label={`Delete ${subtask.title}`} onClick={() => onDelete(subtask)}><Icon name="trash" size={14} /></button>}</div>}</div> })}</div> : <EmptyState title="No subtasks yet" description="Break this task into smaller, assignable steps." />}</div>
}

function EmailsTab({ emails, to, subject, body, busy, readOnly, onTo, onSubject, onBody, onSend, onDelete }: { emails: Note[]; to: string; subject: string; body: string; busy: boolean; readOnly: boolean; onTo: (value: string) => void; onSubject: (value: string) => void; onBody: (value: string) => void; onSend: () => void; onDelete: (email: Note) => void }) {
  const rows = emails as Array<Note & { subject?: string; to_addresses?: string; sent_at?: string; status?: string }>
  return <div>{!readOnly && <div className="email-composer"><div className="email-line"><span>To</span><input type="email" value={to} onChange={(event) => onTo(event.target.value)} placeholder="client@example.com" /></div><div className="email-line"><span>Subject</span><input value={subject} onChange={(event) => onSubject(event.target.value)} placeholder="Production update" /></div><textarea value={body} onChange={(event) => onBody(event.target.value)} placeholder="Write the email…" /><footer><button className="btn btn-primary" disabled={busy || !to.trim() || !subject.trim() || !body.trim()} onClick={onSend}><Icon name="send" size={15} /> Send email</button></footer></div>}{rows.length ? <div className="notes-list email-list">{rows.map((email) => <article key={email.id}><div className="note-meta"><strong>{email.subject || 'Task email'}</strong><time>{email.sent_at ? new Date(email.sent_at).toLocaleString() : email.createdAt ?? email.created_at ? new Date((email.createdAt ?? email.created_at)!).toLocaleString() : '—'}</time><StatusBadge value={email.status || 'sent'} />{!readOnly && <button className="text-link danger-text" onClick={() => onDelete(email)}>Delete</button>}</div><span className="email-to">To: {email.to_addresses || 'Recipient hidden'}</span><div className="note-body">{email.body}</div></article>)}</div> : <EmptyState title="No task emails have been captured." />}</div>
}

function ActivityList({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <EmptyState title="No activity recorded" description="Task changes will appear here." />
  return <div className="activity-timeline">{rows.map((row, index) => <div key={String(row.id ?? index)}><span /><div><strong>{String(row.description ?? row.message ?? fieldLabel(row.action) ?? 'Task updated')}</strong><time>{row.created_at ? new Date(String(row.created_at)).toLocaleString() : ''}</time></div></div>)}</div>
}
