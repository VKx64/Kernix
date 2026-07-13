import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWorkspace } from '../auth/WorkspaceProvider'
import { EntityForm, ErrorBanner, PageHeader, Panel, type FormFieldSpec } from '../components/ui'
import { api, ApiError, normalizePage, unwrap } from '../lib/api'
import { useCan } from '../lib/permissions'
import type { ApiEnvelope, AppSettings, Client, FormPayload, Paginated } from '../types/api'
import { SettingsNav } from './EntityPages'

type SettingsSection = 'system' | 'smtp' | 'storage'

function cleanPayload(payload: FormPayload) {
  return Object.fromEntries(Object.entries(payload).filter(([key, item]) => !(key.includes('password') || key.includes('secret') || key.includes('access_key')) || item !== ''))
}

export function SettingsPage() {
  const can = useCan()
  const { refresh: refreshWorkspace } = useWorkspace()
  const [section, setSection] = useState<SettingsSection>('system')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('')
    try {
      const [settingsResult, clientsResult] = await Promise.allSettled([
        api.get<ApiEnvelope<AppSettings> | AppSettings>('/api/settings', undefined, signal),
        can('clients.view') ? api.get<Paginated<Client> | ApiEnvelope<Paginated<Client>> | Client[]>('/api/clients', { per_page: 100 }, signal) : Promise.resolve(null),
      ])
      if (settingsResult.status === 'rejected') throw settingsResult.reason
      const nextSettings = unwrap(settingsResult.value)
      setSettings(nextSettings)
      const contextClients = (nextSettings.clientOptions ?? nextSettings.client_options ?? []) as Client[]
      if (contextClients.length) setClients(contextClients)
      else if (clientsResult.status === 'fulfilled' && clientsResult.value) setClients(normalizePage(clientsResult.value).data)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(reason instanceof Error ? reason.message : 'Unable to load settings.')
    } finally { if (!signal?.aborted) setLoading(false) }
  }, [can])
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])

  const specs = useMemo<Record<SettingsSection, FormFieldSpec[]>>(() => ({
    system: [
      { name: 'default_timezone', label: 'Default timezone', required: true, placeholder: 'Asia/Manila' },
      { name: 'single_client_mode', label: 'Use single-client mode', type: 'checkbox', help: 'Hides the client switcher and client directory.' },
      { name: 'single_client_id', label: 'Single client', type: 'select', options: clients.map((client) => ({ label: client.name, value: client.id })) },
      { name: 'system_logo', label: 'System logo URL', type: 'url', wide: true },
      { name: 'sidebar_logo', label: 'Sidebar logo URL', type: 'url', wide: true },
      { name: 'favicon', label: 'Favicon URL', type: 'url', wide: true },
    ],
    smtp: [
      { name: 'smtp_host', label: 'SMTP host', placeholder: 'smtp.example.com' },
      { name: 'smtp_port', label: 'Port', type: 'number', min: 1 },
      { name: 'smtp_encryption', label: 'Encryption', type: 'select', options: [{ label: 'TLS', value: 'tls' }, { label: 'SSL', value: 'ssl' }, { label: 'None', value: 'none' }] },
      { name: 'smtp_username', label: 'Username' },
      { name: 'smtp_password', label: 'Password', type: 'password', help: 'Leave blank to keep the saved password.' },
      { name: 'smtp_from_email', label: 'From email', type: 'email' },
      { name: 'smtp_from_name', label: 'From name' },
    ],
    storage: [
      { name: 'storage_driver', label: 'Storage driver', type: 'select', options: [{ label: 'Local disk', value: 'local' }], help: 'S3 is unavailable until the server storage adapter is installed.' },
      { name: 'local_upload_path', label: 'Local upload path' },
      { name: 'local_public_url', label: 'Local public URL', type: 'url', wide: true },
    ],
  }), [clients])

  const keys = specs[section].map((field) => field.name)
  const initial = Object.fromEntries(keys.map((key) => [key, settings?.[key] as string | number | boolean | null | undefined])) as FormPayload
  const save = async (payload: FormPayload) => {
    setBusy(true); setError(''); setSaved('')
    try {
      let response: ApiEnvelope<AppSettings> | AppSettings
      try {
        response = await api.patch<ApiEnvelope<AppSettings> | AppSettings>(`/api/settings/${section}`, cleanPayload(payload))
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 404) throw reason
        response = await api.patch<ApiEnvelope<AppSettings> | AppSettings>('/api/settings', cleanPayload(payload))
      }
      setSettings((old) => ({ ...old, ...unwrap(response) }))
      setSaved('Changes saved.')
      await refreshWorkspace()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save settings.') }
    finally { setBusy(false) }
  }

  const canEdit = can('settings.edit')
  return <div><PageHeader eyebrow="Administration" title="Settings" description="System behavior, outgoing email, and file storage." /><SettingsNav />{error && <ErrorBanner message={error} onRetry={() => void load()} />}{saved && <div className="success-banner">{saved}</div>}<div className="settings-layout"><aside className="settings-sections">{(['system', 'smtp', 'storage'] as SettingsSection[]).map((item) => <button className={section === item ? 'active' : ''} onClick={() => { setSection(item); setError(''); setSaved('') }} key={item}>{item === 'smtp' ? 'Outgoing email' : item[0].toUpperCase() + item.slice(1)}</button>)}</aside><Panel className="settings-form-panel" title={section === 'system' ? 'System preferences' : section === 'smtp' ? 'Outgoing email' : 'File storage'}>{loading ? <div className="panel-loading"><span className="spinner" /> Loading settings…</div> : settings ? <EntityForm key={section} fields={specs[section].map((field) => ({ ...field, disabled: !canEdit }))} initialValues={initial} busy={busy} submitDisabled={!canEdit} submitLabel="Save changes" onSubmit={save} extra={!canEdit ? <p className="read-only-note">Your role can view these settings but cannot change them.</p> : undefined} /> : null}</Panel></div></div>
}
