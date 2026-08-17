import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner, Panel } from '@/components/shared'
import { api, unwrap } from '@/lib/api'
import type { ApiEnvelope } from '@/types/api'

interface McpConnection {
  id: number
  name: string
  created_at: string | null
  last_used_at: string | null
  expires_at: string | null
}

interface McpAccess {
  endpoint: string | null
  local_endpoint: string
  workspace: { id: number; name: string } | null
  tokens: McpConnection[]
}

const CLIENTS = [
  { key: 'claude-desktop', label: 'Claude Desktop' },
  { key: 'claude-code', label: 'Claude Code' },
  { key: 'chatgpt', label: 'ChatGPT' },
] as const

type ClientKey = (typeof CLIENTS)[number]['key']

/**
 * Connect an AI assistant to this workspace.
 *
 * The token is what carries the workspace: one MCP deployment serves every
 * workspace, and the connection lands wherever its token's account belongs. So
 * this screen is per-person rather than per-workspace in what it creates — an
 * assistant gets exactly the reach of whoever set it up, and nothing more.
 */
export function McpAccessPanel() {
  const [access, setAccess] = useState<McpAccess | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  // Held in state, never re-fetched: the server hashes the token and cannot
  // show it again, so losing it here means minting a new one.
  const [freshToken, setFreshToken] = useState('')
  const [client, setClient] = useState<ClientKey>('claude-desktop')
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setAccess(unwrap(await api.get<ApiEnvelope<McpAccess> | McpAccess>('/api/mcp/access')))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load assistant access.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      const created = unwrap(
        await api.post<ApiEnvelope<{ token: string; connection: McpConnection }>>('/api/mcp/access', {
          name: name.trim(),
        }),
      )
      setFreshToken(created.token)
      setName('')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create the connection.')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (connection: McpConnection) => {
    setBusy(true)
    setError('')
    try {
      await api.delete(`/api/mcp/access/${connection.id}`)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to revoke the connection.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (what: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(what)
      window.setTimeout(() => setCopied(''), 2000)
    } catch {
      // Clipboard access can be refused; the text stays selectable either way.
    }
  }

  const endpoint = access?.endpoint ?? access?.local_endpoint ?? ''
  // Until a token has been minted the snippet still has to read as real, so a
  // placeholder stands in rather than an empty string.
  const token = freshToken || 'YOUR-TOKEN-HERE'

  return (
    <Panel title="AI assistant access" contentClassName="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect Claude or ChatGPT to {access?.workspace?.name ?? 'this workspace'} so it can read the
        portfolio and manage work on your behalf. A connection acts as <strong>you</strong> — it
        inherits your role and permissions, and reaches nothing you cannot reach yourself.
      </p>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <Label>Endpoint</Label>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-64 overflow-x-auto rounded-md border border-line bg-muted/40 px-3 py-2 font-mono text-xs">
                {endpoint}
              </code>
              <Button size="sm" variant="outline" onClick={() => void copy('endpoint', endpoint)}>
                {copied === 'endpoint' ? 'Copied' : 'Copy'}
              </Button>
            </div>
            {!access?.endpoint && (
              <p className="text-xs text-muted-foreground">
                No hosted endpoint is configured, so this is the local address. Set{' '}
                <code className="font-mono">MCP_PUBLIC_URL</code> on the server to publish one.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="mcp-connection-name">Create a connection</Label>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                id="mcp-connection-name"
                className="flex-1 min-w-48"
                placeholder="Claude on my laptop"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
              />
              <Button onClick={() => void create()} disabled={busy || !name.trim()}>
                {busy ? 'Working…' : 'Create'}
              </Button>
            </div>
          </div>

          {freshToken && (
            <div className="space-y-2 rounded-lg border border-line bg-muted/40 p-3">
              <p className="text-sm font-medium">Copy this token now</p>
              <p className="text-xs text-muted-foreground">
                It is shown once and cannot be recovered. Treat it like a password — anyone holding
                it can act as you in Kernix.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 min-w-64 overflow-x-auto rounded-md border border-line bg-background px-3 py-2 font-mono text-xs">
                  {freshToken}
                </code>
                <Button size="sm" variant="outline" onClick={() => void copy('token', freshToken)}>
                  {copied === 'token' ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Setup</Label>
            <div className="flex flex-wrap gap-1">
              {CLIENTS.map((option) => (
                <Button
                  key={option.key}
                  size="sm"
                  variant={client === option.key ? 'default' : 'outline'}
                  onClick={() => setClient(option.key)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <pre className="flex-1 min-w-64 overflow-x-auto rounded-md border border-line bg-muted/40 p-3 font-mono text-xs whitespace-pre">
                {snippetFor(client, endpoint, token)}
              </pre>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void copy('snippet', snippetFor(client, endpoint, token))}
              >
                {copied === 'snippet' ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="space-y-2 rounded-lg border border-line bg-muted/20 p-3">
              <p className="text-sm text-muted-foreground">{STEPS[client].intro}</p>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground marker:text-t4">
                {STEPS[client].steps.map((step) => (
                  <li key={step} className="text-pretty leading-[1.5]">{step}</li>
                ))}
              </ol>
              {STEPS[client].note && (
                <p className="text-xs text-warn text-pretty">{STEPS[client].note}</p>
              )}
              <p className="text-xs text-muted-foreground text-pretty">
                Once connected, try <span className="font-medium text-t2">“what is late right now, and who is it sitting with?”</span> —
                it reads your work under your own permissions, and can only change what you could change yourself.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Active connections</Label>
            <ul className="divide-y">
              {access?.tokens.map((connection) => (
                <li key={connection.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{connection.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {connection.last_used_at
                        ? `Last used ${new Date(connection.last_used_at).toLocaleDateString()}`
                        : 'Never used'}
                      {connection.expires_at
                        ? ` · Expires ${new Date(connection.expires_at).toLocaleDateString()}`
                        : ' · No expiry'}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void revoke(connection)}>
                    Revoke
                  </Button>
                </li>
              ))}
              {!access?.tokens.length && (
                <li className="py-2 text-sm text-muted-foreground">No connections yet.</li>
              )}
            </ul>
          </div>
        </>
      )}
    </Panel>
  )
}

/**
 * What to actually do with the block above, per client.
 *
 * Menu names in these apps move around between releases, so each step says
 * what is being looked for as well as where it currently lives — a wording
 * that survives the next redesign is worth more than one that matches today's
 * label exactly.
 */
const STEPS: Record<ClientKey, { intro: string; steps: string[]; note?: string }> = {
  'claude-desktop': {
    intro: 'Claude Desktop reads its connectors from a config file.',
    steps: [
      'Open Settings → Developer → Edit Config. That opens claude_desktop_config.json.',
      'Paste the block above. If the file already has an "mcpServers" section, add the "kernix" entry inside it rather than replacing it.',
      'Save the file and fully quit Claude Desktop — closing the window is not enough.',
      'Reopen it. Kernix appears in the tools menu under the message box.',
    ],
  },
  'claude-code': {
    intro: 'One command, run from anywhere.',
    steps: [
      'Paste the command above into your terminal.',
      'Check it took with: claude mcp list',
      'Start a session and ask "what is late?" — Claude will ask permission to use the Kernix tools the first time.',
    ],
  },
  chatgpt: {
    intro:
      'ChatGPT reaches this server over the internet rather than running it on your machine, so it needs the address and token separately rather than a config file.',
    steps: [
      'Open ChatGPT → Settings → Connectors. This needs a paid plan; connectors are not on the free tier.',
      'Under Advanced settings, turn on Developer mode. Custom MCP connectors are hidden until you do.',
      'Back on Connectors, choose Create (or Add custom connector).',
      'Name it Kernix, and paste the URL from the block above as the MCP Server URL.',
      'For authentication pick the access-token option and paste the token on its own. If it asks for a header instead, the name is Authorization and the value is Bearer followed by a space and the token.',
      'Save, then approve the connector when ChatGPT asks whether you trust it.',
      'In a new chat, open the + menu and switch Kernix on for that conversation.',
    ],
    note:
      'ChatGPT will only connect over HTTPS to a public address. If the endpoint above starts with http:// or points at localhost, it will not work until this server is published.',
  },
}

function snippetFor(client: ClientKey, endpoint: string, token: string): string {
  if (client === 'claude-code') {
    return `claude mcp add --transport http kernix ${endpoint} \\\n  --header "Authorization: Bearer ${token}"`
  }
  if (client === 'chatgpt') {
    // ChatGPT has no config file to paste into — these are the three values its
    // form asks for, laid out so they can be copied one line at a time.
    return [
      `MCP Server URL:  ${endpoint}`,
      `Authentication:  Access token / API key`,
      `Token:           ${token}`,
      ``,
      `If it asks for a header instead:`,
      `  Authorization: Bearer ${token}`,
    ].join('\n')
  }
  return JSON.stringify(
    {
      mcpServers: {
        kernix: {
          type: 'http',
          url: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  )
}
