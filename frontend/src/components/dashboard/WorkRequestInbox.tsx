import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PanelSection } from '@/components/kernix/panel-section'
import { api, unwrap } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import type { ApiEnvelope } from '@/types/api'

interface PendingWorkRequest {
  id: number
  reason: string
  created_at: string | null
  requester?: { id: number; name?: string; first_name?: string; last_name?: string; username?: string } | null
  task?: { id: number; title: string; project?: { id: number; name: string } | null } | null
}

function personName(person: PendingWorkRequest['requester']): string {
  if (!person) return 'Someone'
  const full = person.name || [person.first_name, person.last_name].filter(Boolean).join(' ')
  return full || person.username || 'Someone'
}

/**
 * Who is waiting on you before they can start.
 *
 * These requests already had a home on each task's own page, which is fine for
 * the person who raised one and useless for the person who decides it — nobody
 * opens forty tasks to check whether one is waiting. Now that an employee
 * writing down their own work produces a request, the queue needs somewhere a
 * manager actually looks.
 *
 * Renders nothing at all when the queue is empty, rather than a panel saying
 * so. A permanent "no requests" box on the dashboard is noise every day for
 * the sake of the few days it has something to say.
 */
export function WorkRequestInbox() {
  const can = useCan()
  const navigate = useNavigate()
  const [requests, setRequests] = useState<PendingWorkRequest[]>([])
  const [busy, setBusy] = useState(false)
  const [declining, setDeclining] = useState<PendingWorkRequest | null>(null)
  const [reason, setReason] = useState('')

  const mayReview = can('tasks.review_work_requests')

  const load = useCallback(async () => {
    if (!mayReview) return
    try {
      setRequests(
        unwrap(await api.get<ApiEnvelope<PendingWorkRequest[]> | PendingWorkRequest[]>('/api/task-work-requests/pending')),
      )
    } catch {
      // A dashboard panel is not worth an error banner over: the same requests
      // remain visible and decidable on each task's own page.
    }
  }, [mayReview])

  useEffect(() => {
    void load()
  }, [load])

  const settle = async (request: PendingWorkRequest, approved: boolean) => {
    if (!request.task) return
    setBusy(true)
    try {
      await api.post(
        `/api/tasks/${request.task.id}/work-requests/${request.id}/${approved ? 'approve' : 'decline'}`,
        approved ? {} : { reason: reason.trim() },
      )
      toast.success(
        approved
          ? `${personName(request.requester)} can start on “${request.task.title}”.`
          : `Declined. ${personName(request.requester)} has been told why.`,
      )
      setDeclining(null)
      setReason('')
      await load()
    } catch (reason_) {
      toast.error(reason_ instanceof Error ? reason_.message : 'That decision did not save.')
    } finally {
      setBusy(false)
    }
  }

  if (!mayReview || requests.length === 0) return null

  return (
    <PanelSection
      label="Waiting for your approval"
      meta={`${requests.length} ${requests.length === 1 ? 'request' : 'requests'}`}
    >
      <ul className="divide-y divide-line-soft">
        {requests.map((request) => (
          <li key={request.id} className="flex flex-wrap items-start gap-3 py-2.5 first:pt-0.5">
            <div className="min-w-0 flex-1">
              <p className="text-body-sm text-t2">
                <span className="font-medium">{personName(request.requester)}</span> wants to work on{' '}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-t1"
                  onClick={() => navigate(`/tasks?open=${request.task?.id ?? ''}`)}
                >
                  {request.task?.title ?? 'a task'}
                </button>
                {request.task?.project?.name ? ` · ${request.task.project.name}` : ''}
              </p>
              <p className="mt-0.5 text-meta-sm text-t4 text-pretty">{request.reason}</p>
            </div>

            {declining?.id === request.id ? (
              <div className="flex w-full flex-col gap-2">
                <Textarea
                  value={reason}
                  disabled={busy}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Tell them why, and what to do instead…"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setDeclining(null)
                      setReason('')
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busy || !reason.trim()}
                    onClick={() => void settle(request, false)}
                  >
                    Confirm decline
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setDeclining(request)
                    setReason('')
                  }}
                >
                  Decline
                </Button>
                <Button type="button" size="sm" disabled={busy} onClick={() => void settle(request, true)}>
                  Approve
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </PanelSection>
  )
}
