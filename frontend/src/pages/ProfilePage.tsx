import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Avatar, EntityForm, ErrorBanner, PageHeader, Panel, type FormFieldSpec } from '../components/ui'
import { api, ApiError, unwrap } from '../lib/api'
import { BROWSER_EXTENSION_NAME } from '../lib/brand'
import type { ApiEnvelope, FormPayload } from '../types/api'

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
    if (!window.confirm(`Revoke “${device.name}”? The extension will need to pair again.`)) return
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
    <div>
      <PageHeader eyebrow="Your account" title="Profile" description="Keep your personal details and connected devices current." />
      {error && <ErrorBanner message={error} />}
      {saved && <div className="success-banner">{saved}</div>}
      <div className="profile-layout">
        <Panel className="profile-card">
          <Avatar user={user} size={82} />
          <h2>{user?.name || `${user?.firstName ?? user?.first_name ?? ''} ${user?.lastName ?? user?.last_name ?? ''}`.trim()}</h2>
          <p>@{user?.username}</p>
          <span className="status-badge"><span />{user?.status ?? 'Active'}</span>
        </Panel>
        <div className="profile-main">
          <Panel className="profile-form" title="Personal details">
            <EntityForm fields={fields} initialValues={initial} busy={busy} submitLabel="Update profile" onSubmit={save} />
          </Panel>
          <Panel className="profile-form extension-devices" title="Browser extension">
            <div className="extension-device-body">
              <div className="extension-device-intro">
                <div>
                  <strong>{BROWSER_EXTENSION_NAME}</strong>
                  <p>Generate a short-lived code, then enter it with this workspace URL in the Chrome or Edge extension.</p>
                </div>
                <button className="btn btn-primary" disabled={extensionBusy} onClick={() => void generatePairingCode()}>
                  {extensionBusy ? 'Generating…' : 'Generate pairing code'}
                </button>
              </div>
              {extensionError && <ErrorBanner message={extensionError} />}
              {extensionSaved && <div className="success-banner">{extensionSaved}</div>}
              {pairing && (
                <div className="pairing-code-card">
                  <div>
                    <small>Workspace URL</small>
                    <code>{window.location.origin}</code>
                  </div>
                  <div>
                    <small>One-time code</small>
                    <button className="pairing-code" title="Copy pairing code" onClick={() => void copyPairingCode()}>{pairing.code}</button>
                  </div>
                  <p>Expires {new Date(pairing.expires_at).toLocaleString()} and can be used once.</p>
                </div>
              )}
              <div className="device-list-heading">
                <strong>Paired devices</strong>
                <button className="btn btn-quiet" disabled={devicesLoading} onClick={() => void loadDevices()}>Refresh</button>
              </div>
              {devicesLoading ? <div className="device-empty">Loading paired devices…</div> : devices.length === 0 ? (
                <div className="device-empty">No browser extensions are paired with this account.</div>
              ) : (
                <div className="extension-device-list">
                  {devices.map((device) => (
                    <div key={device.id} className="extension-device-row">
                      <div>
                        <strong>{device.name}</strong>
                        <span>
                          Last used {device.last_used_at ? new Date(device.last_used_at).toLocaleString() : 'never'} · Expires {new Date(device.expires_at).toLocaleDateString()}
                        </span>
                      </div>
                      <button className="btn btn-danger-quiet" disabled={extensionBusy} onClick={() => void revokeDevice(device)}>Revoke</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
