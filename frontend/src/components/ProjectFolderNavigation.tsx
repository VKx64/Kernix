import { useEffect, useState } from 'react'
import { NavLink, useNavigate, useSearchParams } from 'react-router'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { SidebarItemActions } from '@/components/SidebarItemActions'
import { useCollection } from '@/lib/useCollection'
import { folderTree, folderDescendantIds } from '@/lib/useTaskFolders'
import { useCan } from '@/lib/permissions'
import type { EntityId, TaskFolder } from '@/types/api'

export function ProjectFolderNavigation({ projectId, showArchived = false, projectArchived = false }: { projectId: EntityId; showArchived?: boolean; projectArchived?: boolean }) {
  const path = `/api/projects/${projectId}/task-folders`
  const { data: folders, loading, error, reload } = useCollection<TaskFolder>(path, { filters: { archived: showArchived ? 'with' : undefined } })
  const navigate = useNavigate()
  useEffect(() => {
    const refresh = () => { void reload() }
    window.addEventListener('kernix:task-folders-changed', refresh)
    return () => window.removeEventListener('kernix:task-folders-changed', refresh)
  }, [reload])
  const can = useCan()
  const [params] = useSearchParams()
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [parent, setParent] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const hidden = new Set(collapsed.flatMap(id => [...folderDescendantIds(folders, id)]))
  const add = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setSaveError('')
    try {
      await api.post(path, { name: name.trim(), parent_id: parent || null })
      window.dispatchEvent(new Event('kernix:task-folders-changed'))
      setCollapsed(ids => ids.filter(id => id !== parent))
      setParent(null)
      setName('')
      reload()
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'Could not create folder.')
    } finally { setBusy(false) }
  }
  const begin = (id: string) => { setParent(id); setName(''); setSaveError('') }
  return <div className="ml-3 border-l pl-2 text-xs">
    {loading && <p className="py-1 text-muted-foreground">Loading folders…</p>}
    {error && <p role="alert">{error}</p>}
    {folderTree(folders).filter(node => !hidden.has(String(node.folder.id))).map(({ folder, depth, path: label }) => {
      const id = String(folder.id)
      const closed = collapsed.includes(id)
      return <div key={id} className="flex items-center gap-1 py-1" style={{ paddingLeft: depth * 10 }}>
        <button type="button" aria-label={`Toggle ${folder.name}`} aria-expanded={!closed} onClick={() => setCollapsed(ids => closed ? ids.filter(value => value !== id) : [...ids, id])}>
          {closed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
        <NavLink className={`min-w-0 flex-1 truncate rounded px-1 ${folder.archived_at ? 'text-muted-foreground italic' : ''} ${params.get('task_folder_id') === id && params.get('project_id') === String(projectId) ? 'bg-sidebar-accent font-medium' : ''}`} title={`${label}${folder.archived_at ? ' (archived)' : ''}`} to={`/tasks?project_id=${projectId}&task_folder_id=${id}${folder.archived_at ? '&archived=1' : ''}`}>{folder.name}{folder.archived_at ? ' (archived)' : ''}</NavLink>
        <SidebarItemActions name={folder.name} path={`${path}/${id}`} href={`/tasks?project_id=${projectId}&task_folder_id=${id}`} folder={folder} folders={folders} archived={Boolean(folder.archived_at)} parentArchived={projectArchived} onAdd={depth < 4 ? () => begin(id) : undefined} onSaved={() => window.dispatchEvent(new Event('kernix:task-folders-changed'))} onRemoved={() => { const affected = folderDescendantIds(folders, id); affected.add(id); if (params.get('project_id') === String(projectId) && affected.has(params.get('task_folder_id') ?? '')) navigate(`/tasks?project_id=${projectId}`) }} />
      </div>
    })}
    {can('projects.edit') && !projectArchived && <button type="button" className="flex items-center gap-1 py-2 text-muted-foreground" onClick={() => begin('')}><Plus className="size-3" /> Add folder</button>}
    {parent !== null && <form onSubmit={add} className="space-y-2 py-2">
      <label className="block">{parent ? `Subfolder in ${folders.find(folder => String(folder.id) === parent)?.name}` : 'New folder'}
        <input autoFocus aria-label="Folder name" maxLength={191} value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded border bg-background p-1" disabled={busy} />
      </label>
      {saveError && <p role="alert" className="text-destructive">{saveError}</p>}
      <button type="submit" disabled={busy || !name.trim()} className="mr-3 disabled:opacity-50">{busy ? 'Saving…' : 'Create'}</button>
      <button type="button" disabled={busy} onClick={() => setParent(null)}>Cancel</button>
    </form>}
  </div>
}
