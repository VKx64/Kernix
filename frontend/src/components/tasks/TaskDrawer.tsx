import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, SendHorizontal, Timer, X } from 'lucide-react'
import { Link } from 'react-router'
import { LabelRow } from '@/components/kernix/label-row'
import { Avatar } from '@/components/shared'
import { TaskDrawerFiles } from '@/components/tasks/TaskDrawerFiles'
import { TaskDrawerSubtasks } from '@/components/tasks/TaskDrawerSubtasks'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatClock, formatMinutes, isTaskDone, taskLoggedMinutes } from '@/lib/taskSignals'
import { cn } from '@/lib/utils'
import type { Subtask, Task, UserSummary } from '@/types/api'

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
 * Attachments already on the task are shown here so nothing uploaded from
 * elsewhere goes unseen, but uploading and deleting stay on the full task
 * page along with the other heavier surfaces — emails, completion proof,
 * estimate and work requests — which the header links to.
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
  onToggleTimer,
  canManageFiles,
  filesAdminOverride,
  onFilesChanged,
  canCreateSubtasks,
  subtasksAdminOverride,
  onSubtasksChanged,
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
  onComplete: () => void
  /** True only when the timer is running against *this* task. */
  timerRunning: boolean
  /** Seconds on this task's current run, for the clock in the footer. */
  timerSeconds: number
  timerBusy: boolean
  canTrackTime: boolean
  canLogTime: boolean
  onToggleTimer: () => void
  /** Whether the viewer may upload or delete files from the drawer. */
  canManageFiles: boolean
  filesAdminOverride?: boolean
  onFilesChanged: () => void | Promise<void>
  /** Whether the viewer may add a subtask from the drawer. */
  canCreateSubtasks: boolean
  subtasksAdminOverride?: boolean
  onSubtasksChanged: () => void | Promise<void>
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
  const subtasks = task?.subtasks ?? []
  const attachments = task?.attachments ?? []
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
                <LabelRow>Notes</LabelRow>
                <p className="text-[14px] leading-[1.66] text-[#a8a8b0]">
                  {task.description?.trim() || 'No notes yet.'}
                </p>
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
                      </span>
                      {entry.body && (
                        <span className="text-body-lg leading-[1.6] text-[#c8c8d0] text-pretty">{entry.body}</span>
                      )}
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
