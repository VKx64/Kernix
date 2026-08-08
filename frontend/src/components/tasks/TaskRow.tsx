import { memo, type CSSProperties, type MouseEvent } from 'react'
import { Check, MoreHorizontal } from 'lucide-react'
import { Avatar } from '@/components/shared'
import { displayName, fieldLabel } from '@/lib/api'
import {
  dueMeta,
  isTaskDone,
  railColor,
  statusColor,
  taskDueDate,
  taskMetaParts,
  taskRole,
  taskStatusValue,
  taskUrgencyValue,
  urgencyRank,
} from '@/lib/taskSignals'
import { cn } from '@/lib/utils'
import type { Task } from '@/types/api'

export type TaskRowDensity = 'compact' | 'comfortable'

export interface TaskRowProps {
  task: Task
  density: TaskRowDensity
  /** The keyboard cursor is on this row. */
  cursor: boolean
  selected: boolean
  /** Hidden below 720px, where the title needs the space more. */
  showStatus: boolean
  /** Hidden below 560px. */
  showMeta: boolean
  onOpen: (task: Task, event: MouseEvent) => void
  onToggleDone: (task: Task) => void
  onToggleSelected: (task: Task) => void
  onStatusMenu: (task: Task, anchor: HTMLElement) => void
  onDueMenu: (task: Task, anchor: HTMLElement) => void
  onAssigneeMenu: (task: Task, anchor: HTMLElement) => void
  onRowMenu: (task: Task, anchor: HTMLElement) => void
}

/**
 * One task, as a grid rather than a table row so the title column can absorb
 * whatever the fixed columns leave.
 *
 * Two of the design's decisions live here. Urgency and status are collapsed
 * into one gesture — a rail on the left edge carries urgency, a dot carries
 * status — which buys back the horizontal space titles need. And every
 * affordance is invisible at rest: the assignee slot, the row menu and the
 * inline menus only appear once the pointer or the keyboard cursor is on the
 * row, so a dense list stays calm.
 */
function TaskRowImpl({
  task,
  density,
  cursor,
  selected,
  showStatus,
  showMeta,
  onOpen,
  onToggleDone,
  onToggleSelected,
  onStatusMenu,
  onDueMenu,
  onAssigneeMenu,
  onRowMenu,
}: TaskRowProps) {
  const compact = density === 'compact'
  const done = isTaskDone(task)
  const role = taskRole(task)
  const urgency = taskUrgencyValue(task)
  const critical = urgencyRank(urgency) === 0 && !done
  const rail = railColor(urgency, done)
  const due = dueMeta(taskDueDate(task))
  const assignee = task.assignee
  const meta = taskMetaParts(task).join('  ·  ')

  // Fixed tracks, then the title takes the rest: rail, done toggle, title,
  // status, due, assignee, menu.
  const columns = ['3px', '18px', 'minmax(0,1fr)']
  if (showStatus) columns.push('112px')
  columns.push('72px', '22px', '24px')

  const rowStyle: CSSProperties = {
    gridTemplateColumns: columns.join(' '),
    minHeight: compact ? 34 : 46,
  }

  // Menu buttons sit inside a clickable row, so each one stops the click from
  // also opening the drawer.
  const contain = (handler: (anchor: HTMLElement) => void) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    handler(event.currentTarget)
  }

  return (
    <div
      role="row"
      aria-selected={selected}
      tabIndex={-1}
      onClick={(event) => onOpen(task, event)}
      style={rowStyle}
      className={cn(
        'group/row grid cursor-pointer items-center gap-[11px] rounded-md pr-2.5 transition-colors',
        selected ? 'bg-row-selected' : cursor ? 'bg-row-hover' : 'hover:bg-row-hover',
        done && 'opacity-45',
      )}
    >
      <span
        aria-hidden="true"
        className="rounded-full"
        style={{ width: 3, height: compact ? 16 : 22, background: rail ?? 'transparent' }}
      />

      <button
        type="button"
        aria-label={selected ? 'Deselect task' : done ? 'Reopen task' : 'Mark task done'}
        onClick={(event) => {
          event.stopPropagation()
          // While a selection is live this control extends it rather than
          // completing one task — otherwise a stray click loses the selection.
          if (selected) onToggleSelected(task)
          else onToggleDone(task)
        }}
        className={cn(
          'grid size-4 place-items-center border-[1.5px] p-0 text-[9px] font-extrabold text-bg transition-[border-radius,background] duration-150',
          selected
            ? 'rounded-[5px] border-brand bg-brand'
            : done
              ? 'rounded-full border-good bg-good'
              : 'rounded-full border-[#55555f] bg-transparent hover:border-good',
        )}
      >
        {(selected || done) && <Check className="size-2.5" strokeWidth={3.5} />}
      </button>

      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            'truncate text-left tracking-[-0.012em]',
            compact ? 'text-body' : 'text-body-lg',
            'leading-[1.35]',
            done ? 'text-t3 line-through' : critical ? 'font-semibold text-title-strong' : 'font-[450] text-title',
          )}
        >
          {task.title}
        </span>
        {showMeta && !compact && meta && (
          <span className="truncate text-left text-meta-sm text-t3">{meta}</span>
        )}
      </div>

      {showStatus && (
        <button
          type="button"
          onClick={contain((anchor) => onStatusMenu(task, anchor))}
          className={cn(
            '-mx-[7px] inline-flex h-6 min-w-0 items-center gap-[7px] rounded-sm px-[7px] text-body-sm hover:bg-rail',
            role === 'blocked' ? 'text-danger' : 'text-t2',
          )}
        >
          <span
            aria-hidden="true"
            className="size-1.5 flex-none rounded-full"
            style={{ background: statusColor(taskStatusValue(task)) }}
          />
          <span className="truncate">{fieldLabel(taskStatusValue(task))}</span>
        </button>
      )}

      <button
        type="button"
        onClick={contain((anchor) => onDueMenu(task, anchor))}
        className={cn(
          '-mx-[7px] inline-flex h-6 w-full items-center justify-end rounded-sm px-[7px] font-mono text-meta-sm hover:bg-rail',
          due.className,
        )}
      >
        {due.label}
      </button>

      <button
        type="button"
        aria-label={assignee ? `Assigned to ${displayName(assignee)}` : 'Assign this task'}
        onClick={contain((anchor) => onAssigneeMenu(task, anchor))}
        className={cn(
          'grid size-[22px] place-items-center rounded-full p-0 transition-opacity',
          assignee
            ? 'opacity-100'
            : cn(
                'opacity-0 group-hover/row:opacity-80 focus-visible:opacity-100',
                (cursor || selected) && 'opacity-80',
              ),
        )}
      >
        {assignee ? (
          <Avatar user={assignee} className="size-[21px]" />
        ) : (
          <span className="size-[21px] rounded-full border border-dashed border-[#55555f]" />
        )}
      </button>

      <button
        type="button"
        aria-label="Task actions"
        onClick={contain((anchor) => onRowMenu(task, anchor))}
        className={cn(
          'grid size-6 place-items-center rounded-sm p-0 text-t5 transition-opacity hover:bg-line hover:text-t1 focus-visible:opacity-100',
          cursor || selected ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
        )}
      >
        <MoreHorizontal className="size-[13px]" />
      </button>
    </div>
  )
}

export const TaskRow = memo(TaskRowImpl)
