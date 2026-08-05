import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Search } from 'lucide-react'
import { ErrorBanner } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api, unwrap } from '@/lib/api'
import type { ApiEnvelope, Invitation, InvitationCreateResponse, Project, Role } from '@/types/api'

interface InvitationLookups {
  roles?: Role[]
  projects?: Project[]
}

function expirationLabel(value?: string): string {
  if (!value) return 'Not provided'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

export function InviteUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [roles, setRoles] = useState<Role[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [lookupsLoading, setLookupsLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState('')
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [expiresInDays, setExpiresInDays] = useState(7)
  const [projectSearch, setProjectSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Invitation | null>(null)
  const [inviteUrl, setInviteUrl] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const [copyError, setCopyError] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true

    setEmail('')
    setRoleId('')
    setProjectIds([])
    setExpiresInDays(7)
    setProjectSearch('')
    setError('')
    setCreated(null)
    setInviteUrl('')
    setCopyMessage('')
    setCopyError('')
    setLookupsLoading(true)
    setLookupError('')

    void api.get<ApiEnvelope<InvitationLookups> | InvitationLookups>('/api/bootstrap')
      .then((response) => {
        if (!active) return
        const lookups = unwrap(response)
        setRoles(lookups.roles ?? [])
        setProjects(lookups.projects ?? [])
      })
      .catch((reason) => {
        if (active) setLookupError(reason instanceof Error ? reason.message : 'Unable to load roles and projects.')
      })
      .finally(() => {
        if (active) setLookupsLoading(false)
      })

    return () => { active = false }
  }, [open])

  const filteredProjects = useMemo(() => {
    const search = projectSearch.trim().toLowerCase()
    return search ? projects.filter((project) => project.name.toLowerCase().includes(search)) : projects
  }, [projectSearch, projects])

  const selectedRole = roles.find((role) => String(role.id) === roleId)
  const selectedProjects = projects.filter((project) => projectIds.includes(String(project.id)))

  const toggleProject = (project: Project, checked: boolean) => {
    const id = String(project.id)
    setProjectIds((current) => checked ? [...current, id] : current.filter((item) => item !== id))
  }

  const createInvitation = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !selectedRole) return
    if (expiresInDays < 1 || expiresInDays > 30) {
      setError('Choose an expiry between 1 and 30 days.')
      return
    }

    setBusy(true)
    setError('')
    try {
      const response = await api.post<ApiEnvelope<InvitationCreateResponse> | InvitationCreateResponse>('/api/invitations', {
        email: email.trim(),
        role_id: selectedRole.id,
        project_ids: selectedProjects.map((project) => project.id),
        expires_in_days: expiresInDays,
      })
      const result = unwrap(response)
      const invitation = result.invitation ?? result
      const link = result.inviteUrl ?? result.invite_url ?? result.invitationUrl ?? result.invitation_url ?? result.url
        ?? invitation.inviteUrl ?? invitation.invite_url ?? invitation.invitationUrl ?? invitation.invitation_url ?? invitation.url
        ?? (invitation.token ? `${window.location.origin}/invite/${invitation.token}` : '')
      if (!link) throw new Error('The invitation was created, but its link was not returned.')

      setCreated({
        ...invitation,
        email: invitation.email || email.trim(),
        role: invitation.role ?? selectedRole,
        projects: invitation.projects ?? selectedProjects.map((project) => ({ id: project.id, name: project.name })),
      })
      setInviteUrl(link)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create the invitation.')
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    setCopyMessage('')
    setCopyError('')
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopyMessage('Invitation link copied.')
    } catch {
      setCopyError('Copy failed. Select the link and copy it manually.')
    }
  }

  const createAnother = () => {
    setEmail('')
    setRoleId('')
    setProjectIds([])
    setExpiresInDays(7)
    setProjectSearch('')
    setError('')
    setCreated(null)
    setInviteUrl('')
    setCopyMessage('')
    setCopyError('')
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{created ? 'Invitation ready' : 'Invite a user'}</DialogTitle>
          <DialogDescription>
            {created
              ? 'Copy this link and send it to the person you invited.'
              : 'Choose their role and projects before they create an account.'}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                <Check className="size-5" />
              </span>
              <div className="space-y-0.5">
                <h3 className="font-medium">Ready to send</h3>
                <p className="text-sm text-muted-foreground text-pretty">
                  The invitation can only be used to create the assigned account.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-link">Invitation link</Label>
              <div className="flex gap-2">
                <Input
                  id="invite-link"
                  aria-label="Invitation link"
                  className="font-mono text-xs"
                  readOnly
                  value={inviteUrl}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button type="button" onClick={() => void copyLink()}>Copy link</Button>
              </div>
            </div>

            {copyMessage && (
              <Alert role="status">
                <AlertDescription>{copyMessage}</AlertDescription>
              </Alert>
            )}
            {copyError && <ErrorBanner message={copyError} />}

            <dl className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
              <div className="space-y-0.5">
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">Email</dt>
                <dd className="text-sm">{created.email}</dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">Role</dt>
                <dd className="text-sm">{created.role?.name ?? created.roleName ?? created.role_name ?? '—'}</dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">Expires</dt>
                <dd className="text-sm">{expirationLabel(created.expiresAt ?? created.expires_at)}</dd>
              </div>
              <div className="space-y-0.5 sm:col-span-3">
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">Projects</dt>
                <dd className="text-sm text-pretty">
                  {created.projects?.length
                    ? created.projects.map((project) => project.name).join(', ')
                    : 'No projects assigned'}
                </dd>
              </div>
            </dl>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={createAnother}>Create another</Button>
              <Button type="button" onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={(event) => void createInvitation(event)}>
            {lookupError && <ErrorBanner message={lookupError} />}

            <fieldset className="space-y-5" disabled={busy || lookupsLoading}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="invite-email">
                    Email<span aria-hidden="true" className="text-destructive"> *</span>
                  </Label>
                  <Input
                    id="invite-email"
                    aria-label="Email"
                    type="email"
                    autoComplete="off"
                    autoFocus
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    placeholder="person@example.com"
                  />
                  <p className="text-sm text-muted-foreground">The account will use this email address.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invite-role">
                    Role<span aria-hidden="true" className="text-destructive"> *</span>
                  </Label>
                  <Select value={roleId} onValueChange={setRoleId} required>
                    <SelectTrigger id="invite-role" aria-label="Role" className="w-full">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={String(role.id)}>{role.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invite-expiry">Link expires after</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="invite-expiry"
                      aria-label="Link expires after"
                      type="number"
                      min={1}
                      max={30}
                      step={1}
                      value={expiresInDays}
                      onChange={(event) => setExpiresInDays(Number(event.target.value))}
                      required
                    />
                    <span className="text-sm text-muted-foreground">days</span>
                  </div>
                </div>
              </div>

              <section className="space-y-3" aria-labelledby="invite-projects-heading">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <h3 id="invite-projects-heading" className="font-medium">Projects</h3>
                    <p className="text-sm text-muted-foreground">
                      Choose the projects this person will be assigned to.
                    </p>
                  </div>
                  <span className="shrink-0 text-sm text-muted-foreground">{projectIds.length} selected</span>
                </div>

                {projects.length > 6 && (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      aria-label="Search projects"
                      value={projectSearch}
                      onChange={(event) => setProjectSearch(event.target.value)}
                      placeholder="Search projects…"
                    />
                  </div>
                )}

                <ScrollArea className="h-56 rounded-lg border">
                  <div className="divide-y">
                    {lookupsLoading ? (
                      <div className="space-y-2 p-3">
                        {Array.from({ length: 4 }, (_, row) => <Skeleton className="h-9" key={row} />)}
                      </div>
                    ) : filteredProjects.length ? (
                      filteredProjects.map((project) => (
                        <Label
                          key={project.id}
                          className="flex cursor-pointer items-center gap-3 p-3 font-normal hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={projectIds.includes(String(project.id))}
                            onCheckedChange={(checked) => toggleProject(project, checked === true)}
                          />
                          <span className="grid min-w-0 leading-tight">
                            <span className="truncate font-medium">{project.name}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {project.client?.name ?? 'Workspace project'}
                            </span>
                          </span>
                        </Label>
                      ))
                    ) : (
                      <p className="p-4 text-sm text-muted-foreground">
                        {projectSearch ? 'No projects match this search.' : 'No active projects are available.'}
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </section>
            </fieldset>

            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button
                type="submit"
                disabled={busy || lookupsLoading || Boolean(lookupError) || !roles.length}
              >
                {busy ? 'Creating…' : 'Create invitation'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
