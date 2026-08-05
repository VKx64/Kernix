import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DatePicker, Select, useAnchoredPopup, type SelectOption } from '../components/fields'
import { Icon } from '../components/Icon'
import { Modal } from '../components/ui'
import { displayName } from '../lib/api'
import { MAX_ATTACHMENTS_PER_UPLOAD, MAX_ATTACHMENT_BYTES, fileKind, formatBytes, rejectionReason } from '../lib/attachments'
import type { IconName } from '../components/Icon'
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
  canAttach?: boolean
  notice?: ReactNode
  onProjectChange?: (projectId: EntityId | '') => void
  onErrorDismiss?: () => void
  onClose: () => void
  onSubmit: (payload: CreateTaskPayload, files: File[]) => void | Promise<void>
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

const KIND_ICONS: Record<ReturnType<typeof fileKind>, IconName> = {
  image: 'image',
  video: 'video',
  audio: 'play',
  pdf: 'file',
  file: 'file',
}

function fileIcon(mime: string): IconName {
  return KIND_ICONS[fileKind(mime)]
}

function optional(payload: Record<string, unknown>, key: string, value: string) {
  if (value !== '') payload[key] = value
}

function withDefault(options: FieldValue[], fallback: FieldValue | undefined, unsetLabel: string): SelectOption[] {
  return [
    { value: '', label: fallback?.label ?? unsetLabel },
    ...options
      .filter((value) => String(value.id) !== String(fallback?.id ?? ''))
      .map((value) => ({ value: String(value.id), label: value.label })),
  ]
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
  canAttach = false,
  notice,
  onProjectChange,
  onErrorDismiss,
  onClose,
  onSubmit,
}: CreateTaskModalProps) {
  const formId = useId()
  const moreTriggerRef = useRef<HTMLButtonElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const subtaskSequence = useRef(0)
  const subtaskInputs = useRef(new Map<string, HTMLInputElement>())
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(initialProjectId))
  const [moreOpen, setMoreOpen] = useState(false)
  const [showEstimate, setShowEstimate] = useState(false)
  const [showSubtasks, setShowSubtasks] = useState(false)
  const [subtasks, setSubtasks] = useState<DraftSubtask[]>([])
  const [showAttachments, setShowAttachments] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [validationError, setValidationError] = useState('')
  const defaultStatus = defaultFieldValue(statusOptions, 'pending', 'Pending')
  const defaultType = defaultFieldValue(typeOptions, 'task', 'Task')
  const defaultUrgency = defaultFieldValue(urgencyOptions, 'normal', 'Normal')
  const closeMore = useCallback(() => setMoreOpen(false), [])
  const morePosition = useAnchoredPopup(moreOpen, moreTriggerRef, moreMenuRef, closeMore)

  useEffect(() => {
    if (!open) return
    setDraft(emptyDraft(initialProjectId))
    setMoreOpen(false)
    setShowEstimate(false)
    setShowSubtasks(false)
    setSubtasks([])
    setShowAttachments(false)
    setFiles([])
    setValidationError('')
    subtaskSequence.current = 0
  }, [initialProjectId, open])

  // The menu is portalled outside the dialog, so it has to own Escape and Tab
  // while it is open: otherwise Escape reaches the modal and throws away the
  // draft, and Tab makes the modal focus trap yank focus out of the menu.
  useEffect(() => {
    if (!moreOpen) return
    const items = () => Array.from(moreMenuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    const close = () => {
      setMoreOpen(false)
      moreTriggerRef.current?.focus()
    }
    const step = (offset: number) => {
      const buttons = items()
      if (!buttons.length) return
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(index + offset + buttons.length) % buttons.length].focus()
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        step(event.shiftKey ? -1 : 1)
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        step(event.key === 'ArrowDown' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    const frame = window.requestAnimationFrame(() => items()[0]?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [moreOpen])

  // The unset row doubles as the default the backend applies, so a choice can
  // always be undone without a second "clear" affordance.
  const projectChoices = useMemo(() => projects.map((project) => ({ value: String(project.id), label: project.name })), [projects])
  const folderChoices = useMemo<SelectOption[]>(
    () => [{ value: '', label: 'Ungrouped' }, ...folders.map((folder) => ({ value: String(folder.id), label: folder.name }))],
    [folders],
  )
  const statusChoices = useMemo(() => withDefault(statusOptions, defaultStatus, 'Pending'), [defaultStatus, statusOptions])
  const typeChoices = useMemo(() => withDefault(typeOptions, defaultType, 'Task'), [defaultType, typeOptions])
  const urgencyChoices = useMemo(() => withDefault(urgencyOptions, defaultUrgency, 'Priority'), [defaultUrgency, urgencyOptions])
  const userChoices = useMemo<SelectOption[]>(
    () => [{ value: '', label: 'Unassigned' }, ...users.map((user) => ({ value: String(user.id), label: displayName(user) }))],
    [users],
  )

  // Only touch error state when there is an error, so typing does not re-render
  // the whole page through the parent on every keystroke.
  const dismissErrors = () => {
    if (validationError) setValidationError('')
    if (error) onErrorDismiss?.()
  }

  const setField = (field: keyof TaskDraft, value: string) => {
    dismissErrors()
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const focusSubtask = (id: string) => {
    window.requestAnimationFrame(() => subtaskInputs.current.get(id)?.focus())
  }

  const makeSubtask = (): DraftSubtask => ({ id: `draft-subtask-${subtaskSequence.current++}`, title: '' })

  const addSubtask = (afterIndex?: number) => {
    if (subtasks.length >= MAX_SUBTASKS) return
    dismissErrors()
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
    setMoreOpen(false)
    if (!subtasks.length) addSubtask()
  }

  const revealEstimate = () => {
    setShowEstimate(true)
    setMoreOpen(false)
    window.requestAnimationFrame(() => document.getElementById(`${formId}-estimate`)?.focus())
  }

  const revealAttachments = () => {
    setShowAttachments(true)
    setMoreOpen(false)
    window.requestAnimationFrame(() => document.getElementById(`${formId}-files`)?.focus())
  }

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return
    dismissErrors()
    const accepted: File[] = []
    for (const file of Array.from(incoming)) {
      const reason = rejectionReason(file)
      if (reason) {
        setValidationError(reason)
        continue
      }
      if (files.some((existing) => existing.name === file.name && existing.size === file.size)) continue
      accepted.push(file)
    }
    if (!accepted.length) return
    setFiles((current) => {
      const room = MAX_ATTACHMENTS_PER_UPLOAD - current.length
      if (room <= 0) {
        setValidationError(`Up to ${MAX_ATTACHMENTS_PER_UPLOAD} files can be attached while creating a task.`)
        return current
      }
      if (accepted.length > room) {
        setValidationError(`Only the first ${room} of the selected files were attached.`)
      }
      return [...current, ...accepted.slice(0, room)]
    })
  }

  const removeFile = (file: File) => {
    dismissErrors()
    setFiles((current) => current.filter((candidate) => candidate !== file))
  }

  const removeSubtask = (id: string, focusId?: string) => {
    dismissErrors()
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
    || files.length
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
    void onSubmit(payload, canAttach ? files : [])
  }

  const canRevealMore = (canEstimate && !showEstimate) || (canCreateSubtasks && !showSubtasks) || (canAttach && !showAttachments)

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
              <Select
                className="task-location-control task-location-project"
                icon="briefcase"
                label="Project"
                required
                value={draft.project_id}
                options={projectChoices}
                placeholder="Choose project…"
                disabled={Boolean(initialProjectId)}
                onChange={(next) => {
                  setDraft((current) => ({ ...current, project_id: next, task_folder_id: '' }))
                  onProjectChange?.(next)
                  dismissErrors()
                }}
              />

              <Select
                className="task-location-control"
                icon="folder"
                label="Folder"
                value={draft.task_folder_id}
                options={!draft.project_id || foldersLoading ? [] : folderChoices}
                placeholder={!draft.project_id ? 'Choose project first…' : 'Loading folders…'}
                disabled={!draft.project_id || foldersLoading}
                onChange={(next) => setField('task_folder_id', next)}
              />

              {typeOptions.length > 0 && (
                <Select
                  className="task-location-control task-location-type"
                  icon="task"
                  label="Type"
                  value={draft.type_value_id}
                  options={typeChoices}
                  placeholder={defaultType?.label ?? 'Task'}
                  onChange={(next) => setField('type_value_id', next)}
                />
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
                <Select className="task-property-control" icon="check" label="Status" value={draft.status_value_id} options={statusChoices} placeholder={defaultStatus?.label ?? 'Pending'} onChange={(next) => setField('status_value_id', next)} />
              )}

              {canAssign && (
                <Select className="task-property-control" icon="user" label="Assignee" value={draft.assignee_user_id} options={userChoices} placeholder="Unassigned" onChange={(next) => setField('assignee_user_id', next)} />
              )}

              <DatePicker
                className={`task-property-control ${draft.due_date ? 'has-value' : ''}`}
                icon="calendar"
                label="Due date"
                value={draft.due_date}
                placeholder="Due date"
                onChange={(next) => setField('due_date', next)}
              />

              {urgencyOptions.length > 0 && (
                <Select className="task-property-control" icon="flag" label="Priority" value={draft.urgency_value_id} options={urgencyChoices} placeholder={defaultUrgency?.label ?? 'Priority'} onChange={(next) => setField('urgency_value_id', next)} />
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
                <>
                  <button
                    type="button"
                    ref={moreTriggerRef}
                    className="task-create-more"
                    aria-label="More task properties"
                    aria-expanded={moreOpen}
                    onClick={() => setMoreOpen((current) => !current)}
                  >
                    <Icon name="more-horizontal" size={15} /><span>More</span>
                  </button>
                  {moreOpen && morePosition && createPortal(
                    <div className="field-popup task-create-more-menu" ref={moreMenuRef} style={{ top: morePosition.top, left: morePosition.left }}>
                      {canEstimate && !showEstimate && <button type="button" onClick={revealEstimate}><Icon name="clock" size={15} /><span>Time estimate</span></button>}
                      {canCreateSubtasks && !showSubtasks && <button type="button" onClick={revealSubtasks}><Icon name="task" size={15} /><span>Subtasks</span></button>}
                      {canAttach && !showAttachments && <button type="button" onClick={revealAttachments}><Icon name="paperclip" size={15} /><span>Attachments</span></button>}
                    </div>,
                    document.body,
                  )}
                </>
              )}

              {showSubtasks && (
                <button type="button" className="task-property-summary" onClick={() => focusSubtask(subtasks[0]?.id)}>
                  <Icon name="task" size={14} />
                  <span>{displayedSubtaskCount} {displayedSubtaskCount === 1 ? 'subtask' : 'subtasks'}</span>
                </button>
              )}

              {showAttachments && canAttach && (
                <button type="button" className="task-property-summary" onClick={() => document.getElementById(`${formId}-files`)?.click()}>
                  <Icon name="paperclip" size={14} />
                  <span>{files.length} {files.length === 1 ? 'file' : 'files'}</span>
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
                          dismissErrors()
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

            {showAttachments && canAttach && (
              <section className="task-draft-attachments" aria-labelledby={`${formId}-files-title`}>
                <header>
                  <div>
                    <span className="task-draft-subtasks-icon"><Icon name="paperclip" size={16} /></span>
                    <span><strong id={`${formId}-files-title`}>Attachments</strong><small>Pictures, video, or documents up to {formatBytes(MAX_ATTACHMENT_BYTES)} each.</small></span>
                  </div>
                  <button type="button" className="btn btn-quiet" disabled={files.length >= MAX_ATTACHMENTS_PER_UPLOAD} onClick={() => document.getElementById(`${formId}-files`)?.click()}>
                    <Icon name="plus" size={14} /> Add files
                  </button>
                </header>
                <input
                  id={`${formId}-files`}
                  className="sr-only"
                  type="file"
                  multiple
                  aria-label="Attach files"
                  onChange={(event) => {
                    addFiles(event.target.files)
                    event.target.value = ''
                  }}
                />
                {files.length > 0 && (
                  <ul className="attachment-rows">
                    {files.map((file) => (
                      <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                        <span className="attachment-kind"><Icon name={fileIcon(file.type)} size={15} /></span>
                        <span className="attachment-meta"><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
                        <button type="button" className="icon-button danger" aria-label={`Remove ${file.name}`} onClick={() => removeFile(file)}>
                          <Icon name="trash" size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!files.length && (
                  <button type="button" className="task-empty-subtask" onClick={() => document.getElementById(`${formId}-files`)?.click()}>
                    <Icon name="upload" size={15} /> Choose files to attach
                  </button>
                )}
                <p aria-live="polite">
                  {files.length >= MAX_ATTACHMENTS_PER_UPLOAD
                    ? `${MAX_ATTACHMENTS_PER_UPLOAD}-file limit reached.`
                    : 'Files upload once the task is created.'}
                </p>
              </section>
            )}

            {(validationError || error) && <div className="form-error task-create-error" role="alert">{validationError || error}</div>}
          </div>
        </fieldset>

        <footer className="task-create-footer">
          <div className="task-create-footer-actions">
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={requestClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !draft.title.trim() || !draft.project_id}>{busy ? 'Creating…' : 'Create task'}</button>
          </div>
        </footer>
      </form>
    </Modal>
  )
}
