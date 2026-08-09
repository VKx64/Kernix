import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { ArrowRight, Clock, SquareCheck } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError, api } from '@/lib/api'
import { BRAND_MARK, BRAND_NAME } from '@/lib/brand'

type FieldErrors = Partial<Record<'name' | 'email' | 'password', string>>

function fieldErrorsFrom(reason: unknown): FieldErrors {
  if (!(reason instanceof ApiError) || reason.status !== 422) return {}
  const details = reason.details as { errors?: Record<string, string[]> } | undefined
  const errors = details?.errors ?? {}
  const pick = (key: string): string | undefined => errors[key]?.[0]
  return {
    name: pick('name'),
    email: pick('email'),
    // The confirmation input has its own field, but the rule that fails
    // lives on `password` (`confirmed`), so both surface the same message.
    password: pick('password') ?? pick('password_confirmation'),
  }
}

const highlights = [
  { icon: SquareCheck, title: 'Stay focused', copy: 'See the work that needs you now.' },
  { icon: Clock, title: 'Track naturally', copy: 'Connect logged time to real outcomes.' },
]

/**
 * Creating an account.
 *
 * Two ways in, and the difference is one query parameter. Arriving from an
 * invitation, the token comes along and the new account joins that workspace
 * with the role the invitation carries. Arriving cold, the account is created
 * belonging to nothing, and the workspace step comes next — which is why this
 * page promises a workspace rather than delivering one.
 */
export function RegisterPage() {
  const { status, refresh } = useAuth()
  const [params] = useSearchParams()
  const invitation = params.get('invitation') ?? ''
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const navigate = useNavigate()

  if (status === 'authenticated') return <Navigate to="/" replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setFieldErrors({})
    try {
      await api.csrf()
      await api.post('/register', {
        name: name.trim(),
        email: email.trim(),
        password,
        password_confirmation: confirmation,
        invitation_token: invitation || undefined,
      })
      // The session exists now; the shell decides whether the next stop is
      // onboarding or the dashboard.
      await refresh()
      navigate('/', { replace: true })
    } catch (reason) {
      const fields = fieldErrorsFrom(reason)
      setFieldErrors(fields)
      // A field already carries its message; the banner only needs to speak
      // up when the failure has nowhere else to land.
      const hasFieldError = Object.values(fields).some(Boolean)
      if (!hasFieldError) {
        setError(reason instanceof Error ? reason.message : 'Unable to create your account.')
      }
    } finally {
      setBusy(false)
    }
  }

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
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            One calm place for busy work
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance">
            {invitation ? 'Join your team.' : 'Start your workspace.'}
          </h1>
          <p className="text-muted-foreground text-pretty">
            {invitation
              ? 'Your account joins the workspace that invited you, with the access they set for you.'
              : 'Create your account, name your workspace, and it is ready to work in.'}
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

        <p className="text-xs text-muted-foreground">Protected by secure, cookie-based authentication.</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Get started</p>
            <CardTitle asChild className="text-xl">
              <h2>Create your account</h2>
            </CardTitle>
            <CardDescription>
              {invitation ? 'You were invited, so this joins their workspace.' : 'You will name your workspace next.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="name">Your name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  placeholder="Maria Santos"
                  aria-invalid={Boolean(fieldErrors.name)}
                />
                {fieldErrors.name && <p className="text-sm text-destructive">{fieldErrors.name}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  placeholder="you@example.com"
                  aria-invalid={Boolean(fieldErrors.email)}
                />
                {fieldErrors.email && <p className="text-sm text-destructive">{fieldErrors.email}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  aria-invalid={Boolean(fieldErrors.password)}
                />
                {fieldErrors.password && <p className="text-sm text-destructive">{fieldErrors.password}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password_confirmation">Confirm password</Label>
                <Input
                  id="password_confirmation"
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                  placeholder="Type it again"
                />
              </div>

              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Creating your account…' : 'Create account'}
                <ArrowRight />
              </Button>
            </form>
          </CardContent>
          <CardFooter>
            <p className="text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link className="font-medium text-foreground underline-offset-4 hover:underline" to="/login">Sign in</Link>
            </p>
          </CardFooter>
        </Card>
      </section>
    </main>
  )
}
