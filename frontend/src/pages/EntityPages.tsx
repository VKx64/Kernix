import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useWorkspace } from '../auth/WorkspaceProvider'
import { Icon } from '../components/Icon'
import {
  DataTable,
  EmptyState,
  EntityForm,
  ErrorBanner,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  SearchToolbar,
  StatusBadge,
  type Column,
  type FormFieldSpec,
} from '../components/ui'
import { api, displayName, normalizePage, unwrap } from '../lib/api'
import { isAdministrator, useCan } from '../lib/permissions'
import { lockedPermissions, normalizePermissionCatalog, withRequiredPermissions, type PermissionGroup } from '../lib/rolePermissions'
import { useCollection } from '../lib/useCollection'
import { InviteUserModal } from './InviteUserModal'
import { ProjectOnboarding } from './ProjectOnboarding'
import type {
  ApiEnvelope,
  Client,
  Contact,
  CustomField,
  EntityId,
  FieldValue,
  FormPayload,
  Paginated,
  Project,
  Role,
  User,
  UserSummary,
} from '../types/api'

function value(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key]
  return undefined
}

function localDate(raw?: string | null) {
  return raw ? new Date(raw).toLocaleDateString() : '—'
}

function RowActions({ onEdit, onDelete, onRestore, editLabel = 'Edit', removeLabel = 'Archive' }: { onEdit?: () => void; onDelete?: () => void; onRestore?: () => void; editLabel?: string; removeLabel?: string }) {
  if (!onEdit && !onDelete && !onRestore) return <span className="muted">—</span>
  return (
    <div className="row-actions" onClick={(event) => event.stopPropagation()}>
      {onEdit && <button className="icon-button" title={editLabel} aria-label={editLabel} onClick={onEdit}><Icon name="edit" size={16} /></button>}
      {onRestore && <button className="icon-button" title="Restore" aria-label="Restore" onClick={onRestore}><Icon name="play" size={16} /></button>}
      {onDelete && <button className="icon-button danger" title={removeLabel} aria-label={removeLabel} onClick={onDelete}><Icon name="trash" size={16} /></button>}
    </div>
  )
}

interface EntityBootstrapLookups {
  clients?: Client[]
  coworkers?: UserSummary[]
  roles?: Role[]
  fields?: CustomField[]
}

function useLookups(enabled = true) {
  const can = useCan()
  const [clients, setClients] = useState<Client[]>([])
  const [users, setUsers] = useState<UserSummary[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [fields, setFields] = useState<CustomField[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [requestKey, setRequestKey] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let active = true
    setLoading(true)
    setError('')
    void Promise.allSettled([
      api.get<ApiEnvelope<EntityBootstrapLookups> | EntityBootstrapLookups>('/api/bootstrap'),
      can('clients.view') ? api.get<Paginated<Client> | ApiEnvelope<Paginated<Client>> | Client[]>('/api/clients', { per_page: 100 }) : Promise.resolve(null),
      can('users.view') ? api.get<Paginated<UserSummary> | ApiEnvelope<Paginated<UserSummary>> | UserSummary[]>('/api/users', { per_page: 100 }) : Promise.resolve(null),
      can('roles.view') ? api.get<Paginated<Role> | ApiEnvelope<Paginated<Role>> | Role[]>('/api/roles', { per_page: 100 }) : Promise.resolve(null),
      can('fields.view') ? api.get<Paginated<CustomField> | ApiEnvelope<Paginated<CustomField>> | CustomField[]>('/api/fields', { per_page: 100 }) : Promise.resolve(null),
    ]).then(([bootstrapResult, clientResult, userResult, roleResult, fieldResult]) => {
      if (!active) return
      const bootstrap = bootstrapResult.status === 'fulfilled' ? unwrap(bootstrapResult.value) : {}
      setClients(bootstrap.clients ?? (clientResult.status === 'fulfilled' && clientResult.value ? normalizePage(clientResult.value).data : []))
      setUsers(bootstrap.coworkers ?? (userResult.status === 'fulfilled' && userResult.value ? normalizePage(userResult.value).data : []))
      setRoles(bootstrap.roles ?? (roleResult.status === 'fulfilled' && roleResult.value ? normalizePage(roleResult.value).data : []))
      setFields(bootstrap.fields ?? (fieldResult.status === 'fulfilled' && fieldResult.value ? normalizePage(fieldResult.value).data : []))
      if (bootstrapResult.status === 'rejected') setError('Some project setup options could not be loaded.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [can, enabled, requestKey])

  return { clients, users, roles, fields, loading, error, retry: () => setRequestKey((current) => current + 1) }
}

function statusValues(fields: CustomField[], key: string) {
  return fields.find((field) => (field.key ?? (field as unknown as { key_name?: string }).key_name) === key)?.values ?? []
}

function EntityModal({
  open,
  title,
  fields,
  initialValues,
  busy,
  error,
  onClose,
  onSave,
}: {
  open: boolean
  title: string
  fields: FormFieldSpec[]
  initialValues?: FormPayload
  busy: boolean
  error: string
  onClose: () => void
  onSave: (values: FormPayload) => Promise<void>
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" closeDisabled={busy}>
      <EntityForm fields={fields} initialValues={initialValues} busy={busy} error={error} onCancel={onClose} onSubmit={onSave} />
    </Modal>
  )
}

function useEntityMutation<T extends { id: EntityId }>(path: string, reload: () => Promise<void>, removal: 'archive' | 'delete' = 'delete') {
  const [selected, setSelected] = useState<T | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = () => { setSelected(null); setError(''); setOpen(true) }
  const edit = (record: T) => { setSelected(record); setError(''); setOpen(true) }
  const close = () => { if (!busy) setOpen(false) }
  const createRecord = async (payload: FormPayload, label = 'record'): Promise<T | null> => {
    setBusy(true)
    setError('')
    try {
      const response = await api.post<ApiEnvelope<T> | T>(path, payload as Record<string, unknown>)
      const record = unwrap(response)
      try {
        await reload()
      } catch {
        setError(`The ${label} was created, but the list could not be refreshed.`)
      }
      return record
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save this record.')
      return null
    } finally {
      setBusy(false)
    }
  }
  const save = async (payload: FormPayload) => {
    setBusy(true)
    setError('')
    try {
      if (selected) await api.patch(`${path}/${selected.id}`, payload as Record<string, unknown>)
      else await api.post(path, payload as Record<string, unknown>)
      setOpen(false)
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save this record.')
    } finally {
      setBusy(false)
    }
  }
  const archive = async (record: T) => {
    const verb = removal === 'archive' ? 'Archive' : 'Delete'
    if (!window.confirm(`${verb} this record?${removal === 'archive' ? ' It will disappear from active views.' : ' This cannot be undone.'}`)) return
    try {
      if (removal === 'archive') await api.post(`${path}/${record.id}/archive`)
      else await api.delete(`${path}/${record.id}`)
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to archive this record.')
    }
  }

  const restore = async (record: T) => {
    if (!window.confirm('Restore this record to active views?')) return
    setError('')
    try {
      await api.post(`${path}/${record.id}/restore`)
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to restore this record.')
    }
  }

  return { selected, open, busy, error, setError, create, edit, close, createRecord, save, archive, restore }
}

export function ProjectsPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [archived, setArchived] = useState(false)
  const navigate = useNavigate()
  const can = useCan()
  const { singleClientMode, settings } = useWorkspace()
  const collection = useCollection<Project>('/api/projects', { search, page, filters: { archived: archived ? 'only' : undefined } })
  const mutation = useEntityMutation<Project>('/api/projects', collection.reload, 'archive')
  const lookups = useLookups(mutation.open)
  const statuses = statusValues(lookups.fields, 'project_status')
  const singleClientId = value(settings as Record<string, unknown>, 'singleClientId', 'single_client_id')
  const singleClient = value(settings as Record<string, unknown>, 'singleClient', 'single_client') as Client | null | undefined

  const fields: FormFieldSpec[] = [
    { name: 'name', label: 'Project name', required: true, wide: true },
    ...(!singleClientMode ? [{ name: 'client_id', label: 'Client', type: 'select' as const, required: true, options: lookups.clients.map((client) => ({ label: client.name, value: client.id })) }] : []),
    { name: 'manager_user_id', label: 'Project manager', type: 'select', options: lookups.users.map((user) => ({ label: displayName(user), value: user.id })) },
    { name: 'status_value_id', label: 'Status', type: 'select', options: statuses.map((status) => ({ label: status.label, value: status.id })), disabled: lookups.loading && statuses.length === 0, help: lookups.loading && statuses.length === 0 ? 'Loading project statuses…' : undefined },
    { name: 'start_date', label: 'Start date', type: 'date' },
    { name: 'due_date', label: 'Due date', type: 'date' },
    { name: 'description', label: 'Description', type: 'textarea', wide: true },
    { name: 'ai_task_creation_enabled', label: 'Allow AI task creation', type: 'checkbox', wide: true, help: 'People with the AI task-creation permission can turn a plain-language request into one or more tasks.' },
    ...(can('projects.manage_ai_memory') ? [{ name: 'ai_memory_enabled', label: 'Learn project lessons when tasks are completed', type: 'checkbox' as const, wide: true, help: 'Lessons remain pending until the current project manager approves them.' }] : []),
    { name: 'ai_estimate_review_enabled', label: 'Let the AI project manager decide time-extension requests', type: 'checkbox', wide: true, help: 'Requires configured OpenRouter settings and an eligible human project manager for oversight.' },
    { name: 'ai_estimate_review_rules', label: 'Additional AI review rules', type: 'textarea', wide: true, help: 'Optional project rules can make review stricter but cannot weaken the baseline rubric.' },
  ]

  const initial: FormPayload | undefined = mutation.selected ? {
    name: mutation.selected.name,
    client_id: mutation.selected.clientId ?? mutation.selected.client_id ?? mutation.selected.client?.id,
    manager_user_id: mutation.selected.managerUserId ?? mutation.selected.manager_user_id ?? mutation.selected.manager?.id,
    status_value_id: mutation.selected.statusValue?.id ?? mutation.selected.status_value?.id,
    start_date: mutation.selected.startDate ?? mutation.selected.start_date ?? '',
    due_date: mutation.selected.dueDate ?? mutation.selected.due_date ?? '',
    description: mutation.selected.description ?? '',
    ai_estimate_review_enabled: mutation.selected.aiEstimateReviewEnabled ?? mutation.selected.ai_estimate_review_enabled ?? false,
    ai_estimate_review_rules: mutation.selected.aiEstimateReviewRules ?? mutation.selected.ai_estimate_review_rules ?? '',
    ai_task_creation_enabled: mutation.selected.aiTaskCreationEnabled ?? mutation.selected.ai_task_creation_enabled ?? false,
    ai_memory_enabled: mutation.selected.aiMemoryEnabled ?? mutation.selected.ai_memory_enabled ?? false,
  } : singleClientMode && singleClientId ? { client_id: singleClientId as string | number } : undefined

  const columns: Column<Project>[] = [
    { key: 'name', header: 'Project', render: (project) => <div className="primary-cell"><strong>{project.name}</strong><span>{project.client?.name ?? 'No client shown'}</span></div> },
    { key: 'status', header: 'Status', render: (project) => <StatusBadge value={project.statusValue ?? project.status_value ?? project.status} /> },
    { key: 'manager', header: 'Manager', render: (project) => displayName(project.manager) },
    { key: 'ai', header: 'AI features', render: (project) => <div className="project-ai-summary">{(project.aiTaskCreationEnabled ?? project.ai_task_creation_enabled) && <span>Task creation</span>}{(project.aiMemoryEnabled ?? project.ai_memory_enabled) && <span>Memory</span>}{(project.aiEstimateReviewEnabled ?? project.ai_estimate_review_enabled) && <span>Time review</span>}{!(project.aiTaskCreationEnabled ?? project.ai_task_creation_enabled) && !(project.aiMemoryEnabled ?? project.ai_memory_enabled) && !(project.aiEstimateReviewEnabled ?? project.ai_estimate_review_enabled) && 'Off'}</div> },
    { key: 'dates', header: 'Timeline', render: (project) => <span>{localDate(project.startDate ?? project.start_date)} → {localDate(project.dueDate ?? project.due_date)}</span> },
    { key: 'actions', header: '', className: 'action-column', render: (project) => <div className="row-actions" onClick={(event) => event.stopPropagation()}>{!archived && <Link className="icon-button memory-action" title="Project memory" aria-label={`Open ${project.name} memory`} to={`/projects/${project.id}/memory`}><Icon name="sparkles" size={16} />{Number(project.pendingMemoryCount ?? project.pending_memory_count ?? 0) > 0 && <b>{project.pendingMemoryCount ?? project.pending_memory_count}</b>}</Link>}<RowActions onEdit={!archived && can('projects.edit') ? () => mutation.edit(project) : undefined} onDelete={!archived && can('projects.archive') ? () => void mutation.archive(project) : undefined} onRestore={archived && can('projects.archive') ? () => void mutation.restore(project) : undefined} /></div> },
  ]

  return (
    <div>
      <PageHeader eyebrow="Delivery" title="Projects" description={`${collection.meta.total} ${archived ? 'archived' : 'active'} projects in your workspace.`} actions={!archived && can('projects.create') ? <button className="btn btn-primary" onClick={mutation.create}><Icon name="plus" size={16} /> New project</button> : undefined} />
      {(collection.error || (!mutation.open && mutation.error)) && <ErrorBanner message={collection.error || mutation.error} onRetry={() => void collection.reload()} />}
      <Panel className="list-panel">
        <SearchToolbar search={search} onSearch={(next) => { setSearch(next); setPage(1) }} placeholder="Search projects…"><label className={`filter-chip ${archived ? 'active' : ''}`}><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setPage(1) }} />Archived</label></SearchToolbar>
        <DataTable columns={columns} data={collection.data} rowKey={(project) => project.id} loading={collection.loading} emptyTitle={archived ? 'No archived projects' : 'No projects found'} emptyDescription={archived ? 'Archived projects will appear here.' : 'Create a project to organize the first stream of work.'} onRowClick={archived || !can('tasks.view') ? undefined : (project) => navigate(`/tasks?project_id=${project.id}`)} />
        <Pagination meta={collection.meta} onPage={setPage} />
      </Panel>
      {mutation.open && !mutation.selected && <ProjectOnboarding
        clients={lookups.clients}
        managers={lookups.users}
        statuses={statuses}
        lookupsLoading={lookups.loading}
        lookupError={lookups.error}
        singleClientMode={singleClientMode}
        singleClientId={singleClientId as EntityId | null | undefined}
        singleClient={singleClient}
        busy={mutation.busy}
        error={mutation.error}
        canOpenTasks={can('tasks.view')}
        canCreateClients={can('clients.create')}
        onClose={mutation.close}
        onClearError={() => mutation.setError('')}
        onRetryLookups={lookups.retry}
        onCreate={async (payload) => mutation.createRecord(singleClientMode && singleClientId ? { ...payload, client_id: singleClientId as string | number } : payload, 'project')}
        onOpenTasks={(project) => { mutation.close(); navigate(`/tasks?project_id=${project.id}`) }}
        onOpenClients={() => { mutation.close(); navigate('/clients') }}
      />}
      {mutation.open && mutation.selected && <EntityModal open title="Edit project" fields={fields} initialValues={initial} busy={mutation.busy} error={mutation.error} onClose={mutation.close} onSave={async (payload) => mutation.save(singleClientMode && singleClientId ? { ...payload, client_id: singleClientId as string | number } : payload)} />}
    </div>
  )
}

export function ClientsPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [archived, setArchived] = useState(false)
  const can = useCan()
  const { singleClientMode } = useWorkspace()
  const collection = useCollection<Client>('/api/clients', { search, page, filters: { archived: archived ? 'only' : undefined } })
  const mutation = useEntityMutation<Client>('/api/clients', collection.reload, 'archive')
  const lookups = useLookups(mutation.open)
  const statuses = statusValues(lookups.fields, 'client_status')

  if (singleClientMode) {
    return <div><PageHeader eyebrow="Workspace mode" title="Client directory is hidden" description="This workspace is scoped to one client, so client switching and client administration are removed from the interface." /><Panel><EmptyState title="Single-client mode is active" description="Projects and contacts remain available in their own sections." action={can('projects.view') ? <Link className="btn btn-primary" to="/projects">Open projects</Link> : undefined} /></Panel></div>
  }

  const fields: FormFieldSpec[] = [
    { name: 'name', label: 'Client name', required: true, wide: true },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'website', label: 'Website', type: 'url' },
    { name: 'timezone', label: 'Timezone', placeholder: 'Asia/Manila' },
    ...(statuses.length ? [{ name: 'status_value_id', label: 'Status', type: 'select' as const, options: statuses.map((status) => ({ label: status.label, value: status.id })) }] : []),
    { name: 'address', label: 'Address', type: 'textarea', wide: true },
    { name: 'city', label: 'City' },
    { name: 'province', label: 'Province / state' },
    { name: 'zip_code', label: 'Postal code' },
    { name: 'country', label: 'Country' },
    { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ]
  const initial: FormPayload | undefined = mutation.selected ? {
    name: mutation.selected.name,
    email: mutation.selected.email ?? '', phone: mutation.selected.phone ?? '', website: mutation.selected.website ?? '', timezone: mutation.selected.timezone ?? '',
    status_value_id: mutation.selected.statusValue?.id ?? mutation.selected.status_value?.id,
    address: mutation.selected.address ?? '', city: mutation.selected.city ?? '', province: mutation.selected.province ?? '',
    zip_code: mutation.selected.zipCode ?? mutation.selected.zip_code ?? '', country: mutation.selected.country ?? '', notes: mutation.selected.notes ?? '',
  } : undefined
  const columns: Column<Client>[] = [
    { key: 'name', header: 'Client', render: (client) => <div className="primary-cell"><strong>{client.name}</strong><span>{client.website || client.email || 'No contact detail'}</span></div> },
    { key: 'status', header: 'Status', render: (client) => <StatusBadge value={client.statusValue ?? client.status_value ?? client.status} /> },
    { key: 'location', header: 'Location', render: (client) => [client.city, client.country].filter(Boolean).join(', ') || '—' },
    { key: 'phone', header: 'Phone', render: (client) => client.phone || '—' },
    { key: 'actions', header: '', className: 'action-column', render: (client) => <RowActions onEdit={!archived && can('clients.edit') ? () => mutation.edit(client) : undefined} onDelete={!archived && can('clients.archive') ? () => void mutation.archive(client) : undefined} onRestore={archived && can('clients.archive') ? () => void mutation.restore(client) : undefined} /> },
  ]
  return <div><PageHeader eyebrow="Relationships" title="Clients" description={`${collection.meta.total} ${archived ? 'archived' : 'active'} client accounts.`} actions={!archived && can('clients.create') ? <button className="btn btn-primary" onClick={mutation.create}><Icon name="plus" size={16} /> New client</button> : undefined} />{(collection.error || mutation.error) && <ErrorBanner message={collection.error || mutation.error} />}<Panel className="list-panel"><SearchToolbar search={search} onSearch={(next) => { setSearch(next); setPage(1) }} placeholder="Search clients…"><label className={`filter-chip ${archived ? 'active' : ''}`}><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setPage(1) }} />Archived</label></SearchToolbar><DataTable columns={columns} data={collection.data} rowKey={(client) => client.id} loading={collection.loading} emptyTitle={archived ? 'No archived clients' : 'No clients yet'} emptyDescription={archived ? 'Archived clients will appear here.' : 'Add the first client account to begin.'} /><Pagination meta={collection.meta} onPage={setPage} /></Panel><EntityModal open={mutation.open} title={mutation.selected ? 'Edit client' : 'Create client'} fields={fields} initialValues={initial} busy={mutation.busy} error={mutation.error} onClose={mutation.close} onSave={mutation.save} /></div>
}

export function ContactsPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [archived, setArchived] = useState(false)
  const can = useCan()
  const { singleClientMode, settings } = useWorkspace()
  const collection = useCollection<Contact>('/api/contacts', { search, page, filters: { archived: archived ? 'only' : undefined } })
  const mutation = useEntityMutation<Contact>('/api/contacts', collection.reload, 'archive')
  const lookups = useLookups(mutation.open)
  const singleClientId = value(settings as Record<string, unknown>, 'singleClientId', 'single_client_id')
  const fields: FormFieldSpec[] = [
    ...(!singleClientMode ? [{ name: 'client_id', label: 'Client', type: 'select' as const, required: true, options: lookups.clients.map((client) => ({ label: client.name, value: client.id })) }] : []),
    { name: 'first_name', label: 'First name', required: true },
    { name: 'last_name', label: 'Last name' },
    { name: 'title', label: 'Title / role' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone_1', label: 'Primary phone', type: 'tel' },
    { name: 'phone_2', label: 'Alternate phone', type: 'tel' },
    { name: 'status', label: 'Status', type: 'select', options: [{ label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }] },
    { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ]
  const initial: FormPayload | undefined = mutation.selected ? {
    client_id: mutation.selected.clientId ?? mutation.selected.client_id ?? mutation.selected.client?.id,
    first_name: mutation.selected.firstName ?? mutation.selected.first_name ?? '', last_name: mutation.selected.lastName ?? mutation.selected.last_name ?? '',
    title: mutation.selected.title ?? '', email: mutation.selected.email ?? '', phone_1: mutation.selected.phone1 ?? mutation.selected.phone_1 ?? '', phone_2: mutation.selected.phone2 ?? mutation.selected.phone_2 ?? '', status: mutation.selected.status ?? 'active', notes: mutation.selected.notes ?? '',
  } : singleClientMode && singleClientId ? { client_id: singleClientId as string | number, status: 'active' } : { status: 'active' }
  const columns: Column<Contact>[] = [
    { key: 'name', header: 'Contact', render: (contact) => <div className="primary-cell"><strong>{contact.name || [contact.firstName ?? contact.first_name, contact.lastName ?? contact.last_name].filter(Boolean).join(' ')}</strong><span>{contact.title || contact.email || 'No title'}</span></div> },
    { key: 'client', header: 'Client', render: (contact) => contact.client?.name || '—' },
    { key: 'email', header: 'Email', render: (contact) => contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : '—' },
    { key: 'phone', header: 'Phone', render: (contact) => contact.phone1 ?? contact.phone_1 ?? '—' },
    { key: 'status', header: 'Status', render: (contact) => <StatusBadge value={contact.status} /> },
    { key: 'actions', header: '', className: 'action-column', render: (contact) => <RowActions onEdit={!archived && can('contacts.edit') ? () => mutation.edit(contact) : undefined} onDelete={!archived && can('contacts.archive') ? () => void mutation.archive(contact) : undefined} onRestore={archived && can('contacts.archive') ? () => void mutation.restore(contact) : undefined} /> },
  ]
  return <div><PageHeader eyebrow="Directory" title="Contacts" description={`${collection.meta.total} ${archived ? 'archived' : 'active'} client contacts.`} actions={!archived && can('contacts.create') ? <button className="btn btn-primary" onClick={mutation.create}><Icon name="plus" size={16} /> New contact</button> : undefined} />{(collection.error || mutation.error) && <ErrorBanner message={collection.error || mutation.error} />}<Panel className="list-panel"><SearchToolbar search={search} onSearch={(next) => { setSearch(next); setPage(1) }} placeholder="Search people, titles, or email…"><label className={`filter-chip ${archived ? 'active' : ''}`}><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setPage(1) }} />Archived</label></SearchToolbar><DataTable columns={columns} data={collection.data} rowKey={(contact) => contact.id} loading={collection.loading} emptyTitle={archived ? 'No archived contacts' : 'No contacts found'} emptyDescription={archived ? 'Archived contacts will appear here.' : 'Add the people your team collaborates with.'} /><Pagination meta={collection.meta} onPage={setPage} /></Panel><EntityModal open={mutation.open} title={mutation.selected ? 'Edit contact' : 'Create contact'} fields={fields} initialValues={initial} busy={mutation.busy} error={mutation.error} onClose={mutation.close} onSave={async (payload) => mutation.save(singleClientMode && singleClientId ? { ...payload, client_id: singleClientId as string | number } : payload)} /></div>
}

function SettingsNav() {
  const can = useCan()
  const links = [
    can('settings.view') ? { to: '/settings', label: 'System' } : null,
    can('users.view') ? { to: '/settings/users', label: 'Users' } : null,
    can('roles.view') ? { to: '/settings/roles', label: 'Roles' } : null,
    can('fields.view') ? { to: '/settings/fields', label: 'Fields' } : null,
  ].filter((item): item is { to: string; label: string } => Boolean(item))
  return <nav className="settings-nav" aria-label="Administration">{links.map((item) => <NavLink end={item.to === '/settings'} className={({ isActive }) => isActive ? 'active' : ''} to={item.to} key={item.to}>{item.label}</NavLink>)}</nav>
}

function isAdministratorAccount(user: User): boolean {
  return Boolean(user.isAdmin ?? user.is_admin) || ['admin', 'administrator'].includes(String(user.role?.key ?? user.role?.key_name ?? user.role?.name ?? '').toLowerCase())
}

export function UsersPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [archived, setArchived] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const can = useCan()
  const { user: currentUser } = useAuth()
  const isAdmin = isAdministrator(currentUser)
  const collection = useCollection<User>('/api/users', { search, page, filters: { archived: archived ? 'only' : undefined } })
  const mutation = useEntityMutation<User>('/api/users', collection.reload, 'archive')
  const lookups = useLookups(mutation.open)
  const departments = statusValues(lookups.fields, 'user_department')
  const selectedIsSelf = Boolean(mutation.selected && String(mutation.selected.id) === String(currentUser?.id))
  const currentRoleId = currentUser?.roleId ?? currentUser?.role_id ?? currentUser?.role?.id
  const ownRole = currentUser?.role ? { id: currentUser.role.id, name: currentUser.role.name } : null
  const roleOptions = isAdmin
    ? lookups.roles
    : [...lookups.roles.filter((role) => String(role.id) === String(currentRoleId)), ...(ownRole && !lookups.roles.some((role) => String(role.id) === String(ownRole.id)) ? [ownRole] : [])]
  const fields: FormFieldSpec[] = [
    { name: 'first_name', label: 'First name', required: true }, { name: 'last_name', label: 'Last name' },
    { name: 'username', label: 'Username', required: true },
    ...(isAdmin || !mutation.selected ? [{ name: 'role_id', label: 'Role', type: 'select' as const, required: true, disabled: !isAdmin, options: roleOptions.map((role) => ({ label: role.name, value: role.id })) }] : []),
    { name: 'imagic_email', label: 'Work email', type: 'email' },
    ...(isAdmin ? [{ name: 'personal_email', label: 'Personal email', type: 'email' as const }] : []),
    ...(departments.length ? [{ name: 'department_value_id', label: 'Department', type: 'select' as const, options: departments.map((department) => ({ label: department.label, value: department.id })) }] : []),
    { name: 'timezone', label: 'Timezone', placeholder: 'Asia/Manila' },
    ...(!selectedIsSelf || isAdmin ? [{ name: 'status', label: 'Status', type: 'select' as const, options: [{ label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }] }] : []),
    ...((isAdmin || !mutation.selected) ? [
      { name: 'password', label: mutation.selected ? 'New password (leave blank to keep)' : 'Temporary password', type: 'password' as const, required: !mutation.selected },
      { name: 'password_confirmation', label: 'Confirm password', type: 'password' as const, required: !mutation.selected },
    ] : []),
  ]
  const initial: FormPayload | undefined = mutation.selected ? {
    first_name: mutation.selected.firstName ?? mutation.selected.first_name ?? '', last_name: mutation.selected.lastName ?? mutation.selected.last_name ?? '', username: mutation.selected.username ?? '',
    role_id: mutation.selected.roleId ?? mutation.selected.role_id ?? mutation.selected.role?.id,
    imagic_email: mutation.selected.imagicEmail ?? mutation.selected.imagic_email ?? '', ...(isAdmin ? { personal_email: mutation.selected.personalEmail ?? mutation.selected.personal_email ?? '' } : {}),
    department_value_id: mutation.selected.departmentValueId ?? mutation.selected.department_value_id ?? mutation.selected.department?.id,
    timezone: mutation.selected.timezone ?? '', status: mutation.selected.status ?? 'active', password: '', password_confirmation: '',
  } : { role_id: isAdmin ? undefined : currentRoleId, status: 'active', timezone: 'Asia/Manila', password: '', password_confirmation: '' }
  const columns: Column<User>[] = [
    { key: 'name', header: 'User', render: (user) => <div className="primary-cell"><strong>{displayName(user)}</strong><span>@{user.username}</span></div> },
    { key: 'role', header: 'Role', render: (user) => user.role?.name ?? user.roles?.map((role) => typeof role === 'string' ? role : role.name).join(', ') ?? '—' },
    { key: 'department', header: 'Department', render: (user) => user.department?.label ?? '—' },
    { key: 'email', header: 'Email', render: (user) => user.imagicEmail ?? user.imagic_email ?? user.email ?? '—' },
    { key: 'status', header: 'Status', render: (user) => <StatusBadge value={user.status} /> },
    { key: 'actions', header: '', className: 'action-column', render: (user) => { const protectedTarget = !isAdmin && isAdministratorAccount(user); const self = String(user.id) === String(currentUser?.id); return <RowActions onEdit={!archived && can('users.edit') && !protectedTarget ? () => mutation.edit(user) : undefined} onDelete={!archived && can('users.archive') && !protectedTarget && !self ? () => void mutation.archive(user) : undefined} onRestore={archived && can('users.archive') && !protectedTarget ? () => void mutation.restore(user) : undefined} /> } },
  ]
  return <div><PageHeader eyebrow="Administration" title="Users" description={archived ? 'Archived accounts that can be restored.' : 'People who can sign in to this workspace.'} actions={!archived && (isAdmin || can('users.create')) ? <>{isAdmin && <button className="btn btn-primary" onClick={() => setInviteOpen(true)}><Icon name="send" size={16} /> Invite user</button>}{can('users.create') && <button className={`btn ${isAdmin ? 'btn-quiet' : 'btn-primary'}`} onClick={mutation.create}><Icon name="plus" size={16} /> New user</button>}</> : undefined} /><SettingsNav />{(collection.error || mutation.error) && <ErrorBanner message={collection.error || mutation.error} />}<Panel className="list-panel"><SearchToolbar search={search} onSearch={(next) => { setSearch(next); setPage(1) }} placeholder="Search users…"><label className={`filter-chip ${archived ? 'active' : ''}`}><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setPage(1) }} />Archived</label></SearchToolbar><DataTable columns={columns} data={collection.data} rowKey={(user) => user.id} loading={collection.loading} emptyTitle={archived ? 'No archived users' : 'No users found'} /><Pagination meta={collection.meta} onPage={setPage} /></Panel><EntityModal open={mutation.open} title={mutation.selected ? 'Edit user' : 'Create user'} fields={fields} initialValues={initial} busy={mutation.busy} error={mutation.error} onClose={mutation.close} onSave={async (payload) => { const clean = { ...payload }; if (!isAdmin) { delete clean.personal_email; if (mutation.selected) delete clean.role_id; if (selectedIsSelf) delete clean.status } if (mutation.selected && !isAdmin) { delete clean.password; delete clean.password_confirmation } else if (!clean.password) { delete clean.password; delete clean.password_confirmation } await mutation.save(clean) }} /><InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} /></div>
}

function roleIsSystem(role: Role | null): boolean {
  return Boolean(role?.isSystem ?? role?.is_system) || String(role?.key ?? role?.keyName ?? role?.key_name ?? '').toLowerCase() === 'admin'
}

export function RoleForm({ role, groups, busy, error, readOnly, onCancel, onSave }: { role: Role | null; groups: PermissionGroup[]; busy: boolean; error: string; readOnly: boolean; onCancel: () => void; onSave: (payload: FormPayload) => Promise<void> }) {
  const system = roleIsSystem(role)
  const allPermissions = groups.flatMap((group) => group.permissions.map((permission) => permission.key))
  const [name, setName] = useState(role?.name ?? '')
  const [permissions, setPermissions] = useState<string[]>(() => system ? allPermissions : readOnly ? role?.permissions ?? [] : withRequiredPermissions(role?.permissions ?? [], groups))
  const locked = readOnly ? new Set<string>() : lockedPermissions(permissions, groups)
  const submit = (event: FormEvent) => { event.preventDefault(); if (!readOnly) void onSave({ name, permissions: withRequiredPermissions(permissions, groups) }) }
  const toggle = (key: string, checked: boolean) => {
    setPermissions((old) => checked ? withRequiredPermissions([...old, key], groups) : old.filter((item) => item !== key))
  }
  return <form className="entity-form role-form" onSubmit={submit}>
    {system && <div className="system-role-callout"><Icon name="role" size={18} /><div><strong>System role · Full access</strong><span>Administrator access is implicit and cannot be changed.</span></div></div>}
    <label className="form-field wide"><span className="field-label">Role name *</span><input value={name} onChange={(event) => setName(event.target.value)} required disabled={readOnly || system} /></label>
    <div className="permission-grid">{groups.map((group) => <fieldset key={group.key}><legend>{group.label}</legend>{group.permissions.map((permission) => { const dependencyLocked = locked.has(permission.key); return <label className={dependencyLocked ? 'permission-locked' : ''} key={permission.key} title={permission.description}><input type="checkbox" checked={system || permissions.includes(permission.key)} disabled={readOnly || system || dependencyLocked} onChange={(event) => toggle(permission.key, event.target.checked)} /><span><b>{permission.label}</b>{permission.description && <small>{permission.description}</small>}{dependencyLocked && !system && <em>Required</em>}</span></label> })}</fieldset>)}</div>
    {!groups.length && <div className="empty-inline">Permission metadata is unavailable. Reload the page before editing this role.</div>}
    {error && <div className="form-error">{error}</div>}
    <footer className="form-footer"><button type="button" className="btn btn-quiet" onClick={onCancel}>{readOnly ? 'Close' : 'Cancel'}</button>{!readOnly && <button className="btn btn-primary" disabled={busy || !groups.length}>{busy ? 'Saving…' : 'Save role'}</button>}</footer>
  </form>
}

export function RolesPage() {
  const { user } = useAuth()
  const isAdmin = isAdministrator(user)
  const collection = useCollection<Role>('/api/roles')
  const [groups, setGroups] = useState<PermissionGroup[]>([])
  const [catalogError, setCatalogError] = useState('')
  const [selected, setSelected] = useState<Role | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let active = true
    void api.get('/api/roles/permissions').then((response) => {
      if (!active) return
      const next = normalizePermissionCatalog(response)
      setGroups(next)
      if (!next.length) setCatalogError('The server did not return a permission catalog.')
    }).catch((reason) => { if (active) setCatalogError(reason instanceof Error ? reason.message : 'Unable to load the permission catalog.') })
    return () => { active = false }
  }, [])

  const show = (role: Role, edit = false) => { setSelected(role); setEditing(edit && isAdmin && !roleIsSystem(role)); setMutationError(''); setSuccess(''); setOpen(true) }
  const create = () => { setSelected(null); setEditing(true); setMutationError(''); setSuccess(''); setOpen(true) }
  const close = () => { if (!busy) setOpen(false) }
  const save = async (payload: FormPayload) => {
    const assignedUsers = Number(selected?.affectedUsersCount ?? selected?.affected_users_count ?? selected?.usersCount ?? selected?.users_count ?? 0)
    const beforePermissions = [...(selected?.permissions ?? [])].sort()
    const afterPermissions = (Array.isArray(payload.permissions) ? payload.permissions.map(String) : []).sort()
    const permissionsChanged = Boolean(selected) && (beforePermissions.length !== afterPermissions.length || beforePermissions.some((permission, index) => permission !== afterPermissions[index]))
    if (permissionsChanged && assignedUsers > 0 && !window.confirm(`Save these permission changes? ${assignedUsers} affected ${assignedUsers === 1 ? 'user will' : 'users will'} be signed out immediately.`)) return
    setBusy(true); setMutationError(''); setSuccess('')
    try {
      const response = selected ? await api.patch(`/api/roles/${selected.id}`, payload as Record<string, unknown>) : await api.post('/api/roles', payload as Record<string, unknown>)
      const root = response && typeof response === 'object' ? response as Record<string, unknown> : {}
      const data = unwrap(response as Record<string, unknown>) as Record<string, unknown>
      const affected = Number(root.affected_users_count ?? data?.affected_users_count ?? 0)
      const revoked = Boolean(root.sessions_revoked ?? data?.sessions_revoked)
      setOpen(false)
      setSuccess(selected ? `Role updated.${revoked ? ` ${affected} affected ${affected === 1 ? 'user was' : 'users were'} signed out.` : ''}` : 'Role created.')
      await collection.reload()
    } catch (reason) { setMutationError(reason instanceof Error ? reason.message : 'Unable to save this role.') }
    finally { setBusy(false) }
  }
  const remove = async (role: Role) => {
    if (!window.confirm(`Delete “${role.name}”? This is only allowed when no users are assigned.`)) return
    setMutationError(''); setSuccess('')
    try { await api.delete(`/api/roles/${role.id}`); setSuccess('Role deleted.'); await collection.reload() }
    catch (reason) { setMutationError(reason instanceof Error ? reason.message : 'Unable to delete this role.') }
  }

  const columns: Column<Role>[] = [
    { key: 'name', header: 'Role', render: (role) => <div className="primary-cell"><strong>{role.name}</strong><span>{roleIsSystem(role) ? 'System role · Full access' : role.description || 'Workspace access role'}</span></div> },
    { key: 'permissions', header: 'Permissions', render: (role) => <span>{roleIsSystem(role) ? 'Full access' : `${role.permissions?.length ?? 0} enabled`}</span> },
    { key: 'users', header: 'Users', render: (role) => role.usersCount ?? role.users_count ?? '—' },
    { key: 'actions', header: '', className: 'action-column', render: (role) => <div className="row-actions" onClick={(event) => event.stopPropagation()}>{isAdmin && !roleIsSystem(role) ? <><button className="icon-button" title="Edit" aria-label="Edit" onClick={() => show(role, true)}><Icon name="edit" size={16} /></button><button className="icon-button danger" title="Delete" aria-label="Delete" onClick={() => void remove(role)}><Icon name="trash" size={16} /></button></> : <button className="text-link" onClick={() => show(role)}>View</button>}</div> },
  ]
  return <div><PageHeader eyebrow="Administration" title="Roles" description={isAdmin ? 'Give each team member only the access they need.' : 'Review the access assigned to each workspace role.'} actions={isAdmin ? <button className="btn btn-primary" onClick={create}><Icon name="plus" size={16} /> New role</button> : undefined} /><SettingsNav />{(collection.error || catalogError || mutationError) && <ErrorBanner message={collection.error || catalogError || mutationError} />}{success && <div className="success-banner">{success}</div>}<Panel className="list-panel"><DataTable columns={columns} data={collection.data} rowKey={(role) => role.id} loading={collection.loading} emptyTitle="No roles found" onRowClick={(role) => show(role)} /></Panel><Modal open={open} onClose={close} title={!selected ? 'Create role' : editing ? `Edit ${selected.name}` : selected.name} size="lg"><RoleForm key={`${String(selected?.id ?? 'new')}-${editing}-${groups.length}`} role={selected} groups={groups} busy={busy} error={mutationError} readOnly={!editing} onCancel={close} onSave={save} /></Modal></div>
}

function FieldValuesEditor({ field, canAdd, canDelete, onChanged }: { field: CustomField; canAdd: boolean; canDelete: boolean; onChanged: () => Promise<void> }) {
  const [label, setLabel] = useState('')
  const [color, setColor] = useState('#8b5cf6')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const add = async () => {
    if (!label.trim()) return
    setBusy(true); setError('')
    try { await api.post(`/api/fields/${field.id}/values`, { label: label.trim(), color }); setLabel(''); await onChanged() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to add this value.') }
    finally { setBusy(false) }
  }
  const remove = async (item: FieldValue) => {
    if (!window.confirm(`Remove “${item.label}”?`)) return
    try { await api.delete(`/api/fields/${field.id}/values/${item.id}`); await onChanged() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to remove this value.') }
  }
  return <div className="field-values-editor">{error && <ErrorBanner message={error} />}<div className="value-list">{field.values?.map((item) => <div key={item.id}><span className="value-color" style={{ background: item.color || '#64748b' }} /><strong>{item.label}</strong>{canDelete && <button className="icon-button danger" onClick={() => void remove(item)}><Icon name="trash" size={15} /></button>}</div>)}</div>{canAdd && <div className="quick-add field-value-add"><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="New value label" /><input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Value color" /><button className="btn btn-primary" disabled={busy || !label.trim()} onClick={() => void add()}><Icon name="plus" size={15} /> Add value</button></div>}</div>
}

export function FieldsPage() {
  const can = useCan()
  const collection = useCollection<CustomField>('/api/fields')
  const mutation = useEntityMutation<CustomField>('/api/fields', collection.reload)
  const [valuesFieldId, setValuesFieldId] = useState<EntityId | null>(null)
  const valuesField = collection.data.find((field) => String(field.id) === String(valuesFieldId)) ?? null
  const fields: FormFieldSpec[] = [{ name: 'name', label: 'Field name', required: true, wide: true }, { name: 'description', label: 'Description', type: 'textarea', wide: true }]
  const initial = mutation.selected ? { name: mutation.selected.name, description: String((mutation.selected as unknown as { description?: string }).description ?? '') } : undefined
  const columns: Column<CustomField>[] = [
    { key: 'name', header: 'Field', render: (field) => <div className="primary-cell"><strong>{field.name}</strong><span>{field.key ?? field.entityType ?? field.entity_type ?? 'Custom field'}</span></div> },
    { key: 'values', header: 'Values', render: (field) => <button className="text-link" onClick={(event) => { event.stopPropagation(); setValuesFieldId(field.id) }}>{field.values?.length ?? 0} values</button> },
    { key: 'status', header: 'Status', render: (field) => <StatusBadge value={field.active === false ? 'Inactive' : 'Active'} /> },
    { key: 'actions', header: '', className: 'action-column', render: (field) => <RowActions removeLabel="Delete" onEdit={can('fields.edit') ? () => mutation.edit(field) : undefined} onDelete={can('fields.delete') && !(field as unknown as { is_system?: boolean }).is_system ? () => void mutation.archive(field) : undefined} /> },
  ]
  return <div><PageHeader eyebrow="Administration" title="Fields" description="Reusable statuses, priorities, types, and departments." actions={can('fields.create') ? <button className="btn btn-primary" onClick={mutation.create}><Icon name="plus" size={16} /> New field</button> : undefined} /><SettingsNav />{(collection.error || mutation.error) && <ErrorBanner message={collection.error || mutation.error} />}<Panel className="list-panel"><DataTable columns={columns} data={collection.data} rowKey={(field) => field.id} loading={collection.loading} emptyTitle="No fields found" /></Panel><EntityModal open={mutation.open} title={mutation.selected ? 'Edit field' : 'Create field'} fields={fields} initialValues={initial} busy={mutation.busy} error={mutation.error} onClose={mutation.close} onSave={mutation.save} /><Modal open={Boolean(valuesField)} onClose={() => setValuesFieldId(null)} title={`${valuesField?.name ?? 'Field'} values`} size="md">{valuesField ? <FieldValuesEditor field={valuesField} canAdd={can('fields.edit')} canDelete={can('fields.delete')} onChanged={collection.reload} /> : null}</Modal></div>
}

export { SettingsNav }
