import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Loader2, Sparkles, SquareCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { EmptyState } from '@/components/shared'
import { cn } from '@/lib/utils'
import { api, unwrap } from '../lib/api'
import type { AiTaskGeneration, ApiEnvelope, EntityId, Project, TaskFolder } from '../types/api'

const STATUS_COPY: Record<string, string> = {
  queued: 'Waiting for the AI',
  creating: 'Creating your task batch',
  needs_input: 'The AI needs one detail',
  created: 'Tasks created',
  undone: 'Batch undone',
}

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

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create tasks with AI</DialogTitle>
          <DialogDescription>Describe the outcome in plain language. The AI may create one task or a complete set.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!enabledProjects.length && (
            <EmptyState
              title="AI task creation is not enabled on any visible project."
              description="A project manager can enable it in the project settings."
              icon={Sparkles}
            />
          )}

          {!generation && enabledProjects.length > 0 && (
            <form onSubmit={start} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ai-task-project">Project</Label>
                  <Select value={projectId} onValueChange={(next) => { setProjectId(next); setFolderId('') }}>
                    <SelectTrigger id="ai-task-project" className="w-full">
                      <SelectValue placeholder="Choose project…" />
                    </SelectTrigger>
                    <SelectContent aria-label="Project">
                      {enabledProjects.map((project) => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-task-folder">Folder (optional)</Label>
                  <Select value={folderId || '__unset__'} onValueChange={(next) => setFolderId(next === '__unset__' ? '' : next)}>
                    <SelectTrigger id="ai-task-folder" className="w-full">
                      <SelectValue placeholder="Ungrouped" />
                    </SelectTrigger>
                    <SelectContent aria-label="Folder (optional)">
                      <SelectItem value="__unset__">Ungrouped</SelectItem>
                      {folders.map((folder) => <SelectItem key={folder.id} value={String(folder.id)}>{folder.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-task-prompt">What needs to be done?</Label>
                <Textarea
                  id="ai-task-prompt"
                  rows={7}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Example: Prepare next month's client launch. Create the planning, asset review, QA, and handoff tasks, assign them where sensible, and keep everything before July 30."
                  required
                />
              </div>
              <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                <Sparkles className="mt-0.5 size-4 shrink-0" />
                <span>Only approved project memory is used. Private messages, email, and attachments are excluded.</span>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button disabled={busy || !prompt.trim()}><Sparkles /> {busy ? 'Starting…' : 'Create now'}</Button>
              </DialogFooter>
            </form>
          )}

          {generation && (
            <div className="space-y-4">
              <div className={cn('flex items-center gap-3 rounded-lg border p-3', generation.status === 'created' && 'border-success')}>
                {['queued', 'creating'].includes(generation.status) ? <Loader2 className="size-4 animate-spin" /> : <SquareCheck className="size-4" />}
                <div>
                  <strong className="block text-sm">{STATUS_COPY[generation.status] ?? 'AI creation stopped'}</strong>
                  <span className="text-sm text-muted-foreground">
                    {generation.result_summary || generation.error_message || (generation.status === 'creating' ? 'Validating the plan and creating everything together…' : '')}
                  </span>
                </div>
              </div>

              {generation.messages?.map((message) => (
                <div key={message.id} className="rounded-md border p-3">
                  <small className="text-xs font-medium text-muted-foreground">{message.role === 'assistant' ? 'AI project manager' : 'You'}</small>
                  <p className="text-sm text-pretty">{message.body}</p>
                </div>
              ))}

              {generation.status === 'needs_input' && (
                <form onSubmit={answer} className="space-y-2">
                  <Label htmlFor="ai-task-reply" className="sr-only">Answer the question</Label>
                  <Textarea id="ai-task-reply" rows={4} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Answer the question…" required />
                  <Button disabled={busy || !reply.trim()}>Send answer</Button>
                </form>
              )}

              {generation.status === 'created' && (
                <div className="space-y-1">
                  {generation.generated_tasks?.map((link) => link.task && (
                    <Link key={link.task_id} to={`/tasks/${link.task.id}`} className="flex items-center gap-2 rounded-md border p-2 text-sm hover:bg-accent">
                      <SquareCheck className="size-4 text-muted-foreground" /> {link.task.title}
                    </Link>
                  ))}
                </div>
              )}

              {terminal && (
                <DialogFooter>
                  {generation.status === 'created' && (
                    <Button type="button" variant="outline" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => void undo()}>Undo batch</Button>
                  )}
                  <Button type="button" onClick={onClose}>Done</Button>
                </DialogFooter>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
