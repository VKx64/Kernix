import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CheckCircle2, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorBanner } from '@/components/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { api, unwrap } from '@/lib/api'
import type { ApiEnvelope } from '@/types/api'

interface McpAccess {
  endpoint: string | null
  local_endpoint: string
  workspace: { id: number; name: string } | null
}

/**
 * The screen an assistant's sign-in lands on.
 *
 * Some clients — ChatGPT's connectors among them — have nowhere to paste a
 * Kernix token, and offer sign-in instead. The MCP server runs that flow, but
 * deliberately does not run this part of it: it has no idea who is at the
 * keyboard, and should not. The browser arrives here already signed in to
 * Kernix, the person sees what they are about to allow in their own workspace,
 * and approving mints the token and sends it back through a one-time handoff.
 *
 * The connector cannot name where the approval is returned to. `return` is
 * checked against this installation's own MCP endpoint before anything is
 * minted, so a link crafted by somebody else cannot walk away with a token.
 */
export function AssistantAuthorizePage() {
  const [params] = useSearchParams()
  const { user } = useAuth()
  const [access, setAccess] = useState<McpAccess | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const request = params.get('request') ?? ''
  const returnTo = params.get('return') ?? ''
  const client = (params.get('client') ?? 'An AI assistant').slice(0, 60)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const loaded = unwrap(await api.get<ApiEnvelope<McpAccess> | McpAccess>('/api/mcp/access'))
        if (live) setAccess(loaded)
      } catch (reason) {
        if (live) setError(reason instanceof Error ? reason.message : 'Unable to check this request.')
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  // Approving is only safe once the destination is known to be this
  // installation's own assistant server. Until then there is nothing to weigh
  // up, so the screen says so rather than offering a button.
  const trusted = useMemo(() => {
    if (!request || !returnTo || !access) return false
    const configured = access.endpoint ?? access.local_endpoint
    try {
      return new URL(returnTo).origin === new URL(configured).origin
    } catch {
      return false
    }
  }, [request, returnTo, access])

  const signedInAs =
    user?.name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'your account'

  const approve = async () => {
    setBusy(true)
    setError('')
    try {
      const { handoff } = unwrap(
        await api.post<ApiEnvelope<{ handoff: string }>>('/api/mcp/authorize', { client }),
      )
      const back = new URL(returnTo)
      back.searchParams.set('request', request)
      back.searchParams.set('handoff', handoff)
      setDone(true)
      // A full navigation, not a route change: the rest of this belongs to the
      // assistant server and its client, not to the app.
      window.location.replace(back.toString())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to approve this connection.')
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <section className="mx-auto w-full max-w-lg py-12">
        <Skeleton className="h-64 w-full" />
      </section>
    )
  }

  return (
    <section className="mx-auto w-full max-w-lg py-12">
      <Card>
        <CardHeader className="space-y-2">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <CardTitle className="text-balance">{client} wants to connect to Kernix</CardTitle>
          <CardDescription className="text-pretty">
            {trusted
              ? `It will act as you in ${access?.workspace?.name ?? 'this workspace'} — the same role, the same permissions, nothing more.`
              : 'This request did not come from this workspace’s assistant server, so it cannot be approved here.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <ErrorBanner message={error} />}

          {trusted ? (
            <>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
                  <span>
                    Signed in as <span className="font-medium text-t2">{signedInAs}</span>. It sees what you see.
                  </span>
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
                  <span>Every change it makes is recorded against your name, as if you made it.</span>
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
                  <span>
                    You can cut it off at any time under Settings → Workspace → AI assistant access.
                  </span>
                </li>
              </ul>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void approve()} disabled={busy || done}>
                  {busy || done ? 'Connecting…' : `Allow ${client}`}
                </Button>
                <Button variant="outline" asChild disabled={busy}>
                  <a href="/settings/workspace">Cancel</a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-pretty">
                Only approve this if you started it yourself, from {client}.
              </p>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-pretty">
                Approvals are only accepted for{' '}
                <code className="font-mono text-xs">{access?.endpoint ?? access?.local_endpoint}</code>. Open the
                connector again and start the connection from there.
              </p>
              <Button variant="outline" asChild>
                <a href="/settings/workspace">Back to settings</a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
