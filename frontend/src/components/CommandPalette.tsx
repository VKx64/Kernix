import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Search } from 'lucide-react'
import { api } from '@/lib/api'
import { useFeature } from '@/lib/features'
import { useCan } from '@/lib/permissions'
import { statusColor } from '@/lib/taskSignals'
import { useTimerContext } from '@/lib/useTimer'
import { cn } from '@/lib/utils'
import type { Paginated, Task } from '@/types/api'

interface PaletteItem {
  key: string
  label: string
  sub?: string
  hint?: string
  color?: string
  run: () => void
}

interface PaletteGroup {
  label: string
  items: PaletteItem[]
}

/**
 * ⌘K — search and commands.
 *
 * The design gives every screen the same entry point rather than a search box
 * per page, so this lives in the shell and the pages know nothing about it.
 * Tasks are searched server-side as you type; commands are matched locally
 * because they are a fixed short list.
 *
 * Enter on an empty result creates the query as a task, which is what makes
 * the box a capture tool and not just a finder.
 */
export function CommandPalette({
  open,
  onClose,
  onShortcuts,
}: {
  open: boolean
  onClose: () => void
  onShortcuts: () => void
}) {
  const navigate = useNavigate()
  const can = useCan()
  const hasFeature = useFeature()
  const timer = useTimerContext()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [tasks, setTasks] = useState<Task[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    setTasks([])
    // A frame late: the input is not in the document until this commit lands.
    const focus = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(focus)
  }, [open])

  useEffect(() => {
    if (!open || !can('tasks.view')) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void api.get<Paginated<Task>>('/api/tasks', { view: 'all', search: query.trim() || undefined, per_page: 5 }, controller.signal)
        .then((response) => setTasks(response.data ?? []))
        .catch(() => { /* The command half of the palette still works. */ })
    }, query ? 180 : 0)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [open, query, can])

  const groups = useMemo<PaletteGroup[]>(() => {
    const needle = query.trim().toLowerCase()
    const go = (label: string, to: string, permission?: string, feature?: string): PaletteItem | null =>
      (permission && !can(permission)) || (feature && !hasFeature(feature))
        ? null
        : { key: to, label, sub: 'Go to', run: () => { onClose(); navigate(to) } }

    const commands: Array<PaletteItem | null> = [
      can('tasks.create') ? { key: 'new', label: 'New task', hint: 'N', run: () => { onClose(); navigate('/tasks?new=1') } } : null,
      go('Dashboard', '/', 'dashboard.view'),
      go('Tasks', '/tasks', 'tasks.view'),
      go('Messages', '/messages', 'messages.view', 'messages'),
      go('Projects', '/projects', 'projects.view', 'projects'),
      go('Clients', '/clients', 'clients.view', 'clients'),
      go('Timesheet', '/timesheet', 'time.track', 'timesheet'),
      timer.state === 'idle' && can('time.track')
        ? { key: 'timer-start', label: 'Start the timer', run: () => { onClose(); void timer.start(null) } }
        : null,
      timer.state !== 'idle'
        ? { key: 'timer-stop', label: 'Stop the timer', run: () => { onClose(); void timer.stop() } }
        : null,
      timer.state === 'break'
        ? { key: 'timer-resume', label: 'Back to work', hint: 'B', run: () => { onClose(); void timer.resume() } }
        : null,
      { key: 'shortcuts', label: 'Shortcuts', hint: '?', run: () => { onClose(); onShortcuts() } },
    ]

    const matched = commands
      .filter((item): item is PaletteItem => item !== null)
      .filter((item) => !needle || item.label.toLowerCase().includes(needle))

    const taskItems: PaletteItem[] = tasks.map((task) => ({
      key: `task-${task.id}`,
      label: task.title,
      sub: task.project?.name ?? '',
      color: statusColor(task.statusValue ?? task.status_value ?? task.status),
      run: () => { onClose(); navigate(`/tasks?open=${task.id}`) },
    }))

    return [
      taskItems.length ? { label: 'Tasks', items: taskItems } : null,
      matched.length ? { label: 'Commands', items: matched } : null,
    ].filter((group): group is PaletteGroup => group !== null)
  }, [query, tasks, can, hasFeature, navigate, onClose, onShortcuts, timer])

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups])

  if (!open) return null

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIndex((current) => (current + 1) % Math.max(1, flat.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex((current) => (current - 1 + flat.length) % Math.max(1, flat.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = flat[index]
      if (item) item.run()
      // Nothing matched, but the box is not empty — take the words as a task.
      else if (query.trim() && can('tasks.create')) {
        onClose()
        navigate(`/tasks?new=1&title=${encodeURIComponent(query.trim())}`)
      }
    }
  }

  let cursor = -1

  return (
    <div className="fixed inset-0 z-[70] flex justify-center pt-[14vh]">
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className="absolute inset-0 animate-in fade-in duration-150 bg-[rgba(4,4,6,0.58)]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="relative h-fit w-[604px] max-w-[calc(100vw-40px)] overflow-hidden rounded-[14px] border border-line-strong bg-elev-low shadow-overlay"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-[15px]">
          <Search className="size-[15px] flex-none text-label-fg" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setIndex(0) }}
            onKeyDown={onKeyDown}
            placeholder="Search tasks or run a command"
            aria-label="Search tasks or run a command"
            className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-t1 outline-none placeholder:text-t4"
          />
        </div>

        <div className="max-h-[372px] overflow-y-auto p-1.5">
          {groups.map((group) => (
            <div key={group.label} className="pb-[3px] pt-[5px]">
              <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-t4">
                {group.label}
              </div>
              {group.items.map((item) => {
                cursor += 1
                const active = cursor === index
                const position = cursor
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={item.run}
                    onMouseEnter={() => setIndex(position)}
                    className={cn(
                      'flex w-full items-center gap-[11px] rounded-lg px-2.5 py-2 text-left',
                      active ? 'bg-[#1f1f25]' : 'bg-transparent',
                    )}
                  >
                    {item.color && (
                      <span aria-hidden="true" className="size-1.5 flex-none rounded-full" style={{ background: item.color }} />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-body-lg text-[#dcdce1]">{item.label}</span>
                      {item.sub && <span className="truncate text-meta text-t4">{item.sub}</span>}
                    </span>
                    {item.hint && <span className="font-mono text-[10.5px] text-t4">{item.hint}</span>}
                  </button>
                )
              })}
            </div>
          ))}

          {!flat.length && (
            <div className="px-5 py-11 text-center text-body-lg text-t3">
              {can('tasks.create')
                ? 'Nothing matches. Press ↵ to create it as a task.'
                : 'Nothing matches.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
