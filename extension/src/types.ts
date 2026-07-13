export type ClockState = 'clocked_out' | 'working' | 'break'
export type TimeAction = 'clock-in' | 'clock-out' | 'break-start' | 'break-end'

export interface ExtensionUser {
  id: number
  username: string
  name: string
}

export interface Workspace {
  name: string
  origin: string
}

export interface FieldOption {
  id: number
  label: string
  key: string
  color?: string | null
}

export interface TimeBreak {
  id?: number
  start_at: string
  end_at?: string | null
}

export interface TimeState {
  state: ClockState
  started_at?: string | null
  today_minutes: number
  can_mutate_tasks: boolean
  session?: {
    id: number
    clock_in_at: string
    clock_out_at?: string | null
    breaks?: TimeBreak[]
  } | null
  current_break?: TimeBreak | null
}

export interface BootstrapState {
  user: ExtensionUser
  permissions: string[]
  workspace: Workspace
  time: TimeState | null
  task_statuses: FieldOption[]
  stale?: boolean
  last_synced_at?: string
}

export interface ExtensionTask {
  id: number
  title: string
  project?: { id: number; name: string; client?: { id: number; name: string } | null } | null
  status?: FieldOption | null
  urgency?: FieldOption | null
  due_date?: string | null
  estimated_minutes: number
  actual_minutes: number
}

export interface TaskPage {
  data: ExtensionTask[]
  meta: {
    current_page: number
    last_page: number
    per_page: number
    total: number
  }
}

export type WorkerRequest =
  | { type: 'PAIR'; origin: string; code: string; deviceName: string }
  | { type: 'BOOTSTRAP' }
  | { type: 'TASKS_QUERY'; search: string; page: number }
  | { type: 'TASK_STATUS_UPDATE'; taskId: number; statusId: number }
  | { type: 'TASK_NOTE_ADD'; taskId: number; body: string; minutes: number }
  | { type: 'TIME_ACTION'; action: TimeAction }
  | { type: 'DISCONNECT' }

export interface WorkerError {
  code: 'UNPAIRED' | 'AUTH' | 'NETWORK' | 'API' | 'UNKNOWN'
  message: string
  status?: number
}

export type WorkerResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: WorkerError }

export interface StoredState {
  workspaceOrigin?: string
  deviceId?: string
  token?: string
  tokenExpiresAt?: string
  lastBootstrap?: BootstrapState
  lastSyncAt?: string
}
