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
  key_name?: string
  label: string
  color?: string | null
  sortOrder?: number
  sort_order?: number
  active?: boolean
  /**
   * What this value *means*, independent of its label. The server resolves it
   * from the slug (`App\Support\TaskSignals`) so grouping and colouring never
   * key on a workspace's own wording. Only task_status values carry it.
   */
  role?: 'open' | 'active' | 'review' | 'blocked' | 'done' | null
  /** Urgency ordering, lower being more urgent. Only task_urgency values carry it. */
  rank?: number | null
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
  /** Registered but belonging to no workspace yet — onboarding is unfinished. */
  needsWorkspace?: boolean
  needs_workspace?: boolean
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
  /** Derived delivery figures, present only when the list was asked for them. */
  stats?: import('../components/portfolio/ClientTile').ClientStats
  retainerMinutes?: number | null
  retainer_minutes?: number | null
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
  /** Derived delivery figures, present only when the list was asked for them. */
  stats?: import('../lib/health').PortfolioStats
  /** Everyone holding a task on the project, plus its manager. */
  team?: UserSummary[]
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
  aiEstimateReviewEnabled?: boolean
  ai_estimate_review_enabled?: boolean
  aiEstimateReviewRules?: string | null
  ai_estimate_review_rules?: string | null
  aiTaskCreationEnabled?: boolean
  ai_task_creation_enabled?: boolean
  aiMemoryEnabled?: boolean
  ai_memory_enabled?: boolean
  pendingMemoryCount?: number
  pending_memory_count?: number
}

export interface TaskFolder {
  id: EntityId
  projectId?: EntityId
  project_id?: EntityId
  name: string
  sortOrder?: number
  sort_order?: number
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

export interface TaskAttachment {
  id: EntityId
  taskId?: EntityId
  task_id?: EntityId
  originalName?: string
  original_name?: string
  mimeType?: string
  mime_type?: string
  fileSize?: number
  file_size?: number
  canPreview?: boolean
  can_preview?: boolean
  uploadedBy?: UserSummary | null
  uploaded_by?: UserSummary | null
  createdAt?: string
  created_at?: string
}

export interface CompletionProof {
  id: EntityId
  taskId?: EntityId
  task_id?: EntityId
  summary: string
  status: 'pending' | 'approved' | 'rejected' | string
  aiState?: string
  ai_state?: string
  aiVerdict?: string | null
  ai_verdict?: string | null
  aiMessage?: string | null
  ai_message?: string | null
  aiMissingEvidence?: string[]
  ai_missing_evidence?: string[]
  awaitsHumanReview?: boolean
  awaits_human_review?: boolean
  reviewMode?: string | null
  review_mode?: string | null
  reviewReason?: string | null
  review_reason?: string | null
  submittedBy?: UserSummary | null
  submitted_by?: UserSummary | null
  reviewedBy?: UserSummary | null
  reviewed_by?: UserSummary | null
  createdAt?: string
  created_at?: string
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
  assignedUserId?: EntityId | null
  assigned_user_id?: EntityId | null
  conversationId?: EntityId | null
  conversation_id?: EntityId | null
  estimateRequestId?: EntityId | null
  estimate_request_id?: EntityId | null
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
  actorType?: 'user' | 'ai' | 'system' | string
  actor_type?: 'user' | 'ai' | 'system' | string
  actorName?: string
  actor_name?: string
  aiReviewRunId?: EntityId | null
  ai_review_run_id?: EntityId | null
  /** Empty array when the message carries none. */
  reactions?: Array<{ emoji: string; count: number; mine: boolean }>
}

export interface AiReviewRun {
  id: EntityId
  status: string
  action?: 'challenge' | 'approve' | 'reject' | null
  responseMessage?: string | null
  response_message?: string | null
  approvedAdditionalMinutes?: number | null
  approved_additional_minutes?: number | null
  actualModel?: string | null
  actual_model?: string | null
  costUsd?: string | number
  cost_usd?: string | number
  errorCode?: string | null
  error_code?: string | null
  errorMessage?: string | null
  error_message?: string | null
}

export interface EstimateDecision {
  id: EntityId
  source: 'human' | 'ai' | 'human_override' | 'system' | string
  action: 'approve' | 'reject' | string
  approvedAdditionalMinutes?: number | null
  approved_additional_minutes?: number | null
  reason: string
  decider?: UserSummary | null
  createdAt?: string
  created_at?: string
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
  taskFolderId?: EntityId | null
  task_folder_id?: EntityId | null
  folder?: TaskFolder | null
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
  aiTaskGenerationId?: EntityId | null
  ai_task_generation_id?: EntityId | null
  notes?: Note[]
  subtasks?: Subtask[]
  emails?: Note[]
  attachments?: TaskAttachment[]
  completionProofs?: CompletionProof[]
  completion_proofs?: CompletionProof[]
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

export interface TaskWorkRequest {
  id: EntityId
  taskId?: EntityId
  task_id?: EntityId
  task?: Pick<Task, 'id' | 'title' | 'project'>
  reason: string
  status: 'pending' | 'approved' | 'declined' | 'withdrawn' | string
  requester?: UserSummary | null
  decider?: UserSummary | null
  decisionReason?: string | null
  decision_reason?: string | null
  decidedAt?: string | null
  decided_at?: string | null
  createdAt?: string | null
  created_at?: string | null
}

export interface AiTaskGeneration {
  id: EntityId
  project_id: EntityId
  task_folder_id?: EntityId | null
  status: 'queued' | 'needs_input' | 'creating' | 'created' | 'clock_blocked' | 'budget_blocked' | 'failed' | 'undone' | string
  result_summary?: string | null
  error_message?: string | null
  undo_expires_at?: string | null
  messages?: Array<{ id: EntityId; role: 'user' | 'assistant'; body: string; created_at?: string }>
  generated_tasks?: Array<{ task_id: EntityId; task?: Pick<Task, 'id' | 'title'> | null }>
}

export interface ProjectAiProfile {
  id: EntityId
  draft_brief?: string | null
  approved_brief?: string | null
  brief_status: 'empty' | 'draft' | 'approved' | string
  version: number
}

export interface ProjectMemoryEntry {
  id: EntityId
  category: 'rule' | 'workflow' | 'estimating' | 'client_preference' | 'lesson' | string
  content: string
  evidence?: string | null
  status: 'pending' | 'approved' | 'rejected' | 'superseded' | 'archived' | string
  importance: number
  source_task?: Pick<Task, 'id' | 'title'> | null
  rejection_reason?: string | null
}

export interface ProjectMemoryData {
  project: Pick<Project, 'id' | 'name' | 'description' | 'ai_memory_enabled'>
  profile: ProjectAiProfile
  entries: ProjectMemoryEntry[]
  can_manage: boolean
}

export interface EstimateRequest {
  id: EntityId
  taskId?: EntityId
  task_id?: EntityId
  requestedBy?: EntityId
  requested_by?: EntityId
  reviewerUserId?: EntityId | null
  reviewer_user_id?: EntityId | null
  baseEstimatedMinutes?: number
  base_estimated_minutes?: number
  requestedAdditionalMinutes?: number
  requested_additional_minutes?: number
  approvedAdditionalMinutes?: number | null
  approved_additional_minutes?: number | null
  status: 'pending' | 'approved' | 'rejected' | 'replaced' | string
  requestReason?: string
  request_reason?: string
  decisionReason?: string | null
  decision_reason?: string | null
  requester?: UserSummary | null
  reviewer?: UserSummary | null
  decider?: UserSummary | null
  conversationId?: EntityId | null
  conversation_id?: EntityId | null
  createdAt?: string
  created_at?: string
  decidedAt?: string | null
  decided_at?: string | null
  reviewMode?: 'human' | 'ai' | string
  review_mode?: 'human' | 'ai' | string
  aiState?: string | null
  ai_state?: string | null
  effectiveAdditionalMinutes?: number
  effective_additional_minutes?: number
  decisionSource?: string | null
  decision_source?: string | null
  latestAiReviewRun?: AiReviewRun | null
  latest_ai_review_run?: AiReviewRun | null
  decisions?: EstimateDecision[]
}

export interface Message extends Note {
  task?: Pick<Task, 'id' | 'title' | 'project' | 'assignee' | 'status_value' | 'due_date' | 'estimated_minutes' | 'actual_minutes'>
  sender?: UserSummary
  subject?: string
  messages?: Note[]
  latestMessage?: Note | null
  latest_message?: Note | null
  unreadCount?: number
  unread_count?: number
  estimateRequest?: EstimateRequest | null
  estimate_request?: EstimateRequest | null
  canReview?: boolean
  can_review?: boolean
  canOverride?: boolean
  can_override?: boolean
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

export interface OliverAction {
  type: string
  status: 'done' | 'refused' | string
  summary: string
  task_id?: EntityId | null
}

export interface OliverMessage {
  id: EntityId | string
  role: 'user' | 'assistant' | string
  body: string
  actions?: OliverAction[]
  error_code?: string | null
  created_at?: string
}

export interface OliverThread {
  conversation?: { id: EntityId; title?: string; last_message_at?: string | null }
  available?: boolean
  messages?: OliverMessage[]
}

export interface Workspace {
  id: EntityId
  name: string
  slug?: string
  active?: boolean
  member_count?: number | null
  memberCount?: number | null
  created_at?: string
}

export interface AiFeatureSetting {
  key: string
  label: string
  description: string
  enabled: boolean
  prompt: string
  default_prompt: string
  enabled_field: string
  prompt_field: string
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
  activeWorkspace?: Workspace | null
  active_workspace?: Workspace | null
  theme?: string
  timezone?: string
  dateFormat?: string
  date_format?: string
  has_openrouter_api_key?: boolean
  ai_configured?: boolean
  openrouter_model?: string | null
  ai_monthly_budget_usd?: string | number
  ai_max_output_tokens?: number
  ai_request_timeout_seconds?: number
  ai_inactivity_hours?: number
  ai_current_month_cost_usd?: number
  ai_features?: AiFeatureSetting[]
  ai_current_month_usage_by_feature?: Array<{
    feature: string
    cost_usd: string | number
    calls: number
  }>
  /** Per-workspace switches: contacts, timesheet, messages, oliver, clients, projects. Absent key means "on". */
  features?: Record<string, boolean>
  [key: string]: unknown
}

export interface WorkspaceFeature {
  key: string
  label: string
  description: string
  enabled: boolean
  requires: string[]
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

export interface InvitationProject {
  id: EntityId
  name: string
}

export interface InvitationPreview {
  email: string
  role?: Pick<Role, 'id' | 'name'> | null
  roleId?: EntityId
  role_id?: EntityId
  roleName?: string
  role_name?: string
  projects?: InvitationProject[]
  expiresAt?: string
  expires_at?: string
  status?: string
}

export interface Invitation extends InvitationPreview {
  id?: EntityId
  token?: string
  url?: string
  inviteUrl?: string
  invite_url?: string
  invitationUrl?: string
  invitation_url?: string
  createdAt?: string
  created_at?: string
}

export interface InvitationCreateResponse extends Invitation {
  invitation?: Invitation
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

/** The five breaks the timer offers, and how long each one is meant to last. */
export const BREAK_KINDS = [
  { kind: 'Short break', minutes: 5 },
  { kind: 'Coffee', minutes: 15 },
  { kind: 'Lunch', minutes: 45 },
  { kind: 'Meeting', minutes: 30 },
  { kind: 'Open-ended', minutes: 0 },
] as const

export type BreakKind = (typeof BREAK_KINDS)[number]['kind']

export interface TimerTaskRef {
  id: EntityId
  title: string
}

export interface TimerEntry {
  id: EntityId
  task_id: EntityId | null
  task: TimerTaskRef | null
  kind: 'work' | 'break'
  break_kind: BreakKind | null
  /** 0 means an open-ended break — one with no expected return time. */
  break_due_minutes: number | null
  started_at: string
}

export interface TimerHour {
  hour: number
  work_minutes: number
  break_minutes: number
}

export interface TimerDay {
  date: string
  work_minutes: number
  break_minutes: number
}

export interface TimerStatus {
  entry: TimerEntry | null
  /** While on a break, the task that resuming returns to. */
  paused_task: TimerTaskRef | null
  /** Work already banked on `paused_task` this sitting, so the break can show it. */
  paused_seconds: number
  clocked_in: boolean
  today: {
    work_minutes: number
    break_minutes: number
    /** Ten buckets, 9am through 6pm, in the workspace timezone. */
    hours: TimerHour[]
  }
  week: TimerDay[]
}

export interface TimerStopStatus extends TimerStatus {
  logged: { minutes: number; task: TimerTaskRef | null }
}

// --- dashboard -------------------------------------------------------------

export type DashboardRange = 'today' | 'week'

export interface DashboardMetric {
  count?: number
  minutes?: number
  percent?: number
  /** Where the value came from — empty when there is nothing to explain. */
  note: string
}

export interface DashboardStatus {
  label: string
  role?: string
}

export interface DashboardUrgency {
  label: string
  rank?: number
  color?: string | null
}

export interface DashboardTask {
  id: EntityId
  title: string
  project?: string | null
  client?: string | null
  /** Present on project lists, where whose task it is matters. */
  assignee?: UserSummary | null
  status?: DashboardStatus | null
  urgency?: DashboardUrgency | null
  due_date?: string | null
  logged_minutes?: number
}

export interface DashboardFocusTask extends DashboardTask {
  rank: number
  overdue?: boolean
}

export type DashboardRiskReason = 'blocked' | 'overdue' | 'not_started'

export interface DashboardRiskTask extends DashboardTask {
  /** The sentence shown under the title, already phrased by the server. */
  why: string
  reason: DashboardRiskReason
}

export interface DashboardUpcomingDay {
  date: string
  label: string
  tasks: DashboardTask[]
}

export interface DashboardWeekDay {
  date: string
  label: string
  work_minutes: number
  break_minutes: number
  is_today: boolean
}

export interface DashboardRetainerClient {
  id: EntityId
  name: string
  used_minutes: number
  retainer_minutes: number
}

export interface DashboardRetainer {
  month_label: string
  capacity_minutes: number
  used_minutes: number
  projected_minutes: number
  day_of_month: number
  days_in_month: number
  /** Cumulative minutes used, one point per elapsed day of the month. */
  series: Array<{ day: number; used_minutes: number }>
  clients: DashboardRetainerClient[]
}

export interface DashboardActivity {
  id: EntityId
  user?: UserSummary | null
  text: string
  at: string
}

export interface Dashboard {
  range: DashboardRange
  date: string
  greeting_name: string
  metrics: {
    due_today: DashboardMetric
    overdue: DashboardMetric
    tracked_today: DashboardMetric
    retainer_burn: DashboardMetric | null
  }
  focus: DashboardFocusTask[]
  needs_attention: DashboardRiskTask[]
  upcoming: DashboardUpcomingDay[]
  week: DashboardWeekDay[]
  week_total_minutes: number
  last_week_total_minutes: number
  daily_target_minutes: number
  retainer: DashboardRetainer | null
  activity: DashboardActivity[]
}

// --- timesheet -------------------------------------------------------------

export type TimesheetCutoff = 'semi' | 'month'

/** How a date is written in the copied rows. `8-3`, `08-03`, `Aug 3`. */
export type SheetDateFormat = 'short' | 'pad' | 'mon'

export interface TimesheetRow {
  task_id: EntityId
  date: string
  /** The override when one exists, otherwise `generated`. */
  description: string
  generated: string
  edited: boolean
  minutes: number
  hours: number
  task_title: string
}

export interface TimesheetLane {
  client_id: EntityId | null
  client: string
  minutes: number
  entry_count: number
  rows: TimesheetRow[]
}

export interface TimesheetPeriod {
  start: string
  end: string
  label: string
}

export interface Timesheet {
  cutoff: TimesheetCutoff
  offset: number
  period: TimesheetPeriod
  total_minutes: number
  entry_count: number
  days_worked: number
  /** Time tracked without a task, which cannot be attributed to a client. */
  unassigned_minutes: number
  lanes: TimesheetLane[]
}

// --- Oliver ----------------------------------------------------------------

export interface OliverRisk {
  task_id: EntityId
  title: string
  reason: string
  why: string
  severity: 'high' | 'medium' | 'low'
}

export interface OliverWorkload {
  open: number
  overdue: number
  tracked_week_minutes: number
  target_week_minutes: number
  committed_minutes: number
  over_committed: boolean
}

export interface OliverRetainer {
  client_id: EntityId
  name: string
  used_minutes: number
  retainer_minutes: number
  percent: number
  projected_minutes: number
  over: boolean
}

export interface OliverTimeGap {
  date: string
  tracked_minutes: number
  target_minutes: number
  note: string
}

export interface OliverInsights {
  watching: { projects: number; tasks: number; clients: number }
  risk: OliverRisk[]
  workload: OliverWorkload
  retainer: OliverRetainer[]
  time_gaps: OliverTimeGap[]
}

/** What Oliver did, and whether it has since been reversed. */
export interface OliverActionRecord {
  id: EntityId
  type: string
  summary: string
  entity_type: string
  entity_id: EntityId
  undone_at?: string | null
  created_at: string
}

export type FormValue = string | number | boolean | null | undefined
export type FormPayload = Record<string, FormValue | FormValue[]>
