import { Sparkles, X } from 'lucide-react'

/**
 * What `Summarise` returns, sitting at the top of the thread until it is
 * dismissed. It never appears on its own — only a user asking for it produces
 * one — so there is no empty or loading state to give it here; the chip that
 * requests it owns those.
 */
export function ThreadSummaryCard({ summary, onDismiss }: { summary: string; onDismiss: () => void }) {
  return (
    <div className="my-[14px] mt-[14px] mb-1.5 flex items-start gap-[11px] rounded-[11px] border border-[#26273e] bg-[#14152099] px-3.5 py-[13px]">
      <Sparkles className="mt-0.5 size-3.5 flex-none text-[#a8abfb]" strokeWidth={1.6} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[10.5px] font-semibold tracking-[0.1em] text-[#8f92d8] uppercase">Thread summary</span>
        <span className="text-body-sm leading-[1.62] text-[#c4c4cc] text-pretty">{summary}</span>
      </div>
      <button
        type="button"
        aria-label="Dismiss the thread summary"
        onClick={onDismiss}
        className="grid size-[22px] flex-none place-items-center rounded-md text-t3 hover:bg-[#22222a] hover:text-t1"
      >
        <X className="size-[9px]" strokeWidth={2} />
      </button>
    </div>
  )
}
