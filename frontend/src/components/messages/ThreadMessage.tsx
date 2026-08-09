import { Copy, FileText, Reply } from 'lucide-react'
import { Avatar } from '@/components/shared'
import { Tag } from '@/components/kernix/chip'
import { cn } from '@/lib/utils'
import type { Note } from '@/types/api'
import { attachmentName, noteTime } from './signals'

/**
 * One turn in the thread. Everyone reads left-aligned — the design gives the
 * speaker to the name, not to a side — and consecutive lines from the same
 * person drop their avatar and name so a burst reads as one turn.
 *
 * The row actions are invisible at rest, as task rows are: they appear on hover
 * or when something inside them takes focus.
 */
export function ThreadMessage({
  message,
  mine,
  actor,
  isAi,
  grouped,
  seen,
  onReply,
  onCopy,
}: {
  message: Note
  mine: boolean
  actor: string
  isAi: boolean
  /** Same speaker as the line above, on the same day. */
  grouped: boolean
  /** Delivery line under the last thing you said, or empty. */
  seen: string
  onReply: () => void
  onCopy: () => void
}) {
  const files = message.attachments ?? []

  return (
    <div
      className={cn(
        'group/msg relative -mx-2 flex gap-[11px] rounded-[9px] py-[3px] pr-[46px] pl-2 transition-colors hover:bg-[#131316]',
        grouped ? 'mt-0' : 'mt-2.5 pt-1.5',
      )}
    >
      <Avatar user={message.author} className={cn('size-7 flex-none', grouped && 'invisible')} />

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="mb-[3px] flex items-baseline gap-[9px]">
            <span className="text-body font-semibold text-t1">{mine ? 'You' : actor}</span>
            {isAi && <Tag>AI</Tag>}
            <span className="font-mono text-[10.5px] text-t3">{noteTime(message)}</span>
          </div>
        )}

        <p className="text-body-lg leading-[1.62] text-[#c8c8d0] text-pretty whitespace-pre-wrap">{message.body}</p>

        {files.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {files.map((file) => {
              const name = attachmentName(file)
              const content = (
                <>
                  <FileText className="size-[15px] flex-none text-t3" />
                  <span className="truncate text-body-sm text-[#d4d4d9]">{name}</span>
                </>
              )
              return file.url ? (
                <a
                  key={file.id}
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex max-w-full items-center gap-[9px] rounded-[9px] border border-line-strong bg-[#131316] py-2 pr-[11px] pl-[9px] hover:border-[#33333d] hover:bg-soft"
                >
                  {content}
                </a>
              ) : (
                <span
                  key={file.id}
                  className="flex max-w-full items-center gap-[9px] rounded-[9px] border border-line-strong bg-[#131316] py-2 pr-[11px] pl-[9px]"
                >
                  {content}
                </span>
              )
            })}
          </div>
        )}

        {seen && <span className="mt-[5px] block text-[11px] text-t3">{seen}</span>}
      </div>

      <div
        className={cn(
          'absolute top-1 right-1.5 flex gap-0.5 rounded-lg border border-[#26262c] bg-[#1a1a1f] p-0.5 opacity-0 transition-opacity',
          'group-hover/msg:opacity-100 focus-within:opacity-100',
        )}
      >
        <button
          type="button"
          aria-label="Reply to this message"
          onClick={onReply}
          className="grid size-[25px] place-items-center rounded-md text-t2 hover:bg-[#26262e] hover:text-t1"
        >
          <Reply className="size-[13px]" />
        </button>
        <button
          type="button"
          aria-label="Copy this message"
          onClick={onCopy}
          className="grid size-[25px] place-items-center rounded-md text-t2 hover:bg-[#26262e] hover:text-t1"
        >
          <Copy className="size-[13px]" />
        </button>
      </div>
    </div>
  )
}
