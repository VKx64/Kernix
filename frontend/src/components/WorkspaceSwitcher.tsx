import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { api, unwrap } from '@/lib/api'
import { BRAND_MARK, BRAND_NAME } from '@/lib/brand'
import { useCan } from '@/lib/permissions'
import type { ApiEnvelope, Workspace } from '@/types/api'

export function WorkspaceSwitcher({ onSwitched }: { onSwitched: () => void | Promise<void> }) {
  const can = useCan()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')

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
    if (workspace.active) return
    setBusy(true)
    try {
      await api.post(`/api/workspaces/${workspace.id}/activate`)
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
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                aria-label={`Workspace: ${active?.name ?? 'none'}. Switch workspace`}
                className="data-[state=open]:bg-sidebar-accent"
              >
                <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary font-semibold text-sidebar-primary-foreground">
                  {(active?.name ?? BRAND_MARK).charAt(0).toUpperCase()}
                </span>
                <span className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-medium">{active?.name ?? BRAND_NAME}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {workspaces.length > 1 ? `${workspaces.length} workspaces` : 'Workspace'}
                  </span>
                </span>
                <ChevronsUpDown className="ml-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60" sideOffset={4}>
              <DropdownMenuLabel className="text-xs text-muted-foreground">Switch workspace</DropdownMenuLabel>
              {workspaces.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  disabled={busy}
                  onSelect={() => void activate(workspace)}
                  className="gap-2"
                >
                  <span className="flex size-6 items-center justify-center rounded-sm border text-xs">
                    {workspace.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="grid min-w-0 flex-1 leading-tight">
                    <span className="truncate">{workspace.name}</span>
                    {typeof workspace.member_count === 'number' && (
                      <span className="truncate text-xs text-muted-foreground">
                        {workspace.member_count} member{workspace.member_count === 1 ? '' : 's'}
                      </span>
                    )}
                  </span>
                  {workspace.active && <Check className="ml-auto size-4" />}
                </DropdownMenuItem>
              ))}
              {can('workspaces.manage') && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
                    <Plus />
                    New workspace
                  </DropdownMenuItem>
                </>
              )}
              {error && (
                <p className="px-2 py-1.5 text-xs text-destructive" role="alert">{error}</p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => { if (!busy) { setCreateOpen(open); if (!open) setError('') } }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>
              A workspace keeps its own clients, projects, and tasks. Nothing is shared with the others.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={create}>
            <div className="space-y-2">
              <Label htmlFor="workspace-name">
                Workspace name<span aria-hidden="true" className="text-destructive"> *</span>
              </Label>
              <Input
                id="workspace-name"
                autoFocus
                value={name}
                disabled={busy}
                placeholder="Second studio"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? 'Creating…' : 'Create and open'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
