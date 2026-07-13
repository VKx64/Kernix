import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { BRAND_MARK, BRAND_NAME } from './brand'
import { sendWorker } from './messaging'
import { normalizeWorkspaceOrigin, permissionPattern } from './origin'
import { elapsedSeconds, formatDuration } from './state'
import type { BootstrapState, ExtensionTask, TaskPage, TimeAction } from './types'

type Screen = 'loading' | 'unpaired' | 'connected'

function deviceName() {
  const browser = navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome'
  const platform = navigator.userAgent.includes('Windows') ? 'Windows' : navigator.platform || 'Computer'
  return `${browser} on ${platform}`
}

function readableError(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback
}

function statusColor(color?: string | null) {
  return color || '#847b91'
}

export function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null)
  const [tasks, setTasks] = useState<ExtensionTask[]>([])
  const [taskMeta, setTaskMeta] = useState<TaskPage['meta'] | null>(null)
  const [selected, setSelected] = useState<ExtensionTask | null>(null)
  const [search, setSearch] = useState('')
  const [tasksLoading, setTasksLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [workspaceOrigin, setWorkspaceOrigin] = useState('http://localhost:5173')
  const [pairingCode, setPairingCode] = useState('')
  const [statusId, setStatusId] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [minutes, setMinutes] = useState('0')
  const [now, setNow] = useState(0)

  const can = useCallback((permission: string) => bootstrap?.permissions.includes(permission) ?? false, [bootstrap])
  const canMutate = Boolean(bootstrap?.time?.can_mutate_tasks)

  const loadBootstrap = useCallback(async () => {
    try {
      const value = await sendWorker<BootstrapState>({ type: 'BOOTSTRAP' })
      setBootstrap(value)
      setScreen('connected')
      setError('')
      return value
    } catch (reason) {
      const code = (reason as { code?: string }).code
      if (code === 'UNPAIRED' || code === 'AUTH') {
        setBootstrap(null)
        setScreen('unpaired')
      } else {
        setError(readableError(reason, 'Unable to load extension state.'))
        setScreen('unpaired')
      }
      return null
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadBootstrap() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadBootstrap])
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const loadTasks = useCallback(async (page = 1, append = false, query = search) => {
    if (!can('tasks.view')) return
    setTasksLoading(true)
    try {
      const result = await sendWorker<TaskPage>({ type: 'TASKS_QUERY', search: query, page })
      if (!result || !Array.isArray(result.data) || !result.meta) {
        throw new Error('The workspace returned an invalid task list response.')
      }
      setTasks((current) => append ? [...current, ...result.data] : result.data)
      setTaskMeta(result.meta)
      setSelected((current) => current ? result.data.find((task) => task.id === current.id) ?? current : null)
      setError('')
    } catch (reason) {
      setError(readableError(reason, 'Unable to load assigned tasks.'))
    } finally {
      setTasksLoading(false)
    }
  }, [can, search])

  useEffect(() => {
    if (screen !== 'connected' || !can('tasks.view')) return
    const timer = window.setTimeout(() => { void loadTasks(1, false, search) }, 250)
    return () => window.clearTimeout(timer)
  }, [screen, search, can, loadTasks])

  const selectTask = (task: ExtensionTask) => {
    setSelected(task)
    setStatusId(task.status ? String(task.status.id) : '')
    setNoteBody('')
    setMinutes('0')
    setError('')
    setSuccess('')
  }

  const pairExtension = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const origin = normalizeWorkspaceOrigin(workspaceOrigin)
      const granted = await chrome.permissions.request({ origins: [permissionPattern(origin)] })
      if (!granted) throw new Error('Host access is required to connect to this workspace.')
      const value = await sendWorker<BootstrapState>({
        type: 'PAIR',
        origin,
        code: pairingCode.trim().toUpperCase(),
        deviceName: deviceName(),
      })
      setBootstrap(value)
      setWorkspaceOrigin(origin)
      setPairingCode('')
      setScreen('connected')
    } catch (reason) {
      setError(readableError(reason, 'Unable to pair the extension.'))
    } finally {
      setBusy(false)
    }
  }

  const runTimeAction = async (action: TimeAction) => {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const value = await sendWorker<BootstrapState>({ type: 'TIME_ACTION', action })
      setBootstrap(value)
    } catch (reason) {
      setError(readableError(reason, 'Unable to update your work session.'))
    } finally {
      setBusy(false)
    }
  }

  const saveStatus = async () => {
    if (!selected || !statusId) return
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const task = await sendWorker<ExtensionTask>({
        type: 'TASK_STATUS_UPDATE',
        taskId: selected.id,
        statusId: Number(statusId),
      })
      setSelected(task)
      setStatusId(task.status ? String(task.status.id) : '')
      setTasks((current) => current.map((item) => item.id === task.id ? task : item))
      await loadBootstrap()
      setSuccess('Status updated.')
    } catch (reason) {
      setError(readableError(reason, 'Unable to update task status.'))
    } finally {
      setBusy(false)
    }
  }

  const addNote = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected || !noteBody.trim()) return
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await sendWorker({
        type: 'TASK_NOTE_ADD',
        taskId: selected.id,
        body: noteBody.trim(),
        minutes: can('tasks.log_time') ? Math.max(0, Number(minutes) || 0) : 0,
      })
      setNoteBody('')
      setMinutes('0')
      await Promise.all([loadBootstrap(), loadTasks(1, false, search)])
      setSuccess('Note added.')
    } catch (reason) {
      setError(readableError(reason, 'Unable to add the task note.'))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!window.confirm(`Disconnect this extension from ${BRAND_NAME}?`)) return
    setBusy(true)
    try {
      const result = await sendWorker<{ warning?: string }>({ type: 'DISCONNECT' })
      setBootstrap(null)
      setTasks([])
      setSelected(null)
      setScreen('unpaired')
      setError(result.warning ?? '')
    } finally {
      setBusy(false)
    }
  }

  const openTask = async () => {
    if (!selected || !bootstrap) return
    await chrome.tabs.create({ url: `${bootstrap.workspace.origin}/tasks/${selected.id}` })
  }

  const timeLabel = useMemo(() => formatDuration(elapsedSeconds(bootstrap?.time ?? null, now)), [bootstrap?.time, now])

  if (screen === 'loading') {
    return <main className="popup-shell center-state"><span className="spinner" /><p>Loading companion…</p></main>
  }

  if (screen === 'unpaired') {
    return (
      <main className="popup-shell setup-screen">
        <header className="brand-header">
          <span className="brand-mark">{BRAND_MARK}</span>
          <div><strong>{BRAND_NAME}</strong><small>Companion</small></div>
        </header>
        <section className="setup-copy">
          <span className="eyebrow">Connect workspace</span>
          <h1>Time and tasks, one click away.</h1>
          <p>Generate a pairing code from Profile → Browser extension in the web app.</p>
        </section>
        {error && <div className="alert error" role="alert">{error}</div>}
        <form className="setup-form" onSubmit={(event) => void pairExtension(event)}>
          <label>Workspace URL<input type="url" value={workspaceOrigin} onChange={(event) => setWorkspaceOrigin(event.target.value)} placeholder="https://kernix.example.com" required /></label>
          <label>One-time pairing code<input className="code-input" value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} placeholder="ABCDE-FGHIJ" maxLength={11} required /></label>
          <button className="button primary" disabled={busy}>{busy ? 'Pairing…' : 'Pair extension'}</button>
        </form>
        <p className="privacy-note">Requests access only to this workspace. No visited-page data is collected.</p>
      </main>
    )
  }

  if (!bootstrap) return null

  if (selected) {
    const statusChanged = statusId !== String(selected.status?.id ?? '')
    return (
      <main className="popup-shell">
        <header className="task-detail-header">
          <button className="icon-button" title="Back to tasks" onClick={() => setSelected(null)}>←</button>
          <div><small>{selected.project?.name ?? 'No project'}</small><h1>{selected.title}</h1></div>
          <button className="icon-button" title="Open in web app" onClick={() => void openTask()}>↗</button>
        </header>
        <div className="popup-scroll task-detail-body">
          {!canMutate && <div className="clock-gate">Clock in before changing task work.</div>}
          {error && <div className="alert error" role="alert">{error}</div>}
          {success && <div className="alert success">{success}</div>}
          <div className="task-facts">
            <span>{selected.urgency?.label ?? 'Normal priority'}</span>
            <span>{selected.due_date ? `Due ${new Date(`${selected.due_date}T00:00:00`).toLocaleDateString()}` : 'No due date'}</span>
            <span>{selected.actual_minutes}m logged</span>
          </div>
          {can('tasks.change_status') && (
            <section className="detail-section">
              <div className="section-heading"><strong>Status</strong><span>Update workflow state</span></div>
              <select value={statusId} disabled={!canMutate || busy} onChange={(event) => setStatusId(event.target.value)}>
                {bootstrap.task_statuses.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
              </select>
              <button className="button primary" disabled={!canMutate || busy || !statusChanged} onClick={() => void saveStatus()}>{busy ? 'Saving…' : 'Save status'}</button>
            </section>
          )}
          {can('tasks.comment') && (
            <form className="detail-section" onSubmit={(event) => void addNote(event)}>
              <div className="section-heading"><strong>Add note</strong><span>Recorded on the task</span></div>
              <textarea value={noteBody} disabled={!canMutate || busy} onChange={(event) => setNoteBody(event.target.value)} placeholder="What changed or what did you work on?" required />
              {can('tasks.log_time') && <label className="minutes-field">Minutes<input type="number" min="0" step="1" value={minutes} disabled={!canMutate || busy} onChange={(event) => setMinutes(event.target.value)} /></label>}
              <button className="button primary" disabled={!canMutate || busy || !noteBody.trim()}>{busy ? 'Adding…' : 'Add note'}</button>
            </form>
          )}
          <button className="button quiet full" onClick={() => void openTask()}>Open full task in web app ↗</button>
        </div>
      </main>
    )
  }

  const clockState = bootstrap.time?.state ?? 'clocked_out'
  return (
    <main className="popup-shell">
      <header className="connected-header">
        <div className="brand-header compact"><span className="brand-mark">{BRAND_MARK}</span><div><strong>{bootstrap.workspace.name}</strong><small>{bootstrap.user.name}</small></div></div>
        <button className="text-button" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
      </header>
      <div className="popup-scroll">
        {bootstrap.stale && <div className="stale-banner">Offline · showing state from {bootstrap.last_synced_at ? new Date(bootstrap.last_synced_at).toLocaleTimeString() : 'the last sync'}</div>}
        {error && <div className="alert error" role="alert">{error}</div>}
        {can('time.track') && bootstrap.time && (
          <section className={`time-card ${clockState}`}>
            <div className="time-card-top"><div><span className="state-dot" /><strong>{clockState === 'working' ? 'Working' : clockState === 'break' ? 'On break' : 'Clocked out'}</strong></div><small>Task time today · {bootstrap.time.today_minutes}m</small></div>
            <div className="elapsed">{clockState === 'clocked_out' ? '00:00:00' : timeLabel}</div>
            <div className="time-actions">
              {clockState === 'clocked_out' && <button className="button primary" disabled={busy} onClick={() => void runTimeAction('clock-in')}>▶ Clock in</button>}
              {clockState === 'working' && <><button className="button quiet" disabled={busy} onClick={() => void runTimeAction('break-start')}>Ⅱ Start break</button><button className="button danger" disabled={busy} onClick={() => void runTimeAction('clock-out')}>Clock out</button></>}
              {clockState === 'break' && <><button className="button primary" disabled={busy} onClick={() => void runTimeAction('break-end')}>▶ End break</button><button className="button danger" disabled={busy} onClick={() => void runTimeAction('clock-out')}>Clock out</button></>}
            </div>
          </section>
        )}
        {can('tasks.view') ? (
          <section className="tasks-section">
            <div className="tasks-heading"><div><span className="eyebrow">Assigned work</span><h2>My tasks</h2></div><span>{taskMeta?.total ?? 0}</span></div>
            <input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search task or project…" />
            <div className="task-list">
              {tasksLoading && tasks.length === 0 ? <div className="list-state"><span className="spinner" /> Loading tasks…</div> : tasks.length === 0 ? <div className="list-state">No assigned tasks match this view.</div> : tasks.map((task) => (
                <button className="task-card" key={task.id} onClick={() => selectTask(task)}>
                  <div className="task-card-top"><span>{task.project?.name ?? 'No project'}</span><span>{task.due_date ? new Date(`${task.due_date}T00:00:00`).toLocaleDateString() : 'No due date'}</span></div>
                  <strong>{task.title}</strong>
                  <div className="task-card-bottom"><span className="status-pill" style={{ '--status-color': statusColor(task.status?.color) } as React.CSSProperties}>{task.status?.label ?? 'No status'}</span><span>{task.actual_minutes}m / {task.estimated_minutes || 0}m</span></div>
                </button>
              ))}
              {taskMeta && taskMeta.current_page < taskMeta.last_page && <button className="button quiet full" disabled={tasksLoading} onClick={() => void loadTasks(taskMeta.current_page + 1, true)}>{tasksLoading ? 'Loading…' : 'Load more'}</button>}
            </div>
          </section>
        ) : <div className="list-state permission-state">Your role does not include task access.</div>}
      </div>
    </main>
  )
}
