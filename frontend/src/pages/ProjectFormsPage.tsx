import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Bug, Lightbulb, Link as LinkIcon, MoreHorizontal, Plus } from 'lucide-react'
import { Avatar, ErrorBanner } from '@/components/shared'
import { ProjectTabStrip } from '@/components/forms/ProjectTabStrip'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { api, normalizePage, unwrap } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import type { ApiEnvelope, EntityId, FormSubmission, Paginated, Project, ProjectForm } from '@/types/api'

/**
 * Screen A: the project's intake forms and the queue of what has come in and
 * has not been decided yet. Presets and a blank start all create a live form
 * immediately — there is deliberately no multi-step wizard here.
 */
export function ProjectFormsPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const can = useCan()
  const canManage = can('forms.manage')

  const [project, setProject] = useState<Project | null>(null)
  const [forms, setForms] = useState<ProjectForm[]>([])
  const [queue, setQueue] = useState<Array<FormSubmission & { formTitle: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busySlug, setBusySlug] = useState<EntityId | null>(null)
  const [newFormOpen, setNewFormOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true); setError('')
    try {
      const [projectResponse, formsResponse] = await Promise.all([
        api.get<ApiEnvelope<Project>>(`/api/projects/${projectId}`),
        api.get<ApiEnvelope<ProjectForm[]> | ProjectForm[]>(`/api/projects/${projectId}/forms`),
      ])
      setProject(unwrap(projectResponse))
      const formList = unwrap(formsResponse)
      setForms(formList)

      const pendingForms = formList.filter((form) => (form.pending_submissions_count ?? 0) > 0)
      if (pendingForms.length) {
        const results = await Promise.all(pendingForms.map((form) => (
          api.get<ApiEnvelope<Paginated<FormSubmission>> | Paginated<FormSubmission>>(`/api/project-forms/${form.id}/submissions`, { status: 'new', per_page: 50 })
            .then((response) => normalizePage(response).data.map((submission) => ({ ...submission, formTitle: form.title })))
        )))
        const merged = results.flat().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        setQueue(merged)
      } else {
        setQueue([])
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load forms.')
    } finally {
      setLoading(false)
    }
  }, [projectId])
  useEffect(() => { void load() }, [load])

  const createForm = async (preset: 'bug_report' | 'feature_request' | null) => {
    if (!projectId) return
    setCreating(true); setError('')
    try {
      const body = preset ? { preset } : { title: 'Untitled form' }
      const response = await api.post<ApiEnvelope<ProjectForm>>(`/api/projects/${projectId}/forms`, body)
      const created = unwrap(response)
      navigate(`/projects/${projectId}/forms/${created.id}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create this form.')
      setCreating(false)
      setNewFormOpen(false)
    }
  }

  const copyLink = async (form: ProjectForm) => {
    const url = `${window.location.origin}/f/${form.slug}`
    try { await navigator.clipboard.writeText(url) } catch { /* clipboard denied — link stays visible in the row */ }
  }

  const toggleState = async (form: ProjectForm) => {
    setBusySlug(form.id); setError('')
    try {
      const next = form.state === 'live' ? 'paused' : 'live'
      const response = await api.patch<ApiEnvelope<ProjectForm>>(`/api/project-forms/${form.id}`, { state: next })
      const updated = unwrap(response)
      setForms((current) => current.map((item) => (item.id === form.id ? updated : item)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update this form.')
    } finally { setBusySlug(null) }
  }

  const duplicateForm = async (form: ProjectForm) => {
    setBusySlug(form.id); setError('')
    try {
      await api.post(`/api/project-forms/${form.id}/duplicate`)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to duplicate this form.')
    } finally { setBusySlug(null) }
  }

  const deleteForm = async (form: ProjectForm) => {
    if (!window.confirm(`Delete "${form.title}"? Its submissions stay, but the public link stops working.`)) return
    setBusySlug(form.id); setError('')
    try {
      await api.delete(`/api/project-forms/${form.id}`)
      setForms((current) => current.filter((item) => item.id !== form.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete this form.')
    } finally { setBusySlug(null) }
  }

  const liveCount = forms.filter((form) => form.state === 'live').length
  // Paused forms sort last, live/other forms keep their arrival order.
  const sortedForms = [...forms].sort((a, b) => (a.state === 'paused' ? 1 : 0) - (b.state === 'paused' ? 1 : 0))
  const firstLive = forms.find((form) => form.state === 'live')

  if (loading && !project) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[43px]" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {project && (
        <>
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-h1 text-title-strong">{project.name}</h1>
            <span className="text-body-lg text-t3">{project.client?.name}</span>
          </header>
          <ProjectTabStrip projectId={project.id} formsCount={forms.length} />

          <div className="flex flex-wrap items-end gap-3.5 pt-1.5">
            <div className="flex flex-col gap-[5px]">
              <span className="text-title text-title-strong">Intake forms</span>
              <span className="text-body-sm text-t3">
                {project.client?.name ? `${project.client.name} can submit without an account` : 'Anyone with the link can submit without an account'}
                {forms.length > 0 && ` · ${forms.length} form${forms.length === 1 ? '' : 's'}, ${liveCount} live`}
              </span>
            </div>
            <span className="flex-1" />
            {firstLive && (
              <Button variant="outline" size="sm" asChild>
                <a href={`/f/${firstLive.slug}`} target="_blank" rel="noreferrer">Preview as client</a>
              </Button>
            )}
            {canManage && (
              <Dialog open={newFormOpen} onOpenChange={setNewFormOpen}>
                <DialogTrigger asChild>
                  <Button size="sm"><Plus /> New form</Button>
                </DialogTrigger>
                <NewFormDialogContent creating={creating} onChoose={(preset) => void createForm(preset)} />
              </Dialog>
            )}
          </div>

          {forms.length === 0 ? (
            <EmptyFormsState canManage={canManage} creating={creating} onChoose={(preset) => void createForm(preset)} />
          ) : (
            <>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                {sortedForms.map((form) => (
                  <FormCard
                    key={form.id}
                    form={form}
                    canManage={canManage}
                    busy={busySlug === form.id}
                    onCopyLink={() => void copyLink(form)}
                    onEdit={() => navigate(`/projects/${projectId}/forms/${form.id}`)}
                    onToggleState={() => void toggleState(form)}
                    onDuplicate={() => void duplicateForm(form)}
                    onDelete={() => void deleteForm(form)}
                  />
                ))}
              </div>

              {queue.length > 0 && (
                <section className="flex flex-col gap-[11px]">
                  <div className="flex items-center gap-[11px]">
                    <span className="text-label uppercase text-label-fg">Awaiting review</span>
                    <span className="inline-flex h-[18px] items-center rounded-[5px] bg-warn/14 px-1.5 font-mono text-[10px] text-warn">{queue.length}</span>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-line">
                    <div className="grid grid-cols-[26px_1fr_132px_120px_92px_78px] items-center gap-3.5 bg-surface px-[15px] py-[9px] font-mono text-[9.5px] tracking-[.09em] text-t4 uppercase">
                      <span></span><span>Summary</span><span>From</span><span>Form</span><span>Severity</span><span>Received</span>
                    </div>
                    {queue.map((submission) => (
                      <QueueRow key={submission.id} submission={submission} onOpen={() => navigate(`/projects/${projectId}/forms/${submission.project_form_id ?? submission.projectFormId}?submission=${submission.id}`)} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function NewFormDialogContent({ creating, onChoose }: { creating: boolean; onChoose: (preset: 'bug_report' | 'feature_request' | null) => void }) {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New form</DialogTitle>
        <DialogDescription>Starts live right away — there is no draft step.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Button variant="outline" className="h-auto justify-start gap-3 py-3" disabled={creating} onClick={() => onChoose('bug_report')}>
          <Bug className="size-4 text-danger" />
          <span className="flex flex-col items-start gap-0.5">
            <span className="text-body-lg font-semibold">Bug Report</span>
            <span className="text-meta text-t3">Something in the portal is broken.</span>
          </span>
        </Button>
        <Button variant="outline" className="h-auto justify-start gap-3 py-3" disabled={creating} onClick={() => onChoose('feature_request')}>
          <Lightbulb className="size-4 text-brand" />
          <span className="flex flex-col items-start gap-0.5">
            <span className="text-body-lg font-semibold">Feature Request</span>
            <span className="text-meta text-t3">Ask for something new.</span>
          </span>
        </Button>
        <Button variant="outline" className="h-auto justify-start gap-3 py-3" disabled={creating} onClick={() => onChoose(null)}>
          <Plus className="size-4 text-t3" />
          <span className="flex flex-col items-start gap-0.5">
            <span className="text-body-lg font-semibold">Start blank</span>
            <span className="text-meta text-t3">An empty form you build from scratch.</span>
          </span>
        </Button>
      </div>
    </DialogContent>
  )
}

function EmptyFormsState({ canManage, creating, onChoose }: { canManage: boolean; creating: boolean; onChoose: (preset: 'bug_report' | 'feature_request' | null) => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-line py-16 text-center">
      <div className="max-w-80 space-y-1.5">
        <h3 className="text-title text-title-strong">No intake forms yet</h3>
        <p className="text-body-sm text-t3">Give clients a link they can fill in without an account — submissions land in a review queue here, never straight into the task list.</p>
      </div>
      {canManage && (
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" disabled={creating} onClick={() => onChoose('bug_report')}><Bug /> Bug Report</Button>
          <Button variant="outline" disabled={creating} onClick={() => onChoose('feature_request')}><Lightbulb /> Feature Request</Button>
          <Button disabled={creating} onClick={() => onChoose(null)}><Plus /> Start blank</Button>
        </div>
      )}
    </div>
  )
}

function countOrDash(value: number | undefined | null): string {
  return value ? String(value) : '—'
}

function agoOrDash(value: string | undefined | null): string {
  if (!value) return '—'
  return shortAgo(value)
}

function shortAgo(value: string): string {
  const at = new Date(value).getTime()
  if (Number.isNaN(at)) return '—'
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000))
  if (minutes < 60) return `${Math.max(minutes, 1)}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.round(days / 7)
  return `${weeks}w`
}

function FormCard({
  form, canManage, busy, onCopyLink, onEdit, onToggleState, onDuplicate, onDelete,
}: {
  form: ProjectForm
  canManage: boolean
  busy: boolean
  onCopyLink: () => void
  onEdit: () => void
  onToggleState: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const live = form.state === 'live'
  return (
    <div className={cn('overflow-hidden rounded-xl border border-line-strong bg-surface', !live && 'opacity-[.62]')}>
      <div className="flex flex-col gap-[9px] px-4 pt-[15px] pb-[13px]">
        <div className="flex items-center gap-[9px]">
          <span className={cn('grid size-[26px] flex-none place-items-center rounded-[7px]', live ? 'bg-brand/15 text-brand-hover' : 'bg-soft text-t3')}>
            {form.icon ?? '📋'}
          </span>
          <span className="truncate text-body-lg font-semibold text-title-strong">{form.title}</span>
          <span className="flex-1" />
          <span className={cn('inline-flex h-[22px] flex-none items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-meta-sm font-semibold', live ? 'bg-good/13 text-good' : 'bg-soft text-t3')}>
            <span aria-hidden="true" className="size-[5px] rounded-full" style={{ background: 'currentColor' }} />
            {live ? 'Live' : 'Paused'}
          </span>
        </div>
        <span className="line-clamp-2 text-body-sm leading-[1.6] text-t3">{form.blurb || 'No description yet.'}</span>
      </div>
      <div className="flex items-center border-t border-line">
        <span className="flex flex-1 flex-col gap-[3px] px-4 py-2.5">
          <span className="font-mono text-[15px] text-t1">{countOrDash(form.submissions_count)}</span>
          <span className="text-meta text-t4">submissions</span>
        </span>
        <span className="h-[30px] w-px bg-line" />
        <span className="flex flex-1 flex-col gap-[3px] px-4 py-2.5">
          <span className={cn('font-mono text-[15px]', form.pending_submissions_count ? 'text-warn' : 'text-t1')}>{countOrDash(form.pending_submissions_count)}</span>
          <span className="text-meta text-t4">awaiting review</span>
        </span>
        <span className="h-[30px] w-px bg-line" />
        <span className="flex flex-1 flex-col gap-[3px] px-4 py-2.5">
          <span className="font-mono text-[15px] text-t1">{agoOrDash(form.updated_at)}</span>
          <span className="text-meta text-t4">last received</span>
        </span>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-inset px-3 py-2.5">
        {live ? (
          <button type="button" onClick={onCopyLink} className="flex h-[27px] items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-meta text-t2 hover:bg-elev">
            <LinkIcon className="size-3" /> Copy link
          </button>
        ) : (
          <span className="flex h-[27px] items-center px-2.5 text-meta text-t4">Link disabled</span>
        )}
        <span className="flex-1" />
        {canManage && (
          <>
            <button type="button" onClick={onEdit} className="flex h-[27px] items-center whitespace-nowrap rounded-md px-2.5 text-meta text-t2 hover:bg-elev">
              Edit
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" disabled={busy} aria-label={`More actions for ${form.title}`} className="grid size-[27px] place-items-center rounded-md text-t4 hover:bg-elev hover:text-t1">
                  <MoreHorizontal className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onToggleState}>{live ? 'Pause' : 'Resume'}</DropdownMenuItem>
                <DropdownMenuItem onSelect={onDuplicate}>Duplicate</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </div>
  )
}

function severityMeta(submission: FormSubmission & { formTitle: string }) {
  const fields = submission.form_snapshot?.fields ?? []
  const field = fields.find((item) => item.maps === 'urgency')
  if (!field) return null
  const value = submission.answers?.[field.id]
  const choice = field.choices?.find((item) => item.value === value)
  return choice ? { label: choice.label, urgencyKey: choice.urgency_key } : null
}

function summaryOf(submission: FormSubmission & { formTitle: string }) {
  const fields = submission.form_snapshot?.fields ?? []
  const titleField = fields.find((item) => item.maps === 'title')
  const value = titleField ? submission.answers?.[titleField.id] : null
  if (typeof value === 'string' && value.trim()) return value
  return `Submission #${submission.id}`
}

function QueueRow({ submission, onOpen }: { submission: FormSubmission & { formTitle: string }; onOpen: () => void }) {
  const severity = severityMeta(submission)
  const from = submission.submitter_name || submission.email || 'Anonymous'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[26px_1fr_132px_120px_92px_78px] items-center gap-3.5 border-t border-line-soft px-[15px] py-3 text-left hover:bg-row-hover"
    >
      <span aria-hidden="true" className="size-[7px] rounded-full bg-warn" />
      <span className="truncate text-body text-t1">{summaryOf(submission)}</span>
      <span className="flex min-w-0 items-center gap-2">
        <Avatar user={{ id: submission.id, name: from }} className="size-5 text-[8.5px]" />
        <span className="truncate text-body-sm text-t3">{from}</span>
      </span>
      <span className="truncate text-meta text-t3">{submission.formTitle}</span>
      {severity ? (
        <span className="inline-flex h-[22px] w-fit items-center gap-1.5 whitespace-nowrap rounded-md bg-soft px-2 text-meta-sm font-semibold text-t2">{severity.label}</span>
      ) : <span />}
      <span className="whitespace-nowrap font-mono text-meta-sm text-t4">{shortAgo(submission.created_at)}</span>
    </button>
  )
}
