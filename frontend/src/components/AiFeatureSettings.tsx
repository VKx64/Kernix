import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { AiFeatureSetting, FormPayload } from '@/types/api'

interface Draft {
  enabled: boolean
  prompt: string
}

function toDrafts(features: AiFeatureSetting[]): Record<string, Draft> {
  return Object.fromEntries(features.map((feature) => [feature.key, { enabled: feature.enabled, prompt: feature.prompt }]))
}

export function AiFeatureSettings({
  features,
  canEdit,
  busy,
  onSave,
}: {
  features: AiFeatureSetting[]
  canEdit: boolean
  busy: boolean
  onSave: (payload: FormPayload) => void | Promise<void>
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => toDrafts(features))
  const [expanded, setExpanded] = useState<string | null>(null)

  // Saving returns the stored values; adopt them so "changed" resets honestly.
  useEffect(() => { setDrafts(toDrafts(features)) }, [features])

  const changed = features.some((feature) => {
    const draft = drafts[feature.key]
    return draft && (draft.enabled !== feature.enabled || draft.prompt !== feature.prompt)
  })

  const update = (key: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }))
  }

  const save = () => {
    const payload: FormPayload = {}
    features.forEach((feature) => {
      const draft = drafts[feature.key]
      if (!draft) return
      payload[feature.enabled_field] = draft.enabled
      payload[feature.prompt_field] = draft.prompt
    })
    void onSave(payload)
  }

  return (
    <section className="space-y-4 border-t pt-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">AI features</h3>
          <p className="text-sm text-muted-foreground">Switch each capability on or off, and replace its system prompt. An empty prompt uses the built-in one.</p>
        </div>
        {canEdit && (
          <Button type="button" disabled={busy || !changed} onClick={save}>
            {busy ? 'Saving…' : 'Save AI features'}
          </Button>
        )}
      </header>

      <ul className="space-y-3">
        {features.map((feature) => {
          const draft = drafts[feature.key] ?? { enabled: feature.enabled, prompt: feature.prompt }
          const open = expanded === feature.key
          const custom = draft.prompt.trim() !== ''

          return (
            <li className={`rounded-lg border p-4 ${draft.enabled ? '' : 'opacity-70'}`} key={feature.key}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={draft.enabled}
                    disabled={!canEdit || busy}
                    aria-label={`Enable ${feature.label}`}
                    onCheckedChange={(checked) => update(feature.key, { enabled: checked })}
                  />
                  <div>
                    <p className="font-medium">{feature.label}</p>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : feature.key)}
                >
                  <Pencil /> {custom ? 'Custom prompt' : 'Default prompt'}
                </Button>
              </div>

              {open && (
                <div className="mt-3 space-y-2">
                  <Label htmlFor={`${feature.key}-prompt`}>System prompt</Label>
                  <Textarea
                    id={`${feature.key}-prompt`}
                    value={draft.prompt}
                    disabled={!canEdit || busy}
                    placeholder={feature.default_prompt}
                    aria-label={`${feature.label} system prompt`}
                    onChange={(event) => update(feature.key, { prompt: event.target.value })}
                  />
                  <footer className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">{custom ? 'This replaces the built-in prompt.' : 'Empty: the built-in prompt shown above is used.'}</p>
                    {canEdit && custom && (
                      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => update(feature.key, { prompt: '' })}>
                        Restore default
                      </Button>
                    )}
                  </footer>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
