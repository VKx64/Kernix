import { Plus } from 'lucide-react'
import type { MouseEvent } from 'react'
import { Avatar } from '@/components/shared'
import { displayName } from '@/lib/api'
import { dueMeta, isTaskDone, railColor, taskDueDate, taskUrgencyValue, urgencyRank } from '@/lib/taskSignals'
import type { TaskGroup } from '@/lib/taskTriage'
import { cn } from '@/lib/utils'
import type { Task } from '@/types/api'

/**
 * The same groups the list shows, stood on their side.
 *
 * The columns are whatever the current grouping produced — the board does not
 * decide its own axis — and an empty column is kept rather than dropped, because
 * on a board the absence of work in a column is the information.
 *
 * A card is a row minus the columns that make no sense stacked: no status cell
 * (the column already says it when grouping by status), no inline menus. It
 * keeps the urgency rail, the title, the project, the due date and the owner.
 */
export function TaskBoard({
  groups,
  cursorId,
  selectedIds,
  onOpen,
  onAdd,
}: {
  groups: TaskGroup[]
  cursorId: string | null
  selectedIds: string[]
  onOpen: (task: Task, event: MouseEvent) => void
  onAdd?: () => void
}) {
  return (
    <div className="flex items-start gap-3.5 overflow-x-auto pt-4">
      {groups.map((group) => (
        <section key={group.key} className="flex w-[272px] flex-none flex-col gap-2.5">
          <div className="flex items-center gap-2 px-0.5">
            <span
              aria-hidden="true"
              className="size-1.5 flex-none rounded-full"
              style={{ background: group.color ?? 'var(--t4)' }}
            />
            <span className="truncate text-meta font-semibold tracking-[0.02em] text-t2">{group.label}</span>
            <span className="font-mono text-[11px] text-t3">{group.tasks.length}</span>
            {onAdd && (
              <button
                type="button"
                aria-label={`Add a task to ${group.label}`}
                onClick={onAdd}
                className="ml-auto grid size-[22px] place-items-center rounded-sm text-t4 hover:bg-soft hover:text-t1"
              >
                <Plus className="size-[11px]" />
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            {group.tasks.map((task) => (
              <TaskCard
                key={String(task.id)}
                task={task}
                cursor={cursorId === String(task.id)}
                selected={selectedIds.includes(String(task.id))}
                onOpen={onOpen}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function TaskCard({
  task,
  cursor,
  selected,
  onOpen,
}: {
  task: Task
  cursor: boolean
  selected: boolean
  onOpen: (task: Task, event: MouseEvent) => void
}) {
  const done = isTaskDone(task)
  const urgency = taskUrgencyValue(task)
  const critical = urgencyRank(urgency) === 0 && !done
  const due = dueMeta(taskDueDate(task))
  const assignee = task.assignee

  return (
    <button
      type="button"
      aria-selected={selected}
      data-task-id={String(task.id)}
      onClick={(event) => onOpen(task, event)}
      style={{ borderLeftColor: railColor(urgency, done) ?? 'var(--rail)' }}
      className={cn(
        'flex w-full flex-col gap-2.5 rounded-[9px] border border-l-2 border-rail px-3 py-[11px] text-left transition-colors hover:border-line-strong hover:bg-soft',
        selected ? 'bg-row-selected' : cursor ? 'bg-elev' : 'bg-elev-low',
        done && 'opacity-45',
      )}
    >
      <span
        className={cn(
          'text-body leading-[1.45] text-pretty',
          done ? 'text-t3 line-through' : critical ? 'font-semibold text-title-strong' : 'font-[450] text-title',
        )}
      >
        {task.title}
      </span>
      <span className="flex items-center gap-[9px]">
        <span className="flex-1 truncate text-meta-sm text-t3">{task.project?.name ?? 'No project'}</span>
        <span className={cn('flex-none font-mono text-[11px]', due.className)}>{due.label}</span>
        {assignee ? (
          <Avatar user={assignee} className="size-[21px]" title={`Assigned to ${displayName(assignee)}`} />
        ) : (
          <span aria-hidden="true" className="size-[21px] flex-none rounded-full border border-dashed border-t5" />
        )}
      </span>
    </button>
  )
}
