import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { File, FileImage, FileVideo, Music, Trash2, X } from 'lucide-react'
import { InlineMenu, type InlineMenuItem, type InlineMenuState } from '@/components/tasks/InlineMenu'
import { Monogram, initialsOf } from '@/components/kernix/monogram'
import { cn } from '@/lib/utils'
import { displayName, fieldLabel } from '../lib/api'
import { MAX_ATTACHMENTS_PER_UPLOAD, MAX_ATTACHMENT_BYTES, fileKind, formatBytes, rejectionReason } from '../lib/attachments'
import { parseTaskDraftTitle } from '../lib/taskDraft'
import {
  draftTaskWithAi,
  findDuplicateTask,
  firstNameOf,
  inferProjectId,
  parseEstimateMinutes,
  suggestAssigneeUserId,
} from '../lib/taskCapture'
import { dueMeta, statusColor, urgencyColor } from '../lib/taskSignals'
import { folderTree } from '../lib/useTaskFolders'
import type { EntityId, FieldValue, Project, Task, TaskFolder, UserSummary } from '../types/api'

/**
 * Quick capture: one field that accepts a whole task.
 *
 * The person types a sentence, the parser lifts owner, urgency, project and
 * date out of it, and what it understood comes back as chips rather than as a
 * form. Details exist, but stay collapsed — the modal has to be usable end to
 * end with the keyboard in a couple of seconds, and a grid of eight selects is
 * not that.
 *
 * Geometry, states, parser grammar and the dirty-tracking rule below all come
 * from "UI Spec — New Task Modal" rev 1.0. Values that read as magic numbers
 * are literal spec values.
 */

const MAX_SUBTASKS = 50
const LAST_PROJECT_STORAGE_KEY = 'kernix.create-task.last-project-id'
const AI_DRAFT_DELAY_MS = 850
/** How long the fields wait for the panel to paint before taking focus. */
const FOCUS_DELAY_MS = 30

/** The colour the spec gives a project or person chip dot. */
const IDENTITY_DOT = '#57a6f0'

function rememberedProjectId(): string {
  try {
    return window.localStorage?.getItem(LAST_PROJECT_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function rememberProjectId(projectId: string) {
  try {
    if (projectId) window.localStorage?.setItem(LAST_PROJECT_STORAGE_KEY, projectId)
  } catch {
    // Storage may be unavailable (private browsing); the default just resets to blank next time.
  }
}

export type CreateTaskPayload = Record<string, unknown> & {
  project_id?: EntityId
  title: string
  subtasks?: Array<{ title: string }>
}

interface CreateTaskModalProps {
  open: boolean
  busy: boolean
  error?: string
  initialProjectId?: string
  projects: Project[]
  /** Projects is turned off for this workspace: no picker, no requirement — the server attaches the hidden default project. */
  projectsEnabled?: boolean
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
  /**
   * What is already on the board. Only used to guess an owner and to warn about
   * a task that already sounds like this one — omit it and both go quiet.
   */
  existingTasks?: Task[]
  notice?: ReactNode
  onProjectChange?: (projectId: EntityId | '') => void
  onErrorDismiss?: () => void
  onOpenTask?: (taskId: EntityId) => void
  onClose: () => void
  onSubmit: (payload: CreateTaskPayload, files: File[]) => void | Promise<void>
}

/** Every field the detail panel can hand back to the parser once untouched. */
type DraftField = 'project' | 'folder' | 'assignee' | 'status' | 'type' | 'urgency' | 'due' | 'estimate'

interface CaptureDraft {
  project_id: string
  task_folder_id: string
  assignee_user_id: string
  status_value_id: string
  type_value_id: string
  urgency_value_id: string
  due_date: string
  estimate_text: string
}

/**
 * What the parser has already lifted out of the sentence. It has to be kept
 * rather than re-derived, because a token vanishes from the field the moment it
 * resolves — the fact it produced is all that is left of it.
 */
interface ResolvedFacts {
  project?: string
  assignee?: string
  urgency?: string
  due?: string
}

const EMPTY_DRAFT: CaptureDraft = {
  project_id: '',
  task_folder_id: '',
  assignee_user_id: '',
  status_value_id: '',
  type_value_id: '',
  urgency_value_id: '',
  due_date: '',
  estimate_text: '',
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

function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function defaultFieldValue(options: FieldValue[], key: string, fallbackLabel: string) {
  return options.find((value) => {
    const candidateKey = value.key ?? (value as FieldValue & { key_name?: string }).key_name
    return candidateKey === key || value.label.trim().toLowerCase() === fallbackLabel.toLowerCase()
  })
}

function labelOf(options: FieldValue[], id: string): string {
  const match = options.find((option) => String(option.id) === id)
  return match ? fieldLabel(match) : ''
}

/** `#websiterelaunch` — what a suggestion pill appends so the parser resolves it. */
function projectToken(project: Project): string {
  return `#${project.name.replace(/[^A-Za-z0-9]/g, '')}`
}

export function CreateTaskModal({
  open,
  busy,
  error,
  initialProjectId,
  projects,
  projectsEnabled = true,
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
  existingTasks,
  notice,
  onProjectChange,
  onErrorDismiss,
  onOpenTask,
  onClose,
  onSubmit,
}: CreateTaskModalProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const stepRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [resolved, setResolved] = useState<ResolvedFacts>({})
  const [detailOpen, setDetailOpen] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [draft, setDraft] = useState<CaptureDraft>(EMPTY_DRAFT)
  const [dirty, setDirty] = useState<Partial<Record<DraftField, boolean>>>({})
  const [notes, setNotes] = useState('')
  const [subs, setSubs] = useState<string[]>([])
  const [step, setStep] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [validationError, setValidationError] = useState('')
  const [menu, setMenu] = useState<(InlineMenuState & { kind: DraftField }) | null>(null)

  const defaultStatus = defaultFieldValue(statusOptions, 'pending', 'Pending')
  const defaultType = defaultFieldValue(typeOptions, 'task', 'Task')
  const defaultUrgency = defaultFieldValue(urgencyOptions, 'normal', 'Normal')

  useEffect(() => {
    if (!open) return
    setText('')
    setResolved({})
    setDetailOpen(false)
    setAiBusy(false)
    setDraft(EMPTY_DRAFT)
    setDirty({})
    setNotes('')
    setSubs([])
    setStep('')
    setFiles([])
    setValidationError('')
    setMenu(null)
    const timer = window.setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  const tasks = useMemo(() => existingTasks ?? [], [existingTasks])
  const fallbackProject = initialProjectId ?? rememberedProjectId()
  const guessedProjectId = useMemo(
    () => (resolved.project ? '' : inferProjectId(text, projects, fallbackProject)),
    [fallbackProject, projects, resolved.project, text],
  )

  /**
   * The one rule that is easy to get wrong: a field the person edited by hand
   * stops following the text forever, and every untouched field keeps tracking
   * it — a resolved token, an inference, and then nothing.
   */
  const projectId = dirty.project ? draft.project_id : resolved.project ?? guessedProjectId
  const assigneeUserId = dirty.assignee ? draft.assignee_user_id : resolved.assignee ?? ''
  const urgencyValueId = dirty.urgency ? draft.urgency_value_id : resolved.urgency ?? ''
  const dueDate = dirty.due ? draft.due_date : resolved.due ?? ''
  const statusValueId = dirty.status ? draft.status_value_id : ''
  const typeValueId = dirty.type ? draft.type_value_id : ''
  const folderId = dirty.folder ? draft.task_folder_id : ''
  const estimateText = dirty.estimate ? draft.estimate_text : ''

  const project = projects.find((candidate) => String(candidate.id) === String(projectId))
  const assignee = users.find((candidate) => String(candidate.id) === assigneeUserId)

  const suggestedAssigneeId = useMemo(
    () => (canAssign && !assigneeUserId ? suggestAssigneeUserId(projectId, tasks) : ''),
    [assigneeUserId, canAssign, projectId, tasks],
  )
  const suggestedAssignee = users.find((candidate) => String(candidate.id) === suggestedAssigneeId)
  const suggestedDue = useMemo(() => {
    const now = new Date()
    return toIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2))
  }, [])
  const suggestedProject = resolved.project || dirty.project
    ? undefined
    : projects.find((candidate) => String(candidate.id) === String(guessedProjectId))

  const duplicate = useMemo(
    () => (text.trim().length > 6 ? findDuplicateTask(text, tasks) : null),
    [tasks, text],
  )

  // Folders belong to a project, so the page has to be told which one is in
  // play before it can offer any — including the one that was only inferred.
  const notifyProject = useRef('')
  useEffect(() => {
    if (!open || notifyProject.current === projectId) return
    notifyProject.current = projectId
    onProjectChange?.(projectId)
  }, [onProjectChange, open, projectId])

  const dismissErrors = useCallback(() => {
    setValidationError((current) => (current ? '' : current))
    if (error) onErrorDismiss?.()
  }, [error, onErrorDismiss])

  const setField = (field: DraftField, key: keyof CaptureDraft, value: string) => {
    dismissErrors()
    setDirty((current) => ({ ...current, [field]: true }))
    setDraft((current) => ({
      ...current,
      [key]: value,
      // A different project cannot keep the previous project's folder.
      ...(field === 'project' ? { task_folder_id: '' } : {}),
    }))
    if (field === 'project') {
      setDirty((current) => ({ ...current, folder: false }))
      rememberProjectId(value)
    }
  }

  /**
   * Every keystroke goes through the parser: a token that resolves is lifted
   * out of the field and becomes a chip, and a token that resolves to nothing
   * is left exactly where it was typed.
   *
   * A resolved token also clears the matching hand-set value — typing
   * `!critical` after picking High is the person changing their mind, not the
   * text fighting the form.
   */
  const readText = (value: string, settled = false) => {
    dismissErrors()
    const parsed = parseTaskDraftTitle(value, { users, urgencyOptions, projects, now: new Date(), settled })
    setText(parsed.title)

    const facts: ResolvedFacts = {}
    const cleared: Partial<Record<DraftField, boolean>> = {}
    if (parsed.projectId) {
      facts.project = parsed.projectId
      cleared.project = false
    }
    if (parsed.assigneeUserId) {
      facts.assignee = parsed.assigneeUserId
      cleared.assignee = false
    }
    if (parsed.urgencyValueId) {
      facts.urgency = parsed.urgencyValueId
      cleared.urgency = false
    }
    if (parsed.dueDate) {
      facts.due = parsed.dueDate
      cleared.due = false
    }
    if (Object.keys(facts).length) {
      setResolved((current) => ({ ...current, ...facts }))
      setDirty((current) => ({ ...current, ...cleared }))
    }
    return parsed.title
  }

  /** Suggestion pills append text so the parser — not a side channel — applies them. */
  const applySuggestion = (token: string) => {
    const next = `${text.replace(/\s+$/, '')} ${token} `.replace(/^\s+/, '')
    readText(next)
    inputRef.current?.focus()
  }

  const requestClose = useCallback(() => {
    if (busy) return
    onClose()
  }, [busy, onClose])

  // Escape closes capture wherever focus happens to be — including inside a
  // popover menu, which the spec puts *below* capture in the precedence list.
  useEffect(() => {
    if (!open) return
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      requestClose()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [open, requestClose])

  const runAiDraft = () => {
    if (aiBusy) return
    // Settling first resolves a token still sitting at the end of the line, so
    // the draft is written against the same facts the chips show.
    const title = readText(text, true).trim()
    if (!title) {
      inputRef.current?.focus()
      return
    }
    setAiBusy(true)
    window.setTimeout(() => {
      const owner = assigneeUserId || suggestedAssigneeId
      const inferredOwner = !assigneeUserId && owner
        ? firstNameOf(users.find((candidate) => String(candidate.id) === owner))
        : ''
      const result = draftTaskWithAi(title, inferredOwner)
      const escalated = urgencyOptions.find((option) => fieldLabel(option).trim().toLowerCase() === result.urgency)
      const urgency = urgencyValueId || String((escalated ?? defaultUrgency)?.id ?? '')

      setAiBusy(false)
      setDetailOpen(true)
      setNotes(result.note)
      setSubs(canCreateSubtasks ? result.steps.slice(0, MAX_SUBTASKS) : [])
      setDraft((current) => ({
        ...current,
        project_id: projectId,
        assignee_user_id: canAssign ? owner : '',
        urgency_value_id: urgency,
        due_date: dueDate || suggestedDue,
        estimate_text: canEstimate ? `${Math.round(result.estimateMinutes / 60)}h` : '',
      }))
      // The draft has to survive further typing, so everything it decided is
      // marked as touched in one go.
      setDirty((current) => ({
        ...current,
        project: true,
        assignee: true,
        urgency: true,
        due: true,
        estimate: true,
      }))
    }, AI_DRAFT_DELAY_MS)
  }

  const addStep = (value: string) => {
    const title = value.trim()
    if (!title) return
    if (subs.length >= MAX_SUBTASKS) {
      setValidationError(`${MAX_SUBTASKS}-subtask limit reached.`)
      return
    }
    setSubs((current) => [...current, title])
    setStep('')
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
      if (accepted.length > room) setValidationError(`Only the first ${room} of the selected files were attached.`)
      return [...current, ...accepted.slice(0, room)]
    })
  }

  const submit = () => {
    if (busy) return
    // Submitting settles a trailing token, so "call Ana tomorrow" sets the due
    // date even when the field was never left.
    const settled = parseTaskDraftTitle(text, { users, urgencyOptions, projects, now: new Date(), settled: true })
    const title = settled.title.trim() || 'Untitled'
    const finalProject = dirty.project
      ? draft.project_id
      : settled.projectId ?? resolved.project ?? guessedProjectId
    if (!finalProject && projectsEnabled) {
      setValidationError('Choose the project this task belongs to.')
      setDetailOpen(true)
      return
    }

    const payload: CreateTaskPayload = { title }
    optional(payload, 'project_id', finalProject ?? '')
    optional(payload, 'task_folder_id', folderId)
    optional(payload, 'status_value_id', statusValueId)
    optional(payload, 'type_value_id', typeValueId)
    optional(payload, 'urgency_value_id', dirty.urgency ? draft.urgency_value_id : settled.urgencyValueId ?? urgencyValueId)
    optional(payload, 'assignee_user_id', dirty.assignee ? draft.assignee_user_id : settled.assigneeUserId ?? assigneeUserId)
    optional(payload, 'due_date', dirty.due ? draft.due_date : settled.dueDate ?? dueDate)
    if (notes.trim()) payload.description = notes.trim()
    const minutes = parseEstimateMinutes(estimateText)
    if (canEstimate && minutes !== null) payload.estimated_minutes = minutes
    if (canCreateSubtasks && subs.length) payload.subtasks = subs.map((subtask) => ({ title: subtask }))
    void onSubmit(payload, canAttach ? files : [])
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const meta = event.metaKey || event.ctrlKey
    if (event.key === 'Enter' && meta && event.shiftKey) {
      event.preventDefault()
      runAiDraft()
      return
    }
    if (event.key === 'Enter' && meta) {
      event.preventDefault()
      setDetailOpen((current) => !current)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (text.trim()) submit()
    }
  }

  const openMenu = (kind: DraftField) => (event: MouseEvent<HTMLElement>) => {
    setMenu({ kind, anchor: event.currentTarget })
  }

  const closeMenu = () => setMenu(null)

  const menuItems = ((): { title: string; items: InlineMenuItem[] } => {
    const pick = (field: DraftField, key: keyof CaptureDraft) => (value: string) => {
      setField(field, key, value)
      closeMenu()
    }
    switch (menu?.kind) {
      case 'project':
        return {
          title: 'Project',
          items: projects.map((candidate) => ({
            key: String(candidate.id),
            label: candidate.name,
            hint: String(candidate.id) === projectId ? '✓' : undefined,
            onSelect: () => pick('project', 'project_id')(String(candidate.id)),
          })),
        }
      case 'folder':
        return {
          title: 'Folder',
          items: [
            { key: '', label: 'Ungrouped', onSelect: () => pick('folder', 'task_folder_id')('') },
            ...folderTree(folders).map((node) => ({
              key: String(node.folder.id),
              label: node.path,
              hint: String(node.folder.id) === folderId ? '✓' : undefined,
              onSelect: () => pick('folder', 'task_folder_id')(String(node.folder.id)),
            })),
          ],
        }
      case 'assignee':
        return {
          title: 'Assignee',
          items: [
            { key: '', label: 'Unassigned', onSelect: () => pick('assignee', 'assignee_user_id')('') },
            ...users.map((user) => ({
              key: String(user.id),
              label: displayName(user),
              hint: String(user.id) === assigneeUserId ? '✓' : undefined,
              onSelect: () => pick('assignee', 'assignee_user_id')(String(user.id)),
            })),
          ],
        }
      case 'urgency':
        return {
          title: 'Urgency',
          items: urgencyOptions.map((option) => ({
            key: String(option.id),
            label: fieldLabel(option),
            color: urgencyColor(option),
            hint: String(option.id) === urgencyValueId ? '✓' : undefined,
            onSelect: () => pick('urgency', 'urgency_value_id')(String(option.id)),
          })),
        }
      case 'status':
        return {
          title: 'Status',
          items: statusOptions.map((option) => ({
            key: String(option.id),
            label: fieldLabel(option),
            color: statusColor(option),
            hint: String(option.id) === statusValueId ? '✓' : undefined,
            onSelect: () => pick('status', 'status_value_id')(String(option.id)),
          })),
        }
      case 'type':
        return {
          title: 'Type',
          items: typeOptions.map((option) => ({
            key: String(option.id),
            label: fieldLabel(option),
            hint: String(option.id) === typeValueId ? '✓' : undefined,
            onSelect: () => pick('type', 'type_value_id')(String(option.id)),
          })),
        }
      default:
        return { title: '', items: [] }
    }
  })()

  if (!open) return null

  const due = dueMeta(dueDate)
  const chips: Array<{ key: string; label: string; color: string }> = []
  if (project) chips.push({ key: 'project', label: project.name, color: IDENTITY_DOT })
  if (assignee) chips.push({ key: 'assignee', label: displayName(assignee), color: IDENTITY_DOT })
  if (urgencyValueId) {
    const option = urgencyOptions.find((candidate) => String(candidate.id) === urgencyValueId)
    if (option) chips.push({ key: 'urgency', label: fieldLabel(option), color: urgencyColor(option) })
  }
  if (dueDate) {
    chips.push({
      key: 'due',
      label: due.label,
      color: due.tone === 'over' ? 'var(--danger)' : due.tone === 'today' ? 'var(--warn)' : 'var(--t3)',
    })
  }

  const pills: Array<{ key: string; label: string; color: string; token: string }> = []
  if (suggestedProject) {
    pills.push({
      key: 'project',
      label: suggestedProject.name,
      color: IDENTITY_DOT,
      token: projectToken(suggestedProject),
    })
  }
  if (suggestedAssignee) {
    pills.push({
      key: 'assignee',
      label: `${firstNameOf(suggestedAssignee)} usually owns this`,
      color: IDENTITY_DOT,
      token: `@${firstNameOf(suggestedAssignee)}`,
    })
  }
  if (!dueDate) pills.push({ key: 'due', label: 'Due in 2 days', color: 'var(--warn)', token: 'in 2 days' })

  const canCreate = Boolean(text.trim()) && !busy

  return (
    <div
      className="fixed inset-0 z-[65] flex animate-v-fade justify-center overflow-y-auto bg-[rgba(4,4,6,.58)] pt-[16vh] pb-10"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New task"
        className="h-fit w-[604px] max-w-[calc(100vw-40px)] animate-v-lift overflow-hidden rounded-[14px] border border-[#26262c] bg-[#131316] shadow-overlay"
        onKeyDown={onKeyDown}
      >
        {notice}

        <input
          ref={inputRef}
          aria-label="Task title"
          maxLength={255}
          value={text}
          placeholder="What needs doing?"
          onChange={(event) => readText(event.target.value)}
          // Leaving the field settles whatever token was still being typed.
          onBlur={(event) => readText(event.target.value, true)}
          className="w-full border-0 bg-transparent px-5 pt-[19px] pb-[17px] text-[17px] leading-[21px] font-[450] tracking-[-0.012em] text-t1 outline-none placeholder:text-t4"
        />

        {(chips.length > 0 || pills.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3.5">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex h-[26px] items-center gap-1.5 rounded-[7px] bg-line-soft px-[9px] text-meta font-medium text-[#b4b4bc]"
              >
                <span aria-hidden="true" className="size-[5px] rounded-full" style={{ background: chip.color }} />
                {chip.label}
              </span>
            ))}
            {pills.map((pill) => (
              <button
                key={pill.key}
                type="button"
                onClick={() => applySuggestion(pill.token)}
                className="inline-flex h-[26px] items-center gap-1.5 rounded-[7px] border border-dashed border-[#5a5a64] px-[9px] text-meta text-t3 hover:border-solid hover:border-[#3d3d46] hover:text-t1"
              >
                <span aria-hidden="true" className="size-[5px] rounded-full" style={{ background: pill.color }} />
                {pill.label}
              </button>
            ))}
          </div>
        )}

        {aiBusy && (
          <div className="flex items-center gap-2.5 border-t border-line px-5 py-[13px]">
            <span aria-hidden="true" className="size-1.5 flex-none animate-live-pulse rounded-full bg-brand" />
            <span className="text-body-sm text-t3">Drafting scope, owner and steps…</span>
          </div>
        )}

        {detailOpen && (
          <div
            className="flex max-h-[46vh] flex-col gap-4 overflow-y-auto border-t border-line px-5 pt-[15px] pb-[17px]"
            onScroll={closeMenu}
          >
            <div className="grid grid-cols-1 gap-x-[18px] gap-y-0.5 sm:grid-cols-2">
              <FieldRow
                label="Project"
                value={project?.name}
                placeholder="Choose a project"
                readOnly={Boolean(initialProjectId)}
                onOpen={openMenu('project')}
              />
              {canAssign && (
                <FieldRow
                  label="Assignee"
                  value={assignee ? displayName(assignee) : undefined}
                  placeholder="Unassigned"
                  onOpen={openMenu('assignee')}
                >
                  {assignee && (
                    <Monogram size="xs" name={displayName(assignee)} initials={initialsOf(displayName(assignee))} />
                  )}
                </FieldRow>
              )}
              <FieldRow label="Due" htmlFor="capture-due">
                <input
                  id="capture-due"
                  aria-label="Due date"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setField('due', 'due_date', event.target.value)}
                  className="w-full border-0 bg-transparent text-body text-t1 outline-none [&::-webkit-calendar-picker-indicator]:hidden"
                />
              </FieldRow>
              <FieldRow
                label="Urgency"
                value={labelOf(urgencyOptions, urgencyValueId) || defaultUrgency?.label}
                onOpen={openMenu('urgency')}
              >
                <span
                  aria-hidden="true"
                  className="size-[7px] flex-none rounded-full"
                  style={{ background: urgencyColor(urgencyOptions.find((option) => String(option.id) === urgencyValueId) ?? defaultUrgency) }}
                />
              </FieldRow>
              {canChangeStatus && statusOptions.length > 0 && (
                <FieldRow
                  label="Status"
                  value={labelOf(statusOptions, statusValueId) || defaultStatus?.label}
                  onOpen={openMenu('status')}
                >
                  <span
                    aria-hidden="true"
                    className="size-[7px] flex-none rounded-full"
                    style={{ background: statusColor(statusOptions.find((option) => String(option.id) === statusValueId) ?? defaultStatus) }}
                  />
                </FieldRow>
              )}
              {canEstimate && (
                <FieldRow label="Estimate" htmlFor="capture-estimate">
                  <input
                    id="capture-estimate"
                    aria-label="Estimate"
                    value={estimateText}
                    placeholder="3h"
                    onChange={(event) => setField('estimate', 'estimate_text', event.target.value)}
                    className="w-full border-0 bg-transparent text-body text-t1 outline-none placeholder:text-t4"
                  />
                </FieldRow>
              )}
              <FieldRow
                label="Folder"
                value={folders.find((folder) => String(folder.id) === folderId)?.name}
                placeholder={!projectId ? 'Choose a project first' : foldersLoading ? 'Loading…' : 'Ungrouped'}
                readOnly={!projectId || foldersLoading}
                onOpen={openMenu('folder')}
              />
              {typeOptions.length > 0 && (
                <FieldRow
                  label="Type"
                  value={labelOf(typeOptions, typeValueId) || defaultType?.label}
                  onOpen={openMenu('type')}
                />
              )}
            </div>

            <div className="flex flex-col gap-[7px]">
              <span className="text-label uppercase text-label-fg">Notes</span>
              <textarea
                aria-label="Notes"
                rows={3}
                value={notes}
                placeholder="Anything the person picking this up needs to know…"
                onChange={(event) => setNotes(event.target.value)}
                className="min-h-[68px] w-full resize-y rounded-[9px] border border-[#26262c] bg-[#0f0f11] px-[11px] py-2.5 text-body-lg text-[#c4c4cc] outline-none placeholder:text-t4"
              />
            </div>

            {canCreateSubtasks && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-[9px]">
                  <span className="text-label uppercase text-label-fg">Checklist</span>
                  {subs.length > 0 && (
                    <span className="font-mono text-[11px] text-label-fg">
                      {subs.length} {subs.length === 1 ? 'step' : 'steps'}
                    </span>
                  )}
                </div>
                <div className="-mx-2 flex flex-col">
                  {subs.map((subtask, index) => (
                    <div key={`${subtask}-${index}`} className="group flex items-center gap-[11px] rounded-md px-2 py-1.5 hover:bg-line-soft">
                      <span aria-hidden="true" className="size-[15px] flex-none rounded border-[1.5px] border-[#55555f]" />
                      <span className="min-w-0 flex-1 truncate text-body-lg text-[#c4c4cc]">{subtask}</span>
                      <button
                        type="button"
                        aria-label={`Remove step ${index + 1}`}
                        onClick={() => setSubs((current) => current.filter((_, at) => at !== index))}
                        className="text-t4 opacity-0 group-hover:opacity-100 hover:text-t1"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-[11px] px-2 py-1.5">
                    <span aria-hidden="true" className="size-[15px] flex-none rounded border-[1.5px] border-dashed border-[#3a3a43]" />
                    <input
                      ref={stepRef}
                      aria-label="Add a step"
                      value={step}
                      placeholder="Add a step"
                      maxLength={255}
                      onChange={(event) => setStep(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        // Stops the modal submitting the task instead.
                        event.preventDefault()
                        event.stopPropagation()
                        addStep(step)
                      }}
                      className="min-w-0 flex-1 border-0 bg-transparent text-body-lg text-[#c4c4cc] outline-none placeholder:text-t4"
                    />
                  </div>
                </div>
              </div>
            )}

            {canAttach && (
              <div className="flex flex-col gap-[7px]">
                <div className="flex items-center gap-[9px]">
                  <span className="text-label uppercase text-label-fg">Attachments</span>
                  <button
                    type="button"
                    disabled={files.length >= MAX_ATTACHMENTS_PER_UPLOAD}
                    onClick={() => fileRef.current?.click()}
                    className="font-mono text-[11px] text-t4 hover:text-t1 disabled:pointer-events-none disabled:opacity-50"
                  >
                    add · up to {formatBytes(MAX_ATTACHMENT_BYTES)} each
                  </button>
                </div>
                <input
                  ref={fileRef}
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
                  <ul className="-mx-2 flex flex-col">
                    {files.map((file) => {
                      const KindIcon = KIND_ICONS[fileKind(file.type)]
                      return (
                        <li
                          key={`${file.name}-${file.size}-${file.lastModified}`}
                          className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-line-soft"
                        >
                          <KindIcon className="size-3.5 flex-none text-t4" />
                          <span className="min-w-0 flex-1 truncate text-body-sm text-[#c4c4cc]">{file.name}</span>
                          <span className="font-mono text-[11px] text-t4">{formatBytes(file.size)}</span>
                          <button
                            type="button"
                            aria-label={`Remove ${file.name}`}
                            onClick={() => setFiles((current) => current.filter((candidate) => candidate !== file))}
                            className="text-t4 opacity-0 group-hover:opacity-100 hover:text-danger"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}

            {folderError && <p className="text-meta-sm text-danger">{folderError}</p>}
          </div>
        )}

        {duplicate && (
          <button
            type="button"
            onClick={() => {
              onOpenTask?.(duplicate.id)
              onClose()
            }}
            className="flex w-full items-center gap-2.5 border-t border-line px-5 py-[11px] text-left hover:bg-soft"
          >
            <span aria-hidden="true" className="size-[5px] flex-none rounded-full bg-warn" />
            <span className="min-w-0 flex-1 truncate text-body-sm text-t3">
              Similar task exists — <span className="text-[#d4d4d9]">{duplicate.title}</span>
            </span>
            <span className="flex-none text-meta-sm text-label-fg">Open it</span>
          </button>
        )}

        {(validationError || error) && (
          <p role="alert" className="border-t border-line px-5 py-[11px] text-body-sm text-danger">
            {validationError || error}
          </p>
        )}

        <div className="flex items-center gap-[7px] border-t border-line bg-[#101012] py-2.5 pr-3 pl-[13px]">
          <button
            type="button"
            onClick={() => setDetailOpen((current) => !current)}
            className={cn(
              'inline-flex h-[30px] items-center gap-[7px] rounded-lg px-[11px] text-body-sm font-[550] hover:bg-[#1f1f24] hover:text-t1',
              detailOpen ? 'bg-[#1f1f24] text-t1' : 'text-t2',
            )}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2.4 3.4h7.2M2.4 6h7.2M2.4 8.6h4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            {detailOpen ? 'Hide details' : 'Add details'}
          </button>

          <button
            type="button"
            disabled={aiBusy}
            onClick={runAiDraft}
            className={cn(
              'inline-flex h-[30px] items-center gap-[7px] rounded-lg bg-[#1c1d2e] px-[11px] text-body-sm font-[550] text-[#a8abfb] hover:bg-[#23243a] hover:text-[#c8caff]',
              aiBusy && 'pointer-events-none opacity-60',
            )}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 1.8 8.2 5 11.4 6.2 8.2 7.4 7 10.6 5.8 7.4 2.6 6.2 5.8 5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            {aiBusy ? 'Drafting…' : 'Draft with AI'}
          </button>

          <span className="flex-1" />

          <span
            title="Type @owner for the assignee, !high for urgency, #project to file it, and a date like Friday or in 3 days."
            className="mr-0.5 grid size-[26px] cursor-help place-items-center rounded-full text-t4 hover:bg-[#1f1f24] hover:text-t1"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
              <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="8" cy="5" r=".85" fill="currentColor" />
            </svg>
          </span>

          <button
            type="button"
            onClick={requestClose}
            className="inline-flex h-[30px] items-center px-[11px] text-body-sm text-t3 hover:text-t1"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={!canCreate}
            onClick={submit}
            className={cn(
              'inline-flex h-[30px] items-center gap-[7px] rounded-lg px-3 text-body-sm font-semibold',
              canCreate ? 'bg-t1 text-bg hover:brightness-[1.08]' : 'pointer-events-none bg-[#1f1f24] text-t4',
            )}
          >
            {busy ? 'Creating…' : 'Create'}
            <span aria-hidden="true" className="font-mono text-[10px] opacity-50">↵</span>
          </button>
        </div>
      </div>

      <InlineMenu state={menu} title={menuItems.title} items={menuItems.items} onClose={closeMenu} />
    </div>
  )
}

/**
 * One line of the detail panel: a 62px label gutter and a 32px row whose whole
 * width is the hit target, so a value opens its menu without aiming at the text.
 */
function FieldRow({
  label,
  value,
  placeholder,
  htmlFor,
  readOnly = false,
  onOpen,
  children,
}: {
  label: string
  value?: string
  placeholder?: string
  htmlFor?: string
  readOnly?: boolean
  onOpen?: (event: MouseEvent<HTMLElement>) => void
  children?: ReactNode
}) {
  const body = (
    <>
      <span className="w-[62px] flex-none text-meta text-t3">{label}</span>
      {children}
      {(value || placeholder) && (
        <span className={cn('min-w-0 truncate text-body', value ? 'text-t1' : 'text-t4')}>{value || placeholder}</span>
      )}
    </>
  )

  if (onOpen && !readOnly) {
    return (
      <button
        type="button"
        aria-label={label}
        onClick={onOpen}
        className="-mx-[9px] flex h-8 items-center gap-[9px] rounded-md px-[9px] text-left hover:bg-line-soft"
      >
        {body}
      </button>
    )
  }

  return (
    <label htmlFor={htmlFor} className="-mx-[9px] flex h-8 items-center gap-[9px] rounded-md px-[9px]">
      {body}
    </label>
  )
}
