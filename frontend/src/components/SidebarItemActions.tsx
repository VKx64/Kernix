import { useState } from 'react'
import { Ellipsis } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { folderDescendantIds, folderParentId, folderTree } from '@/lib/useTaskFolders'
import type { TaskFolder } from '@/types/api'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type Action = 'rename' | 'move' | 'duplicate' | 'archive' | 'restore' | 'delete' | 'add'

export function SidebarItemActions({ name, path, href, archived = false, folder, folders = [], onSaved, onRemoved, onAdd, parentArchived = false }: {
  name: string; path: string; href: string; archived?: boolean; folder?: TaskFolder; folders?: TaskFolder[]
  onSaved: () => void; onRemoved?: () => void; onAdd?: () => void; parentArchived?: boolean
}) {
  const can = useCan()
  const [action, setAction] = useState<Action | null>(null)
  const [value, setValue] = useState('')
  const [destination, setDestination] = useState('')
  const [search, setSearch] = useState('')
  const [withTasks, setWithTasks] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const edit = can('projects.edit')
  const canArchive = folder ? edit : can('projects.archive')
  const canDuplicate = folder ? edit : can('projects.create')
  const excluded = folder ? folderDescendantIds(folders, folder.id) : new Set<string>()
  if (folder) excluded.add(String(folder.id))
  const choices = folderTree(folders).filter(node => !excluded.has(String(node.folder.id)) && !node.folder.archived_at && (String(node.folder.id) === destination || node.path.toLowerCase().includes(search.trim().toLowerCase())))
  const begin = (next: Action) => { setValue(next === 'duplicate' ? `${name} (copy)`.slice(0, 191) : next === 'add' ? '' : name); setDestination(folder ? folderParentId(folder) : ''); setSearch(''); setWithTasks(false); setError(''); setAction(next) }
  const descriptions: Record<Action, string> = {
    rename: 'Update the name without changing its contents.',
    move: 'Move this folder and its subfolders within this project. The server checks for cycles and the five-level depth limit.',
    duplicate: 'Copies active folders. Optional tasks copy titles, notes, types, urgency and checklist steps as new, unassigned work. Dates, estimates, files, logged time and activity are not copied. Project AI settings and memberships are not copied.',
    archive: folder ? 'Hide this folder and its subfolders. Their tasks must be archived first. Nothing is deleted.' : 'Hide this project. Its tasks must be archived first. Nothing is deleted.',
    restore: 'Restore this item. Restore its parent first; archived child folders remain archived until restored separately.',
    delete: folder ? 'Delete only this folder. Its tasks become ungrouped and its subfolders move up one level. The folder itself cannot be restored.' : 'Delete this empty project. Projects containing tasks, folders, forms or memory cannot be deleted; archive them instead.',
    add: 'Add a folder to this project.',
  }
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" aria-label={`Actions for ${name}`} onKeyDown={event => event.stopPropagation()} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-sidebar-accent focus-visible:outline focus-visible:outline-ring"><Ellipsis className="size-3.5" /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" onKeyDown={event => event.stopPropagation()}>
        {!archived && !parentArchived && edit && <DropdownMenuItem onSelect={() => begin('rename')}>Rename</DropdownMenuItem>}
        {!archived && !parentArchived && edit && (!folder || onAdd) && <DropdownMenuItem onSelect={() => onAdd ? onAdd() : begin('add')}>{folder ? 'Add subfolder' : 'Add folder'}</DropdownMenuItem>}
        {!archived && !parentArchived && folder && edit && <DropdownMenuItem onSelect={() => begin('move')}>Move to…</DropdownMenuItem>}
        {!archived && !parentArchived && canDuplicate && <DropdownMenuItem onSelect={() => begin('duplicate')}>Duplicate…</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => { void navigator.clipboard.writeText(new URL(href, window.location.origin).href).then(() => toast('Link copied'), () => toast.error('Could not copy link.')) }}>Copy link</DropdownMenuItem>
        {canArchive && <DropdownMenuItem disabled={parentArchived} onSelect={() => begin(archived ? 'restore' : 'archive')}>{archived ? 'Restore' : 'Archive…'}</DropdownMenuItem>}
        {edit && (folder || canArchive) && <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onSelect={() => begin('delete')}>Delete…</DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={action !== null} onOpenChange={open => { if (!open && !busy) setAction(null) }}>
      <DialogContent showCloseButton={!busy} onKeyDown={event => event.stopPropagation()}>
        <DialogTitle>{action ? `${action === 'add' ? 'Add folder to' : action.charAt(0).toUpperCase() + action.slice(1)} ${name}` : ''}</DialogTitle>
        <DialogDescription>{action ? descriptions[action] : ''}</DialogDescription>
        <form className="space-y-4" onSubmit={async event => {
          event.preventDefault()
          if (!action || busy) return
          setBusy(true); setError('')
          try {
            if (action === 'rename') await api.patch(path, { name: value.trim() })
            else if (action === 'move') await api.patch(path, { parent_id: destination || null })
            else if (action === 'duplicate') await api.post(`${path}/duplicate`, { name: value.trim(), with_tasks: withTasks })
            else if (action === 'add') await api.post(`${path}/task-folders`, { name: value.trim() })
            else if (action === 'delete') await api.delete(path)
            else await api.post(`${path}/${action}`, {})
            onSaved()
            if (action === 'delete' || action === 'archive') onRemoved?.()
            toast('Saved'); setAction(null)
          } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this change.') }
          finally { setBusy(false) }
        }}>
          {(action === 'rename' || action === 'duplicate' || action === 'add') && <label className="block text-sm">Name<input autoFocus aria-label="Name" required maxLength={191} value={value} onChange={event => setValue(event.target.value)} disabled={busy} className="mt-1 w-full rounded border bg-background p-2" /></label>}
          {action === 'move' && <div className="space-y-2"><input aria-label="Search destinations" placeholder="Search folders…" value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded border bg-background p-2" /><label className="block text-sm">Destination<select aria-label="Destination" size={6} disabled={busy} value={destination} onChange={event => setDestination(event.target.value)} className="mt-1 w-full rounded border bg-background p-2"><option value="">Project root</option>{choices.map(node => <option key={node.folder.id} value={String(node.folder.id)}>{node.path}</option>)}</select></label></div>}
          {action === 'duplicate' && <label className="block text-sm">Include<select aria-label="Duplicate contents" value={withTasks ? 'tasks' : 'structure'} disabled={busy} onChange={event => setWithTasks(event.target.value === 'tasks')} className="ml-2 rounded border bg-background p-2"><option value="structure">Structure only</option>{can('tasks.view') && can('tasks.create') && can('tasks.subtasks') && <option value="tasks">Structure + tasks</option>}</select></label>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setAction(null)}>Cancel</Button><Button type="submit" variant={action === 'delete' ? 'destructive' : 'default'} disabled={busy || ((action === 'rename' || action === 'duplicate' || action === 'add') && !value.trim())}>{busy ? 'Saving…' : action === 'delete' ? 'Delete' : 'Confirm'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </>
}
