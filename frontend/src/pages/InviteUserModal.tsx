import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { ErrorBanner, Modal } from '../components/ui'
import { api, unwrap } from '../lib/api'
import type { ApiEnvelope, Invitation, InvitationCreateResponse, Project, Role } from '../types/api'

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
    <Modal
      open={open}
      onClose={onClose}
      title={created ? 'Invitation ready' : 'Invite a user'}
      description={created ? 'Copy this link and send it to the person you invited.' : 'Choose their role and projects before they create an account.'}
      size="lg"
      closeDisabled={busy}
      className="invite-user-modal"
    >
      {created ? (
        <div className="invite-success">
          <div className="invite-success-heading"><span><Icon name="check" size={22} /></span><div><h3>Ready to send</h3><p>The invitation can only be used to create the assigned account.</p></div></div>
          <label className="invite-link-field">
            <span className="field-label">Invitation link</span>
            <span><input aria-label="Invitation link" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /><button type="button" className="btn btn-primary" onClick={() => void copyLink()}>Copy link</button></span>
          </label>
          {copyMessage && <div className="success-banner" role="status">{copyMessage}</div>}
          {copyError && <ErrorBanner message={copyError} />}
          <dl className="invite-summary">
            <div><dt>Email</dt><dd>{created.email}</dd></div>
            <div><dt>Role</dt><dd>{created.role?.name ?? created.roleName ?? created.role_name ?? '—'}</dd></div>
            <div><dt>Expires</dt><dd>{expirationLabel(created.expiresAt ?? created.expires_at)}</dd></div>
            <div className="wide"><dt>Projects</dt><dd>{created.projects?.length ? created.projects.map((project) => project.name).join(', ') : 'No projects assigned'}</dd></div>
          </dl>
          <footer className="form-footer invite-success-actions"><button type="button" className="btn btn-quiet" onClick={createAnother}>Create another</button><button type="button" className="btn btn-primary" onClick={onClose}>Done</button></footer>
        </div>
      ) : (
        <form className="entity-form invite-user-form" onSubmit={(event) => void createInvitation(event)}>
          {lookupError && <ErrorBanner message={lookupError} />}
          <fieldset disabled={busy || lookupsLoading}>
            <div className="form-grid">
              <label className="form-field wide">
                <span className="field-label">Email <b aria-hidden="true">*</b></span>
                <input aria-label="Email" type="email" autoComplete="off" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="person@example.com" />
                <span className="field-help">The account will use this email address.</span>
              </label>
              <label className="form-field">
                <span className="field-label">Role <b aria-hidden="true">*</b></span>
                <select aria-label="Role" value={roleId} onChange={(event) => setRoleId(event.target.value)} required>
                  <option value="">Select…</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span className="field-label">Link expires after</span>
                <span className="invite-expiry-input"><input aria-label="Link expires after" type="number" min={1} max={30} step={1} value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} required /><span>days</span></span>
              </label>
            </div>
            <section className="invite-project-picker" aria-labelledby="invite-projects-heading">
              <div className="invite-project-picker-heading"><div><h3 id="invite-projects-heading">Projects</h3><p>Choose the projects this person will be assigned to.</p></div><span>{projectIds.length} selected</span></div>
              {projects.length > 6 && <label className="invite-project-search"><Icon name="search" size={16} /><input aria-label="Search projects" value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="Search projects…" /></label>}
              <div className="invite-project-list">
                {lookupsLoading ? <div className="empty-inline"><span className="spinner" /> Loading roles and projects…</div> : filteredProjects.length ? filteredProjects.map((project) => (
                  <label key={project.id}><input type="checkbox" checked={projectIds.includes(String(project.id))} onChange={(event) => toggleProject(project, event.target.checked)} /><span><strong>{project.name}</strong><small>{project.client?.name ?? 'Workspace project'}</small></span></label>
                )) : <div className="empty-inline">{projectSearch ? 'No projects match this search.' : 'No active projects are available.'}</div>}
              </div>
            </section>
          </fieldset>
          {error && <div className="form-error" role="alert">{error}</div>}
          <footer className="form-footer"><button type="button" className="btn btn-quiet" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || lookupsLoading || Boolean(lookupError) || !roles.length}>{busy ? 'Creating…' : 'Create invitation'}</button></footer>
        </form>
      )}
    </Modal>
  )
}
