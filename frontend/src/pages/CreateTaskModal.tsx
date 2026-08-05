import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Clock, File, FileImage, FileVideo, ListChecks, MoreHorizontal, Music, Paperclip, Plus, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DatePicker } from '@/components/date-picker'
import { displayName } from '../lib/api'
import { MAX_ATTACHMENTS_PER_UPLOAD, MAX_ATTACHMENT_BYTES, fileKind, formatBytes, rejectionReason } from '../lib/attachments'
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

interface SelectOption {
  value: string
  label: string
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

const KIND_ICONS: Record<ReturnType<typeof fileKind>, typeof File> = {
  image: FileImage,
  video: FileVideo,
  audio: Music,
  pdf: File,
  file: File,
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

/** A `<Select>` whose empty/default option renders the current fallback label as its placeholder. */
function DraftSelect({
  id,
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: SelectOption[]
  placeholder: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <Select value={value || '__unset__'} disabled={disabled} onValueChange={(next) => onChange(next === '__unset__' ? '' : next)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent aria-label={label}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value || '__unset__'}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
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
  const titleRef = useRef<HTMLInputElement>(null)
  const subtaskSequence = useRef(0)
  const subtaskInputs = useRef(new Map<string, HTMLInputElement>())
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(initialProjectId))
  const [showEstimate, setShowEstimate] = useState(false)
  const [showSubtasks, setShowSubtasks] = useState(false)
  const [subtasks, setSubtasks] = useState<DraftSubtask[]>([])
  const [showAttachments, setShowAttachments] = useState(false)
  const [files, setFiles] = useState<File[]>([])
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
    setShowAttachments(false)
    setFiles([])
    setValidationError('')
    subtaskSequence.current = 0
  }, [initialProjectId, open])

  const projectChoices: SelectOption[] = projects.map((project) => ({ value: String(project.id), label: project.name }))
  const folderChoices: SelectOption[] = [{ value: '', label: 'Ungrouped' }, ...folders.map((folder) => ({ value: String(folder.id), label: folder.name }))]
  const statusChoices = withDefault(statusOptions, defaultStatus, 'Pending')
  const typeChoices = withDefault(typeOptions, defaultType, 'Task')
  const urgencyChoices = withDefault(urgencyOptions, defaultUrgency, 'Priority')
  const userChoices: SelectOption[] = [{ value: '', label: 'Unassigned' }, ...users.map((user) => ({ value: String(user.id), label: displayName(user) }))]

  // Only touch error state when there is an error, so typing does not re-render
  // the whole page through the parent on every keystroke.
  const dismissErrors = () => {
    if (validationError) setValidationError('')
    if (error) onErrorDismiss?.()
  }

  const setField = (field: keyof TaskDraft, value: string) => {
    dismissErrors()
    setDraft((current) => ({ ...current, [field]: value === '__unset__' ? '' : value }))
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
    if (!subtasks.length) addSubtask()
  }

  const revealEstimate = () => {
    setShowEstimate(true)
    window.requestAnimationFrame(() => document.getElementById(`${formId}-estimate`)?.focus())
  }

  const revealAttachments = () => {
    setShowAttachments(true)
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

  const requestClose = useCallback(() => {
    if (busy) return
    if (isDirty && !window.confirm('Discard this task draft?')) return
    onClose()
  }, [busy, isDirty, onClose])

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
    <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose() }}>
      <DialogContent
        className="sm:max-w-2xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Create task</DialogTitle>
          <DialogDescription>Start with the essentials, then add only the detail the team needs.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <fieldset className="space-y-4" disabled={busy}>
            <legend className="sr-only">New task details</legend>
            {notice}

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-project`}>Project</Label>
                <DraftSelect
                  id={`${formId}-project`}
                  label="Project"
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
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-folder`}>Folder</Label>
                <DraftSelect
                  id={`${formId}-folder`}
                  label="Folder"
                  value={draft.task_folder_id}
                  options={folderChoices}
                  placeholder={!draft.project_id ? 'Choose project first…' : foldersLoading ? 'Loading folders…' : 'Ungrouped'}
                  disabled={!draft.project_id || foldersLoading}
                  onChange={(next) => setField('task_folder_id', next)}
                />
              </div>

              {typeOptions.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${formId}-type`}>Type</Label>
                  <DraftSelect
                    id={`${formId}-type`}
                    label="Type"
                    value={draft.type_value_id}
                    options={typeChoices}
                    placeholder={defaultType?.label ?? 'Task'}
                    onChange={(next) => setField('type_value_id', next)}
                  />
                </div>
              )}
            </div>
            {folderError && (
              <Alert variant="destructive">
                <AlertDescription>{folderError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-title`} className="sr-only">Task title</Label>
              <Input
                id={`${formId}-title`}
                ref={titleRef}
                aria-label="Task title"
                required
                maxLength={255}
                className="h-11 text-base font-medium"
                value={draft.title}
                placeholder="What needs to be done?"
                onChange={(event) => setField('title', event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-description`} className="sr-only">Description</Label>
              <Textarea
                id={`${formId}-description`}
                aria-label="Description"
                value={draft.description}
                placeholder="Add a description or helpful context…"
                onChange={(event) => setField('description', event.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-end gap-3">
              {canChangeStatus && statusOptions.length > 0 && (
                <div className="w-40 space-y-1.5">
                  <Label htmlFor={`${formId}-status`}>Status</Label>
                  <DraftSelect id={`${formId}-status`} label="Status" value={draft.status_value_id} options={statusChoices} placeholder={defaultStatus?.label ?? 'Pending'} onChange={(next) => setField('status_value_id', next)} />
                </div>
              )}

              {canAssign && (
                <div className="w-44 space-y-1.5">
                  <Label htmlFor={`${formId}-assignee`}>Assignee</Label>
                  <DraftSelect id={`${formId}-assignee`} label="Assignee" value={draft.assignee_user_id} options={userChoices} placeholder="Unassigned" onChange={(next) => setField('assignee_user_id', next)} />
                </div>
              )}

              <div className="w-44 space-y-1.5">
                <Label htmlFor={`${formId}-due-date`}>Due date</Label>
                <DatePicker id={`${formId}-due-date`} value={draft.due_date} placeholder="Due date" onChange={(next) => setField('due_date', next)} />
              </div>

              {urgencyOptions.length > 0 && (
                <div className="w-36 space-y-1.5">
                  <Label htmlFor={`${formId}-urgency`}>Priority</Label>
                  <DraftSelect id={`${formId}-urgency`} label="Priority" value={draft.urgency_value_id} options={urgencyChoices} placeholder={defaultUrgency?.label ?? 'Priority'} onChange={(next) => setField('urgency_value_id', next)} />
                </div>
              )}

              {showEstimate && canEstimate && (
                <div className="w-32 space-y-1.5">
                  <Label htmlFor={`${formId}-estimate`}>Estimated minutes</Label>
                  <div className="relative">
                    <Clock className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id={`${formId}-estimate`}
                      aria-label="Estimated minutes"
                      type="number"
                      min={0}
                      max={1000000}
                      inputMode="numeric"
                      className="pl-8"
                      value={draft.estimated_minutes}
                      placeholder="Estimate"
                      onChange={(event) => setField('estimated_minutes', event.target.value)}
                    />
                  </div>
                </div>
              )}

              {canRevealMore && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm" aria-label="More task properties">
                      <MoreHorizontal /> More
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {canEstimate && !showEstimate && <DropdownMenuItem onSelect={revealEstimate}><Clock /> Time estimate</DropdownMenuItem>}
                    {canCreateSubtasks && !showSubtasks && <DropdownMenuItem onSelect={revealSubtasks}><ListChecks /> Subtasks</DropdownMenuItem>}
                    {canAttach && !showAttachments && <DropdownMenuItem onSelect={revealAttachments}><Paperclip /> Attachments</DropdownMenuItem>}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {showSubtasks && (
                <Button type="button" variant="ghost" size="sm" onClick={() => focusSubtask(subtasks[0]?.id)}>
                  <ListChecks /> {displayedSubtaskCount} {displayedSubtaskCount === 1 ? 'subtask' : 'subtasks'}
                </Button>
              )}

              {showAttachments && canAttach && (
                <Button type="button" variant="ghost" size="sm" onClick={() => document.getElementById(`${formId}-files`)?.click()}>
                  <Paperclip /> {files.length} {files.length === 1 ? 'file' : 'files'}
                </Button>
              )}
            </div>

            {showSubtasks && canCreateSubtasks && (
              <section className="space-y-3 rounded-lg border p-4" aria-labelledby={`${formId}-subtasks-title`}>
                <header className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ListChecks className="size-4 text-muted-foreground" />
                    <div>
                      <strong id={`${formId}-subtasks-title`} className="block text-sm">Subtasks</strong>
                      <small className="text-xs text-muted-foreground">Break the work into quick, actionable steps.</small>
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled={subtasks.length >= MAX_SUBTASKS} onClick={() => addSubtask()}>
                    <Plus /> Add subtask
                  </Button>
                </header>
                <ol className="space-y-2">
                  {subtasks.map((subtask, index) => (
                    <li key={subtask.id} className="flex items-center gap-2">
                      <span aria-hidden="true" className="w-5 shrink-0 text-right text-sm text-muted-foreground">{index + 1}</span>
                      <Input
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Remove subtask ${index + 1}`}
                        onClick={() => removeSubtask(subtask.id, subtasks[index - 1]?.id ?? subtasks[index + 1]?.id)}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ol>
                {!subtasks.length && (
                  <Button type="button" variant="outline" className="w-full" onClick={() => addSubtask()}>
                    <Plus /> Add the first subtask
                  </Button>
                )}
                <p aria-live="polite" className="text-xs text-muted-foreground">
                  {subtasks.length >= MAX_SUBTASKS ? `${MAX_SUBTASKS}-subtask limit reached.` : 'Press Enter to add the next subtask. Empty rows are ignored when the task is created.'}
                </p>
              </section>
            )}

            {showAttachments && canAttach && (
              <section className="space-y-3 rounded-lg border p-4" aria-labelledby={`${formId}-files-title`}>
                <header className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Paperclip className="size-4 text-muted-foreground" />
                    <div>
                      <strong id={`${formId}-files-title`} className="block text-sm">Attachments</strong>
                      <small className="text-xs text-muted-foreground">Pictures, video, or documents up to {formatBytes(MAX_ATTACHMENT_BYTES)} each.</small>
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled={files.length >= MAX_ATTACHMENTS_PER_UPLOAD} onClick={() => document.getElementById(`${formId}-files`)?.click()}>
                    <Plus /> Add files
                  </Button>
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
                  <ul className="space-y-2">
                    {files.map((file) => {
                      const KindIcon = KIND_ICONS[fileKind(file.type)]
                      return (
                        <li key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center gap-2 rounded-md border p-2">
                          <KindIcon className="size-4 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate text-sm">{file.name}</strong>
                            <small className="block text-xs text-muted-foreground">{formatBytes(file.size)}</small>
                          </span>
                          <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" aria-label={`Remove ${file.name}`} onClick={() => removeFile(file)}>
                            <Trash2 />
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {!files.length && (
                  <Button type="button" variant="outline" className="w-full" onClick={() => document.getElementById(`${formId}-files`)?.click()}>
                    <Upload /> Choose files to attach
                  </Button>
                )}
                <p aria-live="polite" className="text-xs text-muted-foreground">
                  {files.length >= MAX_ATTACHMENTS_PER_UPLOAD
                    ? `${MAX_ATTACHMENTS_PER_UPLOAD}-file limit reached.`
                    : 'Files upload once the task is created.'}
                </p>
              </section>
            )}

            {(validationError || error) && (
              <Alert variant="destructive">
                <AlertDescription>{validationError || error}</AlertDescription>
              </Alert>
            )}
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={requestClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !draft.title.trim() || !draft.project_id}>{busy ? 'Creating…' : 'Create task'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
