import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { Icon } from '../components/Icon'
import { api, unwrap } from '../lib/api'
import { BRAND_MARK, BRAND_NAME } from '../lib/brand'
import type { ApiEnvelope, InvitationPreview } from '../types/api'

function invitationRole(preview: InvitationPreview): string {
  return preview.role?.name ?? preview.roleName ?? preview.role_name ?? 'Workspace member'
}

function invitationExpiry(preview: InvitationPreview): string | null {
  const value = preview.expiresAt ?? preview.expires_at
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

export function InviteAcceptPage() {
  const { token = '' } = useParams<{ token: string }>()
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [previewError, setPreviewError] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setPreviewError('')
    setPreview(null)

    if (!token) {
      setPreviewError('This invitation link is incomplete.')
      setLoading(false)
      return () => { active = false }
    }

    void api.get<ApiEnvelope<InvitationPreview> | InvitationPreview>(`/api/invitations/${encodeURIComponent(token)}`)
      .then((response) => {
        if (active) setPreview(unwrap(response))
      })
      .catch((reason) => {
        if (active) setPreviewError(reason instanceof Error ? reason.message : 'This invitation is invalid, expired, or has already been used.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [token])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!preview || busy) return
    if (password !== passwordConfirmation) {
      setFormError('The password confirmation does not match.')
      return
    }

    setBusy(true)
    setFormError('')
    try {
      await api.csrf()
      await api.post(`/api/invitations/${encodeURIComponent(token)}/accept`, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        username: username.trim(),
        password,
        password_confirmation: passwordConfirmation,
      })
      await refresh()
      navigate('/', { replace: true })
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Unable to create your account from this invitation.')
    } finally {
      setBusy(false)
    }
  }

  const expires = preview ? invitationExpiry(preview) : null
  const projects = preview?.projects ?? []

  return (
    <main className="login-page invite-accept-page">
      <section className="login-story">
        <div className="login-brand"><span className="brand-mark">{BRAND_MARK}</span><strong>{BRAND_NAME}</strong></div>
        <div className="story-copy">
          <span className="eyebrow">You’re invited</span>
          <h1>Join the work already in motion.</h1>
          <p>Create your account and your assigned role and projects will be ready when you arrive.</p>
          <div className="story-metrics">
            <div><span className="metric-icon"><Icon name="role" /></span><strong>Your access is ready</strong><small>Your administrator has already chosen your role.</small></div>
            <div><span className="metric-icon"><Icon name="briefcase" /></span><strong>Start with context</strong><small>Your assigned projects will be waiting in the workspace.</small></div>
          </div>
        </div>
        <div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" />
      </section>
      <section className="login-form-side">
        <div className="login-card invite-accept-card">
          {loading ? (
            <div className="invite-loading" role="status"><span className="spinner" /><p>Checking your invitation…</p></div>
          ) : previewError || !preview ? (
            <div className="invite-unavailable">
              <span className="eyebrow">Invitation unavailable</span>
              <h2>This link can’t be used.</h2>
              <p>{previewError || 'This invitation is invalid, expired, or has already been used.'}</p>
              <Link className="btn btn-quiet" to="/login">Back to sign in</Link>
            </div>
          ) : (
            <>
              <header><span className="eyebrow">Create your account</span><h2>Welcome to {BRAND_NAME}</h2><p>Finish your profile to accept the invitation for <strong>{preview.email}</strong>.</p></header>
              <section className="invite-preview" aria-label="Invitation details">
                <div><small>Role</small><strong>{invitationRole(preview)}</strong></div>
                <div><small>Projects</small><strong>{projects.length ? `${projects.length} assigned` : 'No projects assigned'}</strong></div>
                {projects.length > 0 && <ul>{projects.map((project) => <li key={project.id}>{project.name}</li>)}</ul>}
                {expires && <p>Invitation expires {expires}.</p>}
              </section>
              <form onSubmit={submit}>
                <div className="invite-name-grid">
                  <label className="form-field">
                    <span className="field-label">First name</span>
                    <input autoComplete="given-name" autoFocus value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
                  </label>
                  <label className="form-field">
                    <span className="field-label">Last name</span>
                    <input autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} />
                  </label>
                </div>
                <label className="form-field wide">
                  <span className="field-label">Username</span>
                  <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
                </label>
                <label className="form-field wide">
                  <span className="field-label">Password</span>
                  <input autoComplete="new-password" type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
                </label>
                <label className="form-field wide">
                  <span className="field-label">Confirm password</span>
                  <input autoComplete="new-password" type="password" minLength={8} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required />
                </label>
                {formError && <div className="form-error" role="alert">{formError}</div>}
                <button className="btn btn-primary btn-large btn-block" disabled={busy}>{busy ? 'Creating account…' : 'Create account'} <span>→</span></button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
