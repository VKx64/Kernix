import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorBanner } from '@/components/shared'
import { Monogram, initialsOf } from '@/components/kernix/monogram'
import { Segmented } from '@/components/kernix/segmented'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { copyText, countRows, formatSheetDate, hoursLabel, timesheetText } from '@/lib/timesheet'
import { useTimesheet } from '@/lib/useTimesheet'
import { cn } from '@/lib/utils'
import type { EntityId, TimesheetCutoff, TimesheetLane, TimesheetRow } from '@/types/api'

const CUTOFFS = [
  { value: 'semi', label: '1–15 / 16–end' },
  { value: 'month', label: 'Monthly' },
] as const

/** Lane colours, cycled by position — clients carry no colour of their own. */
const LANE_COLORS = ['var(--brand)', 'var(--good)', 'var(--warn)', '#57a6f0', '#c98bd8', 'var(--danger)']

/**
 * The timesheet, which exists to feed a spreadsheet rather than replace one.
 *
 * Payroll lives in Sheets with its own formulas for totals and balances, so
 * everything here builds toward one clipboard payload: the four columns a
 * person would otherwise type, tab-separated, landing in A:D and touching
 * nothing else. There is no total row and no money — the sheet owns both.
 *
 * Rows are drafted from tracked time, one line per task per day, written in
 * past tense. A draft that reads badly can be edited in place; anything left
 * alone stays generated and follows the task if it is retitled.
 */
export function TimesheetPage() {
  const [params, setParams] = useSearchParams()
  const cutoff = (params.get('cutoff') as TimesheetCutoff) ?? 'semi'
  const offset = Number(params.get('offset') ?? 0) || 0
  const withHeader = params.get('header') === '1'
  const { data, loading, error, reload, describe } = useTimesheet(cutoff, offset)

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const copy = async (clientId?: EntityId | null, clientName?: string) => {
    if (!data) return
    const rows = countRows(data.lanes, clientId)
    if (!rows) return
    const text = timesheetText(data.lanes, { header: withHeader, clientId })
    const copied = await copyText(text)
    toast(
      copied
        ? `${rows} ${rows === 1 ? 'row' : 'rows'} copied${clientName ? ` — ${clientName}` : ''} — paste into your sheet`
        : 'Could not reach the clipboard. Select the rows and copy manually.',
    )
  }

  const total = data ? countRows(data.lanes) : 0

  return (
    <>
      {/* The screen's own header: title and what the period holds on the left,
          the controls that change the period on the right. */}
      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-h1 text-title-strong">Timesheet</h1>
          <p className="mt-[3px] text-body-lg text-t3">
            {!data
              ? 'Loading your tracked time…'
              : data.entry_count
                ? `${data.entry_count} ${data.entry_count === 1 ? 'entry' : 'entries'} · ${hoursLabel(data.total_minutes)} · ${data.days_worked} ${data.days_worked === 1 ? 'day' : 'days'} worked`
                : 'Nothing tracked in this period'}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Segmented
            label="Pay period length"
            options={CUTOFFS}
            value={cutoff}
            onChange={(next) => {
              // The offset counts periods, so it means something different
              // either side of this switch. Going back to the current one is
              // the only reading that is never wrong.
              const updated = new URLSearchParams(params)
              updated.set('cutoff', next)
              updated.delete('offset')
              setParams(updated, { replace: true })
            }}
          />
          <div className="flex h-[31px] flex-none items-center gap-[3px] rounded-md bg-elev-low px-0.5">
            <button
              type="button"
              aria-label="Previous period"
              onClick={() => setParam('offset', String(offset - 1))}
              className="grid size-[27px] place-items-center rounded-sm text-t2 hover:bg-line-strong hover:text-t1"
            >
              <ChevronLeft className="size-3" />
            </button>
            <span className="min-w-[132px] whitespace-nowrap text-center text-meta font-[550] text-t1">
              {data?.period.label ?? '—'}
            </span>
            <button
              type="button"
              aria-label="Next period"
              onClick={() => setParam('offset', String(offset + 1))}
              className="grid size-[27px] place-items-center rounded-sm text-t2 hover:bg-line-strong hover:text-t1"
            >
              <ChevronRight className="size-3" />
            </button>
          </div>
          <Button disabled={!total} onClick={() => void copy()}>
            <Copy className="size-3" />
            {total ? `Copy ${total} ${total === 1 ? 'row' : 'rows'}` : 'Nothing to copy'}
          </Button>
        </div>
      </header>

      {error && <ErrorBanner message={error} onRetry={reload} />}

      {loading && !data && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-5 w-72" />
          {[0, 1, 2].map((lane) => <Skeleton key={lane} className="h-28" />)}
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-5">
            {data.lanes.map((lane, index) => (
              <Lane
                key={String(lane.client_id ?? 'none')}
                lane={lane}
                color={LANE_COLORS[index % LANE_COLORS.length]}
                widest={Math.max(1, ...data.lanes.map((other) => other.minutes))}
                onCopy={() => void copy(lane.client_id, lane.client)}
                onDescribe={describe}
              />
            ))}
          </div>

          {!data.entry_count && (
            <p className="text-meta text-t4">
              Track time against a task and it will draft itself a line here.
            </p>
          )}

          {data.entry_count > 0 && (
            <div className="mt-4 flex flex-wrap items-baseline gap-2.5 border-t border-line px-2 pt-4">
              <span className="text-body text-t3">
                {data.entry_count} {data.entry_count === 1 ? 'row' : 'rows'}
              </span>
              <span className="text-body text-t4">
                Tab-separated · Client, Date, Description, Hours
              </span>
              <span className="flex-1" />
              <label className="flex cursor-pointer items-center gap-2 text-body text-t3">
                <input
                  type="checkbox"
                  checked={withHeader}
                  onChange={(event) => setParam('header', event.target.checked ? '1' : null)}
                  className="size-3.5 accent-brand"
                />
                Header row
              </label>
              <span className="font-mono text-[14px] text-t1">{hoursLabel(data.total_minutes)}</span>
            </div>
          )}

          {data.unassigned_minutes > 0 && (
            // Said plainly rather than folded into a lane: this time is real,
            // but there is no client to bill it to until it has a task.
            <p className="text-meta text-t4">
              {hoursLabel(data.unassigned_minutes)} tracked without a task is not in these rows.
            </p>
          )}
        </div>
      )}
    </>
  )
}

function Lane({
  lane,
  color,
  widest,
  onCopy,
  onDescribe,
}: {
  lane: TimesheetLane
  color: string
  /** The biggest lane in the period, so the bars share one scale. */
  widest: number
  onCopy: () => void
  onDescribe: (taskId: EntityId, date: string, body: string) => Promise<void>
}) {
  return (
    <section className="flex flex-col">
      <div className="flex items-center gap-2.5 pb-[9px]">
        <Monogram name={lane.client} color={color} size="sm" initials={initialsOf(lane.client, 1)} />
        <span className="whitespace-nowrap text-title text-t1">{lane.client}</span>
        <span className="whitespace-nowrap text-meta text-t4">
          {lane.entry_count} {lane.entry_count === 1 ? 'entry' : 'entries'}
        </span>
        <span className="h-0.5 min-w-10 flex-1 overflow-hidden rounded-[2px] bg-elev-low">
          <span
            className="block h-full"
            style={{ width: `${Math.round((lane.minutes / widest) * 100)}%`, background: color, opacity: 0.5 }}
          />
        </span>
        <span className="whitespace-nowrap font-mono text-body-sm text-[#d4d4d9]">{hoursLabel(lane.minutes)}</span>
        <Button variant="ghost" size="sm" className="h-6 px-2.5 text-meta" onClick={onCopy}>
          Copy
        </Button>
      </div>
      {lane.rows.map((row, index) => (
        <Row
          key={`${row.task_id}-${row.date}`}
          row={row}
          separated={index > 0}
          onDescribe={onDescribe}
        />
      ))}
    </section>
  )
}

function Row({
  row,
  separated,
  onDescribe,
}: {
  row: TimesheetRow
  separated: boolean
  onDescribe: (taskId: EntityId, date: string, body: string) => Promise<void>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const editing = draft !== null

  const commit = async () => {
    const body = (draft ?? '').trim()
    setDraft(null)
    if (!body || body === row.description) return
    setBusy(true)
    try {
      await onDescribe(row.task_id, row.date, body)
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Could not save that description.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        // -mx-2 cancels the px-2 used to size the hover background, so the
        // date column lands flush with the lane's left edge — the same edge
        // the monogram tile sits on in the header above.
        '-mx-2 grid grid-cols-[48px_minmax(0,1fr)_62px] items-baseline gap-x-3.5 rounded-md px-2 py-[9px] hover:bg-row-hover',
        separated && 'border-t border-[#131316]',
      )}
    >
      <span className="font-mono text-meta text-t4">{formatSheetDate(row.date)}</span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); void commit() }
            if (event.key === 'Escape') { event.stopPropagation(); setDraft(null) }
          }}
          aria-label={`Description for ${row.task_title} on ${row.date}`}
          className="-my-1 w-full rounded-sm border border-line-strong bg-inset px-1.5 py-1 text-body-lg text-t1 outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setDraft(row.description)}
          title={row.edited ? 'Edited — click to change' : `From “${row.task_title}” — click to edit`}
          className="truncate text-left text-body-lg leading-[1.5] text-[#c8c8d0] text-pretty hover:text-t1"
        >
          {row.description}
        </button>
      )}
      <span className="text-right font-mono text-body-sm text-[#d4d4d9]">{row.hours}</span>
    </div>
  )
}
