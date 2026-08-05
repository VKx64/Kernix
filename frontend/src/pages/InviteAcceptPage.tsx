import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowRight, Briefcase, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { api, unwrap } from '@/lib/api'
import { BRAND_MARK, BRAND_NAME } from '@/lib/brand'
import type { ApiEnvelope, InvitationPreview } from '@/types/api'

function invitationRole(preview: InvitationPreview): string {
  return preview.role?.name ?? preview.roleName ?? preview.role_name ?? 'Workspace member'
}

function invitationExpiry(preview: InvitationPreview): string | null {
  const value = preview.expiresAt ?? preview.expires_at
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

const highlights = [
  { icon: ShieldCheck, title: 'Your access is ready', copy: 'Your administrator has already chosen your role.' },
  { icon: Briefcase, title: 'Start with context', copy: 'Your assigned projects will be waiting in the workspace.' },
]

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
    <main className="grid min-h-svh lg:grid-cols-2">
      <section className="hidden flex-col justify-between border-r bg-muted/40 p-10 lg:flex">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground">
            {BRAND_MARK}
          </span>
          <strong className="text-lg tracking-tight">{BRAND_NAME}</strong>
        </div>

        <div className="max-w-md space-y-4">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">You’re invited</p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance">Join the work already in motion.</h1>
          <p className="text-muted-foreground text-pretty">
            Create your account and your assigned role and projects will be ready when you arrive.
          </p>
          <dl className="grid gap-4 pt-4 sm:grid-cols-2">
            {highlights.map((item) => (
              <div key={item.title} className="space-y-1.5">
                <span className="flex size-9 items-center justify-center rounded-md border bg-background">
                  <item.icon className="size-4" />
                </span>
                <dt className="font-medium">{item.title}</dt>
                <dd className="text-sm text-muted-foreground text-pretty">{item.copy}</dd>
              </div>
            ))}
          </dl>
        </div>

        <span />
      </section>

      <section className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          {loading ? (
            <CardContent className="space-y-3" role="status">
              <p className="text-sm text-muted-foreground">Checking your invitation…</p>
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8 w-2/3" />
            </CardContent>
          ) : previewError || !preview ? (
            <>
              <CardHeader>
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Invitation unavailable
                </p>
                <CardTitle asChild className="text-xl">
                  <h2>This link can’t be used.</h2>
                </CardTitle>
                <CardDescription>
                  {previewError || 'This invitation is invalid, expired, or has already been used.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline">
                  <Link to="/login">Back to sign in</Link>
                </Button>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Create your account
                </p>
                <CardTitle asChild className="text-xl">
                  <h2>Welcome to {BRAND_NAME}</h2>
                </CardTitle>
                <CardDescription>
                  Finish your profile to accept the invitation for <strong>{preview.email}</strong>.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-5">
                <section className="space-y-2 rounded-lg border p-4" aria-label="Invitation details">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">Role</span>
                    <Badge variant="secondary">{invitationRole(preview)}</Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">Projects</span>
                    <span className="text-sm font-medium">
                      {projects.length ? `${projects.length} assigned` : 'No projects assigned'}
                    </span>
                  </div>
                  {projects.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5 pt-1">
                      {projects.map((project) => (
                        <li key={project.id}>
                          <Badge variant="outline" className="font-normal">{project.name}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                  {expires && <p className="pt-1 text-xs text-muted-foreground">Invitation expires {expires}.</p>}
                </section>

                <form className="space-y-4" onSubmit={submit}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="first-name">First name</Label>
                      <Input
                        id="first-name"
                        autoComplete="given-name"
                        autoFocus
                        value={firstName}
                        onChange={(event) => setFirstName(event.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="last-name">Last name</Label>
                      <Input
                        id="last-name"
                        autoComplete="family-name"
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      autoComplete="username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      autoComplete="new-password"
                      type="password"
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password-confirmation">Confirm password</Label>
                    <Input
                      id="password-confirmation"
                      autoComplete="new-password"
                      type="password"
                      minLength={8}
                      value={passwordConfirmation}
                      onChange={(event) => setPasswordConfirmation(event.target.value)}
                      required
                    />
                  </div>

                  {formError && (
                    <Alert variant="destructive" role="alert">
                      <AlertDescription>{formError}</AlertDescription>
                    </Alert>
                  )}

                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? 'Creating account…' : 'Create account'}
                    <ArrowRight />
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </section>
    </main>
  )
}
