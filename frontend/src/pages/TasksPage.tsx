import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useWorkspace } from '../auth/WorkspaceProvider'
import { ClockGate, isClockGate } from '../components/ClockGate'
import { Icon } from '../components/Icon'
import { DataTable, EmptyState, EntityForm, ErrorBanner, Minutes, Modal, PageHeader, Pagination, Panel, SearchToolbar, StatusBadge, type Column, type FormFieldSpec } from '../components/ui'
import { api, displayName, fieldLabel, normalizePage, unwrap } from '../lib/api'
import { useCollection } from '../lib/useCollection'
import { isAdministrator, useCan } from '../lib/permissions'
import type { ApiEnvelope, CustomField, FormPayload, Note, Paginated, Project, Subtask, Task, UserSummary } from '../types/api'

function taskStatus(task: Task) { return task.statusValue ?? task.status_value ?? task.status }
function taskUrgency(task: Task) { return task.urgencyValue ?? task.urgency_value ?? task.urgency }
function dueDate(task: Task) { return task.dueDate ?? task.due_date }
function estimated(task: Task) { return task.estimatedMinutes ?? task.estimated_minutes ?? 0 }
function actual(task: Task) { return task.actualMinutes ?? task.actual_minutes ?? 0 }

interface TaskLookups {
  projects: Project[]
  users: UserSummary[]
  fields: CustomField[]
}

interface BootstrapLookups {
  projects?: Project[]
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
        users: bootstrap.coworkers ?? [],
        fields: bootstrap.fields ?? [],
      })
    })
    return () => { active = false }
  }, [can, enabled])
  return lookups
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
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [clockBlocked, setClockBlocked] = useState(false)
  const [adminOverride, setAdminOverride] = useState(false)
  const { canMutateTasks, canAdminOverride } = useWorkspace()
  const can = useCan()
  const lookups = useTaskLookups(createOpen)
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

  useEffect(() => {
    if (canMutateTasks) setClockBlocked(false)
  }, [canMutateTasks])

  const setFilter = (key: string, value?: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
    setPage(1)
  }

  const columns: Column<Task>[] = [
    { key: 'title', header: 'Task', render: (task) => <div className="primary-cell"><strong>{task.title}</strong><span>{task.project?.name ?? 'No project'}{task.project?.client?.name ? ` · ${task.project.client.name}` : ''}</span></div> },
    { key: 'status', header: 'Status', render: (task) => <StatusBadge value={taskStatus(task)} /> },
    { key: 'urgency', header: 'Urgency', render: (task) => <StatusBadge value={taskUrgency(task)} /> },
    { key: 'assignee', header: 'Assignee', render: (task) => <span>{displayName(task.assignee)}</span> },
    { key: 'due', header: 'Due', render: (task) => dueDate(task) ? <time className={new Date(dueDate(task)!) < new Date() ? 'overdue' : ''}>{new Date(dueDate(task)!).toLocaleDateString()}</time> : '—' },
    { key: 'time', header: 'Logged', render: (task) => <Minutes value={actual(task)} />, className: 'numeric-cell' },
  ]

  const createFields: FormFieldSpec[] = [
    { name: 'title', label: 'Task title', required: true, wide: true, placeholder: 'What needs to be done?' },
    { name: 'project_id', label: 'Project', type: 'select', required: true, options: lookups.projects.map((project) => ({ label: project.name, value: project.id })) },
    ...(can('tasks.assign') ? [{ name: 'assignee_user_id', label: 'Assignee', type: 'select' as const, options: lookups.users.map((user) => ({ label: displayName(user), value: user.id })) }] : []),
    ...(can('tasks.change_status') && statusOptions.length ? [{ name: 'status_value_id', label: 'Status', type: 'select' as const, options: statusOptions.map((value) => ({ label: value.label, value: value.id })) }] : []),
    ...(typeOptions.length ? [{ name: 'type_value_id', label: 'Type', type: 'select' as const, options: typeOptions.map((value) => ({ label: value.label, value: value.id })) }] : []),
    ...(urgencyOptions.length ? [{ name: 'urgency_value_id', label: 'Urgency', type: 'select' as const, options: urgencyOptions.map((value) => ({ label: value.label, value: value.id })) }] : []),
    { name: 'due_date', label: 'Due date', type: 'date' },
    ...(can('tasks.estimate') ? [{ name: 'estimated_minutes', label: 'Estimated minutes', type: 'number' as const, min: 0 }] : []),
    { name: 'description', label: 'Description', type: 'textarea', wide: true, placeholder: 'Add useful context for the team…' },
  ]

  const create = async (values: FormPayload) => {
    if (!canMutateTasks && !(canAdminOverride && adminOverride)) { setClockBlocked(true); return }
    setFormBusy(true)
    setFormError('')
    try {
      const response = await api.post<ApiEnvelope<Task> | Task>('/api/tasks', { ...values, admin_override: adminOverride ? 1 : undefined } as Record<string, unknown>)
      const task = unwrap(response)
      setClockBlocked(false)
      setCreateOpen(false)
      await reload()
      navigate(`/tasks/${task.id}`)
    } catch (reason) {
      if (isClockGate(reason)) setClockBlocked(true)
      setFormError(reason instanceof Error ? reason.message : 'Unable to create the task.')
    } finally {
      setFormBusy(false)
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Work queue" title="Tasks" description={`${meta.total} tasks across your visible projects.`} actions={can('tasks.create') ? <button className="btn btn-primary" onClick={() => { setCreateOpen(true); setClockBlocked(false); setAdminOverride(false) }}><Icon name="plus" size={16} /> New task</button> : undefined} />
      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      <Panel className="list-panel">
        <SearchToolbar search={search} onSearch={(value) => setFilter('search', value || undefined)} placeholder="Search task title or project…">
          <label className={`filter-chip ${mine ? 'active' : ''}`}><input type="checkbox" checked={mine} onChange={(event) => setFilter('mine', event.target.checked ? '1' : undefined)} />Mine</label>
          <label className={`filter-chip ${urgent ? 'active' : ''}`}><input type="checkbox" checked={urgent} onChange={(event) => setFilter('urgent', event.target.checked ? '1' : undefined)} />Urgent</label>
          <label className={`filter-chip ${archived ? 'active' : ''}`}><input type="checkbox" checked={archived} onChange={(event) => setFilter('archived', event.target.checked ? '1' : undefined)} />Archived</label>
          <select className="compact-select" value={sort} onChange={(event) => setFilter('sort', event.target.value === 'due_date' ? undefined : event.target.value)}><option value="due_date">Due date</option><option value="-created_at">Newest</option><option value="urgency">Urgency</option><option value="title">Title</option></select>
        </SearchToolbar>
        <DataTable columns={columns} data={data} rowKey={(task) => task.id} loading={loading} emptyTitle="No tasks match this view" emptyDescription="Try changing a filter or create the next piece of work." onRowClick={(task) => navigate(`/tasks/${task.id}`)} />
        <Pagination meta={meta} onPage={setPage} />
      </Panel>
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create a task" size="lg">
        {clockBlocked && <ClockGate compact />}
        <EntityForm fields={createFields} busy={formBusy} error={formError} submitLabel="Create task" onCancel={() => setCreateOpen(false)} onSubmit={create} extra={canAdminOverride && !canMutateTasks ? <label className="override-toggle"><input type="checkbox" checked={adminOverride} onChange={(event) => setAdminOverride(event.target.checked)} /> Use administrator override</label> : undefined} />
      </Modal>
    </div>
  )
}

type DetailTab = 'notes' | 'subtasks' | 'emails' | 'activity'

export function TaskDetailPage() {
  const { taskId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const can = useCan()
  const { canMutateTasks, canAdminOverride } = useWorkspace()
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [clockBlocked, setClockBlocked] = useState(false)
  const [adminOverride, setAdminOverride] = useState(false)
  const [tab, setTab] = useState<DetailTab>('notes')
  const [editOpen, setEditOpen] = useState(false)
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
  const lookups = useTaskLookups(Boolean(taskId))
  const statusOptions = lookupValues(lookups.fields, 'task_status')
  const typeOptions = lookupValues(lookups.fields, 'task_type')
  const urgencyOptions = lookupValues(lookups.fields, 'task_urgency')

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!taskId) return
    setLoading(true)
    setError('')
    try {
      const response = await api.get<ApiEnvelope<Task> | Task>(`/api/tasks/${taskId}`, undefined, signal)
      setTask(unwrap(response))
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(reason instanceof Error ? reason.message : 'Unable to open this task.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [taskId])

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])

  useEffect(() => { setActivity([]) }, [taskId])

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

  const taskWritePermissions = ['tasks.edit', 'tasks.change_status', 'tasks.comment', 'tasks.log_time', 'tasks.subtasks', 'tasks.assign', 'tasks.estimate', 'tasks.email', 'tasks.archive']
  const canWriteTask = taskWritePermissions.some(can)
  const canEditTaskFields = ['tasks.edit', 'tasks.change_status', 'tasks.assign', 'tasks.estimate'].some(can)
  const canComment = can('tasks.comment')
  const canLogTime = can('tasks.log_time')
  const canManageSubtasks = can('tasks.subtasks')
  const canChangeStatus = can('tasks.change_status')
  const canEmail = can('tasks.email')
  const isAdmin = isAdministrator(user)
  const noteList = task?.notes ?? []
  const subtasks = task?.subtasks ?? []
  const emails = task?.emails ?? []
  const totals = task?.timeTotals
  // `taskActual`/`totalActual` is already inclusive of note time. Never add subtask actual again.
  const actualTotal = totals?.taskActual ?? totals?.totalActual ?? (task ? actual(task) : 0)
  const estimatedTotal = totals?.totalEstimated ?? totals?.taskEstimated ?? (task ? estimated(task) : 0)
  const progress = estimatedTotal > 0 ? Math.min(100, Math.round(actualTotal / estimatedTotal * 100)) : 0
  const isArchived = Boolean(task?.archivedAt ?? task?.archived_at)
  const detailTabs: DetailTab[] = canEmail ? ['notes', 'subtasks', 'emails', 'activity'] : ['notes', 'subtasks', 'activity']
  const ownsRecentNote = (note: Note) => {
    if (isAdmin) return true
    const creator = note.author?.id ?? (typeof note.createdBy === 'object' ? note.createdBy.id : note.createdBy) ?? (typeof note.created_by === 'object' ? note.created_by.id : note.created_by)
    const created = note.createdAt ?? note.created_at
    return String(creator) === String(user?.id) && Boolean(created) && Date.now() - new Date(created!).getTime() <= 86_400_000
  }

  const editFields: FormFieldSpec[] = task ? [
    ...(can('tasks.edit') ? [
      { name: 'title', label: 'Title', required: true, wide: true },
      { name: 'project_id', label: 'Project', type: 'select' as const, required: true, options: lookups.projects.map((project) => ({ label: project.name, value: project.id })) },
    ] : []),
    ...(can('tasks.assign') ? [{ name: 'assignee_user_id', label: 'Assignee', type: 'select' as const, options: lookups.users.map((person) => ({ label: displayName(person), value: person.id })) }] : []),
    ...(canChangeStatus && statusOptions.length ? [{ name: 'status_value_id', label: 'Status', type: 'select' as const, options: statusOptions.map((value) => ({ label: value.label, value: value.id })) }] : []),
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

  const editInitial: FormPayload = {
    title: task.title,
    project_id: task.projectId ?? task.project_id ?? task.project?.id,
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

  return (
    <div className="task-detail-page">
      <button className="back-link" onClick={() => navigate('/tasks')}><Icon name="arrow-left" size={17} /> Back to tasks</button>
      <div className="task-detail-heading">
        <div><div className="task-breadcrumb">{task.project?.client?.name && <span>{task.project.client.name}</span>}{task.project && can('projects.view') ? <Link to={`/tasks?project_id=${task.project.id}`}>{task.project.name}</Link> : <span>{task.project?.name ?? 'No project'}</span>}</div><h1>{task.title}</h1><div className="task-heading-meta"><StatusBadge value={taskStatus(task)} /><StatusBadge value={taskUrgency(task)} /><span>Assigned to {displayName(task.assignee)}</span>{dueDate(task) && <span>Due {new Date(dueDate(task)!).toLocaleDateString()}</span>}</div></div>
        <div className="page-actions">{can('tasks.archive') && !isArchived && <button className="btn btn-danger-quiet" disabled={busy} onClick={() => void archiveTask()}><Icon name="trash" size={16} /> Archive</button>}{can('tasks.archive') && isArchived && <button className="btn btn-primary" disabled={busy} onClick={() => void restoreTask()}><Icon name="play" size={16} /> Restore task</button>}{canEditTaskFields && !isArchived && <button className="btn btn-primary" onClick={() => { setEditOpen(true); setClockBlocked(false) }}><Icon name="edit" size={16} /> Edit task</button>}</div>
      </div>
      {(clockBlocked || (canWriteTask && !canMutateTasks)) && <ClockGate />}
      {canWriteTask && canAdminOverride && !canMutateTasks && <label className="override-toggle"><input type="checkbox" checked={adminOverride} onChange={(event) => setAdminOverride(event.target.checked)} /> Use administrator override for this task</label>}
      {mutationError && <ErrorBanner message={mutationError} />}
      <section className="task-time-strip">
        <div><span>Estimated</span><strong><Minutes value={estimatedTotal} /></strong></div>
        <div className="time-progress"><span style={{ width: `${progress}%` }} /></div>
        <div><span>Actual</span><strong><Minutes value={actualTotal} /></strong></div>
        <div><span>Progress</span><strong>{estimatedTotal ? `${progress}%` : 'No estimate'}</strong></div>
      </section>
      {task.description && <Panel title="Brief"><div className="prose">{task.description}</div></Panel>}
      <section className="task-workspace panel">
        <div className="detail-tabs">
          {detailTabs.map((value) => <button className={tab === value ? 'active' : ''} onClick={() => setTab(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}{value === 'notes' ? <b>{noteList.length}</b> : value === 'subtasks' ? <b>{subtasks.length}</b> : null}</button>)}
        </div>
        <div className="tab-content">
          {tab === 'notes' && <NotesTab notes={noteList} body={noteBody} minutes={noteMinutes} notifyUserId={notifyUserId} users={lookups.users} busy={busy} canComment={!isArchived && canComment} canLogTime={canLogTime} canEdit={(note) => !isArchived && canComment && ownsRecentNote(note)} canDelete={(note) => !isArchived && canComment && ownsRecentNote(note) && (Number(note.timeMinutes ?? note.time_minutes ?? 0) === 0 || canLogTime)} onBody={setNoteBody} onMinutes={setNoteMinutes} onNotifyUser={setNotifyUserId} onAdd={() => void addNote()} onEdit={openNoteEditor} onDelete={(note) => void deleteNote(note)} />}
          {tab === 'subtasks' && <SubtasksTab subtasks={subtasks} title={subtaskTitle} busy={busy} canManage={!isArchived && canManageSubtasks} canComplete={!isArchived && canChangeStatus} canEditAny={!isArchived && (canManageSubtasks || canChangeStatus || can('tasks.assign') || can('tasks.estimate'))} onTitle={setSubtaskTitle} onAdd={() => void addSubtask()} onComplete={(subtask) => void completeSubtask(subtask)} onEdit={setEditingSubtask} onDelete={(subtask) => void deleteSubtask(subtask)} onMove={(subtask, direction) => void moveSubtask(subtask, direction)} />}
          {tab === 'emails' && canEmail && <EmailsTab emails={emails} to={emailTo} subject={emailSubject} body={emailBody} busy={busy} readOnly={isArchived} onTo={setEmailTo} onSubject={setEmailSubject} onBody={setEmailBody} onSend={() => void sendEmail()} onDelete={(email) => void deleteEmail(email)} />}
          {tab === 'activity' && <ActivityList rows={activity} />}
        </div>
      </section>
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit task" size="lg">
        {clockBlocked && <ClockGate compact />}
        <EntityForm fields={editFields} initialValues={editInitial} busy={busy} error={mutationError} onCancel={() => setEditOpen(false)} onSubmit={saveTask} />
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
  return <div>{canManage && <div className="quick-add"><input value={title} onChange={(event) => onTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onAdd() }} placeholder="Add a subtask…" /><button className="btn btn-primary" disabled={busy || !title.trim()} onClick={onAdd}><Icon name="plus" size={15} /> Add</button></div>}{subtasks.length ? <div className="subtask-list">{subtasks.map((subtask, index) => { const completed = Boolean(subtask.completedAt ?? subtask.completed_at); return <div key={subtask.id}><button className={`subtask-check ${completed ? 'completed' : ''}`} disabled={busy || !canComplete} onClick={() => onComplete(subtask)} aria-label={`${completed ? 'Reopen' : 'Complete'} ${subtask.title}`} title={canComplete ? completed ? 'Reopen subtask' : 'Complete subtask' : 'Your role cannot change task status'}><Icon name="check" size={14} /></button><div><strong>{subtask.title}</strong><span>{displayName(subtask.assignee)}{(subtask.dueDate ?? subtask.due_date) ? ` · Due ${new Date(subtask.dueDate ?? subtask.due_date ?? '').toLocaleDateString()}` : ''}</span></div><StatusBadge value={subtask.statusValue ?? subtask.status_value ?? subtask.status} /><span><Minutes value={subtask.actualMinutes ?? subtask.actual_minutes} /></span>{(canEditAny || canManage) && <div className="subtask-actions">{canManage && <><button className="icon-button" disabled={busy || index === 0} aria-label={`Move ${subtask.title} up`} onClick={() => onMove(subtask, -1)}>↑</button><button className="icon-button" disabled={busy || index === subtasks.length - 1} aria-label={`Move ${subtask.title} down`} onClick={() => onMove(subtask, 1)}>↓</button></>}{canEditAny && <button className="icon-button" aria-label={`Edit ${subtask.title}`} onClick={() => onEdit(subtask)}><Icon name="edit" size={14} /></button>}{canManage && <button className="icon-button danger" aria-label={`Delete ${subtask.title}`} onClick={() => onDelete(subtask)}><Icon name="trash" size={14} /></button>}</div>}</div> })}</div> : <EmptyState title="No subtasks yet" description="Break this task into smaller, assignable steps." />}</div>
}

function EmailsTab({ emails, to, subject, body, busy, readOnly, onTo, onSubject, onBody, onSend, onDelete }: { emails: Note[]; to: string; subject: string; body: string; busy: boolean; readOnly: boolean; onTo: (value: string) => void; onSubject: (value: string) => void; onBody: (value: string) => void; onSend: () => void; onDelete: (email: Note) => void }) {
  const rows = emails as Array<Note & { subject?: string; to_addresses?: string; sent_at?: string; status?: string }>
  return <div>{!readOnly && <div className="email-composer"><div className="email-line"><span>To</span><input type="email" value={to} onChange={(event) => onTo(event.target.value)} placeholder="client@example.com" /></div><div className="email-line"><span>Subject</span><input value={subject} onChange={(event) => onSubject(event.target.value)} placeholder="Production update" /></div><textarea value={body} onChange={(event) => onBody(event.target.value)} placeholder="Write the email…" /><footer><button className="btn btn-primary" disabled={busy || !to.trim() || !subject.trim() || !body.trim()} onClick={onSend}><Icon name="send" size={15} /> Send email</button></footer></div>}{rows.length ? <div className="notes-list email-list">{rows.map((email) => <article key={email.id}><div className="note-meta"><strong>{email.subject || 'Task email'}</strong><time>{email.sent_at ? new Date(email.sent_at).toLocaleString() : email.createdAt ?? email.created_at ? new Date((email.createdAt ?? email.created_at)!).toLocaleString() : '—'}</time><StatusBadge value={email.status || 'sent'} />{!readOnly && <button className="text-link danger-text" onClick={() => onDelete(email)}>Delete</button>}</div><span className="email-to">To: {email.to_addresses || 'Recipient hidden'}</span><div className="note-body">{email.body}</div></article>)}</div> : <EmptyState title="No task emails have been captured." />}</div>
}

function ActivityList({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <EmptyState title="No activity recorded" description="Task changes will appear here." />
  return <div className="activity-timeline">{rows.map((row, index) => <div key={String(row.id ?? index)}><span /><div><strong>{String(row.description ?? row.message ?? fieldLabel(row.action) ?? 'Task updated')}</strong><time>{row.created_at ? new Date(String(row.created_at)).toLocaleString() : ''}</time></div></div>)}</div>
}
