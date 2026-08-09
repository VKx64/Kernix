import { useState, type FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { BRAND_MARK } from '@/lib/brand'

/**
 * The one step between registering and having somewhere to work.
 *
 * A workspace is the container for every client, project and task, so it is
 * named deliberately rather than conjured from the account holder's name. There
 * is no way past this screen and no navigation on it: until the workspace
 * exists there is nothing to navigate to, and the account belongs to nothing.
 *
 * Creating it seeds the roles and the status and urgency vocabularies, so the
 * app on the other side is usable rather than empty of even a task status.
 */
export function WorkspaceOnboardingPage() {
  const { user, refresh, logout } = useAuth()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const firstName = (user?.firstName ?? user?.first_name ?? user?.name ?? '').split(' ')[0]

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError('')
    try {
      await api.post('/api/workspaces', { name: trimmed })
      // Refreshing is what clears `needs_workspace` and lets the shell render.
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create your workspace.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 p-6">
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-lg font-semibold text-primary-foreground">
        {BRAND_MARK}
      </span>

      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {firstName ? `One more thing, ${firstName}` : 'One more thing'}
          </h1>
          <p className="text-sm text-muted-foreground text-pretty">
            Name your workspace. It holds your clients, projects and everything your
            team tracks against them.
          </p>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="workspace">Workspace name</Label>
            <Input
              id="workspace"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              minLength={2}
              maxLength={191}
              placeholder="Northwind Creative"
            />
            <p className="text-xs text-muted-foreground">Usually your studio or company name. You can rename it later.</p>
          </div>

          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

          <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
            {busy ? 'Setting it up…' : 'Create workspace'}
            <ArrowRight />
          </Button>
        </form>

        {/* The only way out. Without a workspace there is no app to return to,
            so signing out is the alternative to finishing. */}
        <p className="text-center text-xs text-muted-foreground">
          Signed in as {user?.email || user?.username}.{' '}
          <button type="button" onClick={() => void logout()} className="underline underline-offset-4 hover:text-foreground">
            Sign out
          </button>
        </p>
      </div>
    </main>
  )
}
