import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWorkspace } from '@/auth/WorkspaceProvider'
import { AiFeatureSettings } from '@/components/AiFeatureSettings'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EntityForm, type FormFieldSpec } from '@/components/entity-form'
import { ErrorBanner, PageHeader, Panel } from '@/components/shared'
import { api, ApiError, normalizePage, unwrap } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import type { ApiEnvelope, AppSettings, Client, FormPayload, Paginated } from '@/types/api'
import { SettingsNav } from './EntityPages'

type SettingsSection = 'system' | 'smtp' | 'storage' | 'ai'

const SECTION_LABELS: Record<SettingsSection, string> = {
  system: 'System',
  smtp: 'Outgoing email',
  storage: 'Storage',
  ai: 'AI project manager',
}

const SECTION_TITLES: Record<SettingsSection, string> = {
  system: 'System preferences',
  smtp: 'Outgoing email',
  storage: 'File storage',
  ai: 'AI project manager',
}

// Starting points only — the field stays free text so any OpenRouter model ID works.
// Prices are OpenRouter's per-million input/output rates at the time of writing.
const SUGGESTED_MODELS = [
  { value: 'anthropic/claude-opus-5', label: 'Claude Opus 5 — deepest reasoning, $5 / $25 per 1M' },
  { value: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5 — balanced default, $3 / $15 per 1M' },
  { value: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5 — fastest and cheapest, $1 / $5 per 1M' },
]

function cleanPayload(payload: FormPayload) {
  return Object.fromEntries(Object.entries(payload).filter(([key, item]) => !(key.includes('password') || key.includes('secret') || key.includes('access_key') || key.includes('api_key')) || item !== ''))
}

function aiFeatureLabel(feature: string) {
  return feature.split('_').map((word) => word[0]?.toUpperCase() + word.slice(1)).join(' ')
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
  const [testingAi, setTestingAi] = useState(false)

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
      { name: 'system_logo', label: 'System logo URL', type: 'url' },
      { name: 'sidebar_logo', label: 'Sidebar logo URL', type: 'url' },
      { name: 'favicon', label: 'Favicon URL', type: 'url' },
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
    ai: [
      { name: 'openrouter_api_key', label: 'OpenRouter API key', type: 'password', wide: true, help: settings?.has_openrouter_api_key ? 'A key is saved. Leave blank to keep it.' : 'Stored encrypted and never returned to the browser.' },
      { name: 'openrouter_model', label: 'OpenRouter model ID', required: true, wide: true, placeholder: 'provider/model-name', suggestions: SUGGESTED_MODELS, help: 'Pick a suggested model or type any OpenRouter model ID. Nothing is selected automatically.' },
      { name: 'ai_monthly_budget_usd', label: 'Monthly budget (USD)', type: 'number', min: 0.01, step: 0.01 },
      { name: 'ai_max_output_tokens', label: 'Maximum response tokens', type: 'number', min: 100 },
      { name: 'ai_request_timeout_seconds', label: 'Request timeout (seconds)', type: 'number', min: 10 },
      { name: 'ai_inactivity_hours', label: 'Challenge response window (hours)', type: 'number', min: 1, help: 'Unanswered AI challenges are rejected after this period.' },
    ],
  }), [clients, settings?.has_openrouter_api_key])

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
  const testAi = async () => {
    setTestingAi(true); setError(''); setSaved('')
    try {
      await api.post('/api/settings/ai/test')
      setSaved('OpenRouter connection succeeded.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'OpenRouter connection failed.') }
    finally { setTestingAi(false) }
  }
  const aiExtra = section === 'ai' && settings ? (
    <div className="space-y-3 rounded-lg border p-4 text-sm">
      <p><strong>This month:</strong> ${Number(settings.ai_current_month_cost_usd ?? 0).toFixed(4)} of ${Number(settings.ai_monthly_budget_usd ?? 0).toFixed(2)}</p>
      {(settings.ai_current_month_usage_by_feature?.length ?? 0) > 0 && (
        <div className="space-y-1" aria-label="AI usage by feature">
          {settings.ai_current_month_usage_by_feature?.map((usage) => (
            <p className="flex items-center justify-between" key={usage.feature}><span>{aiFeatureLabel(usage.feature)}</span><strong>${Number(usage.cost_usd).toFixed(4)} · {usage.calls} call{usage.calls === 1 ? '' : 's'}</strong></p>
          ))}
        </div>
      )}
      <p className="text-muted-foreground">Task data is sent with zero-data-retention routing. A feature also has to be enabled on the project that uses it.</p>
      {canEdit && <Button type="button" variant="outline" size="sm" disabled={testingAi || !settings.ai_configured} onClick={() => void testAi()}>{testingAi ? 'Testing…' : 'Test saved connection'}</Button>}
    </div>
  ) : undefined

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Settings" title="System" description="System behavior, integrations, outgoing email, and file storage." />
      <SettingsNav />
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {saved && <p className="text-sm text-success" role="status">{saved}</p>}
      <Tabs value={section} onValueChange={(next) => { setSection(next as SettingsSection); setError(''); setSaved('') }}>
        <TabsList>
          {(['system', 'smtp', 'storage', 'ai'] as SettingsSection[]).map((item) => (
            <TabsTrigger value={item} key={item}>{SECTION_LABELS[item]}</TabsTrigger>
          ))}
        </TabsList>
        {(['system', 'smtp', 'storage', 'ai'] as SettingsSection[]).map((item) => (
          <TabsContent value={item} key={item}>
            <Panel title={SECTION_TITLES[item]}>
              {loading ? (
                <div className="space-y-2" role="status" aria-label="Loading settings">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-2/3" />
                </div>
              ) : settings ? (
                <>
                  <EntityForm
                    key={item}
                    fields={specs[item].map((field) => ({ ...field, disabled: !canEdit }))}
                    initialValues={initial}
                    busy={busy}
                    submitDisabled={!canEdit}
                    submitLabel="Save changes"
                    onSubmit={save}
                    extra={!canEdit ? <p className="text-sm text-muted-foreground">Your role can view these settings but cannot change them.</p> : item === 'ai' ? aiExtra : undefined}
                  />
                  {item === 'ai' && (settings.ai_features?.length ?? 0) > 0 && <AiFeatureSettings features={settings.ai_features ?? []} canEdit={canEdit} busy={busy} onSave={save} />}
                </>
              ) : null}
            </Panel>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
