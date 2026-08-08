import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Check, ChevronLeft, ChevronRight, ExternalLink, SendHorizontal, Timer, X } from 'lucide-react'
import { Link } from 'react-router'
import { LabelRow } from '@/components/kernix/label-row'
import { Avatar } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatMinutes, isTaskDone, taskLoggedMinutes } from '@/lib/taskSignals'
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
 * The heavier surfaces — attachments, emails, completion proof, estimate and
 * work requests — stay on the full task page, which the header links to.
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
  timerBusy,
  canTrackTime,
  onToggleTimer,
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
  onComment: (body: string) => Promise<void>
  onComplete: () => void
  /** True only when the timer is running against *this* task. */
  timerRunning: boolean
  timerBusy: boolean
  canTrackTime: boolean
  onToggleTimer: () => void
}) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const taskId = task ? String(task.id) : null

  // A new task means a new thread; keep the draft per task rather than
  // carrying half a sentence into the next one.
  useEffect(() => {
    setDraft('')
    // Guarded rather than called outright: scrollTo is absent in jsdom, and a
    // failure to reset the scroll position must not take the drawer down.
    scrollRef.current?.scrollTo?.({ top: 0 })
  }, [taskId])

  const subtasks = task?.subtasks ?? []
  const doneSubtasks = subtasks.filter((subtask) => Boolean(subtask.completedAt ?? subtask.completed_at)).length
  const logged = formatMinutes(taskLoggedMinutes(task ?? ({} as Task)))
  const done = task ? isTaskDone(task) : false

  const meta = useMemo(() => {
    if (!task) return ''
    return [task.project?.name, task.project?.client?.name, logged && `${logged} logged`]
      .filter(Boolean)
      .join('  ·  ')
  }, [task, logged])

  const send = async () => {
    const body = draft.trim()
    if (!body || commentBusy) return
    await onComment(body)
    setDraft('')
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

              {subtasks.length > 0 && (
                <section className="flex flex-col gap-[9px]">
                  <div className="flex items-center gap-2.5">
                    <LabelRow>Checklist</LabelRow>
                    <span className="font-mono text-[11px] text-label-fg">{doneSubtasks}/{subtasks.length}</span>
                    <span className="h-0.5 flex-1 overflow-hidden rounded-full bg-rail">
                      <span
                        className="block h-full rounded-full bg-good"
                        style={{ width: `${Math.round((doneSubtasks / subtasks.length) * 100)}%` }}
                      />
                    </span>
                  </div>
                  <div className="-mx-2 flex flex-col">
                    {subtasks.map((subtask) => {
                      const subtaskDone = Boolean(subtask.completedAt ?? subtask.completed_at)
                      return (
                        <button
                          key={String(subtask.id)}
                          type="button"
                          onClick={() => onToggleSubtask(subtask)}
                          className="flex items-center gap-[11px] rounded-[7px] p-2 text-left hover:bg-[#16161a]"
                        >
                          <span
                            className={cn(
                              'grid size-4 flex-none place-items-center rounded-full border-[1.5px] text-bg',
                              subtaskDone ? 'border-good bg-good' : 'border-[#55555f]',
                            )}
                          >
                            {subtaskDone && <Check className="size-2.5" strokeWidth={3.5} />}
                          </span>
                          <span className={cn('text-body-lg', subtaskDone ? 'text-t4 line-through' : 'text-[#a8a8b0]')}>
                            {subtask.title}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              )}

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
            <Button
              size="icon-sm"
              disabled={!draft.trim() || commentBusy}
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
