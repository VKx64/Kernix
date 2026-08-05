import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Building2, Calendar as CalendarIcon, Check, Plus, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { displayName } from '@/lib/api'
import type { Client, EntityId, FieldValue, FormPayload, Project, UserSummary } from '@/types/api'

interface ProjectDraft {
  name: string
  client_id: string
  manager_user_id: string
  status_value_id: string
  start_date: string
  due_date: string
  description: string
}

type ProjectDraftErrors = Partial<Record<keyof ProjectDraft, string>>

interface ProjectOnboardingProps {
  clients: Client[]
  managers: UserSummary[]
  statuses: FieldValue[]
  lookupsLoading?: boolean
  lookupError?: string
  singleClientMode: boolean
  singleClientId?: EntityId | null
  singleClient?: Client | null
  busy: boolean
  error: string
  canOpenTasks?: boolean
  canCreateClients?: boolean
  onClose: () => void
  onClearError?: () => void
  onRetryLookups?: () => void
  onCreate: (values: FormPayload) => Promise<Project | null>
  onOpenTasks?: (project: Project) => void
  onOpenClients?: () => void
}

// Sentinel for "no selection" — Radix Select forbids an empty-string item value.
const UNSET = '__unset__'

function initialDraft(singleClientId?: EntityId | null): ProjectDraft {
  return {
    name: '',
    client_id: singleClientId === undefined || singleClientId === null ? '' : String(singleClientId),
    manager_user_id: '',
    status_value_id: '',
    start_date: '',
    due_date: '',
    description: '',
  }
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function fromIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/**
 * Same job as `@/components/date-picker`'s `DatePicker`, but composed from the
 * lower-level Popover/Calendar primitives directly so the due-date field can
 * disable days before the chosen start date — a constraint the shared
 * component does not expose.
 */
function ComposeDateField({
  id,
  value,
  onChange,
  disabledBefore,
  invalid,
  describedBy,
  placeholder,
  disabled,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabledBefore?: Date
  invalid?: boolean
  describedBy?: string
  placeholder: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = fromIsoDate(value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn('w-full justify-start font-normal', !selected && 'text-muted-foreground')}
        >
          <CalendarIcon />
          {selected ? selected.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? disabledBefore}
          disabled={disabledBefore ? { before: disabledBefore } : undefined}
          autoFocus
          onSelect={(date) => {
            onChange(date ? toIsoDate(date) : '')
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export function ProjectOnboarding({
  clients,
  managers,
  statuses,
  lookupsLoading = false,
  lookupError = '',
  singleClientMode,
  singleClientId,
  singleClient,
  busy,
  error,
  canOpenTasks = false,
  canCreateClients = false,
  onClose,
  onClearError,
  onRetryLookups,
  onCreate,
  onOpenTasks,
  onOpenClients,
}: ProjectOnboardingProps) {
  const formId = useId()
  const [draft, setDraft] = useState<ProjectDraft>(() => initialDraft(singleClientId))
  const [errors, setErrors] = useState<ProjectDraftErrors>({})
  const [created, setCreated] = useState<Project | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const createdHeadingRef = useRef<HTMLHeadingElement>(null)
  const prerequisiteHeadingRef = useRef<HTMLHeadingElement>(null)

  const selectedClient = useMemo(() => {
    if (singleClientMode) return singleClient ?? clients.find((client) => String(client.id) === String(singleClientId)) ?? null
    return clients.find((client) => String(client.id) === draft.client_id) ?? null
  }, [clients, draft.client_id, singleClient, singleClientId, singleClientMode])
  const selectedManager = managers.find((manager) => String(manager.id) === draft.manager_user_id)
  const needsClient = !singleClientMode && !lookupsLoading && !lookupError && clients.length === 0

  const setField = (name: keyof ProjectDraft, value: string) => {
    setDraft((current) => ({ ...current, [name]: value }))
    setErrors((current) => {
      const next = { ...current }
      delete next[name]
      return next
    })
    if (error) onClearError?.()
  }

  const validate = () => {
    const nextErrors: ProjectDraftErrors = {}
    if (!draft.name.trim()) nextErrors.name = 'Enter a project name.'
    else if (draft.name.trim().length > 191) nextErrors.name = 'Keep the project name under 192 characters.'

    if (singleClientMode) {
      if (singleClientId === undefined || singleClientId === null || singleClientId === '') {
        nextErrors.client_id = 'Choose a workspace client in Settings before creating a project.'
      }
    } else if (!draft.client_id) {
      nextErrors.client_id = lookupsLoading
        ? 'Client options are still loading.'
        : lookupError
          ? 'Client options could not be loaded. Try again.'
          : 'Choose the client that owns this project.'
    }

    if (draft.start_date && draft.due_date && draft.due_date < draft.start_date) {
      nextErrors.due_date = 'Due date must be on or after the start date.'
    }

    setErrors(nextErrors)
    const firstInvalid = nextErrors.name ? `${formId}-name` : nextErrors.client_id ? `${formId}-client` : nextErrors.due_date ? `${formId}-due-date` : ''
    if (firstInvalid) window.requestAnimationFrame(() => document.getElementById(firstInvalid)?.focus())
    return Object.keys(nextErrors).length === 0
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!validate()) return

    const project = await onCreate({
      name: draft.name.trim(),
      client_id: singleClientMode ? singleClientId : draft.client_id,
      manager_user_id: draft.manager_user_id,
      status_value_id: draft.status_value_id,
      start_date: draft.start_date,
      due_date: draft.due_date,
      description: draft.description.trim(),
    })
    if (project) {
      setCreated(project)
      window.requestAnimationFrame(() => createdHeadingRef.current?.focus())
    }
  }

  const isDirty = Boolean(
    draft.name.trim()
    || (!singleClientMode && draft.client_id)
    || draft.manager_user_id
    || draft.status_value_id
    || draft.start_date
    || draft.due_date
    || draft.description.trim(),
  )

  const requestClose = () => {
    if (busy) return
    if (!created && isDirty && !window.confirm('Discard this project?')) return
    onClose()
  }

  const openClientSetup = () => {
    if (busy || !canCreateClients || !onOpenClients) return
    onOpenClients()
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) requestClose() }}>
      <DialogContent
        className="sm:max-w-xl"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          if (created) createdHeadingRef.current?.focus()
          else if (needsClient) prerequisiteHeadingRef.current?.focus()
          else nameRef.current?.focus()
        }}
      >
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" disabled={busy} className="absolute top-4 right-4">
            <X />
          </Button>
        </DialogClose>
        <DialogHeader>
          <DialogTitle>{created ? 'Project created' : 'New project'}</DialogTitle>
          {!created && <DialogDescription>Name the work and pick its client. Everything else can change later.</DialogDescription>}
        </DialogHeader>

        {created ? (
          <section className="flex flex-col items-center gap-3 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"><Check className="size-5" /></span>
            <h3 className="text-lg font-semibold" ref={createdHeadingRef} tabIndex={-1}>{created.name}</h3>
            <p className="text-sm text-muted-foreground">{canOpenTasks ? 'Ready for its first tasks.' : 'Added to your project list.'}</p>
            <dl className="grid w-full grid-cols-2 gap-3 rounded-lg border p-4 text-left text-sm">
              <div><dt className="text-xs text-muted-foreground">Client</dt><dd>{created.client?.name ?? selectedClient?.name ?? 'Workspace client'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Project manager</dt><dd>{created.manager ? displayName(created.manager) : selectedManager ? displayName(selectedManager) : 'Unassigned'}</dd></div>
            </dl>
            {error && <Alert role="status"><AlertDescription>{error}</AlertDescription></Alert>}
            <footer className="flex w-full flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Back to projects</Button>
              {canOpenTasks && onOpenTasks && (
                <Button type="button" onClick={() => onOpenTasks(created)}><Check className="size-4" /> Open project tasks</Button>
              )}
            </footer>
          </section>
        ) : needsClient ? (
          <section className="flex flex-col items-center gap-3 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"><Building2 className="size-5" /></span>
            <h3 className="text-lg font-semibold" ref={prerequisiteHeadingRef} tabIndex={-1}>A client comes first</h3>
            <p className="text-sm text-muted-foreground">{canCreateClients ? 'Projects belong to a client. Add one, then come back to set this up.' : 'Ask an administrator to add a client before setting up this project.'}</p>
            <footer className="flex w-full flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="button" disabled={!canCreateClients || !onOpenClients} onClick={openClientSetup}>
                {canCreateClients && onOpenClients ? <><Plus /> Add first client</> : 'Client required'}
              </Button>
            </footer>
          </section>
        ) : (
          <form className="space-y-5" onSubmit={(event) => void submit(event)} noValidate>
            <fieldset className="space-y-5" disabled={busy}>
              <legend className="sr-only">Project details</legend>

              {lookupError && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                    <span>{lookupError}</span>
                    {onRetryLookups && <Button type="button" variant="link" size="sm" disabled={lookupsLoading} onClick={onRetryLookups}>{lookupsLoading ? 'Retrying…' : 'Try again'}</Button>}
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`${formId}-name`}>Project name <span aria-hidden="true" className="text-destructive">*</span></Label>
                  <Input
                    id={`${formId}-name`}
                    ref={nameRef}
                    data-autofocus
                    required
                    maxLength={191}
                    value={draft.name}
                    aria-invalid={Boolean(errors.name)}
                    aria-describedby={errors.name ? `${formId}-name-error` : undefined}
                    placeholder="Website launch"
                    onChange={(event) => setField('name', event.target.value)}
                  />
                  {errors.name && <p className="text-sm text-destructive" id={`${formId}-name-error`}>{errors.name}</p>}
                </div>

                {singleClientMode ? (
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Client</Label>
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Building2 className="size-4" />{selectedClient?.name ?? 'No client configured'}</p>
                    {errors.client_id && <p className="text-sm text-destructive">{errors.client_id}</p>}
                  </div>
                ) : (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor={`${formId}-client`}>Client <span aria-hidden="true" className="text-destructive">*</span></Label>
                    <Select
                      value={draft.client_id}
                      required
                      disabled={lookupsLoading && clients.length === 0}
                      onValueChange={(next) => setField('client_id', next)}
                    >
                      <SelectTrigger
                        id={`${formId}-client`}
                        className="w-full"
                        aria-invalid={Boolean(errors.client_id)}
                        aria-describedby={errors.client_id ? `${formId}-client-error` : undefined}
                      >
                        <SelectValue placeholder={lookupsLoading && clients.length === 0 ? 'Loading clients…' : 'Select a client…'} />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((client) => <SelectItem key={client.id} value={String(client.id)}>{client.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {errors.client_id && <p className="text-sm text-destructive" id={`${formId}-client-error`}>{errors.client_id}</p>}
                  </div>
                )}

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`${formId}-description`}>Description <span className="text-xs text-muted-foreground">Optional</span></Label>
                  <Textarea
                    id={`${formId}-description`}
                    value={draft.description}
                    placeholder="What is the team delivering?"
                    onChange={(event) => setField('description', event.target.value)}
                  />
                </div>
              </div>

              <p className="flex items-center gap-2 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">Planning · all optional</p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`${formId}-manager`}>Project manager</Label>
                  <Select
                    value={draft.manager_user_id || UNSET}
                    disabled={lookupsLoading && managers.length === 0}
                    onValueChange={(next) => setField('manager_user_id', next === UNSET ? '' : next)}
                  >
                    <SelectTrigger id={`${formId}-manager`} className="w-full">
                      <SelectValue placeholder={lookupsLoading && managers.length === 0 ? 'Loading team…' : 'Unassigned'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Unassigned</SelectItem>
                      {managers.map((manager) => <SelectItem key={manager.id} value={String(manager.id)}>{displayName(manager)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${formId}-status`}>Starting status</Label>
                  <Select
                    value={draft.status_value_id || UNSET}
                    disabled={lookupsLoading && statuses.length === 0}
                    onValueChange={(next) => setField('status_value_id', next === UNSET ? '' : next)}
                  >
                    <SelectTrigger id={`${formId}-status`} className="w-full">
                      <SelectValue placeholder={lookupsLoading && statuses.length === 0 ? 'Loading statuses…' : 'Choose later'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Choose later</SelectItem>
                      {statuses.map((status) => <SelectItem key={status.id} value={String(status.id)}>{status.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${formId}-start-date`}>Start date</Label>
                  <ComposeDateField
                    id={`${formId}-start-date`}
                    value={draft.start_date}
                    placeholder="No start date"
                    onChange={(next) => setField('start_date', next)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${formId}-due-date`}>Due date</Label>
                  <ComposeDateField
                    id={`${formId}-due-date`}
                    value={draft.due_date}
                    disabledBefore={fromIsoDate(draft.start_date)}
                    placeholder="No due date"
                    invalid={Boolean(errors.due_date)}
                    describedBy={errors.due_date ? `${formId}-due-date-error` : undefined}
                    onChange={(next) => setField('due_date', next)}
                  />
                  {errors.due_date && <p className="text-sm text-destructive" id={`${formId}-due-date-error`}>{errors.due_date}</p>}
                </div>
              </div>

              {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
            </fieldset>

            <footer className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={requestClose}>Cancel</Button>
              <Button type="submit" disabled={busy || (lookupsLoading && clients.length === 0 && !singleClientMode)}>
                {busy ? 'Creating…' : 'Create project'}
              </Button>
            </footer>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
