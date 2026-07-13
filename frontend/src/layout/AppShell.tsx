import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useWorkspace } from '../auth/WorkspaceProvider'
import { Icon, type IconName } from '../components/Icon'
import { Avatar } from '../components/ui'
import { api, unwrap } from '../lib/api'
import { BRAND_MARK, BRAND_NAME } from '../lib/brand'
import { useCan } from '../lib/permissions'
import type { ApiEnvelope } from '../types/api'

interface NavigationItem {
  to: string
  label: string
  icon: IconName
  permission?: string
}

const navigation: NavigationItem[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard.view' },
  { to: '/messages', label: 'Messages', icon: 'inbox', permission: 'messages.view' },
  { to: '/tasks', label: 'Tasks', icon: 'task', permission: 'tasks.view' },
  { to: '/projects', label: 'Projects', icon: 'briefcase', permission: 'projects.view' },
  { to: '/clients', label: 'Clients', icon: 'building', permission: 'clients.view' },
  { to: '/contacts', label: 'Contacts', icon: 'contact', permission: 'contacts.view' },
  { to: '/analytics', label: 'Analytics', icon: 'analytics', permission: 'analytics.view' },
]

function formatElapsed(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function AppShell() {
  const { user, logout } = useAuth()
  const { time, timeBusy, timeAction, singleClientMode } = useWorkspace()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const [timerOpen, setTimerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [unread, setUnread] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')
  const location = useLocation()
  const navigate = useNavigate()
  const can = useCan()
  const administrationTarget = can('settings.view')
    ? '/settings'
    : can('users.view')
      ? '/settings/users'
      : can('roles.view')
        ? '/settings/roles'
        : can('fields.view')
          ? '/settings/fields'
          : null
  const visibleNavigation = navigation.filter((item) => {
    if (item.to === '/clients' && singleClientMode) return false
    return !item.permission || can(item.permission)
  })
  if (administrationTarget) visibleNavigation.push({ to: administrationTarget, label: 'Administration', icon: 'gear' })

  const state = time?.state ?? time?.status ?? 'clocked_out'
  const clockedIn = Boolean(time?.clockedIn ?? time?.clocked_in ?? time?.isClockedIn ?? time?.is_clocked_in ?? time?.session ?? ['working', 'clocked_in'].includes(state))
  const onBreak = Boolean(time?.onBreak ?? time?.on_break ?? time?.isOnBreak ?? time?.is_on_break ?? time?.currentBreak ?? time?.current_break ?? state === 'break')
  const started = time?.startedAt ?? time?.started_at ?? time?.session?.clockInAt ?? time?.session?.clock_in_at
  const initialElapsed = time?.elapsedSeconds ?? time?.elapsed_seconds ?? 0
  const breakMilliseconds = (time?.session?.breaks ?? []).reduce((total, entry) => {
    const breakStarted = entry.startAt ?? entry.start_at
    if (!breakStarted) return total
    const breakEnded = entry.endAt ?? entry.end_at
    return total + Math.max(0, (breakEnded ? new Date(breakEnded).getTime() : now) - new Date(breakStarted).getTime())
  }, 0)
  const elapsed = started ? Math.max(0, Math.floor((now - new Date(started).getTime() - breakMilliseconds) / 1000)) : initialElapsed

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    if (!clockedIn) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [clockedIn])

  useEffect(() => {
    if (!can('messages.view')) {
      setUnread(0)
      return
    }
    let active = true
    const loadUnread = async () => {
      try {
        const response = await api.get<ApiEnvelope<{ count?: number; unread_count?: number }> | { count?: number; unread_count?: number }>('/api/messages/unread-count')
        const value = unwrap(response)
        if (active) setUnread(value.count ?? value.unread_count ?? 0)
      } catch {
        // Badge is supplemental; the inbox still presents its own state.
      }
    }
    void loadUnread()
    const interval = window.setInterval(loadUnread, 60_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [can, location.pathname])

  return (
    <div className="app-shell">
      <button className={`sidebar-scrim ${mobileOpen ? 'open' : ''}`} aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">{BRAND_MARK}</span>
          <span className="brand-copy"><strong>{BRAND_NAME}</strong><small>Workspace</small></span>
        </div>

        <nav className="main-nav">
          <span className="nav-kicker">Workspace</span>
          {visibleNavigation.map((item) => (
            <NavLink end={item.to === '/'} className={({ isActive }) => `nav-link ${(isActive || (item.label === 'Administration' && location.pathname.startsWith('/settings'))) ? 'active' : ''}`} key={item.to} to={item.to} onClick={() => setMobileOpen(false)}>
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.to === '/messages' && unread > 0 && <b className="nav-count">{unread > 99 ? '99+' : unread}</b>}
            </NavLink>
          ))}
          {!visibleNavigation.length && <p className="nav-empty">No workspace areas are assigned to this role.</p>}
        </nav>

        {can('time.track') && <div className="sidebar-footer">
          <div className={`mini-clock ${clockedIn ? 'active' : ''} ${onBreak ? 'break' : ''}`}>
            <span className="mini-clock-dot" />
            <div><small>{onBreak ? 'On break' : clockedIn ? 'Clocked in' : 'Not clocked in'}</small><strong>{clockedIn ? formatElapsed(elapsed) : '--:--:--'}</strong></div>
            {!clockedIn && <button className="icon-button" aria-label="Clock in" disabled={timeBusy} onClick={() => void timeAction('clock-in')}><Icon name="play" size={16} /></button>}
          </div>
        </div>}
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Icon name="menu" /></button>
            {can('tasks.view') && <form className="global-search" onSubmit={(event) => { event.preventDefault(); if (query.trim()) navigate(`/tasks?search=${encodeURIComponent(query.trim())}`) }}>
              <Icon name="search" size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks and projects…" />
              <kbd>↵</kbd>
            </form>}
          </div>
          <div className="topbar-actions">
            {can('time.track') && <div className="popover-wrap">
              <button className={`timer-trigger ${clockedIn ? 'active' : ''}`} onClick={() => setTimerOpen((open) => !open)}>
                <span className="live-dot" />
                <span>{onBreak ? 'Break' : clockedIn ? formatElapsed(elapsed) : 'Clock in'}</span>
                <Icon name="chevron-down" size={15} />
              </button>
              {timerOpen && (
                <div className="popover timer-popover">
                  <span className="popover-label">Time tracking</span>
                  <strong>{clockedIn ? formatElapsed(elapsed) : 'Ready when you are'}</strong>
                  <p>{onBreak ? 'Your work timer is paused.' : clockedIn ? 'Your work session is active.' : 'Clock in before changing task work.'}</p>
                  <div className="timer-actions">
                    {!clockedIn ? (
                      <button className="btn btn-primary" disabled={timeBusy} onClick={() => void timeAction('clock-in')}><Icon name="play" size={15} /> Clock in</button>
                    ) : onBreak ? (
                      <button className="btn btn-primary" disabled={timeBusy} onClick={() => void timeAction('break-end')}><Icon name="play" size={15} /> Resume</button>
                    ) : (
                      <button className="btn btn-quiet" disabled={timeBusy} onClick={() => void timeAction('break-start')}><Icon name="pause" size={15} /> Take break</button>
                    )}
                    {clockedIn && <button className="btn btn-danger-quiet" disabled={timeBusy} onClick={() => void timeAction('clock-out')}>Clock out</button>}
                  </div>
                </div>
              )}
            </div>}
            <button className="icon-button" aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
            </button>
            <div className="popover-wrap">
              <button className="user-trigger" onClick={() => setUserOpen((open) => !open)}><Avatar user={user} size={34} /><Icon name="chevron-down" size={14} /></button>
              {userOpen && (
                <div className="popover user-popover">
                  <div className="user-summary"><Avatar user={user} size={40} /><div><strong>{user?.name || user?.username}</strong><span>{user?.email || `@${user?.username ?? ''}`}</span></div></div>
                  <NavLink to="/profile" onClick={() => setUserOpen(false)}><Icon name="profile" size={17} /> Profile</NavLink>
                  {administrationTarget && <NavLink to={administrationTarget} onClick={() => setUserOpen(false)}><Icon name="gear" size={17} /> Administration</NavLink>}
                  <button onClick={() => void logout()}><Icon name="logout" size={17} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="page-content"><Outlet /></main>
      </div>
    </div>
  )
}
