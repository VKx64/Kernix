import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { DatePicker, Select } from '../components/fields'
import { Modal } from '../components/ui'
import { displayName } from '../lib/api'
import type { Client, EntityId, FieldValue, FormPayload, Project, UserSummary } from '../types/api'

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

  const selectedClient = useMemo(() => {
    if (singleClientMode) return singleClient ?? clients.find((client) => String(client.id) === String(singleClientId)) ?? null
    return clients.find((client) => String(client.id) === draft.client_id) ?? null
  }, [clients, draft.client_id, singleClient, singleClientId, singleClientMode])
  const selectedManager = managers.find((manager) => String(manager.id) === draft.manager_user_id)
  const needsClient = !singleClientMode && !lookupsLoading && !lookupError && clients.length === 0

  const clientOptions = useMemo(() => clients.map((client) => ({ value: String(client.id), label: client.name })), [clients])
  // Optional selects keep an explicit "unset" row so a choice can be undone.
  const managerOptions = useMemo(
    () => [{ value: '', label: 'Unassigned' }, ...managers.map((manager) => ({ value: String(manager.id), label: displayName(manager) }))],
    [managers],
  )
  const statusOptions = useMemo(
    () => [{ value: '', label: 'Choose later' }, ...statuses.map((status) => ({ value: String(status.id), label: status.label }))],
    [statuses],
  )

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
    <Modal
      open
      onClose={requestClose}
      closeDisabled={busy}
      title={created ? 'Project created' : 'New project'}
      description={created ? undefined : 'Name the work and pick its client. Everything else can change later.'}
      className="project-compose-modal"
    >
      {created ? (
        <section className="project-created">
          <span className="project-created-icon"><Icon name="check" size={24} /></span>
          <h3 ref={createdHeadingRef} tabIndex={-1}>{created.name}</h3>
          <p>{canOpenTasks ? 'Ready for its first tasks.' : 'Added to your project list.'}</p>
          <dl className="project-created-meta">
            <div>
              <dt>Client</dt>
              <dd>{created.client?.name ?? selectedClient?.name ?? 'Workspace client'}</dd>
            </div>
            <div>
              <dt>Project manager</dt>
              <dd>{created.manager ? displayName(created.manager) : selectedManager ? displayName(selectedManager) : 'Unassigned'}</dd>
            </div>
          </dl>
          {error && <div className="project-created-notice" role="status">{error}</div>}
          <footer className="project-created-actions">
            <button type="button" className="btn btn-quiet" onClick={onClose}>Back to projects</button>
            {canOpenTasks && onOpenTasks && (
              <button type="button" className="btn btn-primary" onClick={() => onOpenTasks(created)}><Icon name="task" size={16} /> Open project tasks</button>
            )}
          </footer>
        </section>
      ) : needsClient ? (
        <section className="project-prerequisite">
          <span className="project-prerequisite-icon"><Icon name="building" size={24} /></span>
          <h3 data-autofocus tabIndex={-1}>A client comes first</h3>
          <p>{canCreateClients ? 'Projects belong to a client. Add one, then come back to set this up.' : 'Ask an administrator to add a client before setting up this project.'}</p>
          <footer className="project-prerequisite-actions">
            <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={!canCreateClients || !onOpenClients} onClick={openClientSetup}>
              {canCreateClients && onOpenClients ? <><Icon name="plus" size={16} /> Add first client</> : 'Client required'}
            </button>
          </footer>
        </section>
      ) : (
        <form className="project-compose" onSubmit={(event) => void submit(event)} noValidate>
          <fieldset className="project-compose-fields" disabled={busy}>
            <legend className="sr-only">Project details</legend>
            <div className="project-compose-body">
              {lookupError && (
                <div className="project-compose-lookup-error" role="alert">
                  <span>{lookupError}</span>
                  {onRetryLookups && <button type="button" className="text-link" disabled={lookupsLoading} onClick={onRetryLookups}>{lookupsLoading ? 'Retrying…' : 'Try again'}</button>}
                </div>
              )}

              <div className="form-grid">
                <label className="form-field wide" htmlFor={`${formId}-name`}>
                  <span className="field-label">Project name <b aria-hidden="true">*</b></span>
                  <input
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
                  {errors.name && <span className="field-error" id={`${formId}-name-error`}>{errors.name}</span>}
                </label>

                {singleClientMode ? (
                  <div className="form-field wide">
                    <span className="field-label">Client</span>
                    <p className="project-static-field"><Icon name="building" size={15} />{selectedClient?.name ?? 'No client configured'}</p>
                    {errors.client_id && <span className="field-error">{errors.client_id}</span>}
                  </div>
                ) : (
                  <div className="form-field wide">
                    <label className="field-label" htmlFor={`${formId}-client`}>Client <b aria-hidden="true">*</b></label>
                    <Select
                      id={`${formId}-client`}
                      label="Client"
                      required
                      value={draft.client_id}
                      options={clientOptions}
                      placeholder={lookupsLoading && clients.length === 0 ? 'Loading clients…' : 'Select a client…'}
                      disabled={lookupsLoading && clients.length === 0}
                      invalid={Boolean(errors.client_id)}
                      describedBy={errors.client_id ? `${formId}-client-error` : undefined}
                      onChange={(next) => setField('client_id', next)}
                    />
                    {errors.client_id && <span className="field-error" id={`${formId}-client-error`}>{errors.client_id}</span>}
                  </div>
                )}

                <label className="form-field wide" htmlFor={`${formId}-description`}>
                  <span className="field-label">Description <small>Optional</small></span>
                  <textarea
                    id={`${formId}-description`}
                    value={draft.description}
                    placeholder="What is the team delivering?"
                    onChange={(event) => setField('description', event.target.value)}
                  />
                </label>
              </div>

              <p className="project-compose-divider"><span>Planning · all optional</span></p>

              <div className="form-grid">
                <div className="form-field">
                  <label className="field-label" htmlFor={`${formId}-manager`}>Project manager</label>
                  <Select
                    id={`${formId}-manager`}
                    label="Project manager"
                    value={draft.manager_user_id}
                    options={managerOptions}
                    placeholder={lookupsLoading && managers.length === 0 ? 'Loading team…' : 'Unassigned'}
                    disabled={lookupsLoading && managers.length === 0}
                    onChange={(next) => setField('manager_user_id', next)}
                  />
                </div>

                <div className="form-field">
                  <label className="field-label" htmlFor={`${formId}-status`}>Starting status</label>
                  <Select
                    id={`${formId}-status`}
                    label="Starting status"
                    value={draft.status_value_id}
                    options={statusOptions}
                    placeholder={lookupsLoading && statuses.length === 0 ? 'Loading statuses…' : 'Choose later'}
                    disabled={lookupsLoading && statuses.length === 0}
                    onChange={(next) => setField('status_value_id', next)}
                  />
                </div>

                <div className="form-field">
                  <label className="field-label" htmlFor={`${formId}-start-date`}>Start date</label>
                  <DatePicker
                    id={`${formId}-start-date`}
                    label="Start date"
                    value={draft.start_date}
                    placeholder="No start date"
                    onChange={(next) => setField('start_date', next)}
                  />
                </div>

                <div className="form-field">
                  <label className="field-label" htmlFor={`${formId}-due-date`}>Due date</label>
                  <DatePicker
                    id={`${formId}-due-date`}
                    label="Due date"
                    value={draft.due_date}
                    min={draft.start_date || undefined}
                    placeholder="No due date"
                    invalid={Boolean(errors.due_date)}
                    describedBy={errors.due_date ? `${formId}-due-date-error` : undefined}
                    onChange={(next) => setField('due_date', next)}
                  />
                  {errors.due_date && <span className="field-error" id={`${formId}-due-date-error`}>{errors.due_date}</span>}
                </div>
              </div>

              {error && <div className="form-error" role="alert">{error}</div>}
            </div>
          </fieldset>

          <footer className="project-compose-footer">
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={requestClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || (lookupsLoading && clients.length === 0 && !singleClientMode)}>
              {busy ? 'Creating…' : 'Create project'}
            </button>
          </footer>
        </form>
      )}
    </Modal>
  )
}
