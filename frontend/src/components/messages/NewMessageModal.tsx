import { useEffect, useState } from 'react'
import { Search, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api, displayName, normalizePage, unwrap } from '@/lib/api'
import type { ApiEnvelope, Message, Paginated, Task, UserSummary } from '@/types/api'

export function NewMessageModal({
  open,
  onClose,
  onStarted,
}: {
  open: boolean
  onClose: () => void
  onStarted: (conversation: Message) => void
}) {
  const [recipients, setRecipients] = useState<UserSummary[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskSearch, setTaskSearch] = useState('')
  const [recipientId, setRecipientId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setRecipientId(''); setTaskId(''); setBody(''); setError(''); setTaskSearch('')
    void (async () => {
      try {
        setRecipients(unwrap(await api.get<ApiEnvelope<UserSummary[]> | UserSummary[]>('/api/messages/recipients')) ?? [])
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Unable to load people.')
      }
    })()
  }, [open])

  // Task list is searchable because a workspace can hold far more tasks than a dropdown should show.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.get<Paginated<Task> | ApiEnvelope<Paginated<Task>> | Task[]>('/api/tasks', { per_page: 50, search: taskSearch || undefined }, controller.signal)
        setTasks(normalizePage(response).data)
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : 'Unable to load tasks.')
      }
    }, taskSearch ? 250 : 0)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [open, taskSearch])

  const send = async () => {
    if (!recipientId || !taskId || !body.trim()) return
    setBusy(true); setError('')
    try {
      const response = await api.post<ApiEnvelope<Message> | Message>('/api/messages', { recipient_id: Number(recipientId), task_id: Number(taskId), body: body.trim() })
      onStarted(unwrap(response))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start this conversation.')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>Conversations are attached to a task so both of you share the same context.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Send to</Label>
            <Select value={recipientId} onValueChange={setRecipientId}>
              <SelectTrigger aria-label="Send to" className="w-full">
                <SelectValue placeholder="Choose a person…" />
              </SelectTrigger>
              <SelectContent>
                {recipients.map((person) => <SelectItem key={person.id} value={String(person.id)}>{displayName(person)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-message-task-search">Search tasks</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-t3" />
              <Input id="new-message-task-search" className="pl-8" value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Search tasks…" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>About task</Label>
            <Select value={taskId} onValueChange={setTaskId}>
              <SelectTrigger aria-label="About task" className="w-full">
                <SelectValue placeholder={tasks.length ? 'Choose a task…' : 'No tasks match'} />
              </SelectTrigger>
              <SelectContent>
                {tasks.map((task) => <SelectItem key={task.id} value={String(task.id)}>{task.project?.name ? `${task.title} · ${task.project.name}` : task.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-message-body">Message</Label>
            <Textarea id="new-message-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write your message…" rows={5} />
          </div>
          {error && <p className="text-body-sm text-danger" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy || !recipientId || !taskId || !body.trim()} onClick={() => void send()}>
            <Send /> {busy ? 'Sending…' : 'Send message'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
