import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router'
import {
  Pencil,
  Play,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { useWorkspace } from '@/auth/WorkspaceProvider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { DataTable, DataTableColumnHeader, type ColumnDef } from '@/components/data-table'
import { AvatarUpload } from '@/components/AvatarUpload'
import { EntityForm, type FormFieldSpec } from '@/components/entity-form'
import {
  Avatar,
  EmptyState,
  ErrorBanner,
  LoadingRows,
  PageHeader,
  Panel,
  SearchToolbar,
  StatusBadge,
} from '@/components/shared'
import { LabelRow } from '@/components/kernix/label-row'
import { ClientTile, type ClientStats } from '@/components/portfolio/ClientTile'
import { ProjectCard } from '@/components/portfolio/ProjectCard'
import { api, displayName, normalizePage, unwrap } from '@/lib/api'
import type { PortfolioStats } from '@/lib/health'
import { isAdministrator, useCan } from '@/lib/permissions'
import { lockedPermissions, normalizePermissionCatalog, withRequiredPermissions, type PermissionGroup } from '@/lib/rolePermissions'
import { useCollection } from '@/lib/useCollection'
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
} from '@/types/api'

function value(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key]
  return undefined
}

function RowActions({ onEdit, onDelete, onRestore, editLabel = 'Edit', removeLabel = 'Archive' }: { onEdit?: () => void; onDelete?: () => void; onRestore?: () => void; editLabel?: string; removeLabel?: string }) {
  if (!onEdit && !onDelete && !onRestore) return <span className="text-sm text-muted-foreground">—</span>
  return (
    <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
      {onEdit && <Button variant="ghost" size="icon-sm" title={editLabel} aria-label={editLabel} onClick={onEdit}><Pencil /></Button>}
      {onRestore && <Button variant="ghost" size="icon-sm" title="Restore" aria-label="Restore" onClick={onRestore}><Play /></Button>}
      {onDelete && <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" title={removeLabel} aria-label={removeLabel} onClick={onDelete}><Trash2 /></Button>}
    </div>
  )
}

function ArchivedToggle({ archived, onChange }: { archived: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <Switch checked={archived} onCheckedChange={onChange} />
      Archived
    </label>
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
  aside,
}: {
  open: boolean
  title: string
  fields: FormFieldSpec[]
  initialValues?: FormPayload
  busy: boolean
  error: string
  onClose: () => void
  onSave: (values: FormPayload) => Promise<void>
  /** Rendered above the fields, for controls that save on their own. */
  aside?: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {aside}
        <EntityForm fields={fields} initialValues={initialValues} busy={busy} error={error} onCancel={onClose} onSubmit={onSave} />
      </DialogContent>
    </Dialog>
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

/** Stats the server derives; a project fetched without `stats=1` gets zeroes. */
function projectStats(project: Project): PortfolioStats {
  return project.stats ?? {
    total: 0, done: 0, open: 0, overdue: 0, blocked: 0, unowned: 0,
    logged_minutes: 0, estimated_minutes: 0, budget_minutes: null,
    percent_complete: 0, health: 'ontrack',
  }
}

/** Only worth a pill when it is not the ordinary case. */
function projectStateLabel(project: Project): string | undefined {
  const label = (project.statusValue ?? project.status_value)?.label
  if (!label || /active|in progress/i.test(label)) return undefined
  return label
}

function groupByClient(projects: Project[]) {
  const groups = new Map<string, { id: EntityId | string; name: string; projects: Project[] }>()
  projects.forEach((project) => {
    const id = project.client?.id ?? project.clientId ?? project.client_id ?? 'none'
    const key = String(id)
    if (!groups.has(key)) groups.set(key, { id: key, name: project.client?.name ?? 'No client', projects: [] })
    groups.get(key)!.projects.push(project)
  })
  return [...groups.values()]
}

export function ProjectsPage() {
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const navigate = useNavigate()
  const can = useCan()
  const { singleClientMode, settings } = useWorkspace()
  const collection = useCollection<Project>('/api/projects', { search, all: true, filters: { archived: archived ? 'only' : undefined, stats: 1 } })
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


  return (
    <div className="@container space-y-4">
      <PageHeader eyebrow="Delivery" title="Projects" description={`${collection.meta.total} ${archived ? 'archived' : 'active'} projects in your workspace.`} actions={!archived && can('projects.create') ? <Button onClick={mutation.create}><Plus /> New project</Button> : undefined} />
      {(collection.error || (!mutation.open && mutation.error)) && <ErrorBanner message={collection.error || mutation.error} onRetry={() => void collection.reload()} />}
      <SearchToolbar
        value={search}
        onChange={setSearch}
        placeholder="Search projects…"
        actions={<ArchivedToggle archived={archived} onChange={setArchived} />}
      />
      {collection.loading && !collection.data.length && <LoadingRows rows={4} columns={1} />}
      {!collection.loading && !collection.data.length && (
        <EmptyState
          title={archived ? 'No archived projects' : 'No projects found'}
          description={archived ? 'Archived projects will appear here.' : 'Create a project to organize the first stream of work.'}
        />
      )}
      {/* Grouped by client rather than listed flat: a project only means
          something next to the others for the same client. */}
      {groupByClient(collection.data).map((group) => (
        <section key={String(group.id)} className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-2.5">
            <LabelRow>{group.name}</LabelRow>
            <span className="text-meta text-t4">
              {group.projects.length} {group.projects.length === 1 ? 'project' : 'projects'}
            </span>
          </div>
          <div className="grid gap-2.5 @[720px]:grid-cols-2 @[1100px]:grid-cols-3">
            {group.projects.map((project) => (
              <ProjectCard
                key={project.id}
                name={project.name}
                stats={projectStats(project)}
                stateLabel={projectStateLabel(project)}
                team={project.team ?? []}
                onOpen={can('tasks.view') ? () => navigate(`/tasks?project_id=${project.id}`) : undefined}
                actions={
                  <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                    {!archived && (
                      <Button variant="ghost" size="icon-sm" className="relative" title="Project memory" aria-label={`Open ${project.name} memory`} asChild>
                        <Link to={`/projects/${project.id}/memory`}>
                          <Sparkles />
                          {Number(project.pendingMemoryCount ?? project.pending_memory_count ?? 0) > 0 && (
                            <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[0.6rem] text-primary-foreground">{project.pendingMemoryCount ?? project.pending_memory_count}</span>
                          )}
                        </Link>
                      </Button>
                    )}
                    <RowActions
                      onEdit={!archived && can('projects.edit') ? () => mutation.edit(project) : undefined}
                      onDelete={!archived && can('projects.archive') ? () => void mutation.archive(project) : undefined}
                      onRestore={archived && can('projects.archive') ? () => void mutation.restore(project) : undefined}
                    />
                  </div>
                }
              />
            ))}
          </div>
        </section>
      ))}
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

/** Stats the server derives; a client fetched without `stats=1` gets zeroes. */
function clientStats(client: Client): ClientStats {
  return client.stats ?? {
    projects: 0, open_tasks: 0, overdue: 0, blocked: 0, logged_minutes: 0,
    retainer_minutes: null, retainer_used_minutes: null, health: 'ontrack', owner: null,
  }
}

export function ClientsPage() {
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const navigate = useNavigate()
  const can = useCan()
  const { singleClientMode } = useWorkspace()
  const collection = useCollection<Client>('/api/clients', { search, all: true, filters: { archived: archived ? 'only' : undefined, stats: 1 } })
  const mutation = useEntityMutation<Client>('/api/clients', collection.reload, 'archive')
  const lookups = useLookups(mutation.open)
  const statuses = statusValues(lookups.fields, 'client_status')

  if (singleClientMode) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Workspace mode" title="Client directory is hidden" description="This workspace is scoped to one client, so client switching and client administration are removed from the interface." />
        <Panel>
          <EmptyState title="Single-client mode is active" description="Projects and contacts remain available in their own sections." action={can('projects.view') ? <Button asChild><Link to="/projects">Open projects</Link></Button> : undefined} />
        </Panel>
      </div>
    )
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
  return (
    <div className="@container space-y-4">
      <PageHeader eyebrow="Relationships" title="Clients" description={`${collection.meta.total} ${archived ? 'archived' : 'active'} client accounts.`} actions={!archived && can('clients.create') ? <Button onClick={mutation.create}><Plus /> New client</Button> : undefined} />
      {(collection.error || mutation.error) && <ErrorBanner message={collection.error || mutation.error} />}
      <SearchToolbar
        value={search}
        onChange={setSearch}
        placeholder="Search clients…"
        actions={<ArchivedToggle archived={archived} onChange={setArchived} />}
      />
      {collection.loading && !collection.data.length && <LoadingRows rows={3} columns={1} />}
      {!collection.loading && !collection.data.length && (
        <EmptyState
          title={archived ? 'No archived clients' : 'No clients yet'}
          description={archived ? 'Archived clients will appear here.' : 'Add the first client account to begin.'}
        />
      )}
      <div className="grid gap-2.5 @[640px]:grid-cols-2 @[1000px]:grid-cols-3">
        {collection.data.map((client) => (
          <ClientTile
            key={client.id}
            name={client.name}
            stats={clientStats(client)}
            onOpen={can('projects.view') ? () => navigate(`/projects?client_id=${client.id}`) : undefined}
            actions={
              <RowActions
                onEdit={!archived && can('clients.edit') ? () => mutation.edit(client) : undefined}
                onDelete={!archived && can('clients.archive') ? () => void mutation.archive(client) : undefined}
                onRestore={archived && can('clients.archive') ? () => void mutation.restore(client) : undefined}
              />
            }
          />
        ))}
      </div>
      <EntityModal open={mutation.open} title={mutation.selected ? 'Edit client' : 'Create client'} fields={fields} initialValues={initial} busy={mutation.busy} error={mutation.error} onClose={mutation.close} onSave={mutation.save} />
    </div>
  )
}

export function ContactsPage() {
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const can = useCan()
  const { singleClientMode, settings } = useWorkspace()
  const collection = useCollection<Contact>('/api/contacts', { search, all: true, filters: { archived: archived ? 'only' : undefined } })
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
  const columns: ColumnDef<Contact>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Contact" />,
      cell: ({ row }) => <div className="flex flex-col"><span className="font-medium">{row.original.name || [row.original.firstName ?? row.original.first_name, row.original.lastName ?? row.original.last_name].filter(Boolean).join(' ')}</span><span className="text-xs text-muted-foreground">{row.original.title || row.original.email || 'No title'}</span></div>,
    },
    { id: 'client', header: 'Client', cell: ({ row }) => row.original.client?.name || '—' },
    { id: 'email', header: 'Email', cell: ({ row }) => row.original.email ? <a className="text-primary underline-offset-4 hover:underline" href={`mailto:${row.original.email}`}>{row.original.email}</a> : '—' },
    { id: 'phone', header: 'Phone', cell: ({ row }) => row.original.phone1 ?? row.original.phone_1 ?? '—' },
    { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge value={row.original.status} /> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => <RowActions onEdit={!archived && can('contacts.edit') ? () => mutation.edit(row.original) : undefined} onDelete={!archived && can('contacts.archive') ? () => void mutation.archive(row.original) : undefined} onRestore={archived && can('contacts.archive') ? () => void mutation.restore(row.original) : undefined} />,
    },
  ]
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Directory" title="Contacts" description={`${collection.meta.total} ${archived ? 'archived' : 'active'} client contacts.`} actions={!archived && can('contacts.create') ? <Button onClick={mutation.create}><Plus /> New contact</Button> : undefined} />
      {(collection.error || mutation.error) && <ErrorBanner message={collection.error || mutation.error} />}
      <Panel>
        <DataTable columns={columns} data={collection.data} loading={collection.loading} search={search} onSearch={setSearch} searchPlaceholder="Search people, titles, or email…" toolbar={<ArchivedToggle archived={archived} onChange={setArchived} />} emptyTitle={archived ? 'No archived contacts' : 'No contacts found'} emptyDescription={archived ? 'Archived contacts will appear here.' : 'Add the people your team collaborates with.'} />
      </Panel>
      <EntityModal open={mutation.open} title={mutation.selected ? 'Edit contact' : 'Create contact'} fields={fields} initialValues={initial} busy={mutation.busy} error={mutation.error} onClose={mutation.close} onSave={async (payload) => mutation.save(singleClientMode && singleClientId ? { ...payload, client_id: singleClientId as string | number } : payload)} />
    </div>
  )
}

function SettingsNav() {
  const can = useCan()
  const links = [
    can('settings.view') ? { to: '/settings', label: 'System' } : null,
    can('users.view') ? { to: '/settings/users', label: 'Users' } : null,
    can('roles.view') ? { to: '/settings/roles', label: 'Roles' } : null,
    can('fields.view') ? { to: '/settings/fields', label: 'Fields' } : null,
  ].filter((item): item is { to: string; label: string } => Boolean(item))
  return (
    <nav className="flex flex-wrap gap-1 border-b" aria-label="Settings">
      {links.map((item) => (
        <NavLink
          end={item.to === '/settings'}
          className={({ isActive }) => `border-b-2 px-3 py-2 text-sm font-medium ${isActive ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          to={item.to}
          key={item.to}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

function isAdministratorAccount(user: User): boolean {
  return Boolean(user.isAdmin ?? user.is_admin) || ['admin', 'administrator'].includes(String(user.role?.key ?? user.role?.key_name ?? user.role?.name ?? '').toLowerCase())
}

export function UsersPage() {
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const can = useCan()
  const { user: currentUser } = useAuth()
  const isAdmin = isAdministrator(currentUser)
  const collection = useCollection<User>('/api/users', { search, all: true, filters: { archived: archived ? 'only' : undefined } })
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
  const columns: ColumnDef<User>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title="User" />,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Avatar user={row.original} />
          <div className="flex flex-col"><span className="font-medium">{displayName(row.original)}</span><span className="text-xs text-muted-foreground">@{row.original.username}</span></div>
        </div>
      ),
    },
    { id: 'role', header: 'Role', cell: ({ row }) => row.original.role?.name ?? row.original.roles?.map((role) => typeof role === 'string' ? role : role.name).join(', ') ?? '—' },
    { id: 'department', header: 'Department', cell: ({ row }) => row.original.department?.label ?? '—' },
    { id: 'email', header: 'Email', cell: ({ row }) => row.original.imagicEmail ?? row.original.imagic_email ?? row.original.email ?? '—' },
    { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge value={row.original.status} /> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const user = row.original
        const protectedTarget = !isAdmin && isAdministratorAccount(user)
        const self = String(user.id) === String(currentUser?.id)
        return <RowActions onEdit={!archived && can('users.edit') && !protectedTarget ? () => mutation.edit(user) : undefined} onDelete={!archived && can('users.archive') && !protectedTarget && !self ? () => void mutation.archive(user) : undefined} onRestore={archived && can('users.archive') && !protectedTarget ? () => void mutation.restore(user) : undefined} />
      },
    },
  ]
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Settings"
        title="Users"
        description={archived ? 'Archived accounts that can be restored.' : 'People who can sign in to this workspace.'}
        actions={!archived && (isAdmin || can('users.create')) ? (
          <>
            {isAdmin && <Button onClick={() => setInviteOpen(true)}><Send /> Invite user</Button>}
            {can('users.create') && <Button variant={isAdmin ? 'outline' : 'default'} onClick={mutation.create}><Plus /> New user</Button>}
          </>
        ) : undefined}
      />
      <SettingsNav />
      {(collection.error || mutation.error) && <ErrorBanner message={collection.error || mutation.error} />}
      <Panel>
        <DataTable columns={columns} data={collection.data} loading={collection.loading} search={search} onSearch={setSearch} searchPlaceholder="Search users…" toolbar={<ArchivedToggle archived={archived} onChange={setArchived} />} emptyTitle={archived ? 'No archived users' : 'No users found'} />
      </Panel>
      <EntityModal
        open={mutation.open}
        title={mutation.selected ? 'Edit user' : 'Create user'}
        fields={fields}
        initialValues={initial}
        busy={mutation.busy}
        error={mutation.error}
        onClose={mutation.close}
        aside={mutation.selected && can('users.edit') ? (
          <AvatarUpload
            user={mutation.selected as UserSummary}
            userId={mutation.selected.id}
            onChanged={() => void collection.reload()}
            className="pb-2"
          />
        ) : undefined}
        onSave={async (payload) => {
          const clean = { ...payload }
          if (!isAdmin) { delete clean.personal_email; if (mutation.selected) delete clean.role_id; if (selectedIsSelf) delete clean.status }
          if (mutation.selected && !isAdmin) { delete clean.password; delete clean.password_confirmation }
          else if (!clean.password) { delete clean.password; delete clean.password_confirmation }
          await mutation.save(clean)
        }}
      />
      <InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  )
}

function roleIsSystem(role: Role | null): boolean {
  return Boolean(role?.isSystem ?? role?.is_system) || String(role?.key ?? role?.keyName ?? role?.key_name ?? '').toLowerCase() === 'admin'
}

export function RoleForm({ role, groups, busy, error, readOnly, onCancel, onSave }: { role: Role | null; groups: PermissionGroup[]; busy: boolean; error: string; readOnly: boolean; onCancel: () => void; onSave: (payload: FormPayload) => Promise<void> }) {
  const formId = useId()
  const system = roleIsSystem(role)
  const allPermissions = groups.flatMap((group) => group.permissions.map((permission) => permission.key))
  const [name, setName] = useState(role?.name ?? '')
  const [permissions, setPermissions] = useState<string[]>(() => system ? allPermissions : readOnly ? role?.permissions ?? [] : withRequiredPermissions(role?.permissions ?? [], groups))
  const locked = readOnly ? new Set<string>() : lockedPermissions(permissions, groups)
  const submit = (event: FormEvent) => { event.preventDefault(); if (!readOnly) void onSave({ name, permissions: withRequiredPermissions(permissions, groups) }) }
  const toggle = (key: string, checked: boolean) => {
    setPermissions((old) => checked ? withRequiredPermissions([...old, key], groups) : old.filter((item) => item !== key))
  }
  return (
    <form className="space-y-5" onSubmit={submit}>
      {system && (
        <Alert>
          <ShieldCheck className="size-4" />
          <AlertDescription>
            <strong className="text-foreground">System role · Full access</strong>
            <span>Administrator access is implicit and cannot be changed.</span>
          </AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor={`${formId}-name`}>Role name *</Label>
        <Input id={`${formId}-name`} value={name} onChange={(event) => setName(event.target.value)} required disabled={readOnly || system} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((group) => (
          <fieldset key={group.key} className="space-y-3 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">{group.label}</legend>
            {group.permissions.map((permission) => {
              const dependencyLocked = locked.has(permission.key)
              const checkboxId = `${formId}-${permission.key}`
              return (
                <div className={`flex items-start gap-2 ${dependencyLocked ? 'opacity-80' : ''}`} key={permission.key} title={permission.description}>
                  <Checkbox
                    id={checkboxId}
                    checked={system || permissions.includes(permission.key)}
                    disabled={readOnly || system || dependencyLocked}
                    onCheckedChange={(checked) => toggle(permission.key, checked === true)}
                  />
                  <Label htmlFor={checkboxId} className="flex-col items-start gap-0.5 font-normal">
                    <span>{permission.label}</span>
                    {permission.description && <span className="text-xs font-normal text-muted-foreground">{permission.description}</span>}
                    {dependencyLocked && !system && <span className="text-xs font-normal text-muted-foreground">Required</span>}
                  </Label>
                </div>
              )
            })}
          </fieldset>
        ))}
      </div>
      {!groups.length && <p className="text-sm text-muted-foreground">Permission metadata is unavailable. Reload the page before editing this role.</p>}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <footer className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>{readOnly ? 'Close' : 'Cancel'}</Button>
        {!readOnly && <Button disabled={busy || !groups.length}>{busy ? 'Saving…' : 'Save role'}</Button>}
      </footer>
    </form>
  )
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

  const columns: ColumnDef<Role>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
      cell: ({ row }) => <div className="flex flex-col"><span className="font-medium">{row.original.name}</span><span className="text-xs text-muted-foreground">{roleIsSystem(row.original) ? 'System role · Full access' : row.original.description || 'Workspace access role'}</span></div>,
    },
    { id: 'permissions', header: 'Permissions', cell: ({ row }) => <span>{roleIsSystem(row.original) ? 'Full access' : `${row.original.permissions?.length ?? 0} enabled`}</span> },
    { id: 'users', header: 'Users', cell: ({ row }) => row.original.usersCount ?? row.original.users_count ?? '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const role = row.original
        return (
          <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
            {isAdmin && !roleIsSystem(role) ? (
              <>
                <Button variant="ghost" size="icon-sm" title="Edit" aria-label="Edit" onClick={() => show(role, true)}><Pencil /></Button>
                <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" title="Delete" aria-label="Delete" onClick={() => void remove(role)}><Trash2 /></Button>
              </>
            ) : (
              <Button variant="link" size="sm" onClick={() => show(role)}>View</Button>
            )}
          </div>
        )
      },
    },
  ]
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Settings" title="Roles" description={isAdmin ? 'Give each team member only the access they need.' : 'Review the access assigned to each workspace role.'} actions={isAdmin ? <Button onClick={create}><Plus /> New role</Button> : undefined} />
      <SettingsNav />
      {(collection.error || catalogError || mutationError) && <ErrorBanner message={collection.error || catalogError || mutationError} />}
      {success && <Alert><AlertDescription>{success}</AlertDescription></Alert>}
      <Panel>
        <DataTable columns={columns} data={collection.data} loading={collection.loading} emptyTitle="No roles found" onRowClick={(role) => show(role)} />
      </Panel>
      <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{!selected ? 'Create role' : editing ? `Edit ${selected.name}` : selected.name}</DialogTitle>
          </DialogHeader>
          <RoleForm key={`${String(selected?.id ?? 'new')}-${editing}-${groups.length}`} role={selected} groups={groups} busy={busy} error={mutationError} readOnly={!editing} onCancel={close} onSave={save} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FieldValuesEditor({ field, canAdd, canDelete, onChanged }: { field: CustomField; canAdd: boolean; canDelete: boolean; onChanged: () => Promise<void> }) {
  const [label, setLabel] = useState('')
  const [color, setColor] = useState('#9c6cff')
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
  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      <ul className="space-y-2">
        {field.values?.map((item) => (
          <li className="flex items-center gap-2 rounded-md border px-3 py-2" key={item.id}>
            <span aria-hidden="true" className="size-3 rounded-full" style={{ background: item.color || '#64748b' }} />
            <span className="flex-1 font-medium">{item.label}</span>
            {canDelete && <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" aria-label={`Remove ${item.label}`} onClick={() => void remove(item)}><Trash2 /></Button>}
          </li>
        ))}
      </ul>
      {canAdd && (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="flex-1" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="New value label" />
          <Input type="color" className="w-16 p-1" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Value color" />
          <Button disabled={busy || !label.trim()} onClick={() => void add()}><Plus /> Add value</Button>
        </div>
      )}
    </div>
  )
}

export function FieldsPage() {
  const can = useCan()
  const collection = useCollection<CustomField>('/api/fields')
  const mutation = useEntityMutation<CustomField>('/api/fields', collection.reload)
  const [valuesFieldId, setValuesFieldId] = useState<EntityId | null>(null)
  const valuesField = collection.data.find((field) => String(field.id) === String(valuesFieldId)) ?? null
  const fields: FormFieldSpec[] = [{ name: 'name', label: 'Field name', required: true, wide: true }, { name: 'description', label: 'Description', type: 'textarea', wide: true }]
  const initial = mutation.selected ? { name: mutation.selected.name, description: String((mutation.selected as unknown as { description?: string }).description ?? '') } : undefined
  const columns: ColumnDef<CustomField>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Field" />,
      cell: ({ row }) => <div className="flex flex-col"><span className="font-medium">{row.original.name}</span><span className="text-xs text-muted-foreground">{row.original.key ?? row.original.entityType ?? row.original.entity_type ?? 'Custom field'}</span></div>,
    },
    { id: 'values', header: 'Values', cell: ({ row }) => <Button variant="link" size="sm" onClick={(event) => { event.stopPropagation(); setValuesFieldId(row.original.id) }}>{row.original.values?.length ?? 0} values</Button> },
    { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge value={row.original.active === false ? 'Inactive' : 'Active'} /> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => <RowActions removeLabel="Delete" onEdit={can('fields.edit') ? () => mutation.edit(row.original) : undefined} onDelete={can('fields.delete') && !(row.original as unknown as { is_system?: boolean }).is_system ? () => void mutation.archive(row.original) : undefined} />,
    },
  ]
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Settings" title="Fields" description="Reusable statuses, priorities, types, and departments." actions={can('fields.create') ? <Button onClick={mutation.create}><Plus /> New field</Button> : undefined} />
      <SettingsNav />
      {(collection.error || mutation.error) && <ErrorBanner message={collection.error || mutation.error} />}
      <Panel>
        <DataTable columns={columns} data={collection.data} loading={collection.loading} emptyTitle="No fields found" />
      </Panel>
      <EntityModal open={mutation.open} title={mutation.selected ? 'Edit field' : 'Create field'} fields={fields} initialValues={initial} busy={mutation.busy} error={mutation.error} onClose={mutation.close} onSave={mutation.save} />
      <Dialog open={Boolean(valuesField)} onOpenChange={(next) => { if (!next) setValuesFieldId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{valuesField?.name ?? 'Field'} values</DialogTitle>
          </DialogHeader>
          {valuesField ? <FieldValuesEditor field={valuesField} canAdd={can('fields.edit')} canDelete={can('fields.delete')} onChanged={collection.reload} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { SettingsNav }
