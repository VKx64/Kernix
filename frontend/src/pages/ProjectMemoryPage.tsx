import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Icon } from '../components/Icon'
import { EmptyState, ErrorBanner, LoadingRows, PageHeader, Panel, StatusBadge } from '../components/ui'
import { api, unwrap } from '../lib/api'
import type { ApiEnvelope, ProjectMemoryData, ProjectMemoryEntry } from '../types/api'

const MEMORY_DESCRIPTION = 'Reviewed context the AI can use when planning tasks and checking time requests.'

export function ProjectMemoryPage() {
  const { projectId } = useParams()
  const [data, setData] = useState<ProjectMemoryData | null>(null)
  const [brief, setBrief] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<'pending' | 'approved' | 'history'>('pending')

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

  if (loading) return <div className="memory-page">
    <Link className="back-link" to="/projects"><Icon name="arrow-left" size={15} /> Projects</Link>
    <PageHeader eyebrow="Project knowledge" title="Project memory" description={MEMORY_DESCRIPTION} />
    <Panel><LoadingRows rows={3} columns={2} /></Panel>
  </div>
  if (!data) return <ErrorBanner message={error || 'Project memory could not be loaded.'} onRetry={() => void load()} />
  const pending = data.entries.filter((entry) => entry.status === 'pending')
  const approved = data.entries.filter((entry) => entry.status === 'approved')
  const history = data.entries.filter((entry) => !['pending', 'approved'].includes(entry.status))
  const visibleEntries = view === 'pending' ? pending : view === 'approved' ? approved : history
  return <div className="memory-page">
    <Link className="back-link" to="/projects"><Icon name="arrow-left" size={15} /> Projects</Link>
    <PageHeader
      eyebrow="Project knowledge"
      title={data.project.name}
      description={MEMORY_DESCRIPTION}
      actions={<Link className="btn btn-quiet" to={`/tasks?project_id=${data.project.id}`}><Icon name="task" size={16} /> View tasks</Link>}
    />
    {error && <ErrorBanner message={error} />}
    {!data.project.ai_memory_enabled && <div className="memory-disabled-banner"><Icon name="pause" size={17} /><div><strong>Learning is paused</strong><span>Approved knowledge still works, but completed tasks will not suggest new lessons.</span></div></div>}

    <div className="memory-overview">
      <Panel className="memory-brief-panel">
        <header>
          <div><span className="eyebrow">Project brief</span><h2>Give the AI the big picture</h2><p>Purpose, scope, workflow, and the rules that should apply across this project.</p></div>
          <StatusBadge value={data.profile.brief_status} />
        </header>
        {data.can_manage ? <>
          <label className="memory-brief-field">
            <span>Brief</span>
            <textarea rows={5} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Example: What are we delivering, who is it for, and what should the team always keep in mind?" />
          </label>
          <div className="panel-actions"><button className="btn btn-quiet" disabled={busy || !data.project.ai_memory_enabled} onClick={() => void draft()}><Icon name="sparkles" size={16} /> Draft with AI</button><button className="btn btn-quiet" disabled={busy || !brief.trim()} onClick={() => void saveBrief(false)}>Save draft</button><button className="btn btn-primary" disabled={busy || !brief.trim()} onClick={() => void saveBrief(true)}><Icon name="check" size={16} /> Approve</button></div>
        </> : <div className={`memory-brief-copy${data.profile.approved_brief ? '' : ' empty'}`}>{data.profile.approved_brief || 'No approved project brief yet.'}</div>}
      </Panel>

      <Panel className="memory-summary-panel">
        <div className="memory-summary-heading"><span className="memory-summary-icon"><Icon name="sparkles" size={17} /></span><div><strong>AI context</strong><small>Manager controlled</small></div></div>
        <dl>
          <div><dt>Approved</dt><dd>{approved.length}</dd></div>
          <div><dt>To review</dt><dd>{pending.length}</dd></div>
          <div><dt>Learning</dt><dd className={data.project.ai_memory_enabled ? 'is-on' : ''}>{data.project.ai_memory_enabled ? 'On' : 'Off'}</dd></div>
        </dl>
        <p>The AI can suggest knowledge, but only manager-approved items are used in future decisions.</p>
      </Panel>
    </div>

    <Panel className="memory-library">
      <header className="memory-library-heading"><div><span className="eyebrow">Knowledge library</span><h2>Reusable project lessons</h2></div></header>
      <nav className="memory-tabs" aria-label="Project memory views">
        <button className={view === 'pending' ? 'active' : ''} onClick={() => setView('pending')}><Icon name="inbox" size={15} /> Review <b>{pending.length}</b></button>
        <button className={view === 'approved' ? 'active' : ''} onClick={() => setView('approved')}><Icon name="check" size={15} /> Approved <b>{approved.length}</b></button>
        <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}><Icon name="more-horizontal" size={15} /> History <b>{history.length}</b></button>
      </nav>
      {visibleEntries.length ? <div className="memory-card-grid">{visibleEntries.map((entry) => <MemoryCard key={entry.id} entry={entry} actions={view === 'pending' && data.can_manage ? <><button className="btn btn-primary" disabled={busy} onClick={() => void act(entry, 'approve')}>Approve</button><button className="btn btn-quiet" disabled={busy} onClick={() => void act(entry, 'edit')}>Edit & approve</button><button className="btn btn-quiet danger" disabled={busy} onClick={() => void act(entry, 'reject')}>Reject</button></> : view === 'approved' && data.can_manage ? <><button className="btn btn-quiet" disabled={busy} onClick={() => void act(entry, 'edit')}>Edit</button><button className="btn btn-quiet danger" disabled={busy} onClick={() => void act(entry, 'archive')}>Archive</button></> : undefined} />)}</div> : <MemoryEmpty view={view} />}
    </Panel>
  </div>
}

function MemoryEmpty({ view }: { view: 'pending' | 'approved' | 'history' }) {
  const copy = view === 'pending'
    ? { icon: 'inbox' as const, title: 'Nothing to review', description: 'New lessons from completed tasks will appear here for manager approval.' }
    : view === 'approved'
      ? { icon: 'check' as const, title: 'No approved lessons yet', description: 'Approved lessons become trusted context for future AI work.' }
      : { icon: 'more-horizontal' as const, title: 'No history yet', description: 'Archived, rejected, and replaced lessons will be kept here.' }
  return <EmptyState icon={copy.icon} title={copy.title} description={copy.description} />
}

function MemoryCard({ entry, actions }: { entry: ProjectMemoryEntry; actions?: React.ReactNode }) {
  return <article className="memory-card"><header><StatusBadge value={entry.category.replace('_', ' ')} /><small>Importance {entry.importance}/5</small></header><p>{entry.content}</p>{entry.evidence && <blockquote><strong>Evidence</strong>{entry.evidence}</blockquote>}<footer>{entry.source_task ? <Link to={`/tasks/${entry.source_task.id}`}>Source: {entry.source_task.title}</Link> : <span>Project brief</span>}<StatusBadge value={entry.status} /></footer>{actions && <div className="memory-card-actions">{actions}</div>}</article>
}
