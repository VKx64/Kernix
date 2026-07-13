import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { Icon } from '../components/Icon'
import { BRAND_MARK, BRAND_NAME } from '../lib/brand'

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
    <main className="login-page">
      <section className="login-story">
        <div className="login-brand"><span className="brand-mark">{BRAND_MARK}</span><strong>{BRAND_NAME}</strong></div>
        <div className="story-copy">
          <span className="eyebrow">One calm place for busy work</span>
          <h1>Keep every production moving.</h1>
          <p>Projects, client details, task conversations, and time—organized for the whole team.</p>
          <div className="story-metrics">
            <div><span className="metric-icon"><Icon name="task" /></span><strong>Stay focused</strong><small>See the work that needs you now.</small></div>
            <div><span className="metric-icon"><Icon name="clock" /></span><strong>Track naturally</strong><small>Connect logged time to real outcomes.</small></div>
          </div>
        </div>
        <div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" />
      </section>
      <section className="login-form-side">
        <div className="login-card">
          <header><span className="eyebrow">Welcome back</span><h2>Sign in to your workspace</h2><p>Use your username or email address.</p></header>
          <form onSubmit={submit}>
            <label className="form-field wide">
              <span className="field-label">Username or email</span>
              <input autoComplete="username" autoFocus value={identity} onChange={(event) => setIdentity(event.target.value)} required placeholder="you@example.com" />
            </label>
            <label className="form-field wide password-field">
              <span className="field-label">Password</span>
              <input autoComplete="current-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="Enter your password" />
              <button type="button" onClick={() => setShowPassword((show) => !show)}>{showPassword ? 'Hide' : 'Show'}</button>
            </label>
            <label className="remember-line"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Keep me signed in</span></label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="btn btn-primary btn-large btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <span>→</span></button>
          </form>
          <footer>Protected by secure, cookie-based authentication.</footer>
        </div>
      </section>
    </main>
  )
}
