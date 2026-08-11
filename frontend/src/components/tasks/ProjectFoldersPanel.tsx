import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FolderPlus, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useWorkspace } from '@/auth/WorkspaceProvider'
import { ErrorBanner } from '@/components/shared'
import { PanelSection } from '@/components/kernix/panel-section'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { api, unwrap } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { folderDescendantIds, folderParentId, folderTree } from '@/lib/useTaskFolders'
import type { ApiEnvelope, EntityId, TaskFolder } from '@/types/api'

/** Matches TaskFolder::MAX_DEPTH; the server is still the one that enforces it. */
const MAX_DEPTH = 5

type Draft = { parentId: string; name: string }

/**
 * The project's folder tree, with the only place folders are created, renamed,
 * moved and removed.
 *
 * Everything reloads from the server after a write rather than being patched
 * in place: a delete promotes subfolders and can rename one of them around a
 * collision, so the shape after the call is not something the client can
 * predict from what it sent.
 */
export function ProjectFoldersPanel({ projectId }: { projectId: EntityId }) {
  const can = useCan()
  const { adminOverride } = useWorkspace()
  const canEdit = can('projects.edit')

  const [folders, setFolders] = useState<TaskFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const draftInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async (signal?: () => boolean) => {
    setLoading(true)
    try {
      const response = await api.get<ApiEnvelope<TaskFolder[]> | TaskFolder[]>(`/api/projects/${projectId}/task-folders`)
      const list = unwrap(response)
      if (signal && !signal()) return
      setFolders(Array.isArray(list) ? list : [])
      setError('')
    } catch (cause) {
      if (signal && !signal()) return
      setError(cause instanceof Error ? cause.message : 'Folders could not be loaded.')
    } finally {
      if (!signal || signal()) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    let current = true
    void load(() => current)
    return () => { current = false }
  }, [load])

  useEffect(() => {
    if (draft) draftInput.current?.focus()
  }, [draft])

  const nodes = useMemo(() => folderTree(folders), [folders])
  const hidden = useMemo(() => {
    const out = new Set<string>()
    collapsed.forEach((id) => folderDescendantIds(folders, id).forEach((child) => out.add(child)))
    return out
  }, [collapsed, folders])
  const hasChildren = useMemo(() => {
    const parents = new Set<string>()
    folders.forEach((folder) => { const parent = folderParentId(folder); if (parent) parents.add(parent) })
    return parents
  }, [folders])

  /** Runs a write, then refetches. Returns false so callers can keep a draft open. */
  const mutate = async (run: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await run()
      await load()
      setError('')
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That change could not be saved.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const submitDraft = async () => {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) { setDraft(null); return }
    const okay = await mutate(() => api.post(`/api/projects/${projectId}/task-folders`, {
      name,
      parent_id: draft.parentId ? draft.parentId : null,
    }))
    // Kept open on failure so the typed name is not lost to a duplicate name
    // or a depth the server refused.
    if (okay) setDraft({ ...draft, name: '' })
  }

  const submitRename = async () => {
    if (!renaming) return
    const name = renaming.name.trim()
    if (!name) { setRenaming(null); return }
    const okay = await mutate(() => api.patch(`/api/projects/${projectId}/task-folders/${renaming.id}`, { name }))
    if (okay) setRenaming(null)
  }

  const remove = async (folder: TaskFolder) => {
    const children = folderDescendantIds(folders, folder.id).size
    const warning = children
      ? `Delete “${folder.name}”? Its ${children === 1 ? 'subfolder moves' : `${children} subfolders move`} up a level and its tasks become Ungrouped.`
      : `Delete “${folder.name}”? Its tasks become Ungrouped.`
    if (!window.confirm(warning)) return
    await mutate(() => api.delete(`/api/projects/${projectId}/task-folders/${folder.id}`, adminOverride ? { admin_override: 1 } : undefined))
  }

  const move = async (folder: TaskFolder, parentId: string | null) => {
    await mutate(() => api.patch(`/api/projects/${projectId}/task-folders/${folder.id}`, { parent_id: parentId }))
  }

  const toggle = (id: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })

  /**
   * Where a folder may be re-parented: not itself, not its own subtree, and
   * nowhere the branch it carries would overrun the cap. `depth` here is
   * zero-based, so a target's level is `depth + 1`, and the deepest folder in
   * the moved branch ends up at that level plus the branch's own height.
   */
  const moveTargets = (folder: TaskFolder, depth: number) => {
    const banned = folderDescendantIds(folders, folder.id)
    const height = nodes
      .filter((node) => String(node.folder.id) === String(folder.id) || banned.has(String(node.folder.id)))
      .reduce((tallest, node) => Math.max(tallest, node.depth), depth) - depth + 1
    return nodes.filter((node) => (
      String(node.folder.id) !== String(folder.id)
      && !banned.has(String(node.folder.id))
      && String(node.folder.id) !== folderParentId(folder)
      && node.depth + 1 + height <= MAX_DEPTH
    ))
  }

  return (
    <PanelSection
      label="Folders"
      meta={canEdit ? (
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setDraft({ parentId: '', name: '' })}>
          <Plus /> New folder
        </Button>
      ) : undefined}
      empty={!loading && !folders.length && !draft && (canEdit
        ? 'No folders yet. Add one to group this project’s tasks.'
        : 'This project has no folders yet.')}
    >
      {error && <div className="mb-2"><ErrorBanner message={error} /></div>}
      {loading && !folders.length && <p className="pb-1.5 text-body-sm text-t4">Loading folders…</p>}

      <ul className="flex flex-col">
        {nodes.map(({ folder, depth }) => {
          const id = String(folder.id)
          if (hidden.has(id)) return null
          const expandable = hasChildren.has(id)
          const isRenaming = renaming?.id === id
          const targets = canEdit ? moveTargets(folder, depth) : []
          return (
            <li key={id}>
              <div
                className="group -mx-2 flex items-center gap-1.5 rounded-md px-2 py-[6px] hover:bg-elev-low"
                style={{ paddingLeft: `${8 + depth * 16}px` }}
              >
                {expandable ? (
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    aria-expanded={!collapsed.has(id)}
                    aria-label={`${collapsed.has(id) ? 'Expand' : 'Collapse'} ${folder.name}`}
                    className="flex size-4 flex-none items-center justify-center text-t4 hover:text-t1"
                  >
                    {collapsed.has(id) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </button>
                ) : <span aria-hidden="true" className="size-4 flex-none" />}

                {isRenaming ? (
                  <Input
                    autoFocus
                    value={renaming.name}
                    disabled={busy}
                    aria-label={`Rename ${folder.name}`}
                    className="h-7 flex-1"
                    onChange={(event) => setRenaming({ id, name: event.target.value })}
                    onBlur={() => void submitRename()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); void submitRename() }
                      if (event.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-body-lg text-title">{folder.name}</span>
                )}

                {canEdit && !isRenaming && (
                  <div className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    {depth + 1 < MAX_DEPTH && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={busy}
                        aria-label={`Add a subfolder in ${folder.name}`}
                        onClick={() => { setCollapsed((current) => { const next = new Set(current); next.delete(id); return next }); setDraft({ parentId: id, name: '' }) }}
                      >
                        <FolderPlus />
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-xs" disabled={busy} aria-label={`Actions for ${folder.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setRenaming({ id, name: folder.name })}>
                          <Pencil /> Rename
                        </DropdownMenuItem>
                        {folderParentId(folder) && (
                          <DropdownMenuItem onSelect={() => void move(folder, null)}>Move to top level</DropdownMenuItem>
                        )}
                        {targets.map((target) => (
                          <DropdownMenuItem key={String(target.folder.id)} onSelect={() => void move(folder, String(target.folder.id))}>
                            Move into {target.path}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => void remove(folder)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>

              {draft?.parentId === id && (
                <DraftRow
                  depth={depth + 1}
                  draft={draft}
                  busy={busy}
                  inputRef={draftInput}
                  label={`New subfolder in ${folder.name}`}
                  onChange={(name) => setDraft({ ...draft, name })}
                  onSubmit={() => void submitDraft()}
                  onCancel={() => setDraft(null)}
                />
              )}
            </li>
          )
        })}
      </ul>

      {draft?.parentId === '' && (
        <DraftRow
          depth={0}
          draft={draft}
          busy={busy}
          inputRef={draftInput}
          label="New folder name"
          onChange={(name) => setDraft({ ...draft, name })}
          onSubmit={() => void submitDraft()}
          onCancel={() => setDraft(null)}
        />
      )}
    </PanelSection>
  )
}

function DraftRow({
  depth, draft, busy, inputRef, label, onChange, onSubmit, onCancel,
}: {
  depth: number
  draft: Draft
  busy: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  label: string
  onChange: (name: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className={cn('-mx-2 flex items-center gap-1.5 py-[6px] pr-2')} style={{ paddingLeft: `${8 + depth * 16 + 22}px` }}>
      <Input
        ref={inputRef}
        value={draft.name}
        disabled={busy}
        placeholder={label}
        aria-label={label}
        className="h-7 flex-1"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); onSubmit() }
          if (event.key === 'Escape') onCancel()
        }}
      />
      <Button type="button" size="sm" disabled={busy || !draft.name.trim()} onClick={onSubmit}>Add</Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
    </div>
  )
}
