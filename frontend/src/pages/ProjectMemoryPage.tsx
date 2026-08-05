import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Check, Inbox, MoreHorizontal, Pause, Sparkles, SquareCheck } from 'lucide-react'
import { EmptyState, ErrorBanner, LoadingRows, PageHeader, Panel, StatusBadge } from '@/components/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, unwrap } from '@/lib/api'
import type { ApiEnvelope, ProjectMemoryData, ProjectMemoryEntry } from '@/types/api'

const MEMORY_DESCRIPTION = 'Reviewed context the AI can use when planning tasks and checking time requests.'

type MemoryView = 'pending' | 'approved' | 'history'

export function ProjectMemoryPage() {
  const { projectId } = useParams()
  const [data, setData] = useState<ProjectMemoryData | null>(null)
  const [brief, setBrief] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<MemoryView>('pending')

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true); setError('')
    try {
      const response = await api.get<ApiEnvelope<ProjectMemoryData> | ProjectMemoryData>(`/api/projects/${projectId}/ai-memory`)
      const next = unwrap(response); setData(next); setBrief(next.profile.draft_brief ?? next.profile.approved_brief ?? '')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load project memory.') }
    finally { setLoading(false) }
  }, [projectId])
  useEffect(() => { void load() }, [load])

  const draft = async () => {
    setBusy(true); setError('')
    try { await api.post(`/api/projects/${projectId}/ai-memory/brief-draft`); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to draft the project brief.') }
    finally { setBusy(false) }
  }
  const saveBrief = async (approve: boolean) => {
    if (!brief.trim()) return
    setBusy(true); setError('')
    try { await api.patch(`/api/projects/${projectId}/ai-memory/brief`, { brief: brief.trim(), approve }); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save the project brief.') }
    finally { setBusy(false) }
  }
  const act = async (entry: ProjectMemoryEntry, action: 'approve' | 'reject' | 'archive' | 'edit') => {
    let payload: Record<string, unknown> = { action }
    if (action === 'reject') { const reason = window.prompt('Why should this lesson be rejected?'); if (!reason) return; payload.reason = reason }
    if (action === 'edit') { const content = window.prompt('Edit this approved project memory:', entry.content); if (!content?.trim()) return; payload = { action, content: content.trim(), category: entry.category } }
    setBusy(true); setError('')
    try { await api.patch(`/api/projects/${projectId}/ai-memory/entries/${entry.id}`, payload); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update this memory entry.') }
    finally { setBusy(false) }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <BackLink />
        <PageHeader eyebrow="Project knowledge" title="Project memory" description={MEMORY_DESCRIPTION} />
        <Panel><LoadingRows rows={3} columns={2} /></Panel>
      </div>
    )
  }
  if (!data) return <ErrorBanner message={error || 'Project memory could not be loaded.'} onRetry={() => void load()} />

  const pending = data.entries.filter((entry) => entry.status === 'pending')
  const approved = data.entries.filter((entry) => entry.status === 'approved')
  const history = data.entries.filter((entry) => !['pending', 'approved'].includes(entry.status))
  const visibleEntries = view === 'pending' ? pending : view === 'approved' ? approved : history

  return (
    <div className="space-y-6">
      <BackLink />
      <PageHeader
        eyebrow="Project knowledge"
        title={data.project.name}
        description={MEMORY_DESCRIPTION}
        actions={(
          <Button asChild variant="outline">
            <Link to={`/tasks?project_id=${data.project.id}`}>
              <SquareCheck />
              View tasks
            </Link>
          </Button>
        )}
      />

      {error && <ErrorBanner message={error} />}

      {!data.project.ai_memory_enabled && (
        <Alert>
          <Pause />
          <AlertTitle>Learning is paused</AlertTitle>
          <AlertDescription>
            Approved knowledge still works, but completed tasks will not suggest new lessons.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <Panel contentClassName="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Project brief</p>
              <h2 className="text-lg font-semibold tracking-tight">Give the AI the big picture</h2>
              <p className="text-sm text-muted-foreground text-pretty">
                Purpose, scope, workflow, and the rules that should apply across this project.
              </p>
            </div>
            <StatusBadge value={data.profile.brief_status} />
          </div>

          {data.can_manage ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="project-brief">Brief</Label>
                <Textarea
                  id="project-brief"
                  rows={5}
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                  placeholder="Example: What are we delivering, who is it for, and what should the team always keep in mind?"
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" disabled={busy || !data.project.ai_memory_enabled} onClick={() => void draft()}>
                  <Sparkles />
                  Draft with AI
                </Button>
                <Button variant="outline" disabled={busy || !brief.trim()} onClick={() => void saveBrief(false)}>
                  Save draft
                </Button>
                <Button disabled={busy || !brief.trim()} onClick={() => void saveBrief(true)}>
                  <Check />
                  Approve
                </Button>
              </div>
            </>
          ) : (
            <p className={data.profile.approved_brief ? 'text-sm text-pretty' : 'text-sm text-muted-foreground'}>
              {data.profile.approved_brief || 'No approved project brief yet.'}
            </p>
          )}
        </Panel>

        <Panel contentClassName="space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md border">
              <Sparkles className="size-4" />
            </span>
            <div className="leading-tight">
              <p className="font-medium">AI context</p>
              <p className="text-xs text-muted-foreground">Manager controlled</p>
            </div>
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Approved</dt>
              <dd className="font-mono tabular-nums">{approved.length}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">To review</dt>
              <dd className="font-mono tabular-nums">{pending.length}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Learning</dt>
              <dd>
                <Badge variant={data.project.ai_memory_enabled ? 'default' : 'outline'}>
                  {data.project.ai_memory_enabled ? 'On' : 'Off'}
                </Badge>
              </dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground text-pretty">
            The AI can suggest knowledge, but only manager-approved items are used in future decisions.
          </p>
        </Panel>
      </div>

      <Panel contentClassName="space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Knowledge library</p>
          <h2 className="text-lg font-semibold tracking-tight">Reusable project lessons</h2>
        </div>

        <Tabs value={view} onValueChange={(next) => setView(next as MemoryView)}>
          <TabsList aria-label="Project memory views">
            <TabsTrigger value="pending">
              <Inbox />
              Review
              <Badge variant="secondary" className="ml-1">{pending.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="approved">
              <Check />
              Approved
              <Badge variant="secondary" className="ml-1">{approved.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="history">
              <MoreHorizontal />
              History
              <Badge variant="secondary" className="ml-1">{history.length}</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {visibleEntries.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {visibleEntries.map((entry) => (
              <MemoryCard
                key={entry.id}
                entry={entry}
                actions={view === 'pending' && data.can_manage ? (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => void act(entry, 'approve')}>Approve</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(entry, 'edit')}>Edit &amp; approve</Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => void act(entry, 'reject')}>Reject</Button>
                  </>
                ) : view === 'approved' && data.can_manage ? (
                  <>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(entry, 'edit')}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => void act(entry, 'archive')}>Archive</Button>
                  </>
                ) : undefined}
              />
            ))}
          </div>
        ) : (
          <MemoryEmpty view={view} />
        )}
      </Panel>
    </div>
  )
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
      <Link to="/projects">
        <ArrowLeft />
        Projects
      </Link>
    </Button>
  )
}

function MemoryEmpty({ view }: { view: MemoryView }) {
  const copy = view === 'pending'
    ? { icon: Inbox, title: 'Nothing to review', description: 'New lessons from completed tasks will appear here for manager approval.' }
    : view === 'approved'
      ? { icon: Check, title: 'No approved lessons yet', description: 'Approved lessons become trusted context for future AI work.' }
      : { icon: MoreHorizontal, title: 'No history yet', description: 'Archived, rejected, and replaced lessons will be kept here.' }
  return <EmptyState icon={copy.icon} title={copy.title} description={copy.description} />
}

function MemoryCard({ entry, actions }: { entry: ProjectMemoryEntry; actions?: React.ReactNode }) {
  return (
    <Card className="gap-4">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <StatusBadge value={entry.category.replace('_', ' ')} />
        <span className="text-xs text-muted-foreground">Importance {entry.importance}/5</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-pretty">{entry.content}</p>
        {entry.evidence && (
          <blockquote className="space-y-1 border-l-2 pl-3 text-sm text-muted-foreground">
            <strong className="block text-xs uppercase tracking-widest">Evidence</strong>
            {entry.evidence}
          </blockquote>
        )}
      </CardContent>
      <CardFooter className="flex-wrap items-center justify-between gap-2 text-sm">
        {entry.source_task ? (
          <Link className="underline underline-offset-4" to={`/tasks/${entry.source_task.id}`}>
            Source: {entry.source_task.title}
          </Link>
        ) : (
          <span className="text-muted-foreground">Project brief</span>
        )}
        <StatusBadge value={entry.status} />
      </CardFooter>
      {actions && <CardFooter className="flex-wrap gap-2">{actions}</CardFooter>}
    </Card>
  )
}
