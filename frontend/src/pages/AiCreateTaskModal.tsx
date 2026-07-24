import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Icon } from '../components/Icon'
import { ErrorBanner, Modal } from '../components/ui'
import { api, unwrap } from '../lib/api'
import type { AiTaskGeneration, ApiEnvelope, EntityId, Project, TaskFolder } from '../types/api'

export function AiCreateTaskModal({ open, projects, initialProjectId, onClose, onCreated }: {
  open: boolean
  projects: Project[]
  initialProjectId?: EntityId
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const enabledProjects = useMemo(() => projects.filter((project) => project.aiTaskCreationEnabled ?? project.ai_task_creation_enabled), [projects])
  const [projectId, setProjectId] = useState('')
  const [folderId, setFolderId] = useState('')
  const [folders, setFolders] = useState<TaskFolder[]>([])
  const [prompt, setPrompt] = useState('')
  const [reply, setReply] = useState('')
  const [generation, setGeneration] = useState<AiTaskGeneration | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notifiedId, setNotifiedId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const preferred = enabledProjects.find((project) => String(project.id) === String(initialProjectId)) ?? enabledProjects[0]
    setProjectId(preferred ? String(preferred.id) : '')
    setFolderId(''); setPrompt(''); setReply(''); setGeneration(null); setError(''); setNotifiedId(null)
  }, [enabledProjects, initialProjectId, open])

  useEffect(() => {
    if (!open || !projectId) { setFolders([]); return }
    let active = true
    void api.get<ApiEnvelope<TaskFolder[]> | TaskFolder[]>(`/api/projects/${projectId}/task-folders`)
      .then((response) => { if (active) setFolders(unwrap(response)) })
      .catch(() => { if (active) setFolders([]) })
    return () => { active = false }
  }, [open, projectId])

  useEffect(() => {
    if (!open || !generation || !['queued', 'creating'].includes(generation.status)) return
    let active = true
    const timer = window.setTimeout(() => {
      void api.get<ApiEnvelope<AiTaskGeneration> | AiTaskGeneration>(`/api/ai-task-generations/${generation.id}`)
        .then((response) => { if (active) setGeneration(unwrap(response)) })
        .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to check AI progress.') })
    }, 1200)
    return () => { active = false; window.clearTimeout(timer) }
  }, [generation, open])

  useEffect(() => {
    if (generation?.status === 'created' && notifiedId !== String(generation.id)) {
      setNotifiedId(String(generation.id)); void onCreated()
    }
  }, [generation, notifiedId, onCreated])

  const start = async (event: FormEvent) => {
    event.preventDefault(); if (!projectId || !prompt.trim()) return
    setBusy(true); setError('')
    try {
      const response = await api.post<ApiEnvelope<AiTaskGeneration> | AiTaskGeneration>(`/api/projects/${projectId}/ai-task-generations`, { prompt: prompt.trim(), task_folder_id: folderId ? Number(folderId) : null })
      setGeneration(unwrap(response))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to start AI task creation.') }
    finally { setBusy(false) }
  }

  const answer = async (event: FormEvent) => {
    event.preventDefault(); if (!generation || !reply.trim()) return
    setBusy(true); setError('')
    try {
      const response = await api.post<ApiEnvelope<AiTaskGeneration> | AiTaskGeneration>(`/api/ai-task-generations/${generation.id}/messages`, { message: reply.trim() })
      setReply(''); setGeneration(unwrap(response))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to send your answer.') }
    finally { setBusy(false) }
  }

  const undo = async () => {
    if (!generation || !window.confirm('Undo this entire AI-created batch?')) return
    setBusy(true); setError('')
    try {
      const response = await api.post<ApiEnvelope<AiTaskGeneration> | AiTaskGeneration>(`/api/ai-task-generations/${generation.id}/undo`)
      setGeneration(unwrap(response)); await onCreated()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to undo this batch.') }
    finally { setBusy(false) }
  }

  const terminal = generation && ['created', 'failed', 'clock_blocked', 'budget_blocked', 'undone'].includes(generation.status)
  return <Modal open={open} onClose={onClose} title="Create tasks with AI" description="Describe the outcome in plain language. The AI may create one task or a complete set." size="lg" closeDisabled={busy}>
    <div className="ai-task-creator">
      {error && <ErrorBanner message={error} />}
      {!enabledProjects.length && <div className="empty-inline">AI task creation is not enabled on any visible project. A project manager can enable it in the project settings.</div>}
      {!generation && enabledProjects.length > 0 && <form onSubmit={start} className="form-grid">
        <label className="form-field"><span className="field-label">Project</span><select value={projectId} onChange={(event) => { setProjectId(event.target.value); setFolderId('') }} required>{enabledProjects.map((project) => <option key={project.id} value={String(project.id)}>{project.name}</option>)}</select></label>
        <label className="form-field"><span className="field-label">Folder (optional)</span><select value={folderId} onChange={(event) => setFolderId(event.target.value)}><option value="">Ungrouped</option>{folders.map((folder) => <option key={folder.id} value={String(folder.id)}>{folder.name}</option>)}</select></label>
        <label className="form-field wide"><span className="field-label">What needs to be done?</span><textarea rows={7} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Example: Prepare next month's client launch. Create the planning, asset review, QA, and handoff tasks, assign them where sensible, and keep everything before July 30." required /></label>
        <div className="ai-privacy-note"><Icon name="sparkles" size={16} /><span>Only approved project memory is used. Private messages, email, and attachments are excluded.</span></div>
        <footer className="form-footer"><button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !prompt.trim()}><Icon name="sparkles" size={16} /> {busy ? 'Starting…' : 'Create now'}</button></footer>
      </form>}
      {generation && <div className="ai-generation-result">
        <div className={`ai-generation-state ${generation.status}`}><span className={['queued', 'creating'].includes(generation.status) ? 'spinner' : ''} /><div><strong>{generation.status === 'queued' ? 'Waiting for the AI' : generation.status === 'creating' ? 'Creating your task batch' : generation.status === 'needs_input' ? 'The AI needs one detail' : generation.status === 'created' ? 'Tasks created' : generation.status === 'undone' ? 'Batch undone' : 'AI creation stopped'}</strong><span>{generation.result_summary || generation.error_message || (generation.status === 'creating' ? 'Validating the plan and creating everything together…' : '')}</span></div></div>
        {generation.messages?.map((message) => <div key={message.id} className={`ai-conversation-message ${message.role}`}><small>{message.role === 'assistant' ? 'AI project manager' : 'You'}</small><p>{message.body}</p></div>)}
        {generation.status === 'needs_input' && <form onSubmit={answer} className="ai-clarification"><textarea rows={4} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Answer the question…" required /><button className="btn btn-primary" disabled={busy || !reply.trim()}>Send answer</button></form>}
        {generation.status === 'created' && <div className="ai-created-tasks">{generation.generated_tasks?.map((link) => link.task && <Link key={link.task_id} to={`/tasks/${link.task.id}`}><Icon name="task" size={15} /> {link.task.title}</Link>)}</div>}
        {terminal && <footer className="form-footer">{generation.status === 'created' && <button type="button" className="btn btn-quiet danger" disabled={busy} onClick={() => void undo()}>Undo batch</button>}<button type="button" className="btn btn-primary" onClick={onClose}>Done</button></footer>}
      </div>}
    </div>
  </Modal>
}
