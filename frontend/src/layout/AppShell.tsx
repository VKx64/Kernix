import { useEffect, useState, type ComponentType } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import {
  BarChart3,
  Briefcase,
  Building2,
  Contact,
  Inbox,
  LayoutDashboard,
  LogOut,
  Moon,
  Pause,
  Play,
  Search,
  Settings,
  SquareCheck,
  Sun,
  UserRound,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { useWorkspace } from '@/auth/WorkspaceProvider'
import { Avatar } from '@/components/shared'
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { api, unwrap } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { ApiEnvelope } from '@/types/api'

interface NavigationItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  permission?: string
}

const navigation: NavigationItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
  { to: '/messages', label: 'Messages', icon: Inbox, permission: 'messages.view' },
  { to: '/tasks', label: 'Tasks', icon: SquareCheck, permission: 'tasks.view' },
  { to: '/projects', label: 'Projects', icon: Briefcase, permission: 'projects.view' },
  { to: '/clients', label: 'Clients', icon: Building2, permission: 'clients.view' },
  { to: '/contacts', label: 'Contacts', icon: Contact, permission: 'contacts.view' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, permission: 'analytics.view' },
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
  const { time, timeBusy, timeAction, singleClientMode, refresh: refreshWorkspace } = useWorkspace()
  const [query, setQuery] = useState('')
  const [unread, setUnread] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const can = useCan()
  // Settings lives under the profile menu only — it is account/admin plumbing,
  // not one of the workspace areas the sidebar lists.
  const settingsTarget = can('settings.view')
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
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <WorkspaceSwitcher onSwitched={async () => { await refreshWorkspace(); navigate(0) }} />
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleNavigation.map((item) => {
                  const active = item.to === '/'
                    ? location.pathname === '/'
                    : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <NavLink end={item.to === '/'} to={item.to}>
                          <item.icon />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                      {item.to === '/messages' && unread > 0 && (
                        <SidebarMenuBadge>{unread > 99 ? '99+' : unread}</SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
              {!visibleNavigation.length && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  No workspace areas are assigned to this role.
                </p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {can('time.track') && (
          <SidebarFooter>
            <div className="flex items-center gap-2 rounded-md border p-2 group-data-[collapsible=icon]:hidden">
              <span
                aria-hidden="true"
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  onBreak ? 'bg-warning' : clockedIn ? 'bg-success animate-pulse' : 'bg-muted-foreground/40',
                )}
              />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-xs text-muted-foreground">
                  {onBreak ? 'On break' : clockedIn ? 'Clocked in' : 'Not clocked in'}
                </p>
                <p className="font-mono text-sm tabular-nums">{clockedIn ? formatElapsed(elapsed) : '--:--:--'}</p>
              </div>
              {!clockedIn && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Clock in"
                  disabled={timeBusy}
                  onClick={() => void timeAction('clock-in')}
                >
                  <Play />
                </Button>
              )}
            </div>
          </SidebarFooter>
        )}
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />

          {can('tasks.view') && (
            <form
              className="relative hidden max-w-sm flex-1 sm:block"
              onSubmit={(event) => {
                event.preventDefault()
                if (query.trim()) navigate(`/tasks?search=${encodeURIComponent(query.trim())}`)
              }}
            >
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tasks and projects…"
                aria-label="Search tasks and projects"
              />
            </form>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* Clocked out: one button, one action. Clocked in: live timer that
                opens the session controls, so the state is never a guess. */}
            {can('time.track') && (clockedIn ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={onBreak ? 'On break, open time tracking' : 'Clocked in, open time tracking'}
                  >
                    <span
                      aria-hidden="true"
                      className={cn('size-2 rounded-full', onBreak ? 'bg-warning' : 'bg-success animate-pulse')}
                    />
                    <span className="font-mono tabular-nums">{formatElapsed(elapsed)}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 space-y-3">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-widest text-muted-foreground">
                      {onBreak ? 'Break in progress' : 'Work session'}
                    </p>
                    <p className="font-mono text-2xl tabular-nums">{formatElapsed(elapsed)}</p>
                    <p className="text-sm text-muted-foreground text-pretty">
                      {onBreak
                        ? 'Your work timer is paused. Resume to keep changing task work.'
                        : 'Task changes and logged note time are recorded against this session.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {onBreak ? (
                      <Button size="sm" disabled={timeBusy} onClick={() => void timeAction('break-end')}>
                        <Play />
                        Resume work
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled={timeBusy} onClick={() => void timeAction('break-start')}>
                        <Pause />
                        Take a break
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={timeBusy} onClick={() => void timeAction('clock-out')}>
                      Clock out
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <Button size="sm" disabled={timeBusy} onClick={() => void timeAction('clock-in')}>
                <Play />
                {timeBusy ? 'Clocking in…' : 'Clock in'}
              </Button>
            ))}

            <Button
              variant="ghost"
              size="icon"
              aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
                  <Avatar user={user} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex items-center gap-2 font-normal">
                  <Avatar user={user} className="size-9" />
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate font-medium">{user?.name || user?.username}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {user?.email || `@${user?.username ?? ''}`}
                    </span>
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <NavLink to="/profile">
                    <UserRound />
                    Profile
                  </NavLink>
                </DropdownMenuItem>
                {settingsTarget && (
                  <DropdownMenuItem asChild>
                    <NavLink to={settingsTarget}>
                      <Settings />
                      Settings
                    </NavLink>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void logout()}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  )
}
