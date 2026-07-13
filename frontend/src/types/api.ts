export type EntityId = number | string

export interface ApiEnvelope<T> {
  data: T
  message?: string
}

export interface PaginationMeta {
  page: number
  perPage: number
  total: number
  lastPage?: number
}

export interface Paginated<T> {
  data: T[]
  current_page?: number
  last_page?: number
  per_page?: number
  total?: number
  from?: number | null
  to?: number | null
  meta?: Partial<PaginationMeta>
  links?: Record<string, string | null>
  lookups?: Record<string, unknown[]>
}

export interface FieldValue {
  id: EntityId
  fieldId?: EntityId
  field_id?: EntityId
  key?: string
  label: string
  color?: string | null
  sortOrder?: number
  sort_order?: number
  active?: boolean
}

export interface UserSummary {
  id: EntityId
  name?: string
  firstName?: string
  first_name?: string
  lastName?: string
  last_name?: string
  username?: string
  email?: string
  avatar?: string | null
  profileImage?: string | null
  profile_image?: string | null
}

export interface User extends UserSummary {
  roleId?: EntityId
  role_id?: EntityId
  role?: { id: EntityId; name: string; key?: string; key_name?: string; isSystem?: boolean; is_system?: boolean }
  department?: FieldValue | null
  departmentValueId?: EntityId | null
  department_value_id?: EntityId | null
  roles?: Array<{ id: EntityId; name: string } | string>
  permissions?: string[]
  isAdmin?: boolean
  is_admin?: boolean
  status?: string
  timezone?: string
  imagicEmail?: string | null
  imagic_email?: string | null
  personalEmail?: string | null
  personal_email?: string | null
  phone1?: string | null
  phone_1?: string | null
  createdAt?: string
  created_at?: string
}

export interface Client {
  id: EntityId
  name: string
  website?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  province?: string | null
  zipCode?: string | null
  zip_code?: string | null
  country?: string | null
  timezone?: string | null
  notes?: string | null
  status?: string | FieldValue
  statusValue?: FieldValue
  status_value?: FieldValue
  archivedAt?: string | null
  archived_at?: string | null
}

export interface Project {
  id: EntityId
  clientId?: EntityId
  client_id?: EntityId
  client?: Pick<Client, 'id' | 'name' | 'timezone'>
  name: string
  description?: string | null
  status?: string | FieldValue
  statusValue?: FieldValue
  status_value?: FieldValue
  manager?: UserSummary | null
  managerUserId?: EntityId | null
  manager_user_id?: EntityId | null
  startDate?: string | null
  start_date?: string | null
  dueDate?: string | null
  due_date?: string | null
  archivedAt?: string | null
  archived_at?: string | null
}

export interface Contact {
  id: EntityId
  clientId?: EntityId
  client_id?: EntityId
  client?: Pick<Client, 'id' | 'name'>
  firstName?: string
  first_name?: string
  lastName?: string
  last_name?: string
  name?: string
  title?: string | null
  email?: string | null
  phone1?: string | null
  phone_1?: string | null
  phone2?: string | null
  phone_2?: string | null
  notes?: string | null
  status?: 'active' | 'inactive' | string
  archivedAt?: string | null
  archived_at?: string | null
}

export interface Attachment {
  id: EntityId
  name?: string
  originalName?: string
  original_name?: string
  url?: string
  size?: number
  mimeType?: string
  mime_type?: string
}

export interface Note {
  id: EntityId
  taskId?: EntityId
  task_id?: EntityId
  subtaskId?: EntityId | null
  subtask_id?: EntityId | null
  body: string
  timeMinutes?: number
  time_minutes?: number
  assignedUser?: UserSummary | null
  assigned_user?: UserSummary | null
  isMessage?: boolean
  is_message?: boolean
  readAt?: string | null
  read_at?: string | null
  author?: UserSummary
  createdBy?: UserSummary | EntityId
  created_by?: UserSummary | EntityId
  createdAt?: string
  created_at?: string
  attachments?: Attachment[]
}

export interface Subtask {
  id: EntityId
  taskId?: EntityId
  task_id?: EntityId
  title: string
  status?: string | FieldValue
  statusValue?: FieldValue
  status_value?: FieldValue
  assignee?: UserSummary | null
  dueDate?: string | null
  due_date?: string | null
  estimatedMinutes?: number
  estimated_minutes?: number
  actualMinutes?: number
  actual_minutes?: number
  completedAt?: string | null
  completed_at?: string | null
  sortOrder?: number
  sort_order?: number
}

export interface Task {
  id: EntityId
  projectId?: EntityId
  project_id?: EntityId
  project?: Project
  title: string
  description?: string | null
  status?: string | FieldValue
  statusValue?: FieldValue
  status_value?: FieldValue
  urgency?: string | FieldValue
  urgencyValue?: FieldValue
  urgency_value?: FieldValue
  type?: string | FieldValue
  typeValue?: FieldValue
  type_value?: FieldValue
  assignee?: UserSummary | null
  creator?: UserSummary | null
  dueDate?: string | null
  due_date?: string | null
  estimatedMinutes?: number
  estimated_minutes?: number
  actualMinutes?: number
  actual_minutes?: number
  archivedAt?: string | null
  archived_at?: string | null
  notes?: Note[]
  subtasks?: Subtask[]
  emails?: Note[]
  timeTotals?: {
    taskEstimated?: number
    taskActual?: number
    subtaskEstimated?: number
    subtaskActual?: number
    totalEstimated?: number
    totalActual?: number
  }
  time_totals?: Record<string, number>
}

export interface Message extends Note {
  task?: Pick<Task, 'id' | 'title'>
  sender?: UserSummary
  subject?: string
}

export interface DashboardData {
  counts?: {
    myTasks?: number
    my_tasks?: number
    unreadMessages?: number
    unread_messages?: number
    activeProjects?: number
    active_projects?: number
    open_projects?: number
    activeClients?: number
    active_clients?: number
  }
  myTasks?: Task[]
  my_tasks?: Task[]
  recentActivity?: Array<{
    id?: EntityId
    description?: string
    message?: string
    createdAt?: string
    created_at?: string
  }>
  recent_activity?: DashboardData['recentActivity']
  time?: {
    todayMinutes?: number
    today_minutes?: number
    weekMinutes?: number
    week_minutes?: number
    byProject?: Array<{ name: string; minutes: number; color?: string }>
    by_project?: Array<{ name: string; minutes: number; color?: string }>
  }
  teamTime?: TeamTimeSummary
  team_time?: TeamTimeSummary
}

export interface TeamTimeEntry {
  id?: EntityId
  userId?: EntityId
  user_id?: EntityId
  user?: UserSummary
  name?: string
  state?: ClockState | string
  status?: ClockState | string
  startedAt?: string | null
  started_at?: string | null
  elapsedSeconds?: number
  elapsed_seconds?: number
  todayMinutes?: number
  today_minutes?: number
  clockInAt?: string | null
  clock_in_at?: string | null
  currentBreakStartedAt?: string | null
  current_break_started_at?: string | null
}

export interface TeamTimeSummary {
  clockedInCount?: number
  clocked_in_count?: number
  workingCount?: number
  working_count?: number
  onBreakCount?: number
  on_break_count?: number
  sessions?: TeamTimeEntry[]
}

export interface AnalyticsData {
  totals?: Record<string, number>
  byProject?: Array<{ name: string; minutes: number; count?: number }>
  by_project?: Array<{ name: string; minutes: number; count?: number }>
  byUser?: Array<{ name: string; minutes: number; count?: number }>
  by_user?: Array<{ name: string; minutes: number; count?: number }>
  timeline?: Array<{ date: string; minutes: number; count?: number }>
}

export interface AppSettings {
  appName?: string
  app_name?: string
  singleClientMode?: boolean
  single_client_mode?: boolean
  singleClient?: Client | null
  single_client?: Client | null
  taskMutationsRequireClockIn?: boolean
  task_mutations_require_clock_in?: boolean
  canAdminOverride?: boolean
  can_admin_override?: boolean
  theme?: string
  timezone?: string
  dateFormat?: string
  date_format?: string
  [key: string]: unknown
}

export type ClockState = 'clocked_out' | 'working' | 'break' | 'clocked_in'

export interface TimeStatus {
  state?: ClockState
  status?: ClockState
  clockedIn?: boolean
  clocked_in?: boolean
  onBreak?: boolean
  on_break?: boolean
  startedAt?: string | null
  started_at?: string | null
  elapsedSeconds?: number
  elapsed_seconds?: number
  entry?: Record<string, unknown> | null
  todayMinutes?: number
  today_minutes?: number
  canMutateTasks?: boolean
  can_mutate_tasks?: boolean
  isClockedIn?: boolean
  is_clocked_in?: boolean
  isOnBreak?: boolean
  is_on_break?: boolean
  session?: {
    id?: EntityId
    clockInAt?: string
    clock_in_at?: string
    clockOutAt?: string | null
    clock_out_at?: string | null
    breaks?: Array<{
      startAt?: string
      start_at?: string
      endAt?: string | null
      end_at?: string | null
    }>
  } | null
  currentBreak?: Record<string, unknown> | null
  current_break?: Record<string, unknown> | null
  canAdminOverride?: boolean
  can_admin_override?: boolean
}

export interface Role {
  id: EntityId
  name: string
  key?: string
  keyName?: string
  key_name?: string
  description?: string | null
  permissions?: string[]
  usersCount?: number
  users_count?: number
  affectedUsersCount?: number
  affected_users_count?: number
  isSystem?: boolean
  is_system?: boolean
}

export interface CustomField {
  id: EntityId
  name: string
  key?: string
  entityType?: string
  entity_type?: string
  type?: string
  active?: boolean
  values?: FieldValue[]
}

export type FormValue = string | number | boolean | null | undefined
export type FormPayload = Record<string, FormValue | FormValue[]>
