import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { Modal } from '../components/ui'
import { displayName } from '../lib/api'
import type { EntityId, FieldValue, Project, TaskFolder, UserSummary } from '../types/api'

interface TaskDraft {
  title: string
  project_id: string
  task_folder_id: string
  description: string
  status_value_id: string
  type_value_id: string
  urgency_value_id: string
  assignee_user_id: string
  due_date: string
  estimated_minutes: string
}

interface DraftSubtask {
  id: string
  title: string
}

const MAX_SUBTASKS = 50

export type CreateTaskPayload = Record<string, unknown> & {
  project_id: EntityId
  title: string
  subtasks?: Array<{ title: string }>
}

interface CreateTaskModalProps {
  open: boolean
  busy: boolean
  error?: string
  initialProjectId?: string
  projects: Project[]
  folders: TaskFolder[]
  foldersLoading?: boolean
  folderError?: string
  users: UserSummary[]
  statusOptions: FieldValue[]
  typeOptions: FieldValue[]
  urgencyOptions: FieldValue[]
  canAssign: boolean
  canChangeStatus: boolean
  canEstimate: boolean
  canCreateSubtasks: boolean
  notice?: ReactNode
  extra?: ReactNode
  onProjectChange?: (projectId: EntityId | '') => void
  onErrorDismiss?: () => void
  onClose: () => void
  onSubmit: (payload: CreateTaskPayload) => void | Promise<void>
}

function emptyDraft(initialProjectId?: string): TaskDraft {
  return {
    title: '',
    project_id: initialProjectId ?? '',
    task_folder_id: '',
    description: '',
    status_value_id: '',
    type_value_id: '',
    urgency_value_id: '',
    assignee_user_id: '',
    due_date: '',
    estimated_minutes: '',
  }
}

function optional(payload: Record<string, unknown>, key: string, value: string) {
  if (value !== '') payload[key] = value
}

function defaultFieldValue(options: FieldValue[], key: string, fallbackLabel: string) {
  return options.find((value) => {
    const candidateKey = value.key ?? (value as FieldValue & { key_name?: string }).key_name
    return candidateKey === key || value.label.trim().toLowerCase() === fallbackLabel.toLowerCase()
  })
}

export function CreateTaskModal({
  open,
  busy,
  error,
  initialProjectId,
  projects,
  folders,
  foldersLoading = false,
  folderError = '',
  users,
  statusOptions,
  typeOptions,
  urgencyOptions,
  canAssign,
  canChangeStatus,
  canEstimate,
  canCreateSubtasks,
  notice,
  extra,
  onProjectChange,
  onErrorDismiss,
  onClose,
  onSubmit,
}: CreateTaskModalProps) {
  const formId = useId()
  const moreRef = useRef<HTMLDetailsElement>(null)
  const subtaskSequence = useRef(0)
  const subtaskInputs = useRef(new Map<string, HTMLInputElement>())
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(initialProjectId))
  const [showEstimate, setShowEstimate] = useState(false)
  const [showSubtasks, setShowSubtasks] = useState(false)
  const [subtasks, setSubtasks] = useState<DraftSubtask[]>([])
  const [validationError, setValidationError] = useState('')
  const defaultStatus = defaultFieldValue(statusOptions, 'pending', 'Pending')
  const defaultType = defaultFieldValue(typeOptions, 'task', 'Task')
  const defaultUrgency = defaultFieldValue(urgencyOptions, 'normal', 'Normal')

  useEffect(() => {
    if (!open) return
    setDraft(emptyDraft(initialProjectId))
    setShowEstimate(false)
    setShowSubtasks(false)
    setSubtasks([])
    setValidationError('')
    subtaskSequence.current = 0
  }, [initialProjectId, open])

  const setField = (field: keyof TaskDraft, value: string) => {
    setValidationError('')
    onErrorDismiss?.()
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const focusSubtask = (id: string) => {
    window.requestAnimationFrame(() => subtaskInputs.current.get(id)?.focus())
  }

  const makeSubtask = (): DraftSubtask => ({ id: `draft-subtask-${subtaskSequence.current++}`, title: '' })

  const addSubtask = (afterIndex?: number) => {
    if (subtasks.length >= MAX_SUBTASKS) return
    onErrorDismiss?.()
    const row = makeSubtask()
    setSubtasks((current) => {
      if (afterIndex === undefined) return [...current, row]
      const next = current.slice()
      next.splice(afterIndex + 1, 0, row)
      return next
    })
    focusSubtask(row.id)
  }

  const revealSubtasks = () => {
    setShowSubtasks(true)
    if (!subtasks.length) addSubtask()
    if (moreRef.current) moreRef.current.open = false
  }

  const revealEstimate = () => {
    setShowEstimate(true)
    if (moreRef.current) moreRef.current.open = false
    window.requestAnimationFrame(() => document.getElementById(`${formId}-estimate`)?.focus())
  }

  const removeSubtask = (id: string, focusId?: string) => {
    onErrorDismiss?.()
    setSubtasks((current) => current.filter((subtask) => subtask.id !== id))
    if (focusId) focusSubtask(focusId)
  }

  const onSubtaskKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (subtasks[index]?.title.trim()) addSubtask(index)
      return
    }
    if (event.key === 'Backspace' && !subtasks[index]?.title && subtasks.length > 1) {
      event.preventDefault()
      removeSubtask(subtasks[index].id, index > 0 ? subtasks[index - 1]?.id : subtasks[index + 1]?.id)
    }
  }

  const subtaskTitles = subtasks.map((subtask) => subtask.title.trim()).filter(Boolean)
  const displayedSubtaskCount = subtaskTitles.length || subtasks.length
  const isDirty = Boolean(
    draft.title.trim()
    || draft.description.trim()
    || draft.task_folder_id
    || draft.status_value_id
    || draft.type_value_id
    || draft.urgency_value_id
    || draft.assignee_user_id
    || draft.due_date
    || draft.estimated_minutes
    || subtaskTitles.length
    || (!initialProjectId && draft.project_id),
  )

  const requestClose = () => {
    if (busy) return
    if (isDirty && !window.confirm('Discard this task draft?')) return
    onClose()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const title = draft.title.trim()
    if (!title || !draft.project_id) {
      setValidationError(!title ? 'Give the task a clear title before creating it.' : 'Choose the project this task belongs to.')
      return
    }

    const payload: CreateTaskPayload = { project_id: draft.project_id, title }
    optional(payload, 'task_folder_id', draft.task_folder_id)
    optional(payload, 'status_value_id', draft.status_value_id)
    optional(payload, 'type_value_id', draft.type_value_id)
    optional(payload, 'urgency_value_id', draft.urgency_value_id)
    optional(payload, 'assignee_user_id', draft.assignee_user_id)
    optional(payload, 'due_date', draft.due_date)
    if (draft.description.trim()) payload.description = draft.description.trim()
    if (draft.estimated_minutes !== '') payload.estimated_minutes = Number(draft.estimated_minutes)
    if (subtaskTitles.length) payload.subtasks = subtaskTitles.map((subtaskTitle) => ({ title: subtaskTitle }))
    void onSubmit(payload)
  }

  const canRevealMore = (canEstimate && !showEstimate) || (canCreateSubtasks && !showSubtasks)

  return (
    <Modal
      open={open}
      onClose={requestClose}
      closeDisabled={busy}
      title="Create task"
      description="Start with the essentials, then add only the detail the team needs."
      size="lg"
      className="task-create-modal"
    >
      <form className="task-create-form" onSubmit={submit} noValidate>
        <fieldset className="task-create-fields" disabled={busy}>
          <legend className="sr-only">New task details</legend>
          <div className="task-create-body">
            {notice}

            <div className="task-create-location" role="group" aria-label="Task location and type">
              <label className="task-location-control task-location-project">
                <Icon name="briefcase" size={15} />
                <span className="sr-only">Project</span>
                <select
                  aria-label="Project"
                  required
                  value={draft.project_id}
                  disabled={Boolean(initialProjectId)}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, project_id: event.target.value, task_folder_id: '' }))
                    onProjectChange?.(event.target.value)
                    onErrorDismiss?.()
                    setValidationError('')
                  }}
                >
                  <option value="">Choose project…</option>
                  {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
                </select>
              </label>

              <label className="task-location-control">
                <Icon name="folder" size={15} />
                <span className="sr-only">Folder</span>
                <select aria-label="Folder" value={draft.task_folder_id} disabled={!draft.project_id || foldersLoading} onChange={(event) => setField('task_folder_id', event.target.value)}>
                  <option value="">{!draft.project_id ? 'Choose project first…' : foldersLoading ? 'Loading folders…' : 'Ungrouped'}</option>
                  {folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}
                </select>
              </label>

              {typeOptions.length > 0 && (
                <label className="task-location-control task-location-type">
                  <Icon name="task" size={15} />
                  <span className="sr-only">Type</span>
                  <select aria-label="Type" value={draft.type_value_id} onChange={(event) => setField('type_value_id', event.target.value)}>
                    <option value="">{defaultType?.label ?? 'Task'}</option>
                    {typeOptions.filter((value) => String(value.id) !== String(defaultType?.id ?? '')).map((value) => <option value={value.id} key={value.id}>{value.label}</option>)}
                  </select>
                </label>
              )}
            </div>
            {folderError && <div className="task-create-inline-error" role="alert">{folderError}</div>}

            <label className="task-title-field">
              <span className="sr-only">Task title</span>
              <input
                aria-label="Task title"
                data-autofocus
                required
                maxLength={255}
                value={draft.title}
                placeholder="What needs to be done?"
                onChange={(event) => setField('title', event.target.value)}
              />
            </label>

            <label className="task-description-field">
              <span className="sr-only">Description</span>
              <textarea
                aria-label="Description"
                value={draft.description}
                placeholder="Add a description or helpful context…"
                onChange={(event) => setField('description', event.target.value)}
              />
            </label>

            <div className="task-create-properties" role="group" aria-label="Task properties">
              {canChangeStatus && statusOptions.length > 0 && (
                <label className="task-property-control">
                  <Icon name="check" size={14} />
                  <span className="sr-only">Status</span>
                  <select aria-label="Status" value={draft.status_value_id} onChange={(event) => setField('status_value_id', event.target.value)}>
                    <option value="">{defaultStatus?.label ?? 'Pending'}</option>
                    {statusOptions.filter((value) => String(value.id) !== String(defaultStatus?.id ?? '')).map((value) => <option value={value.id} key={value.id}>{value.label}</option>)}
                  </select>
                </label>
              )}

              {canAssign && (
                <label className="task-property-control">
                  <Icon name="user" size={14} />
                  <span className="sr-only">Assignee</span>
                  <select aria-label="Assignee" value={draft.assignee_user_id} onChange={(event) => setField('assignee_user_id', event.target.value)}>
                    <option value="">Assignee</option>
                    {users.map((user) => <option value={user.id} key={user.id}>{displayName(user)}</option>)}
                  </select>
                </label>
              )}

              <label className={`task-property-control ${draft.due_date ? 'has-value' : ''}`}>
                <Icon name="calendar" size={14} />
                <span className="sr-only">Due date</span>
                <input aria-label="Due date" type="date" value={draft.due_date} onChange={(event) => setField('due_date', event.target.value)} />
              </label>

              {urgencyOptions.length > 0 && (
                <label className="task-property-control">
                  <Icon name="flag" size={14} />
                  <span className="sr-only">Priority</span>
                  <select aria-label="Priority" value={draft.urgency_value_id} onChange={(event) => setField('urgency_value_id', event.target.value)}>
                    <option value="">{defaultUrgency?.label ?? 'Priority'}</option>
                    {urgencyOptions.filter((value) => String(value.id) !== String(defaultUrgency?.id ?? '')).map((value) => <option value={value.id} key={value.id}>{value.label}</option>)}
                  </select>
                </label>
              )}

              {showEstimate && canEstimate && (
                <label className={`task-property-control task-estimate-control ${draft.estimated_minutes ? 'has-value' : ''}`}>
                  <Icon name="clock" size={14} />
                  <span className="sr-only">Estimated minutes</span>
                  <input
                    id={`${formId}-estimate`}
                    aria-label="Estimated minutes"
                    type="number"
                    min={0}
                    max={1000000}
                    inputMode="numeric"
                    value={draft.estimated_minutes}
                    placeholder="Estimate"
                    onChange={(event) => setField('estimated_minutes', event.target.value)}
                  />
                  <span aria-hidden="true">min</span>
                </label>
              )}

              {canRevealMore && (
                <details className="task-create-more" ref={moreRef}>
                  <summary aria-label="More task properties"><Icon name="more-horizontal" size={15} /><span>More</span></summary>
                  <div className="task-create-more-menu">
                    {canEstimate && !showEstimate && <button type="button" onClick={revealEstimate}><Icon name="clock" size={15} /><span>Time estimate</span></button>}
                    {canCreateSubtasks && !showSubtasks && <button type="button" onClick={revealSubtasks}><Icon name="task" size={15} /><span>Subtasks</span></button>}
                  </div>
                </details>
              )}

              {showSubtasks && (
                <button type="button" className="task-property-summary" onClick={() => focusSubtask(subtasks[0]?.id)}>
                  <Icon name="task" size={14} />
                  <span>{displayedSubtaskCount} {displayedSubtaskCount === 1 ? 'subtask' : 'subtasks'}</span>
                </button>
              )}
            </div>

            {showSubtasks && canCreateSubtasks && (
              <section className="task-draft-subtasks" aria-labelledby={`${formId}-subtasks-title`}>
                <header>
                  <div>
                    <span className="task-draft-subtasks-icon"><Icon name="task" size={16} /></span>
                    <span><strong id={`${formId}-subtasks-title`}>Subtasks</strong><small>Break the work into quick, actionable steps.</small></span>
                  </div>
                  <button type="button" className="btn btn-quiet" disabled={subtasks.length >= MAX_SUBTASKS} onClick={() => addSubtask()}><Icon name="plus" size={14} /> Add subtask</button>
                </header>
                <ol>
                  {subtasks.map((subtask, index) => (
                    <li key={subtask.id}>
                      <span aria-hidden="true">{index + 1}</span>
                      <input
                        ref={(node) => {
                          if (node) subtaskInputs.current.set(subtask.id, node)
                          else subtaskInputs.current.delete(subtask.id)
                        }}
                        aria-label={`Subtask ${index + 1} title`}
                        maxLength={255}
                        value={subtask.title}
                        placeholder="Add a subtask"
                        onKeyDown={(event) => onSubtaskKeyDown(event, index)}
                        onChange={(event) => {
                          onErrorDismiss?.()
                          setSubtasks((current) => current.map((row) => row.id === subtask.id ? { ...row, title: event.target.value } : row))
                        }}
                      />
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label={`Remove subtask ${index + 1}`}
                        onClick={() => removeSubtask(subtask.id, subtasks[index - 1]?.id ?? subtasks[index + 1]?.id)}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </li>
                  ))}
                </ol>
                {!subtasks.length && <button type="button" className="task-empty-subtask" onClick={() => addSubtask()}><Icon name="plus" size={15} /> Add the first subtask</button>}
                <p aria-live="polite">{subtasks.length >= MAX_SUBTASKS ? `${MAX_SUBTASKS}-subtask limit reached.` : 'Press Enter to add the next subtask. Empty rows are ignored when the task is created.'}</p>
              </section>
            )}

            {(validationError || error) && <div className="form-error task-create-error" role="alert">{validationError || error}</div>}
          </div>
        </fieldset>

        <footer className="task-create-footer">
          <div className="task-create-footer-extra">{extra}</div>
          <div className="task-create-footer-actions">
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={requestClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !draft.title.trim() || !draft.project_id}>{busy ? 'Creating…' : 'Create task'}</button>
          </div>
        </footer>
      </form>
    </Modal>
  )
}
