import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ChevronLeft, GripVertical, MoreHorizontal, Plus } from 'lucide-react'
import { SubmissionDrawer } from '@/components/forms/SubmissionDrawer'
import { LabelRow } from '@/components/kernix/label-row'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { api, unwrap } from '@/lib/api'
import {
  FIELD_TYPES, MAX_FIELDS, allowedMaps, fieldHasChoices, isMapAllowed, mapLabel, typeLabel,
} from '@/lib/formFieldCatalogue'
import { savedAgoLabel, useAutosave } from '@/lib/useAutosave'
import { useTaskLookups } from '@/lib/useTaskLookups'
import { cn } from '@/lib/utils'
import type { ApiEnvelope, ProjectForm, ProjectFormField, ProjectFormFieldChoice } from '@/types/api'

let tempFieldSeq = 0
function tempFieldId() {
  tempFieldSeq += 1
  return `new-${tempFieldSeq}`
}

function isNewFieldId(id: string) {
  return id.startsWith('new-')
}

function blankField(type: string): ProjectFormField {
  return {
    id: tempFieldId(),
    type,
    label: 'Untitled field',
    help: '',
    required: false,
    choices: fieldHasChoices(type) ? [
      { value: 'option_1', label: 'Option 1', caption: null, urgency_key: null },
      { value: 'option_2', label: 'Option 2', caption: null, urgency_key: null },
    ] : [],
    maps: 'none',
  }
}

interface FormMeta {
  title: string
  blurb: string
  header_line: string
  state: 'live' | 'paused'
  require_email: boolean
  auto_convert: boolean
  notify: boolean
}

function metaFromForm(form: ProjectForm): FormMeta {
  return {
    title: form.title ?? '',
    blurb: form.blurb ?? '',
    header_line: form.header_line ?? '',
    state: form.state ?? 'live',
    require_email: Boolean(form.require_email),
    auto_convert: Boolean(form.auto_convert),
    notify: form.notify ?? true,
  }
}

/**
 * Screen B. Saves on every change with the same "Saved" flash Settings uses
 * — there is deliberately no Save button anywhere on this screen. See
 * `lib/useAutosave.ts` for the debounce/in-flight contract this relies on.
 */
export function ProjectFormBuilderPage() {
  const { projectId, formId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { urgencyOptions } = useTaskLookups()

  const [form, setForm] = useState<ProjectForm | null>(null)
  const [meta, setMeta] = useState<FormMeta | null>(null)
  const [fields, setFields] = useState<ProjectFormField[]>([])
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [moveNotice, setMoveNotice] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)

  const load = useCallback(async () => {
    if (!formId) return
    setLoading(true); setLoadError('')
    try {
      const response = await api.get<ApiEnvelope<ProjectForm>>(`/api/project-forms/${formId}`)
      const loaded = unwrap(response)
      setForm(loaded)
      setMeta(metaFromForm(loaded))
      setFields(loaded.fields ?? [])
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : 'Unable to load this form.')
    } finally { setLoading(false) }
  }, [formId])
  useEffect(() => { void load() }, [load])

  const draft = useMemo(() => (meta ? { ...meta, fields } : null), [meta, fields])

  const save = useCallback(async (value: typeof draft) => {
    if (!value || !formId) return
    const payload = {
      title: value.title,
      blurb: value.blurb || null,
      header_line: value.header_line || null,
      state: value.state,
      require_email: value.require_email,
      auto_convert: value.auto_convert,
      notify: value.notify,
      fields: value.fields.map((field) => ({
        id: isNewFieldId(field.id) ? undefined : field.id,
        type: field.type,
        label: field.label || 'Untitled field',
        help: field.help || null,
        required: Boolean(field.required),
        maps: field.maps || 'none',
        choices: field.choices ?? [],
      })),
    }
    const response = await api.patch<ApiEnvelope<ProjectForm>>(`/api/project-forms/${formId}`, payload)
    const updated = unwrap(response)
    setForm(updated)
    // Adopt the server's canonical field ids so the next save recognises the
    // fields it already created instead of duplicating them.
    setFields((current) => {
      const bySeq = updated.fields ?? []
      if (bySeq.length !== current.length) return current
      return current.map((field, index) => ({ ...field, id: bySeq[index]?.id ?? field.id }))
    })
    setSelectedFieldId((current) => {
      if (!current || !isNewFieldId(current)) return current
      const index = fields.findIndex((f) => f.id === current)
      return updated.fields?.[index]?.id ?? current
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId])

  const autosave = useAutosave({ value: draft, onSave: save, enabled: !loading && Boolean(draft) })

  const updateMeta = (patch: Partial<FormMeta>) => setMeta((current) => (current ? { ...current, ...patch } : current))

  const updateField = (id: string, patch: Partial<ProjectFormField>) => {
    setFields((current) => current.map((field) => (field.id === id ? { ...field, ...patch } : field)))
  }

  const setFieldMap = (id: string, map: string) => {
    setFields((current) => {
      const target = current.find((field) => field.id === id)
      const previousHolder = map !== 'none' ? current.find((field) => field.maps === map && field.id !== id) : undefined
      if (previousHolder && target) {
        setMoveNotice(`"${mapLabel(map)}" moved from "${previousHolder.label}" to "${target.label}."`)
      }
      return current.map((field) => {
        if (field.id === id) return { ...field, maps: map }
        if (previousHolder && field.id === previousHolder.id) return { ...field, maps: 'none' }
        return field
      })
    })
  }

  const changeFieldType = (id: string, type: string) => {
    setFields((current) => current.map((field) => {
      if (field.id !== id) return field
      const nextMaps = isMapAllowed(type, field.maps) ? field.maps : 'none'
      const nextChoices = fieldHasChoices(type)
        ? (field.choices?.length ? field.choices : blankField(type).choices)
        : []
      return { ...field, type, maps: nextMaps, choices: nextChoices }
    }))
  }

  const addField = (type: string) => {
    if (fields.length >= MAX_FIELDS) return
    const created = blankField(type)
    setFields((current) => [...current, created])
    setSelectedFieldId(created.id)
  }

  const requestDeleteField = (id: string) => {
    const submissionCount = form?.submissions_count ?? 0
    if (submissionCount > 0 && pendingDeleteId !== id) {
      setPendingDeleteId(id)
      return
    }
    setFields((current) => current.filter((field) => field.id !== id))
    setSelectedFieldId((current) => (current === id ? null : current))
    setPendingDeleteId(null)
  }

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return
    setFields((current) => {
      const fromIndex = current.findIndex((field) => field.id === fromId)
      const toIndex = current.findIndex((field) => field.id === toId)
      if (fromIndex === -1 || toIndex === -1) return current
      const next = [...current]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }

  useEffect(() => {
    if (!moveNotice) return
    const timer = window.setTimeout(() => setMoveNotice(''), 4000)
    return () => window.clearTimeout(timer)
  }, [moveNotice])

  const selectedField = fields.find((field) => field.id === selectedFieldId) ?? null
  const openSubmissionId = searchParams.get('submission')
  const closeSubmission = () => { searchParams.delete('submission'); setSearchParams(searchParams, { replace: true }) }

  if (loading && !form) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px]" />
      </div>
    )
  }
  if (loadError && !form) {
    return <p className="text-body-sm text-danger">{loadError}</p>
  }
  if (!form || !meta) return null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
        <Button variant="ghost" size="sm" className="-ml-2 text-t3" asChild>
          <Link to={`/projects/${projectId}/forms`}><ChevronLeft className="size-3.5" /> Forms</Link>
        </Button>
        <span className="h-3.5 w-px bg-line-strong" />
        <input
          value={meta.title}
          onChange={(event) => updateMeta({ title: event.target.value })}
          aria-label="Form title"
          className="min-w-0 flex-none border-0 bg-transparent text-body-lg font-semibold text-title-strong outline-none"
          style={{ width: `${Math.max(8, meta.title.length + 1)}ch` }}
        />
        <span className={cn('inline-flex h-[22px] items-center gap-1.5 rounded-md px-2 text-meta-sm font-semibold', meta.state === 'live' ? 'bg-good/13 text-good' : 'bg-soft text-t3')}>
          <span aria-hidden="true" className="size-[5px] rounded-full" style={{ background: 'currentColor' }} />
          {meta.state === 'live' ? 'Live' : 'Paused'}
        </span>
        <span className="flex-1" />
        <span role="status" className="text-meta-sm text-t4">
          {autosave.saving ? 'Saving…' : autosave.error ? <span className="text-danger">{autosave.error}</span> : savedAgoLabel(autosave.savedAt)}
        </span>
        <Button variant="outline" size="sm" asChild>
          <a href={`/f/${form.slug}`} target="_blank" rel="noreferrer">Preview</a>
        </Button>
      </div>

      {moveNotice && <p role="status" className="text-meta-sm text-t3">{moveNotice}</p>}

      <div className="grid grid-cols-1 items-start gap-5 @[900px]:grid-cols-[1fr_316px]">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-2 rounded-xl border border-line-strong bg-surface p-4">
            <input
              value={meta.title}
              onChange={(event) => updateMeta({ title: event.target.value })}
              aria-label="Form title (blurb card)"
              className="border-0 bg-transparent text-[17px] font-[550] tracking-[-0.015em] text-title-strong outline-none"
            />
            <textarea
              value={meta.blurb}
              onChange={(event) => updateMeta({ blurb: event.target.value })}
              placeholder="What is this form for? Shown to whoever opens the link."
              rows={2}
              className="resize-none border-0 bg-transparent text-body-sm leading-[1.6] text-t3 outline-none placeholder:text-t4"
            />
          </div>

          <div className="flex flex-col gap-2">
            {fields.map((field) => (
              <FieldRow
                key={field.id}
                field={field}
                selected={field.id === selectedFieldId}
                onSelect={() => setSelectedFieldId(field.id)}
                onDragStart={() => { dragId.current = field.id }}
                onDropOn={() => { if (dragId.current) reorder(dragId.current, field.id) }}
              />
            ))}
          </div>

          <AddFieldControl atCap={fields.length >= MAX_FIELDS} onAdd={addField} />
        </div>

        <div className="flex flex-col gap-3">
          {selectedField && (
            <FieldInspector
              field={selectedField}
              urgencyOptions={urgencyOptions}
              submissionCount={form.submissions_count ?? 0}
              pendingDelete={pendingDeleteId === selectedField.id}
              onChange={(patch) => updateField(selectedField.id, patch)}
              onChangeType={(type) => changeFieldType(selectedField.id, type)}
              onChangeMap={(map) => setFieldMap(selectedField.id, map)}
              onDelete={() => requestDeleteField(selectedField.id)}
              onCancelDelete={() => setPendingDeleteId(null)}
            />
          )}

          <FormSettingsPanel meta={meta} onChange={updateMeta} />

          <PublicLinkPanel form={form} onRotated={(updated) => setForm(updated)} />
        </div>
      </div>

      {openSubmissionId && (
        <SubmissionDrawer submissionId={openSubmissionId} onClose={closeSubmission} onDecided={() => void load()} />
      )}
    </div>
  )
}

function FieldRow({ field, selected, onSelect, onDragStart, onDropOn }: {
  field: ProjectFormField
  selected: boolean
  onSelect: () => void
  onDragStart: () => void
  onDropOn: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect() }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); onDropOn() }}
      className={cn(
        'grid cursor-pointer grid-cols-[22px_1fr_118px_74px] items-center gap-3 rounded-[10px] border border-line-strong bg-surface p-[11px_12px] text-left',
        selected && 'border-[1.5px] border-brand bg-[#15151c] shadow-[0_0_0_3px_rgba(123,127,246,0.1)]',
      )}
    >
      <span
        draggable
        onDragStart={(event) => { event.stopPropagation(); onDragStart() }}
        onClick={(event) => event.stopPropagation()}
        aria-label={`Reorder ${field.label}`}
        className="grid cursor-grab place-items-center text-t5"
      >
        <GripVertical className="size-3" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-body text-t1">{field.label}</span>
        <span className="truncate text-meta-sm text-t4">{field.help || (field.choices?.length ? field.choices.map((choice) => choice.label).join(' · ') : '')}</span>
      </span>
      <span className="inline-flex h-6 w-fit items-center whitespace-nowrap rounded-md bg-fill px-2 font-mono text-[10.5px] text-t2">{typeLabel(field.type)}</span>
      {field.required ? (
        <span className="inline-flex h-6 w-fit items-center whitespace-nowrap rounded-md bg-danger/12 px-2 text-meta-sm font-semibold text-danger">Required</span>
      ) : (
        <span className="text-meta-sm text-t4">Optional</span>
      )}
    </div>
  )
}

function AddFieldControl({ atCap, onAdd }: { atCap: boolean; onAdd: (type: string) => void }) {
  if (atCap) {
    return (
      <div className="flex items-center gap-2.5 rounded-[10px] border border-dashed border-line-strong p-3 text-t5">
        <span className="grid size-5 place-items-center rounded-md bg-soft"><Plus className="size-2.5" /></span>
        <span className="text-body-sm">Add field</span>
        <span className="flex-1" />
        <span className="font-mono text-meta-sm text-t4">{MAX_FIELDS} fields is the most a form can hold</span>
      </div>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-2.5 rounded-[10px] border border-dashed border-line-strong p-3 text-t3 hover:border-line-strong hover:text-t1">
          <span className="grid size-5 place-items-center rounded-md bg-soft"><Plus className="size-2.5" /></span>
          <span className="text-body-sm">Add field</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {FIELD_TYPES.map((type) => (
          <DropdownMenuItem key={type} onSelect={() => onAdd(type)}>{typeLabel(type)}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FieldInspector({
  field, urgencyOptions, submissionCount, pendingDelete, onChange, onChangeType, onChangeMap, onDelete, onCancelDelete,
}: {
  field: ProjectFormField
  urgencyOptions: Array<{ id: string | number; key?: string; key_name?: string; label: string }>
  submissionCount: number
  pendingDelete: boolean
  onChange: (patch: Partial<ProjectFormField>) => void
  onChangeType: (type: string) => void
  onChangeMap: (map: string) => void
  onDelete: () => void
  onCancelDelete: () => void
}) {
  const choices = field.choices ?? []
  const setChoice = (index: number, patch: Partial<ProjectFormFieldChoice>) => {
    onChange({ choices: choices.map((choice, i) => (i === index ? { ...choice, ...patch } : choice)) })
  }
  const addChoice = () => {
    if (choices.length >= 12) return
    const n = choices.length + 1
    onChange({ choices: [...choices, { value: `option_${n}`, label: `Option ${n}`, caption: null, urgency_key: null }] })
  }
  const removeChoice = (index: number) => {
    onChange({ choices: choices.filter((_, i) => i !== index) })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-surface">
      <div className="border-b border-line px-3.5 py-2.5 text-label uppercase text-label-fg">Field — {field.label}</div>
      <div className="flex flex-col gap-3.5 px-3.5 py-3.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-meta-sm text-t3">Label</span>
          <input value={field.label} onChange={(event) => onChange({ label: event.target.value })} className="h-8 rounded-md border border-line-strong bg-inset px-2.5 text-body-sm text-t1 outline-none focus-visible:border-brand" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-meta-sm text-t3">Help text</span>
          <input value={field.help ?? ''} onChange={(event) => onChange({ help: event.target.value })} className="h-8 rounded-md border border-line-strong bg-inset px-2.5 text-body-sm text-t2 outline-none focus-visible:border-brand" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-meta-sm text-t3">Type</span>
          <select value={field.type} onChange={(event) => onChangeType(event.target.value)} className="h-8 rounded-md border border-line-strong bg-inset px-2.5 text-body-sm text-t1 outline-none">
            {FIELD_TYPES.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
          </select>
        </label>

        {fieldHasChoices(field.type) && (
          <div className="flex flex-col gap-1.5">
            <span className="text-meta-sm text-t3">{field.type === 'severity' ? 'Choices — each maps to an urgency' : 'Choices'}</span>
            {choices.map((choice, index) => (
              <div key={index} className="flex items-center gap-2 rounded-md bg-inset p-1.5">
                <input
                  value={choice.label}
                  onChange={(event) => setChoice(index, { label: event.target.value })}
                  aria-label={`Choice ${index + 1} label`}
                  className="min-w-0 flex-1 border-0 bg-transparent text-body-sm text-t1 outline-none"
                />
                {field.type === 'severity' && (
                  <select
                    value={choice.urgency_key ?? ''}
                    onChange={(event) => setChoice(index, { urgency_key: event.target.value || null })}
                    aria-label={`Choice ${index + 1} urgency`}
                    className="h-6 rounded-sm border-0 bg-transparent text-meta-sm text-t3 outline-none"
                  >
                    <option value="">— urgency —</option>
                    {urgencyOptions.map((option) => {
                      const key = option.key ?? option.key_name ?? String(option.id)
                      return <option key={String(option.id)} value={key}>{option.label}</option>
                    })}
                  </select>
                )}
                <button type="button" onClick={() => removeChoice(index)} disabled={choices.length <= 2} aria-label={`Remove choice ${index + 1}`} className="text-t5 hover:text-danger disabled:opacity-40">×</button>
              </div>
            ))}
            <button type="button" onClick={addChoice} disabled={choices.length >= 12} className="self-start text-meta-sm text-brand hover:text-brand-hover disabled:opacity-40">+ Add choice</button>
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-meta-sm text-t3">Maps to</span>
          <select value={field.maps ?? 'none'} onChange={(event) => onChangeMap(event.target.value)} className="h-8 rounded-md border border-line-strong bg-inset px-2.5 text-body-sm text-t1 outline-none">
            {allowedMaps(field.type).map((map) => <option key={map} value={map}>{mapLabel(map)}</option>)}
          </select>
        </label>

        <label className="flex items-center gap-2.5 pt-0.5">
          <Switch checked={Boolean(field.required)} onCheckedChange={(checked) => onChange({ required: checked })} />
          <span className="text-body-sm text-t2">Required</span>
        </label>

        <div className="border-t border-line-soft pt-3">
          {pendingDelete ? (
            <div className="flex flex-col gap-2 rounded-md bg-warn/10 p-2.5">
              <p className="text-meta-sm text-warn">{submissionCount} submission{submissionCount === 1 ? '' : 's'} used this field. Their answers stay.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={onDelete}>Delete anyway</Button>
                <Button size="sm" variant="ghost" onClick={onCancelDelete}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={onDelete}>Delete field</Button>
          )}
        </div>
      </div>
    </div>
  )
}

function FormSettingsPanel({ meta, onChange }: { meta: FormMeta; onChange: (patch: Partial<FormMeta>) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-surface">
      <div className="border-b border-line px-3.5 py-2.5 text-label uppercase text-label-fg">Form settings</div>
      <div className="flex flex-col">
        <SettingRow label="Accepting submissions" checked={meta.state === 'live'} onCheckedChange={(checked) => onChange({ state: checked ? 'live' : 'paused' })} />
        <SettingRow label="Require email" checked={meta.require_email} onCheckedChange={(checked) => onChange({ require_email: checked })} />
        <SettingRow label="Auto-convert to task" note="Skips review — off by default" checked={meta.auto_convert} onCheckedChange={(checked) => onChange({ auto_convert: checked })} />
        <SettingRow label="Notify on new submission" checked={meta.notify} onCheckedChange={(checked) => onChange({ notify: checked })} />
      </div>
    </div>
  )
}

function SettingRow({ label, note, checked, onCheckedChange }: { label: string; note?: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center gap-2.5 border-t border-line-soft px-3.5 py-2.5 first:border-t-0">
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-body-sm text-t2">{label}</span>
        {note && <span className="text-meta-sm text-t4">{note}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function PublicLinkPanel({ form, onRotated }: { form: ProjectForm; onRotated: (form: ProjectForm) => void }) {
  const [busy, setBusy] = useState(false)
  const url = `${window.location.origin}/f/${form.slug}`

  const rotate = async () => {
    if (!window.confirm('Rotate the link? The old link stops working immediately.')) return
    setBusy(true)
    try {
      const response = await api.post<ApiEnvelope<ProjectForm>>(`/api/project-forms/${form.id}/rotate-slug`)
      onRotated(unwrap(response))
    } finally { setBusy(false) }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(url) } catch { /* clipboard denied — the link stays visible */ }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line-strong bg-surface p-3.5">
      <LabelRow>Public link</LabelRow>
      <div className="flex items-center gap-2">
        <input readOnly value={url} aria-label="Public form link" className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-inset px-2.5 font-mono text-meta-sm text-t2 outline-none" />
        <Button size="sm" variant="outline" onClick={() => void copy()}>Copy</Button>
      </div>
      <Button size="sm" variant="ghost" className="self-start text-t3" disabled={busy} onClick={() => void rotate()}>
        <MoreHorizontal className="size-3" /> Rotate link
      </Button>
    </div>
  )
}
