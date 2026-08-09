import { formatMinutes } from '@/lib/taskSignals'
import { cn } from '@/lib/utils'
import type { OliverInsights } from '@/types/api'

/** The nine one-click tools, each an intent the composer would otherwise type. */
export const OLIVER_TOOLS: Array<{ label: string; sub: string; intent: string; color: string }> = [
  { label: 'What is on me', sub: 'Your late and blocked work, worst first', intent: 'risk', color: 'var(--danger)' },
  { label: 'Free to pick up', sub: 'Unowned tasks in the projects you are on', intent: 'unowned', color: 'var(--warn)' },
  { label: 'Lighten my week', sub: 'Move what can wait out of the next five days', intent: 'workload', color: 'var(--brand)' },
  { label: 'Check my time', sub: 'Gaps between tracked hours and logged hours', intent: 'time', color: 'var(--danger)' },
  { label: 'Draft a client update', sub: 'On the work you own · you approve before it sends', intent: 'client update', color: 'var(--warn)' },
  { label: 'Plan my week', sub: 'Order your work by what gates what', intent: 'plan', color: 'var(--good)' },
  { label: 'Split a heavy task', sub: 'Break anything of yours running long into steps', intent: 'split', color: 'var(--brand)' },
  { label: 'Unblock me', sub: 'Push each of your blockers to whoever can clear it', intent: 'escalate', color: 'var(--warn)' },
  { label: 'Retainer check', sub: 'Burn on the clients you work for', intent: 'retainer', color: 'var(--warn)' },
]

export interface ActedEntry {
  id: string | number
  at: string
  summary: string
  undone_at?: string | null
}

/**
 * What Oliver is watching, what it can be asked, and what it has already done.
 *
 * The guardrail sentence at the foot is not decoration: it is the one place
 * the rules are stated in the interface rather than only in a decision
 * document, and it changes with the autopilot switch.
 */
export function OliverRail({
  insights,
  acted,
  autopilot,
  onTool,
  onUndo,
}: {
  insights: OliverInsights | null
  acted: ActedEntry[]
  autopilot: boolean
  onTool: (intent: string) => void
  onUndo: (id: ActedEntry['id']) => void
}) {
  const watching = [
    { label: 'Projects', value: insights?.watching.projects ?? 0, color: 'var(--brand)' },
    { label: 'Your open tasks', value: insights?.workload.open ?? 0, color: 'var(--t4)' },
    { label: 'At risk', value: insights?.risk.length ?? 0, color: 'var(--danger)' },
    { label: 'Clients on retainer', value: insights?.retainer.length ?? 0, color: 'var(--warn)' },
  ]

  return (
    <aside className="hidden w-[340px] flex-none flex-col gap-3 overflow-y-auto py-[18px] pr-7 @[900px]:flex">
      <section className="flex flex-col gap-[11px] rounded-xl border border-line-soft px-[15px] py-3.5">
        <span className="text-label uppercase text-label-fg">Watching</span>
        {watching.map((row) => (
          <div key={row.label} className="flex items-baseline gap-[9px]">
            <span
              aria-hidden="true"
              className="size-[5px] flex-none rounded-full"
              style={{ background: row.value ? row.color : '#3f3f48' }}
            />
            <span className="flex-1 text-body-sm text-[#a8a8b0]">{row.label}</span>
            <span className={cn('font-mono text-body-sm', row.value ? 'text-t2' : 'text-t4')}>{row.value}</span>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-[3px] rounded-xl border border-line-soft px-3 pb-3 pt-3.5">
        <span className="px-[3px] pb-1.5 text-label uppercase text-label-fg">Tools</span>
        {OLIVER_TOOLS.map((tool) => (
          <button
            key={tool.intent + tool.label}
            type="button"
            onClick={() => onTool(tool.intent)}
            className="flex w-full flex-col gap-0.5 rounded-lg px-[9px] py-2 text-left hover:bg-soft"
          >
            <span className="flex w-full items-center gap-2">
              <span aria-hidden="true" className="size-[5px] flex-none rounded-full" style={{ background: tool.color }} />
              <span className="flex-1 text-body-sm font-[550] text-title">{tool.label}</span>
            </span>
            <span className="pl-4 text-meta leading-[1.45] text-t4 text-pretty">{tool.sub}</span>
          </button>
        ))}
      </section>

      <section className="flex flex-col gap-2.5 rounded-xl border border-line-soft px-[15px] py-3.5">
        <div className="flex items-baseline gap-2">
          <span className="text-label uppercase text-label-fg">Acted today</span>
          <span className="flex-1" />
          <span className="font-mono text-meta text-t3">
            {acted.length} {acted.length === 1 ? 'action' : 'actions'}
          </span>
        </div>
        {acted.map((entry) => (
          <div key={entry.id} className="flex items-baseline gap-[9px]">
            <span className="flex-none font-mono text-[10.5px] text-t5">{entry.at}</span>
            <span className={cn('flex-1 text-body leading-[1.45] text-pretty', entry.undone_at ? 'text-t5 line-through' : 'text-t2')}>
              {entry.summary}
            </span>
            {!entry.undone_at && (
              <button
                type="button"
                onClick={() => onUndo(entry.id)}
                className="flex-none rounded-sm px-1.5 text-meta text-t4 hover:bg-soft hover:text-t1"
              >
                Undo
              </button>
            )}
          </div>
        ))}
        {!acted.length && <span className="text-body text-t4">Nothing yet today.</span>}
      </section>

      {insights?.workload && (
        <section className="flex flex-col gap-2.5 rounded-xl border border-line-soft px-[15px] py-3.5">
          <span className="text-label uppercase text-label-fg">This week</span>
          <div className="flex items-baseline gap-2">
            <span className="flex-1 text-body-sm text-[#a8a8b0]">Tracked</span>
            <span className="font-mono text-body-sm text-t2">
              {formatMinutes(insights.workload.tracked_week_minutes) || '0m'} of {formatMinutes(insights.workload.target_week_minutes)}
            </span>
          </div>
          {insights.workload.over_committed && (
            <span className="text-meta text-warn text-pretty">
              The next seven days hold more work than hours.
            </span>
          )}
        </section>
      )}

      {/* The rules, stated where they apply rather than only in a document. */}
      <p className="px-[3px] text-meta leading-[1.55] text-t5 text-pretty">
        {autopilot
          ? 'Oliver reorders and reschedules your own work without asking, and only ever talks to you about it. Anything leaving the studio — client mail, invoices — waits for a human.'
          : 'Autopilot is off. Oliver proposes and waits for you on everything.'}
      </p>
    </aside>
  )
}
