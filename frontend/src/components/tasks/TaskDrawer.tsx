import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Pencil, SendHorizontal, Timer, X } from 'lucide-react'
import { Link } from 'react-router'
import { LabelRow } from '@/components/kernix/label-row'
import { Avatar } from '@/components/shared'
import { TaskDrawerEmails } from '@/components/tasks/TaskDrawerEmails'
import { TaskDrawerFiles } from '@/components/tasks/TaskDrawerFiles'
import { TaskDrawerRequests } from '@/components/tasks/TaskDrawerRequests'
import { TaskDrawerSubtasks } from '@/components/tasks/TaskDrawerSubtasks'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatClock, formatMinutes, isTaskDone, taskLoggedMinutes } from '@/lib/taskSignals'
import { cn } from '@/lib/utils'
import type { EntityId, EstimateRequest, Subtask, Task, TaskWorkRequest, UserSummary } from '@/types/api'

/**
 * The task drawer. It slides over the list rather than replacing it, because the
 * list is the thing you are working through — losing your place to read one task
 * is the cost the design is avoiding.
 *
 * Everything on it is either a fact or one gesture away from being changed: the
 * five fields open the same inline menus the rows do, and the activity log and
 * the comments are one chronological thread rather than two tabs, so "what
 * happened" reads in order regardless of who or what caused it.
 *
 * Files, subtasks, correspondence, the brief itself and the two requests — for
 * more time, and to work on something you are not assigned to — are all here,
 * so reading a task and acting on it cost no navigation. What is left on the
 * full task page is completion proof, which the header still links to.
 */
export interface TaskDrawerField {
  key: string
  label: string
  value: string
  color?: string | null
  user?: UserSummary | null
  disabled?: boolean
  onOpen: (anchor: HTMLElement) => void
}

export interface FeedEntry {
  key: string
  who: string
  user?: UserSummary | null
  what: string
  when: string
  /** A comment renders its body; an event is the one-line summary alone. */
  body?: string
  /** Epoch millis, so comments and events can be interleaved in order. */
  at: number
  /** Set on comments the viewer may still change; events never carry one. */
  noteId?: EntityId
}

export function TaskDrawer({
  task,
  loading,
  fields,
  feed,
  showEvents,
  commentCount,
  canComment,
  canComplete,
  commentBusy,
  hasPrevious,
  hasNext,
  onToggleEvents,
  onClose,
  onPrevious,
  onNext,
  onToggleSubtask,
  onComment,
  onComplete,
  timerRunning,
  timerSeconds,
  timerBusy,
  canTrackTime,
  canLogTime,
  canAdjustTime,
  onToggleTimer,
  onAdjustTime,
  canManageFiles,
  filesAdminOverride,
  onFilesChanged,
  canCreateSubtasks,
  subtasksAdminOverride,
  onSubtasksChanged,
  canEmail,
  emailsAdminOverride,
  onEmailsChanged,
  estimateRequests,
  workRequests,
  canRequestEstimate,
  canReviewWorkRequests,
  currentUserId,
  requestsAdminOverride,
  onRequestsChanged,
  canEditDescription,
  onSaveDescription,
  onEditComment,
  onDeleteComment,
}: {
  task: Task | null
  loading: boolean
  fields: TaskDrawerField[]
  feed: FeedEntry[]
  showEvents: boolean
  commentCount: number
  canComment: boolean
  canComplete: boolean
  commentBusy: boolean
  hasPrevious: boolean
  hasNext: boolean
  onToggleEvents: () => void
  onClose: () => void
  onPrevious: () => void
  onNext: () => void
  onToggleSubtask: (subtask: Subtask) => void
  onComment: (body: string, minutes: number) => Promise<void>
  onAdjustTime: (minutes: number) => Promise<void>
  onComplete: () => void
  /** True only when the timer is running against *this* task. */
  timerRunning: boolean
  /** Seconds on this task's current run, for the clock in the footer. */
  timerSeconds: number
  timerBusy: boolean
  canTrackTime: boolean
  canLogTime: boolean
  /** Correcting the total is a manager's job, not the assignee's. */
  canAdjustTime: boolean
  onToggleTimer: () => void
  /** Whether the viewer may upload or delete files from the drawer. */
  canManageFiles: boolean
  filesAdminOverride?: boolean
  onFilesChanged: () => void | Promise<void>
  /** Whether the viewer may add a subtask from the drawer. */
  canCreateSubtasks: boolean
  subtasksAdminOverride?: boolean
  onSubtasksChanged: () => void | Promise<void>
  /** Whether the viewer may read and send this task's correspondence. */
  canEmail: boolean
  emailsAdminOverride?: boolean
  onEmailsChanged: () => void | Promise<void>
  estimateRequests: EstimateRequest[]
  workRequests: TaskWorkRequest[]
  /** Only the assignee asks for more time, and only while the task is live. */
  canRequestEstimate: boolean
  canReviewWorkRequests: boolean
  currentUserId?: EntityId
  requestsAdminOverride?: boolean
  onRequestsChanged: () => void | Promise<void>
  /** Whether the viewer may rewrite the brief from here. */
  canEditDescription: boolean
  onSaveDescription: (description: string) => Promise<void>
  onEditComment: (noteId: EntityId, body: string) => Promise<void>
  onDeleteComment: (noteId: EntityId) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  // The files section listens on the drawer's own root, so a file dropped
  // anywhere over the panel — not just the FILES section — targets this task.
  const panelRef = useRef<HTMLDivElement>(null)
  const taskId = task ? String(task.id) : null

  // A new task means a new thread; keep the draft per task rather than
  // carrying half a sentence into the next one.
  useEffect(() => {
    setDraft('')
    // Guarded rather than called outright: scrollTo is absent in jsdom, and a
    // failure to reset the scroll position must not take the drawer down.
    scrollRef.current?.scrollTo?.({ top: 0 })
  }, [taskId])

  const [minutesDraft, setMinutesDraft] = useState('')
  const [totalDraft, setTotalDraft] = useState<string | null>(null)
  const [totalBusy, setTotalBusy] = useState(false)
  // null means "not editing"; an empty string is a brief being cleared.
  const [notesDraft, setNotesDraft] = useState<string | null>(null)
  const [notesBusy, setNotesBusy] = useState(false)
  const [commentDraft, setCommentDraft] = useState<{ id: EntityId; body: string } | null>(null)
  const [commentEditBusy, setCommentEditBusy] = useState(false)
  const subtasks = task?.subtasks ?? []
  const attachments = task?.attachments ?? []
  const emails = task?.emails ?? []
  const archived = Boolean(task?.archivedAt ?? task?.archived_at)
  // The run in progress counts towards the total on screen. Without it the
  // task reads as untouched for the whole hour somebody is working on it, and
  // the number only moves when they remember to stop the clock.
  const loggedMinutes = taskLoggedMinutes(task ?? ({} as Task)) + (timerRunning ? Math.floor(timerSeconds / 60) : 0)
  const logged = formatMinutes(loggedMinutes)
  const done = task ? isTaskDone(task) : false

  const meta = useMemo(() => {
    if (!task) return ''
    return [task.project?.name, task.project?.client?.name, logged && `${logged} logged`]
      .filter(Boolean)
      .join('  ·  ')
  }, [task, logged])

  /**
   * A correction is the new total, not a delta: "this took two hours" is what
   * somebody knows, and working out the difference from a number they think is
   * wrong is not their job.
   */
  const commitTotal = async () => {
    const text = totalDraft ?? ''
    setTotalDraft(null)
    const minutes = parseMinutes(text)
    if (!text.trim() || minutes === loggedMinutes) return
    setTotalBusy(true)
    try {
      await onAdjustTime(minutes)
    } finally {
      setTotalBusy(false)
    }
  }

  /** Saves the brief, leaving the editor open if the write fails. */
  const commitNotes = async () => {
    if (notesDraft === null || notesBusy) return
    if (notesDraft === (task?.description ?? '')) {
      setNotesDraft(null)
      return
    }
    setNotesBusy(true)
    try {
      await onSaveDescription(notesDraft)
      setNotesDraft(null)
    } finally {
      setNotesBusy(false)
    }
  }

  const commitComment = async () => {
    if (!commentDraft || commentEditBusy) return
    const body = commentDraft.body.trim()
    if (!body) return
    setCommentEditBusy(true)
    try {
      await onEditComment(commentDraft.id, body)
      setCommentDraft(null)
    } finally {
      setCommentEditBusy(false)
    }
  }

  const removeComment = async (noteId: EntityId) => {
    if (commentEditBusy) return
    if (!window.confirm('Delete this comment?')) return
    setCommentEditBusy(true)
    try {
      await onDeleteComment(noteId)
    } finally {
      setCommentEditBusy(false)
    }
  }

  const send = async () => {
    const body = draft.trim()
    const logged = parseMinutes(minutesDraft)
    // Either half is enough on its own: a note about the work, or the time it
    // took. Requiring both would mean inventing a sentence to log twenty
    // minutes, which is how time stops being logged at all.
    if ((!body && !logged) || commentBusy) return
    await onComment(body, logged)
    setDraft('')
    setMinutesDraft('')
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Close task"
        onClick={onClose}
        className="absolute inset-0 animate-in bg-[rgba(4,4,6,0.5)] fade-in duration-150"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={task?.title ?? 'Task'}
        className="relative flex h-full w-[496px] max-w-full animate-in flex-col border-l border-line bg-[#0e0e10] duration-200 slide-in-from-right-8"
      >
        <div className="flex flex-none items-center gap-1 py-3 pr-3.5 pl-5">
          <span className="flex-1 font-mono text-[11px] text-label-fg">
            {task ? `#${task.id}` : ''}
          </span>
          {task && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="size-[27px]" asChild>
                  <Link to={`/tasks/${task.id}`} aria-label="Open the full task page">
                    <ExternalLink className="size-[11px]" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Full page — files, email, proof</TooltipContent>
            </Tooltip>
          )}
          <Button variant="ghost" size="icon-sm" className="size-[27px]" disabled={!hasPrevious} onClick={onPrevious} aria-label="Previous task">
            <ChevronLeft className="size-[11px]" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="size-[27px]" disabled={!hasNext} onClick={onNext} aria-label="Next task">
            <ChevronRight className="size-[11px]" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="size-[27px]" onClick={onClose} aria-label="Close task">
            <X className="size-[11px]" />
          </Button>
        </div>

        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-[26px] overflow-x-hidden overflow-y-auto px-6 pt-1 pb-8">
          {loading && !task ? (
            <div className="flex flex-col gap-4 pt-2">
              <Skeleton className="h-6 w-4/5" />
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : task ? (
            <>
              <div className="flex flex-col gap-2">
                <h2 className={cn('text-[21px] leading-[1.34] font-semibold tracking-[-0.024em] text-title-strong text-pretty', done && 'line-through')}>
                  {task.title}
                </h2>
                {meta && <span className="text-body-sm text-t3">{meta}</span>}
              </div>

              <div className="grid grid-cols-[76px_1fr] items-center gap-x-2 gap-y-0.5">
                {fields.map((field) => (
                  <Fragmented key={field.key}>
                    <span className="text-body-sm text-t3">{field.label}</span>
                    <button
                      type="button"
                      disabled={field.disabled}
                      onClick={(event: MouseEvent<HTMLButtonElement>) => field.onOpen(event.currentTarget)}
                      className="flex h-[30px] items-center gap-2 rounded-[7px] px-2 text-left disabled:cursor-default hover:bg-soft disabled:hover:bg-transparent"
                    >
                      {field.user ? (
                        <Avatar user={field.user} className="size-[18px]" />
                      ) : field.color ? (
                        <span aria-hidden="true" className="size-[7px] flex-none rounded-full" style={{ background: field.color }} />
                      ) : null}
                      <span className="truncate text-body-sm text-t1">{field.value}</span>
                    </button>
                  </Fragmented>
                ))}
              </div>

              <section className="flex flex-col gap-[9px]">
                <div className="flex items-center gap-2.5">
                  <LabelRow>Notes</LabelRow>
                  <span className="flex-1" />
                  {canEditDescription && notesDraft === null && (
                    <button
                      type="button"
                      onClick={() => setNotesDraft(task.description ?? '')}
                      className="inline-flex h-6 flex-none items-center gap-1 rounded-[7px] px-2 text-[11.5px] whitespace-nowrap text-t3 hover:bg-soft hover:text-t1"
                    >
                      <Pencil className="size-3" />
                      Edit
                    </button>
                  )}
                </div>
                {notesDraft === null ? (
                  // `whitespace-pre-wrap` keeps the line breaks somebody wrote;
                  // collapsing them here is how a formatted brief reads as one
                  // run-on paragraph the moment it comes back from the API.
                  <p
                    onClick={canEditDescription ? () => setNotesDraft(task.description ?? '') : undefined}
                    className={cn(
                      'text-[14px] leading-[1.66] whitespace-pre-wrap text-[#a8a8b0]',
                      canEditDescription && 'cursor-text rounded-[7px] hover:bg-soft',
                    )}
                  >
                    {task.description?.trim() || 'No notes yet.'}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <textarea
                      autoFocus
                      value={notesDraft}
                      disabled={notesBusy}
                      rows={5}
                      onChange={(event) => setNotesDraft(event.target.value)}
                      onKeyDown={(event) => {
                        // Escape is the drawer's own close key, so cancelling
                        // the edit must stop it reaching the window handler.
                        if (event.key === 'Escape') {
                          event.stopPropagation()
                          setNotesDraft(null)
                          return
                        }
                        // Enter belongs to the text — a brief is written in
                        // paragraphs — so saving is the deliberate chord.
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault()
                          void commitNotes()
                        }
                      }}
                      aria-label="Notes"
                      placeholder="What this task is about…"
                      className="resize-none rounded-[7px] border border-line bg-transparent px-2.5 py-1.5 text-[14px] leading-[1.66] text-t1 outline-none placeholder:text-t4 focus:border-line-strong"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={notesBusy}
                        onClick={() => void commitNotes()}
                        className="h-7 rounded-[7px] bg-soft px-2.5 text-[11.5px] text-t1 disabled:opacity-40 hover:bg-line-soft"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={notesBusy}
                        onClick={() => setNotesDraft(null)}
                        className="h-7 rounded-[7px] px-2.5 text-[11.5px] text-t3 hover:bg-soft hover:text-t1"
                      >
                        Cancel
                      </button>
                      <span className="font-mono text-[10.5px] text-t4">⌘↵</span>
                    </div>
                  </div>
                )}
              </section>

              <TaskDrawerFiles
                taskId={task.id}
                attachments={attachments}
                canManage={canManageFiles}
                adminOverride={filesAdminOverride}
                onChanged={onFilesChanged}
                dragContainerRef={panelRef}
              />

              <TaskDrawerSubtasks
                taskId={task.id}
                subtasks={subtasks}
                canManage={canCreateSubtasks}
                adminOverride={subtasksAdminOverride}
                onToggle={onToggleSubtask}
                onCreated={onSubtasksChanged}
              />

              <TaskDrawerEmails
                taskId={task.id}
                emails={emails}
                canManage={canEmail}
                readOnly={archived}
                adminOverride={emailsAdminOverride}
                onChanged={onEmailsChanged}
              />

              <TaskDrawerRequests
                taskId={task.id}
                estimateRequests={estimateRequests}
                workRequests={workRequests}
                canRequestEstimate={canRequestEstimate}
                canReviewWork={canReviewWorkRequests}
                currentUserId={currentUserId}
                adminOverride={requestsAdminOverride}
                onChanged={onRequestsChanged}
              />

              <section className="flex flex-col gap-3.5">
                <div className="flex items-center gap-2.5">
                  <LabelRow>Discussion</LabelRow>
                  <span className="font-mono text-[11px] text-label-fg">{commentCount}</span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={onToggleEvents}
                    className="h-[22px] rounded-sm px-2 text-meta-sm text-t3 hover:bg-line-soft hover:text-t1"
                  >
                    {showEvents ? 'Comments only' : 'Show activity'}
                  </button>
                </div>

                {feed.length === 0 && (
                  <p className="text-meta text-t4">Nothing has happened on this task yet.</p>
                )}

                {feed.map((entry) => (
                  <div key={entry.key} className="flex items-start gap-[11px]">
                    {entry.user ? (
                      <Avatar user={entry.user} className={entry.body ? 'size-[26px]' : 'size-[22px]'} />
                    ) : (
                      <span className={cn('flex-none rounded-full bg-soft', entry.body ? 'size-[26px]' : 'size-[22px]')} />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span className="text-body font-[550] text-[#d4d4d9]">{entry.who}</span>
                        <span className="text-meta text-t3">{entry.what}</span>
                        <span className="text-meta-sm text-t4">{entry.when}</span>
                        {entry.noteId !== undefined && commentDraft?.id !== entry.noteId && (
                          <>
                            <button
                              type="button"
                              onClick={() => setCommentDraft({ id: entry.noteId!, body: entry.body ?? '' })}
                              className="text-meta-sm text-t4 hover:text-t1"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeComment(entry.noteId!)}
                              className="text-meta-sm text-t4 hover:text-destructive"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </span>
                      {entry.noteId !== undefined && commentDraft?.id === entry.noteId ? (
                        <span className="flex flex-col gap-1.5">
                          <textarea
                            autoFocus
                            value={commentDraft.body}
                            disabled={commentEditBusy}
                            rows={3}
                            onChange={(event) => setCommentDraft({ id: commentDraft.id, body: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                event.stopPropagation()
                                setCommentDraft(null)
                                return
                              }
                              if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault()
                                void commitComment()
                              }
                            }}
                            aria-label="Edit comment"
                            className="resize-none rounded-[7px] border border-line bg-transparent px-2.5 py-1.5 text-body-lg leading-[1.5] text-t1 outline-none focus:border-line-strong"
                          />
                          <span className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={commentEditBusy || !commentDraft.body.trim()}
                              onClick={() => void commitComment()}
                              className="h-7 rounded-[7px] bg-soft px-2.5 text-[11.5px] text-t1 disabled:opacity-40 hover:bg-line-soft"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              disabled={commentEditBusy}
                              onClick={() => setCommentDraft(null)}
                              className="h-7 rounded-[7px] px-2.5 text-[11.5px] text-t3 hover:bg-soft hover:text-t1"
                            >
                              Cancel
                            </button>
                          </span>
                        </span>
                      ) : entry.body ? (
                        <span className="text-body-lg leading-[1.6] whitespace-pre-wrap text-[#c8c8d0] text-pretty">{entry.body}</span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </section>
            </>
          ) : null}
        </div>

        {task && canComment && (
          <div className="flex flex-none items-start gap-2.5 border-t border-line-soft px-5 py-3">
            <textarea
              value={draft}
              disabled={commentBusy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && draft) {
                  event.stopPropagation()
                  event.currentTarget.blur()
                  return
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
              rows={1}
              placeholder="Write a comment — ↵ to send"
              className="max-h-[120px] min-h-8 flex-1 resize-none border-0 bg-transparent py-1.5 text-body-lg leading-[1.5] text-t1 outline-none placeholder:text-t4"
            />
            {canLogTime && (
              // Beside the comment rather than behind a separate dialog: the
              // moment somebody has to go looking for it is the moment the
              // time goes unlogged.
              <input
                value={minutesDraft}
                onChange={(event) => setMinutesDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
                inputMode="decimal"
                placeholder="0m"
                aria-label="Time spent"
                title="Time spent — 45, 45m, 1.5h or 1:30"
                className="w-14 self-end rounded-sm border border-line-soft bg-transparent px-1.5 py-1 text-right font-mono text-body-sm text-t2 outline-none placeholder:text-t4 focus:border-line-strong"
              />
            )}
            <Button
              size="icon-sm"
              disabled={(!draft.trim() && !parseMinutes(minutesDraft)) || commentBusy}
              onClick={() => void send()}
              aria-label="Send comment"
            >
              <SendHorizontal className="size-[13px]" />
            </Button>
          </div>
        )}

        {task && (
          <div className="flex flex-none items-center gap-[7px] border-t border-line-soft px-5 py-3">
            <Button disabled={!canComplete} onClick={onComplete}>
              {done ? 'Reopen' : 'Complete'}
            </Button>
            {/* Starting from here also clocks the user in, which is why there
                is no separate clock-in step anywhere in the app. */}
            {canTrackTime && (
              <Button variant="outline" disabled={timerBusy} onClick={onToggleTimer}>
                <Timer className="size-[13px]" />
                {timerRunning ? 'Stop timer' : 'Start timer'}
              </Button>
            )}
            {canAdjustTime && !timerRunning && (
              totalDraft !== null ? (
                <input
                  autoFocus
                  value={totalDraft}
                  disabled={totalBusy}
                  inputMode="decimal"
                  onChange={(event) => setTotalDraft(event.target.value)}
                  onBlur={() => void commitTotal()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void commitTotal() }
                    if (event.key === 'Escape') { event.stopPropagation(); setTotalDraft(null) }
                  }}
                  aria-label="Total time on this task"
                  className="w-20 rounded-sm border border-line-strong bg-inset px-1.5 py-1 text-right font-mono text-body-sm text-t1 outline-none"
                />
              ) : (
                <Button
                  variant="ghost"
                  disabled={totalBusy}
                  onClick={() => setTotalDraft(loggedMinutes ? String(loggedMinutes) : '')}
                  title="Correct what this task actually cost"
                >
                  {logged ? `${logged} logged` : 'Set time'}
                </Button>
              )
            )}
            {timerRunning && (
              // A running clock with nothing on screen counting is
              // indistinguishable from a button that did nothing.
              <span className="font-mono text-body-sm tabular-nums text-ok" aria-label="Time on this run">
                {formatClock(timerSeconds)}
              </span>
            )}
            <span className="flex-1" />
            <span className="font-mono text-[10.5px] text-t4">Esc</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Grid children must be siblings, so the label/value pair needs no wrapper element. */
function Fragmented({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

/**
 * Reads the little time box beside the comment.
 *
 * `45`, `45m`, `1.5h` and `1:30` are all things a person writes for the same
 * span, and the box is too small to explain itself, so it accepts all of them.
 * Anything else reads as zero rather than guessing.
 */
function parseMinutes(input: string): number {
  const text = input.trim().toLowerCase()
  if (!text) return 0

  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])

  const hours = /^(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?$/.exec(text)
  if (hours) return Math.round(Number(hours[1]) * 60)

  const minutes = /^(\d+(?:\.\d+)?)\s*m?(?:ins?|inutes?)?$/.exec(text)
  if (minutes) return Math.round(Number(minutes[1]))

  return 0
}
