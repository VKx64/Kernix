import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { ArrowRight, Clock, SquareCheck } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BRAND_MARK, BRAND_NAME } from '@/lib/brand'

const highlights = [
  { icon: SquareCheck, title: 'Stay focused', copy: 'See the work that needs you now.' },
  { icon: Clock, title: 'Track naturally', copy: 'Connect logged time to real outcomes.' },
]

export function LoginPage() {
  const { status, login } = useAuth()
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const destination = (location.state as { from?: string } | null)?.from || '/'

  if (status === 'authenticated') return <Navigate to={destination} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(identity.trim(), password, remember)
      navigate(destination, { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in.')
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
          <h1 className="text-4xl font-semibold tracking-tight text-balance">Keep every production moving.</h1>
          <p className="text-muted-foreground text-pretty">
            Projects, client details, task conversations, and time—organized for the whole team.
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
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Welcome back</p>
            <CardTitle asChild className="text-xl">
              <h2>Sign in to your workspace</h2>
            </CardTitle>
            <CardDescription>Use your username or email address.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="identity">Username or email</Label>
                <Input
                  id="identity"
                  autoComplete="username"
                  autoFocus
                  value={identity}
                  onChange={(event) => setIdentity(event.target.value)}
                  required
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    className="pr-16"
                    autoComplete="current-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    placeholder="Enter your password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 h-7 -translate-y-1/2"
                    onClick={() => setShowPassword((show) => !show)}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember"
                  checked={remember}
                  onCheckedChange={(checked) => setRemember(checked === true)}
                />
                <Label htmlFor="remember" className="font-normal">Keep me signed in</Label>
              </div>

              {error && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
                <ArrowRight />
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">
              No account yet?{' '}
              <Link className="font-medium text-foreground underline-offset-4 hover:underline" to="/register">
                Create one
              </Link>
            </p>
            <p className="text-xs text-muted-foreground lg:hidden">Protected by secure, cookie-based authentication.</p>
          </CardFooter>
        </Card>
      </section>
    </main>
  )
}
