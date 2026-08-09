import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ActionItem {
  title: string
  made: boolean
}

/**
 * What `Action items` returns, as a footer strip between the thread and the
 * composer rather than a modal — reading a message and turning it into work
 * are meant to feel like the same motion.
 *
 * `canCreate` is one flag for the whole conversation rather than per row: it
 * is false only when the seat lacks `tasks.create` or the conversation has no
 * project to file into, and both are properties of the conversation, not of
 * one line the AI happened to extract. A row without the button still shows
 * its title, so the read is not lost even when nothing can be filed from it.
 */
export function ActionItemsBar({
  items,
  canCreate,
  onCreate,
  onClose,
}: {
  items: ActionItem[]
  canCreate: boolean
  onCreate: (index: number) => void
  onClose: () => void
}) {
  return (
    <div className="flex flex-none flex-col gap-2 border-t border-line-soft bg-inset px-5 py-3">
      <div className="flex items-center gap-2.5">
        <span className="text-[10.5px] font-semibold tracking-[0.1em] text-[#8f92d8] uppercase">Action items found</span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Close action items"
          onClick={onClose}
          className="grid size-[22px] place-items-center rounded-md text-t3 hover:bg-[#22222a] hover:text-t1"
        >
          <X className="size-[9px]" strokeWidth={2} />
        </button>
      </div>

      {items.map((item, index) => (
        <div key={`${index}-${item.title}`} className="flex items-center gap-[11px]">
          <span className="size-[5px] flex-none rounded-full bg-brand" />
          <span className="flex-1 truncate text-body-sm text-[#d4d4d9]">{item.title}</span>
          {canCreate && (
            <button
              type="button"
              disabled={item.made}
              onClick={() => onCreate(index)}
              className={cn(
                'h-[26px] flex-none rounded-[7px] px-2.5 text-[11.5px] font-semibold',
                item.made ? 'bg-[#17211a] text-good' : 'bg-[#22222a] text-t1 hover:brightness-110',
              )}
            >
              {item.made ? 'Added' : 'Create task'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
