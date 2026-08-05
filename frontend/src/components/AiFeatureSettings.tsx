import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import type { AiFeatureSetting, FormPayload } from '../types/api'

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
    <section className="ai-feature-settings">
      <header>
        <div>
          <h3>AI features</h3>
          <p>Switch each capability on or off, and replace its system prompt. An empty prompt uses the built-in one.</p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary" disabled={busy || !changed} onClick={save}>
            {busy ? 'Saving…' : 'Save AI features'}
          </button>
        )}
      </header>

      <ul>
        {features.map((feature) => {
          const draft = drafts[feature.key] ?? { enabled: feature.enabled, prompt: feature.prompt }
          const open = expanded === feature.key
          const custom = draft.prompt.trim() !== ''

          return (
            <li key={feature.key} className={draft.enabled ? '' : 'is-off'}>
              <div className="ai-feature-head">
                <label className="ai-feature-toggle">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    disabled={!canEdit || busy}
                    aria-label={`Enable ${feature.label}`}
                    onChange={(event) => update(feature.key, { enabled: event.target.checked })}
                  />
                  <span>
                    <strong>{feature.label}</strong>
                    <small>{feature.description}</small>
                  </span>
                </label>
                <button
                  type="button"
                  className="btn btn-quiet"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : feature.key)}
                >
                  <Icon name="edit" size={14} /> {custom ? 'Custom prompt' : 'Default prompt'}
                </button>
              </div>

              {open && (
                <div className="ai-feature-prompt">
                  <label>
                    <span className="field-label">System prompt</span>
                    <textarea
                      value={draft.prompt}
                      disabled={!canEdit || busy}
                      placeholder={feature.default_prompt}
                      aria-label={`${feature.label} system prompt`}
                      onChange={(event) => update(feature.key, { prompt: event.target.value })}
                    />
                  </label>
                  <footer>
                    <small>{custom ? 'This replaces the built-in prompt.' : 'Empty: the built-in prompt shown above is used.'}</small>
                    {canEdit && custom && (
                      <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => update(feature.key, { prompt: '' })}>
                        Restore default
                      </button>
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
