import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useAnchoredPopup } from './fields'
import { Icon } from './Icon'
import { Modal } from './ui'
import { api, unwrap } from '../lib/api'
import { BRAND_MARK, BRAND_NAME } from '../lib/brand'
import { useCan } from '../lib/permissions'
import type { ApiEnvelope, Workspace } from '../types/api'

export function WorkspaceSwitcher({ onSwitched }: { onSwitched: () => void | Promise<void> }) {
  const can = useCan()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const close = useCallback(() => setOpen(false), [])
  const position = useAnchoredPopup(open, triggerRef, menuRef, close)

  const load = useCallback(async () => {
    try {
      const list = unwrap(await api.get<ApiEnvelope<Workspace[]> | Workspace[]>('/api/workspaces'))
      // A malformed payload must not take the whole shell down with it.
      setWorkspaces(Array.isArray(list) ? list : [])
    } catch {
      // The switcher is supplemental; the current workspace still works.
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const active = workspaces.find((workspace) => workspace.active) ?? workspaces[0] ?? null

  const activate = async (workspace: Workspace) => {
    if (workspace.active) { setOpen(false); return }
    setBusy(true)
    try {
      await api.post(`/api/workspaces/${workspace.id}/activate`)
      setOpen(false)
      await load()
      await onSwitched()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That workspace could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      await api.post('/api/workspaces', { name: name.trim() })
      setCreateOpen(false)
      setName('')
      await load()
      await onSwitched()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The workspace could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="workspace-switcher"
        aria-expanded={open}
        aria-label={`Workspace: ${active?.name ?? 'none'}. Switch workspace`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="brand-mark">{(active?.name ?? BRAND_MARK).charAt(0).toUpperCase()}</span>
        <span className="brand-copy">
          <strong>{active?.name ?? BRAND_NAME}</strong>
          <small>{workspaces.length > 1 ? `${workspaces.length} workspaces` : 'Workspace'}</small>
        </span>
        <Icon name="chevron-down" size={15} />
      </button>

      {open && position && (
        <div className="field-popup workspace-menu" ref={menuRef} style={{ top: position.top, left: position.left }}>
          <span className="workspace-menu-label">Switch workspace</span>
          <ul>
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <button type="button" className={workspace.active ? 'is-active' : ''} disabled={busy} onClick={() => void activate(workspace)}>
                  <span className="workspace-dot">{workspace.name.charAt(0).toUpperCase()}</span>
                  <span>
                    <strong>{workspace.name}</strong>
                    {typeof workspace.member_count === 'number' && <small>{workspace.member_count} member{workspace.member_count === 1 ? '' : 's'}</small>}
                  </span>
                  {workspace.active && <Icon name="check" size={15} />}
                </button>
              </li>
            ))}
          </ul>
          {can('workspaces.manage') && (
            <button type="button" className="workspace-menu-create" onClick={() => { setOpen(false); setCreateOpen(true) }}>
              <Icon name="plus" size={15} /> New workspace
            </button>
          )}
          {error && <p className="workspace-menu-error" role="alert">{error}</p>}
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => { if (!busy) { setCreateOpen(false); setError('') } }}
        title="Create workspace"
        description="A workspace keeps its own clients, projects, and tasks. Nothing is shared with the others."
        size="sm"
        closeDisabled={busy}
      >
        <form className="entity-form" onSubmit={create}>
          <label className="form-field wide">
            <span className="field-label">Workspace name <b aria-hidden="true">*</b></span>
            <input data-autofocus value={name} disabled={busy} placeholder="Second studio" onChange={(event) => setName(event.target.value)} />
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <footer className="form-footer">
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setCreateOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create and open'}</button>
          </footer>
        </form>
      </Modal>
    </>
  )
}
