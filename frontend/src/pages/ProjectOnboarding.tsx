import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { Modal, StatusBadge } from '../components/ui'
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

interface ProjectStep {
  label: string
  eyebrow: string
  title: string
  description: string
  note: string
  sectionTitle: string
  sectionDescription: string
  badge: string
  icon: IconName
}

const steps: ProjectStep[] = [
  {
    label: 'Basics',
    eyebrow: 'Foundation',
    title: 'Give the work a clear home',
    description: 'Name the project, choose its client, and capture the short version of what the team is delivering.',
    note: 'You’ll set ownership and dates next.',
    sectionTitle: 'Project essentials',
    sectionDescription: 'These details become the shared context across tasks and updates.',
    badge: '2 required',
    icon: 'briefcase',
  },
  {
    label: 'Plan',
    eyebrow: 'Delivery plan',
    title: 'Set the team up to deliver',
    description: 'Choose a project manager, starting status, and the dates your team should work toward.',
    note: 'Everything on this step is optional.',
    sectionTitle: 'Ownership and timing',
    sectionDescription: 'Give the work a clear lead and a useful shape. Anything undecided can wait.',
    badge: 'All optional',
    icon: 'user',
  },
  {
    label: 'Review',
    eyebrow: 'Final check',
    title: 'One last look',
    description: 'Check the details below. Nothing is created until you choose Create project.',
    note: 'You can still go back without losing anything.',
    sectionTitle: 'Ready for the workspace',
    sectionDescription: 'Make sure the team will recognize this project at a glance.',
    badge: 'Ready to create',
    icon: 'check',
  },
]

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

function formattedDate(value: string) {
  if (!value) return 'Not set'
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
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
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<ProjectDraft>(() => initialDraft(singleClientId))
  const [errors, setErrors] = useState<ProjectDraftErrors>({})
  const [created, setCreated] = useState<Project | null>(null)
  const [returnToReview, setReturnToReview] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const clientRef = useRef<HTMLSelectElement>(null)
  const clientRequirementRef = useRef<HTMLDivElement>(null)
  const dueDateRef = useRef<HTMLInputElement>(null)
  const stepHeadingRef = useRef<HTMLHeadingElement>(null)

  const selectedClient = useMemo(() => {
    if (singleClientMode) return singleClient ?? clients.find((client) => String(client.id) === String(singleClientId)) ?? null
    return clients.find((client) => String(client.id) === draft.client_id) ?? null
  }, [clients, draft.client_id, singleClient, singleClientId, singleClientMode])
  const selectedManager = managers.find((manager) => String(manager.id) === draft.manager_user_id)
  const selectedStatus = statuses.find((status) => String(status.id) === draft.status_value_id)
  const currentStep = steps[step]
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

  const focusStepHeading = () => window.requestAnimationFrame(() => stepHeadingRef.current?.focus())

  const goToStep = (next: number) => {
    setErrors({})
    setStep(next)
    focusStepHeading()
  }

  const openCompletedStep = (next: number) => {
    setReturnToReview(step === 2)
    goToStep(next)
  }

  const validateBasics = () => {
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
          : clients.length
            ? 'Choose the client that owns this project.'
            : 'Add an active client before setting up a project.'
    }

    setErrors(nextErrors)
    if (nextErrors.name) nameRef.current?.focus()
    else if (nextErrors.client_id) (clientRef.current ?? clientRequirementRef.current)?.focus()
    return Object.keys(nextErrors).length === 0
  }

  const validatePlan = () => {
    const nextErrors: ProjectDraftErrors = {}
    if (draft.start_date && draft.due_date && draft.due_date < draft.start_date) {
      nextErrors.due_date = 'Due date must be on or after the start date.'
    }
    setErrors(nextErrors)
    if (nextErrors.due_date) dueDateRef.current?.focus()
    return Object.keys(nextErrors).length === 0
  }

  const continueSetup = () => {
    if (step === 0 && validateBasics()) {
      const next = returnToReview ? 2 : 1
      if (next === 2) setReturnToReview(false)
      goToStep(next)
    } else if (step === 1 && validatePlan()) {
      setReturnToReview(false)
      goToStep(2)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (step < 2) {
      continueSetup()
      return
    }
    if (!validateBasics()) {
      setStep(0)
      window.requestAnimationFrame(() => {
        if (!draft.name.trim()) nameRef.current?.focus()
        else (clientRef.current ?? clientRequirementRef.current)?.focus()
      })
      return
    }
    if (!validatePlan()) {
      setStep(1)
      window.requestAnimationFrame(() => dueDateRef.current?.focus())
      return
    }

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
      window.requestAnimationFrame(() => stepHeadingRef.current?.focus())
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
    if (!created && isDirty && !window.confirm('Discard this project setup?')) return
    onClose()
  }

  const openClientSetup = () => {
    if (busy || !canCreateClients || !onOpenClients) return
    if (isDirty && !window.confirm('Your project setup will not be saved. Go add a client?')) return
    onOpenClients()
  }

  const back = () => {
    setReturnToReview(false)
    goToStep(step - 1)
  }

  const primaryLabel = returnToReview
    ? 'Back to review'
    : step === 0
      ? 'Continue to plan'
      : step === 1
        ? 'Review project'
        : busy
          ? 'Creating…'
          : 'Create project'

  return (
    <Modal
      open
      onClose={requestClose}
      closeDisabled={busy}
      title={created ? 'Project ready' : 'Set up a project'}
      description={created ? 'Everything is in place for the team.' : 'Turn a new stream of work into a clear starting point.'}
      size="lg"
      className="project-onboarding-modal"
    >
      {created ? (
        <section className="onboarding-success">
          <span className="onboarding-success-icon"><Icon name="check" size={28} /></span>
          <span className="eyebrow">Project ready</span>
          <h3 ref={stepHeadingRef} tabIndex={-1}>{created.name} is ready for the team</h3>
          <p>{canOpenTasks ? 'The project is in Kernix. Add its first tasks when you’re ready.' : 'The project is in Kernix and has been added to your project list.'}</p>
          <div className="onboarding-success-summary">
            <span>Client <strong>{created.client?.name ?? selectedClient?.name ?? 'Workspace client'}</strong></span>
            <span>Project manager <strong>{created.manager ? displayName(created.manager) : selectedManager ? displayName(selectedManager) : 'Unassigned'}</strong></span>
          </div>
          {error && <div className="onboarding-success-notice" role="status"><Icon name="check" size={15} /><span>{error}</span></div>}
          <footer className="onboarding-success-actions">
            <button type="button" className="btn btn-quiet" onClick={onClose}>Back to projects</button>
            {canOpenTasks && onOpenTasks && <button type="button" className="btn btn-primary" onClick={() => onOpenTasks(created)}><Icon name="task" size={16} /> Open project tasks</button>}
          </footer>
        </section>
      ) : (
        <form className="project-onboarding" onSubmit={(event) => void submit(event)} noValidate>
          <div className="onboarding-progress">
            <div className="onboarding-progress-copy">
              <span>Guided setup</span>
              <strong>Step {step + 1} of {steps.length}</strong>
            </div>
            <ol aria-label="Project setup progress">
              {steps.map((item, index) => (
                <li className={`${index === step ? 'is-current' : ''} ${index < step ? 'is-complete' : ''}`} aria-current={index === step ? 'step' : undefined} key={item.label}>
                  <button type="button" disabled={busy || index >= step} onClick={() => openCompletedStep(index)} aria-label={`${item.label}${index < step ? ', complete' : index === step ? ', current step' : ', upcoming'}`}>
                    <span>{index < step ? <Icon name="check" size={13} /> : index + 1}</span>
                    {item.label}
                  </button>
                </li>
              ))}
            </ol>
            <span className="sr-only" role="progressbar" aria-label="Project setup step" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={step + 1} aria-valuetext={`Step ${step + 1} of ${steps.length}: ${currentStep.label}`} />
          </div>

          <fieldset className="onboarding-stage" disabled={busy}>
            <legend className="sr-only">{currentStep.title}</legend>
            <aside className="onboarding-guide onboarding-step-enter" key={`guide-${step}`}>
              <span className="onboarding-guide-icon"><Icon name={currentStep.icon} size={21} /></span>
              <span className="eyebrow">{currentStep.eyebrow}</span>
              <h3 ref={stepHeadingRef} tabIndex={-1} data-autofocus>{currentStep.title}</h3>
              <p>{currentStep.description}</p>
              <div className="onboarding-guide-note"><Icon name="check" size={15} /><span>{currentStep.note}</span></div>
            </aside>

            <div className="onboarding-fields onboarding-step-enter" key={`fields-${step}`}>
              <header className="onboarding-fields-intro">
                <div>
                  <h4>{currentStep.sectionTitle}</h4>
                  <p>{currentStep.sectionDescription}</p>
                </div>
                <span>{currentStep.badge}</span>
              </header>

              {lookupError && (
                <div className="form-error onboarding-lookup-error" role="alert">
                  <span>{lookupError}</span>
                  {onRetryLookups && <button type="button" className="text-link" disabled={lookupsLoading} onClick={onRetryLookups}>{lookupsLoading ? 'Retrying…' : 'Try again'}</button>}
                </div>
              )}
              {step === 0 && (
                <div className="form-grid">
                  <label className="form-field wide" htmlFor={`${formId}-name`}>
                    <span className="field-label">Project name <b aria-hidden="true">*</b></span>
                    <input
                      id={`${formId}-name`}
                      ref={nameRef}
                      required
                      value={draft.name}
                      maxLength={191}
                      aria-invalid={Boolean(errors.name)}
                      aria-describedby={errors.name ? `${formId}-name-error` : undefined}
                      placeholder="Website launch"
                      onChange={(event) => setField('name', event.target.value)}
                    />
                    {errors.name && <span className="field-error" id={`${formId}-name-error`}>{errors.name}</span>}
                  </label>

                  {singleClientMode ? (
                    <div className="onboarding-client-context wide">
                      <span className="onboarding-context-icon"><Icon name="building" size={18} /></span>
                      <span><small>Workspace client</small><strong>{selectedClient?.name ?? 'No client configured'}</strong></span>
                      {errors.client_id && <span className="field-error">{errors.client_id}</span>}
                    </div>
                  ) : needsClient ? (
                    <div className="onboarding-prerequisite wide" ref={clientRequirementRef} tabIndex={-1}>
                      <span className="onboarding-context-icon"><Icon name="building" size={18} /></span>
                      <span>
                        <strong>A client comes first</strong>
                        <small>{canCreateClients ? 'Add your first client, then come back to give their work a home.' : 'Ask an administrator to add a client before setting up this project.'}</small>
                      </span>
                      {errors.client_id && <span className="field-error">{errors.client_id}</span>}
                    </div>
                  ) : (
                    <label className="form-field wide" htmlFor={`${formId}-client`}>
                      <span className="field-label">Client <b aria-hidden="true">*</b></span>
                      <select
                        id={`${formId}-client`}
                        ref={clientRef}
                        required
                        value={draft.client_id}
                        disabled={lookupsLoading && clients.length === 0}
                        aria-invalid={Boolean(errors.client_id)}
                        aria-describedby={errors.client_id ? `${formId}-client-error` : undefined}
                        onChange={(event) => setField('client_id', event.target.value)}
                      >
                        <option value="">{lookupsLoading && clients.length === 0 ? 'Loading clients…' : 'Select a client…'}</option>
                        {clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}
                      </select>
                      <span className="field-help">The client provides context for this project and its tasks.</span>
                      {errors.client_id && <span className="field-error" id={`${formId}-client-error`}>{errors.client_id}</span>}
                    </label>
                  )}

                  <label className="form-field wide" htmlFor={`${formId}-description`}>
                    <span className="field-label">Short description <small>Optional</small></span>
                    <textarea id={`${formId}-description`} value={draft.description} placeholder="What is the team delivering?" onChange={(event) => setField('description', event.target.value)} />
                    <span className="field-help">A sentence or two is enough to orient everyone.</span>
                  </label>
                </div>
              )}

              {step === 1 && (
                <div className="form-grid">
                  <label className="form-field" htmlFor={`${formId}-manager`}>
                    <span className="field-label">Project manager</span>
                    <select id={`${formId}-manager`} value={draft.manager_user_id} disabled={lookupsLoading && managers.length === 0} onChange={(event) => setField('manager_user_id', event.target.value)}>
                      <option value="">{lookupsLoading && managers.length === 0 ? 'Loading team…' : 'Unassigned'}</option>
                      {managers.map((manager) => <option value={manager.id} key={manager.id}>{displayName(manager)}</option>)}
                    </select>
                    <span className="field-help">The person accountable for keeping delivery moving.</span>
                  </label>

                  <label className="form-field" htmlFor={`${formId}-status`}>
                    <span className="field-label">Starting status</span>
                    <select id={`${formId}-status`} value={draft.status_value_id} disabled={lookupsLoading && statuses.length === 0} onChange={(event) => setField('status_value_id', event.target.value)}>
                      <option value="">{lookupsLoading && statuses.length === 0 ? 'Loading statuses…' : 'Choose later'}</option>
                      {statuses.map((status) => <option value={status.id} key={status.id}>{status.label}</option>)}
                    </select>
                    <span className="field-help">Choose the status that best matches the project’s starting point.</span>
                  </label>

                  <label className="form-field" htmlFor={`${formId}-start-date`}>
                    <span className="field-label">Start date</span>
                    <input id={`${formId}-start-date`} type="date" value={draft.start_date} onChange={(event) => setField('start_date', event.target.value)} />
                  </label>

                  <label className="form-field" htmlFor={`${formId}-due-date`}>
                    <span className="field-label">Due date</span>
                    <input
                      id={`${formId}-due-date`}
                      ref={dueDateRef}
                      type="date"
                      min={draft.start_date || undefined}
                      value={draft.due_date}
                      aria-invalid={Boolean(errors.due_date)}
                      aria-describedby={errors.due_date ? `${formId}-due-date-error` : undefined}
                      onChange={(event) => setField('due_date', event.target.value)}
                    />
                    {errors.due_date && <span className="field-error" id={`${formId}-due-date-error`}>{errors.due_date}</span>}
                  </label>
                </div>
              )}

              {step === 2 && (
                <div className="onboarding-review">
                  <section className="onboarding-review-card">
                    <header>
                      <div className="onboarding-review-heading"><span><Icon name="briefcase" size={16} /></span><div><small>Basics</small><h4>Project</h4></div></div>
                      <button type="button" className="text-link" onClick={() => openCompletedStep(0)}>Edit basics</button>
                    </header>
                    <dl>
                      <div><dt>Name</dt><dd>{draft.name.trim()}</dd></div>
                      <div><dt>Client</dt><dd>{selectedClient?.name ?? 'Workspace client'}</dd></div>
                      <div className="wide"><dt>Description</dt><dd>{draft.description.trim() || 'Not added'}</dd></div>
                    </dl>
                  </section>
                  <section className="onboarding-review-card">
                    <header>
                      <div className="onboarding-review-heading"><span><Icon name="clock" size={16} /></span><div><small>Plan</small><h4>Delivery</h4></div></div>
                      <button type="button" className="text-link" onClick={() => openCompletedStep(1)}>Edit plan</button>
                    </header>
                    <dl>
                      <div><dt>Project manager</dt><dd>{selectedManager ? displayName(selectedManager) : 'Unassigned'}</dd></div>
                      <div><dt>Status</dt><dd>{selectedStatus ? <StatusBadge value={selectedStatus} /> : 'Not set'}</dd></div>
                      <div><dt>Start date</dt><dd>{formattedDate(draft.start_date)}</dd></div>
                      <div><dt>Due date</dt><dd>{formattedDate(draft.due_date)}</dd></div>
                    </dl>
                  </section>
                </div>
              )}

              {Object.keys(errors).length > 0 && <div className="form-error" role="alert">Check the highlighted information before continuing.</div>}
              {error && <div className="form-error" role="alert">{error}</div>}
            </div>
          </fieldset>

          <footer className={`form-footer onboarding-footer onboarding-footer-step-${step}`}>
            <button type="button" className="btn btn-quiet onboarding-cancel" disabled={busy} onClick={requestClose}>Cancel</button>
            {step > 0 && <button type="button" className="btn btn-quiet" disabled={busy} onClick={back}><Icon name="arrow-left" size={16} /> Back</button>}
            {needsClient ? (
              <button type="button" className="btn btn-primary" disabled={busy || !canCreateClients || !onOpenClients} onClick={openClientSetup}>
                {canCreateClients && onOpenClients ? <><Icon name="plus" size={16} /> Add first client</> : 'Client required'}
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={busy || (step === 0 && lookupsLoading && clients.length === 0 && !singleClientMode)}>{primaryLabel}</button>
            )}
          </footer>
        </form>
      )}
    </Modal>
  )
}
