import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ErrorBanner } from '@/components/shared'
import { OliverRail, type ActedEntry } from '@/components/oliver/OliverRail'
import { OliverChat } from '@/components/OliverChat'
import { api, unwrap } from '@/lib/api'
import { usePageFill } from '@/layout/page-fill'
import { cn } from '@/lib/utils'
import type { ApiEnvelope, OliverActionRecord, OliverInsights } from '@/types/api'

/** The six chips above the composer — the questions worth one tap. */
const PROMPTS = [
  'What is on me?',
  'Am I overloaded?',
  'Free to pick up',
  'Check my time',
  'Unblock me',
  'Plan my week',
] as const

const AUTOPILOT_KEY = 'kernix.oliver.autopilot'

function shortTime(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Oliver — the AI project manager, as its own section.
 *
 * The screen is a thread with a rail, and the rail is the honest half: what
 * Oliver is watching, what it can be asked, what it has already done, and the
 * rules it works under. Everything it reports is about the signed-in employee
 * — a teammate's workload belongs to a manager view, not here.
 *
 * Actions are taken directly and reported afterwards, each with an Undo. That
 * is the design's bargain: an assistant that asks permission for everything is
 * a to-do list with extra steps. The one thing it never does unasked is talk
 * to a client.
 */
export function OliverPage() {
  usePageFill()
  const [insights, setInsights] = useState<OliverInsights | null>(null)
  const [actions, setActions] = useState<OliverActionRecord[]>([])
  const [error, setError] = useState('')
  const [autopilot, setAutopilot] = useState(() => {
    try {
      return window.localStorage.getItem(AUTOPILOT_KEY) !== 'off'
    } catch {
      return true
    }
  })
  const askRef = useRef<((text: string) => void) | null>(null)

  const load = useCallback(async () => {
    try {
      const [nextInsights, nextActions] = await Promise.all([
        api.get<ApiEnvelope<OliverInsights>>('/api/oliver/insights').then(unwrap),
        api.get<ApiEnvelope<OliverActionRecord[]>>('/api/oliver/actions', { limit: 20 }).then(unwrap),
      ])
      setInsights(nextInsights)
      setActions(nextActions)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to read your work right now.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggleAutopilot = () => {
    setAutopilot((current) => {
      const next = !current
      try { window.localStorage.setItem(AUTOPILOT_KEY, next ? 'on' : 'off') } catch { /* Session-only is fine. */ }
      return next
    })
  }

  const undo = async (id: ActedEntry['id']) => {
    try {
      await api.post(`/api/oliver/actions/${id}/undo`)
      toast('Reverted')
      await load()
    } catch (reason) {
      // A refusal here is usually "somebody has since changed this", which is
      // worth reading rather than a generic failure.
      toast(reason instanceof Error ? reason.message : 'Could not undo that.')
    }
  }

  const ask = (text: string) => askRef.current?.(text)

  const watchedProjects = insights?.watching.projects ?? 0

  return (
    <div className="@container -mx-4 -mt-4 -mb-14 flex min-h-0 flex-1 flex-col md:-mx-7 md:-mt-[18px]">
      <header className="flex-none border-b border-soft px-7 pb-3.5 pt-4">
        <div className="flex items-center gap-3">
          <span className="grid size-8 flex-none place-items-center rounded-[10px] bg-brand/15 text-[13px] font-bold text-brand-hover">
            O
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="mb-0.5 text-[17px] font-semibold tracking-[-0.02em] text-title-strong">Oliver</h1>
            <p className="text-meta text-t3">
              Your project manager · watching your work across {watchedProjects} {watchedProjects === 1 ? 'project' : 'projects'}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleAutopilot}
            aria-pressed={autopilot}
            className={cn(
              'inline-flex h-[29px] flex-none items-center gap-[7px] whitespace-nowrap rounded-lg px-3 text-meta font-semibold transition-[filter] hover:brightness-110',
              autopilot ? 'bg-good/15 text-good' : 'bg-line-soft text-t3',
            )}
          >
            <span aria-hidden="true" className={cn('size-1.5 rounded-full', autopilot ? 'bg-good' : 'bg-t6')} />
            {autopilot ? 'Autopilot on' : 'Autopilot off'}
          </button>
        </div>
      </header>

      {error && <div className="px-7 pt-3"><ErrorBanner message={error} onRetry={load} /></div>}

      <div className="flex min-h-0 flex-1 items-stretch">
        <div className="flex min-w-0 flex-1 flex-col">
          <OliverChat
            prompts={[...PROMPTS]}
            hint={autopilot ? 'Client mail needs your approval' : 'Autopilot off — proposes only'}
            onActed={load}
            registerAsk={(fn) => { askRef.current = fn }}
          />
        </div>

        <OliverRail
          insights={insights}
          autopilot={autopilot}
          acted={actions.map((action) => ({
            id: action.id,
            at: shortTime(action.created_at),
            summary: action.summary,
            undone_at: action.undone_at,
          }))}
          onTool={ask}
          onUndo={undo}
        />
      </div>
    </div>
  )
}
