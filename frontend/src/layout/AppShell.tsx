import { useEffect, useState, type ComponentType } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import {
  Briefcase,
  Building2,
  Clock,
  Contact,
  ChevronsUpDown,
  Inbox,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
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
import { CommandPalette } from '@/components/CommandPalette'
import { ShortcutsDialog } from '@/components/ShortcutsDialog'
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
import { useFeature } from '@/lib/features'
import { useCan } from '@/lib/permissions'
import { useTimerContext } from '@/lib/useTimer'
import { cn } from '@/lib/utils'
import { PageFillProvider } from '@/layout/page-fill'
import type { ApiEnvelope } from '@/types/api'

interface NavigationItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  permission?: string
  /** A per-workspace switch this item also needs to be on for. */
  feature?: string
  /** A presence dot rather than a count — only Oliver carries one. */
  live?: boolean
  /** Which running total, if any, badges this item. */
  badge?: 'unread' | 'tasks'
}

const navigation: NavigationItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
  { to: '/messages', label: 'Messages', icon: Inbox, permission: 'messages.view', feature: 'messages', badge: 'unread' },
  { to: '/tasks', label: 'Tasks', icon: SquareCheck, permission: 'tasks.view', badge: 'tasks' },
  { to: '/projects', label: 'Projects', icon: Briefcase, permission: 'projects.view', feature: 'projects' },
  { to: '/clients', label: 'Clients', icon: Building2, permission: 'clients.view', feature: 'clients' },
  // Oliver is a place in the design's nav, not a row inside Messages. The dot
  // is presence, not a count — it says the assistant is watching.
  { to: '/oliver', label: 'Oliver', icon: Sparkles, permission: 'messages.view', feature: 'oliver', live: true },
  { to: '/timesheet', label: 'Timesheet', icon: Clock, permission: 'time.track', feature: 'timesheet' },
  { to: '/contacts', label: 'Contacts', icon: Contact, permission: 'contacts.view', feature: 'contacts' },
]

export function AppShell() {
  const { user, logout } = useAuth()
  const { timeBusy, timeAction, singleClientMode, refresh: refreshWorkspace } = useWorkspace()
  const timer = useTimerContext()
  const [unread, setUnread] = useState(0)
  const [openTasks, setOpenTasks] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const can = useCan()
  const hasFeature = useFeature()
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
    if (item.feature && !hasFeature(item.feature)) return false
    return !item.permission || can(item.permission)
  })

  // Attendance is now a consequence of tracking rather than a thing the user
  // manages, so the shell only needs to know whether there is a day to close.
  // It outlives the timer: stopping at noon does not clock you out.
  const clockedIn = timer.clockedIn

  useEffect(() => {
    if (!can('messages.view') || !hasFeature('messages')) {
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
  }, [can, hasFeature, location.pathname])

  /**
   * The two global overlays. They live here rather than on a page because the
   * design offers them everywhere, and because Escape has to close them before
   * any page's own Escape handling runs — which it does, since this listener
   * is attached first and stops the event.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName.toLowerCase()
      const typing = tag === 'input' || tag === 'textarea' || target?.isContentEditable

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (event.key === 'Escape' && (paletteOpen || shortcutsOpen)) {
        event.stopPropagation()
        setPaletteOpen(false)
        setShortcutsOpen(false)
        return
      }
      // `?` is Shift+/ — a plain key, so it must not fire mid-sentence.
      if (event.key === '?' && !typing && !paletteOpen) {
        event.preventDefault()
        setShortcutsOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [paletteOpen, shortcutsOpen])

  // The design badges Tasks with how much is on your plate. It reads the same
  // `mine` view the task screen counts, so the two can never disagree.
  useEffect(() => {
    if (!can('tasks.view')) {
      setOpenTasks(0)
      return
    }
    let active = true
    void api.get<{ counts?: { mine?: number } }>('/api/tasks', { view: 'mine', per_page: 1 })
      .then((response) => { if (active) setOpenTasks(response.counts?.mine ?? 0) })
      .catch(() => { /* Supplemental, like the unread badge. */ })
    return () => { active = false }
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
                      {item.live && (
                        <SidebarMenuBadge>
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-good" />
                        </SidebarMenuBadge>
                      )}
                      {item.badge === 'unread' && unread > 0 && (
                        <SidebarMenuBadge>{unread > 99 ? '99+' : unread}</SidebarMenuBadge>
                      )}
                      {item.badge === 'tasks' && openTasks > 0 && (
                        <SidebarMenuBadge>{openTasks > 99 ? '99+' : openTasks}</SidebarMenuBadge>
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

      {/* No shell header: in the design the sidebar runs full height and every
          screen owns its own top area — Messages has none at all. A global bar
          would sit above all of them carrying one screen's search. */}
      <SidebarInset className="h-svh overflow-hidden">
        {/* Below md the sidebar is a sheet, so the only way to open it is a
            trigger floating over the page rather than a bar reserved for it. */}
        <SidebarTrigger className="absolute left-2 top-2 z-20 md:hidden" />

        <PageFillProvider>
          {(fill) => (
            <main
              className={cn(
                'flex min-h-0 flex-1 flex-col gap-5 px-4 py-4 md:px-7 md:pt-[18px] md:pb-14',
                fill ? 'overflow-hidden' : 'overflow-y-auto',
              )}
            >
              <Outlet />
            </main>
          )}
        </PageFillProvider>
      </SidebarInset>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onShortcuts={() => setShortcutsOpen(true)}
      />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <Toaster />
    </SidebarProvider>
  )
}
