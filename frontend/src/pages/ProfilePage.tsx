import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { EntityForm, type FormFieldSpec } from '@/components/entity-form'
import { Avatar, ErrorBanner, PageHeader, Panel } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { api, ApiError, unwrap } from '@/lib/api'
import { BROWSER_EXTENSION_NAME } from '@/lib/brand'
import type { ApiEnvelope, FormPayload } from '@/types/api'

interface ExtensionDevice {
  id: number
  name: string
  created_at: string
  last_used_at?: string | null
  expires_at: string
}

interface PairingCode {
  code: string
  expires_at: string
}

export function ProfilePage() {
  const { user, refresh } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [devices, setDevices] = useState<ExtensionDevice[]>([])
  const [devicesLoading, setDevicesLoading] = useState(true)
  const [extensionBusy, setExtensionBusy] = useState(false)
  const [extensionError, setExtensionError] = useState('')
  const [extensionSaved, setExtensionSaved] = useState('')
  const [pairing, setPairing] = useState<PairingCode | null>(null)
  const [pendingRevoke, setPendingRevoke] = useState<ExtensionDevice | null>(null)

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true)
    try {
      const response = await api.get<ApiEnvelope<ExtensionDevice[]> | ExtensionDevice[]>('/api/extension/devices')
      setDevices(unwrap(response))
    } catch (reason) {
      setExtensionError(reason instanceof Error ? reason.message : 'Unable to load paired devices.')
    } finally {
      setDevicesLoading(false)
    }
  }, [])

  useEffect(() => { void loadDevices() }, [loadDevices])

  const fields: FormFieldSpec[] = [
    { name: 'first_name', label: 'First name', required: true },
    { name: 'last_name', label: 'Last name' },
    { name: 'personal_email', label: 'Personal email', type: 'email' },
    { name: 'phone_1', label: 'Phone', type: 'tel' },
    { name: 'timezone', label: 'Timezone', placeholder: 'Asia/Manila' },
    { name: 'current_password', label: 'Current password', type: 'password', help: 'Required only when changing your password.' },
    { name: 'password', label: 'New password', type: 'password' },
    { name: 'password_confirmation', label: 'Confirm new password', type: 'password' },
  ]
  const initial: FormPayload = {
    first_name: user?.firstName ?? user?.first_name ?? '',
    last_name: user?.lastName ?? user?.last_name ?? '',
    personal_email: user?.personalEmail ?? user?.personal_email ?? user?.email ?? '',
    phone_1: user?.phone1 ?? user?.phone_1 ?? '',
    timezone: user?.timezone ?? '',
    current_password: '',
    password: '',
    password_confirmation: '',
  }

  const save = async (payload: FormPayload) => {
    setBusy(true)
    setError('')
    setSaved('')
    const clean = Object.fromEntries(Object.entries(payload).filter(([key, item]) => (
      !['current_password', 'password', 'password_confirmation'].includes(key) || item !== ''
    )))
    try {
      try {
        await api.patch('/api/profile', clean)
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 404) throw reason
        await api.patch('/api/user', clean)
      }
      await refresh()
      setSaved('Profile updated.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update your profile.')
    } finally {
      setBusy(false)
    }
  }

  const generatePairingCode = async () => {
    setExtensionBusy(true)
    setExtensionError('')
    setExtensionSaved('')
    try {
      const response = await api.post<ApiEnvelope<PairingCode> | PairingCode>('/api/extension/pairings')
      setPairing(unwrap(response))
    } catch (reason) {
      setExtensionError(reason instanceof Error ? reason.message : 'Unable to generate a pairing code.')
    } finally {
      setExtensionBusy(false)
    }
  }

  const copyPairingCode = async () => {
    if (!pairing) return
    try {
      await navigator.clipboard.writeText(pairing.code)
      setExtensionSaved('Pairing code copied.')
    } catch {
      setExtensionError('Copy failed. Select the code and copy it manually.')
    }
  }

  const revokeDevice = async (device: ExtensionDevice) => {
    setExtensionBusy(true)
    setExtensionError('')
    setExtensionSaved('')
    try {
      await api.delete(`/api/extension/devices/${device.id}`)
      setDevices((current) => current.filter((item) => item.id !== device.id))
      setExtensionSaved('Extension access revoked.')
    } catch (reason) {
      setExtensionError(reason instanceof Error ? reason.message : 'Unable to revoke this device.')
    } finally {
      setExtensionBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Your account"
        title="Profile"
        description="Keep your personal details and connected devices current."
      />

      {error && <ErrorBanner message={error} />}
      {saved && (
        <Alert role="status">
          <AlertDescription>{saved}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardContent className="flex flex-col items-center gap-2 text-center">
            <Avatar user={user} className="size-20" />
            <h2 className="text-lg font-semibold tracking-tight">
              {user?.name || `${user?.firstName ?? user?.first_name ?? ''} ${user?.lastName ?? user?.last_name ?? ''}`.trim()}
            </h2>
            <p className="text-sm text-muted-foreground">@{user?.username}</p>
            <Badge variant="outline" className="rounded-full font-normal capitalize">
              {user?.status ?? 'Active'}
            </Badge>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Panel title="Personal details">
            <EntityForm
              fields={fields}
              initialValues={initial}
              busy={busy}
              submitLabel="Update profile"
              onSubmit={save}
            />
          </Panel>

          <Panel title="Browser extension" contentClassName="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-0.5">
                <p className="font-medium">{BROWSER_EXTENSION_NAME}</p>
                <p className="text-sm text-muted-foreground text-pretty">
                  Generate a short-lived code, then enter it with this workspace URL in the Chrome or Edge extension.
                </p>
              </div>
              <Button disabled={extensionBusy} onClick={() => void generatePairingCode()}>
                {extensionBusy ? 'Generating…' : 'Generate pairing code'}
              </Button>
            </div>

            {extensionError && <ErrorBanner message={extensionError} />}
            {extensionSaved && (
              <Alert role="status">
                <AlertDescription>{extensionSaved}</AlertDescription>
              </Alert>
            )}

            {pairing && (
              <div className="space-y-3 rounded-lg border p-4">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">Workspace URL</p>
                  <code className="font-mono text-sm">{window.location.origin}</code>
                </div>
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">One-time code</p>
                  <Button
                    variant="outline"
                    className="font-mono text-lg tracking-[0.3em]"
                    title="Copy pairing code"
                    onClick={() => void copyPairingCode()}
                  >
                    {pairing.code}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Expires {new Date(pairing.expires_at).toLocaleString()} and can be used once.
                </p>
              </div>
            )}

            <Separator />

            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">Paired devices</p>
              <Button variant="outline" size="sm" disabled={devicesLoading} onClick={() => void loadDevices()}>
                Refresh
              </Button>
            </div>

            {devicesLoading ? (
              <div className="space-y-2" role="status">
                <p className="sr-only">Loading paired devices…</p>
                {Array.from({ length: 2 }, (_, row) => <Skeleton className="h-14" key={row} />)}
              </div>
            ) : devices.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No browser extensions are paired with this account.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {devices.map((device) => (
                  <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate font-medium">{device.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Last used {device.last_used_at ? new Date(device.last_used_at).toLocaleString() : 'never'} · Expires {new Date(device.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={extensionBusy}
                      onClick={() => setPendingRevoke(device)}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <AlertDialog open={Boolean(pendingRevoke)} onOpenChange={(open) => { if (!open) setPendingRevoke(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{pendingRevoke?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The extension will need to pair again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const device = pendingRevoke
                setPendingRevoke(null)
                if (device) void revokeDevice(device)
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
