import { Avatar } from '@/components/shared'
import { Tag } from '@/components/kernix/chip'
import { Checkbox } from '@/components/ui/checkbox'
import { displayName } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { EntityId, Message } from '@/types/api'
import { authorId, counterpart, estimateRequest, shortAge, unreadCount } from './signals'

/** The design's preview names people by first name only — "Sam: …". */
function firstName(person?: { first_name?: string; firstName?: string } | null): string {
  const full = displayName(person as never)
  return (person?.firstName ?? person?.first_name ?? full).split(' ')[0]
}

/**
 * One conversation in the left pane: who it is with, when it last moved, the
 * last line spoken, and the task it hangs off.
 *
 * The selection checkbox sits on top of the avatar rather than beside it, so a
 * row that is not being selected shows no selection chrome at all and the two
 * states occupy exactly the same space.
 */
export function ConversationRow({
  message,
  userId,
  open,
  cursor,
  picked,
  onOpen,
  onPickedChange,
}: {
  message: Message
  userId?: EntityId
  /** This conversation is the one shown in the thread pane. */
  open: boolean
  /** The keyboard cursor is on this row. */
  cursor: boolean
  picked: boolean
  onOpen: () => void
  onPickedChange: (picked: boolean) => void
}) {
  const person = counterpart(message, userId)
  const latest = message.latestMessage ?? message.latest_message ?? message
  const request = estimateRequest(message)
  const unread = unreadCount(message)
  const mine = authorId(latest) === String(userId ?? '')

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter') onOpen() }}
      className={cn(
        'group/row flex cursor-pointer items-start gap-2.5 rounded-[9px] px-2.5 py-[9px] text-left transition-colors',
        open ? 'bg-row-selected' : cursor ? 'bg-[#16161a]' : 'hover:bg-[#16161a]',
      )}
    >
      <span className="relative size-[30px] flex-none">
        <Avatar
          user={person}
          className={cn('size-[30px] transition-opacity', picked ? 'opacity-0' : 'group-hover/row:opacity-0')}
        />
        <span
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'absolute inset-0 grid place-items-center transition-opacity',
            picked ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 focus-within:opacity-100',
          )}
        >
          <Checkbox
            aria-label={`Select conversation with ${displayName(person)}`}
            checked={picked}
            onCheckedChange={(checked) => onPickedChange(checked === true)}
          />
        </span>
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              'flex-1 truncate text-body',
              unread ? 'font-[650] text-title-strong' : open ? 'font-[550] text-t1' : 'font-[550] text-title',
            )}
          >
            {displayName(person)}
          </span>
          {request && <Tag className="flex-none">Estimate</Tag>}
          <time className="flex-none font-mono text-[10.5px] text-t3">{shortAge(latest)}</time>
        </span>
        {/* The design always names the speaker, not only when it is you —
            "Taylor: …", "Priya: …" — so a glance down the list says who is
            waiting on whom without opening anything. */}
        <span className={cn('truncate text-meta-sm', unread ? 'text-t2' : 'text-t3')}>
          <span className="font-medium">{mine ? 'You' : firstName(person)}: </span>
          {latest.body}
        </span>
        <span className="truncate text-[10.5px] text-t3">{message.task?.title || message.subject || 'Task thread'}</span>
      </span>

      {unread > 0 && (
        <span
          className={cn(
            'grid h-[17px] min-w-[17px] flex-none place-items-center rounded-[9px] px-[5px] text-[10.5px] font-bold text-bg',
            request?.status === 'pending' ? 'bg-warn' : 'bg-brand',
          )}
        >
          {unread}
        </span>
      )}
    </div>
  )
}
