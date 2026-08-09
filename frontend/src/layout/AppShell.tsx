import { useEffect, useState, type ComponentType } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router'
import {
  Briefcase,
  Building2,
  Clock,
  Contact,
  ChevronsUpDown,
  Inbox,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
  SquareCheck,
  UserRound,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { useWorkspace } from '@/auth/WorkspaceProvider'
import { Avatar } from '@/components/shared'
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { TimerBox } from '@/components/timer/TimerBox'
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
import { useTimerContext } from '@/lib/useTimer'
import { cn } from '@/lib/utils'
import { PageActionsSlotContext } from '@/layout/page-actions'
import { PageFillProvider } from '@/layout/page-fill'
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
  { to: '/timesheet', label: 'Timesheet', icon: Clock, permission: 'time.track' },
  { to: '/contacts', label: 'Contacts', icon: Contact, permission: 'contacts.view' },
]

export function AppShell() {
  const { user, logout } = useAuth()
  const { timeBusy, timeAction, singleClientMode, refresh: refreshWorkspace } = useWorkspace()
  const timer = useTimerContext()
  const [query, setQuery] = useState('')
  const [unread, setUnread] = useState(0)
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const can = useCan()
  // Page actions render into the header through this slot, so a page never
  // stacks a second bar of chrome under the shell's own.
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null)

  // On the task list this input *is* the task search — it drives the same
  // `search` param the page reads, so there is only ever one search box.
  const onTaskList = location.pathname === '/tasks'
  const searchValue = onTaskList ? params.get('search') ?? '' : query
  const updateSearch = (value: string) => {
    if (!onTaskList) {
      setQuery(value)
      return
    }
    const next = new URLSearchParams(params)
    if (value) next.set('search', value)
    else next.delete('search')
    setParams(next, { replace: true })
  }
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

  // Attendance is now a consequence of tracking rather than a thing the user
  // manages, so the shell only needs to know whether there is a day to close.
  // It outlives the timer: stopping at noon does not clock you out.
  const clockedIn = timer.clockedIn

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

        <SidebarFooter>
          {can('time.track') && <TimerBox timer={timer} />}

          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" aria-label="Account menu" className="data-[state=open]:bg-sidebar-accent">
                    <Avatar user={user} />
                    <span className="grid flex-1 text-left leading-tight">
                      <span className="truncate font-medium">{user?.name || user?.username}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {user?.email || `@${user?.username ?? ''}`}
                      </span>
                    </span>
                    <ChevronsUpDown className="ml-auto" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56" sideOffset={4}>
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
                  {/* Clocking in happens by starting the timer, so clocking out
                      is the only attendance control left, and it belongs with
                      the other end-of-day action rather than in the header. */}
                  {can('time.track') && clockedIn && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem disabled={timeBusy} onSelect={() => void timeAction('clock-out')}>
                        <LogOut />
                        Clock out
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void logout()}>
                    <LogOut />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      {/* The shell owns the viewport height and the content area does the
          scrolling, so the header stays put and a page can pin its own footer
          to the bottom of the scroll container. */}
      <SidebarInset className="h-svh overflow-hidden">
        {/* 28px page gutter, matched by the content below so a header control
            and the first row under it share an edge. */}
        <header className="z-10 flex h-14 shrink-0 items-center gap-2 border-b border-line-soft bg-background px-4 md:px-7">
          {/* Below md the sidebar is a sheet and this is the only way to open
              it, so the trigger stays there and only the desktop one goes. */}
          <SidebarTrigger className="-ml-1 md:hidden" />

          {can('tasks.view') && (
            <form
              className="hidden items-center gap-2 sm:flex"
              onSubmit={(event) => {
                event.preventDefault()
                if (!onTaskList && query.trim()) navigate(`/tasks?search=${encodeURIComponent(query.trim())}`)
              }}
            >
              {/* Names what the input searches, which is only ever tasks. On
                  the task list it is also that page's heading — the page itself
                  no longer renders one. */}
              {onTaskList
                ? <h1 className="text-sm font-medium">Tasks</h1>
                : <span className="text-sm font-medium">Tasks</span>}
              <div className="relative w-56 lg:w-72">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={searchValue}
                  onChange={(event) => updateSearch(event.target.value)}
                  placeholder={onTaskList ? 'Search task title or project…' : 'Search tasks and projects…'}
                  aria-label={onTaskList ? 'Search task title or project…' : 'Search tasks and projects'}
                />
              </div>
            </form>
          )}

          <div ref={setActionSlot} className="flex min-w-0 flex-1 flex-wrap items-center gap-2" />

        </header>

        <PageFillProvider>
          {(fill) => (
            <main
              className={cn(
                'flex min-h-0 flex-1 flex-col gap-5 px-4 py-4 md:px-7 md:pt-[18px] md:pb-14',
                fill ? 'overflow-hidden' : 'overflow-y-auto',
              )}
            >
              <PageActionsSlotContext.Provider value={actionSlot}>
                <Outlet />
              </PageActionsSlotContext.Provider>
            </main>
          )}
        </PageFillProvider>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  )
}
