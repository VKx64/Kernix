import { useEffect, useState, type ComponentType, type CSSProperties } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import {
  Briefcase,
  Building2,
  Clock,
  Contact,
  ChevronDown,
  ChevronRight,
  Inbox,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  SquareCheck,
  UserRound,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { useWorkspace } from '@/auth/WorkspaceProvider'
import { Avatar } from '@/components/shared'
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher'
import { ProjectFolderNavigation } from '@/components/ProjectFolderNavigation'
import { SidebarItemActions } from '@/components/SidebarItemActions'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { api, unwrap } from '@/lib/api'
import { useCollection } from '@/lib/useCollection'
import { useFeature } from '@/lib/features'
import { useCan } from '@/lib/permissions'
import { useTimerContext } from '@/lib/useTimer'
import { cn } from '@/lib/utils'
import { PageFillProvider } from '@/layout/page-fill'
import type { ApiEnvelope, Project } from '@/types/api'

function ProjectNavigation({ canViewTasks }: { canViewTasks: boolean }) {
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const { data: projects, loading, error, reload } = useCollection<Project>('/api/projects', { all: true, filters: { archived: showArchived ? 'with' : undefined } })
  const navigate = useNavigate()
  const location = useLocation()
  const selected = new URLSearchParams(location.search).get('project_id')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3 border-b px-3 pb-3">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Projects</h2><NavLink to="/projects" className="text-xs text-muted-foreground hover:text-foreground">View all</NavLink></div>
        <label className="flex items-center gap-2 rounded-md border px-2"><Search aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /><input aria-label="Search projects" placeholder="Search projects…" value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent py-2 text-xs outline-none" /></label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />Show archived</label>
      </div>
      <nav aria-label="Project folders" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
      <SidebarMenuSub className="mx-0 border-0 px-0">
      {loading && !projects.length && <li className="p-2 text-xs text-muted-foreground">Loading projects…</li>}
      {!loading && !error && !projects.some(project => project.name.toLowerCase().includes(search.trim().toLowerCase())) && <li className="p-2 text-xs text-muted-foreground">{search ? 'No projects match your search.' : 'No projects yet.'}</li>}
      {error && <li className="px-2 py-1 text-xs text-muted-foreground">Projects could not be loaded.</li>}
      {projects.filter(project => project.name.toLowerCase().includes(search.trim().toLowerCase())).map((project) => (
        <SidebarMenuSubItem key={project.id}>
          <div className="flex items-center">
          {canViewTasks && <button type="button" aria-label={`Toggle folders for ${project.name}`} aria-expanded={expanded[String(project.id)] ?? true} onClick={() => setExpanded(value => ({ ...value, [String(project.id)]: !(value[String(project.id)] ?? true) }))}>
            {(expanded[String(project.id)] ?? true) ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>}
          <SidebarMenuSubButton asChild isActive={canViewTasks
            ? location.pathname === '/tasks' && selected === String(project.id)
            : location.pathname === `/projects/${project.id}`}>
            <NavLink to={canViewTasks ? `/tasks?project_id=${encodeURIComponent(project.id)}${project.archived_at ? '&archived=1' : ''}` : `/projects/${project.id}`} title={project.name}>
              <span className={project.archived_at ? 'text-muted-foreground italic' : ''}>{project.name}{project.archived_at ? ' (archived)' : ''}</span>
            </NavLink>
          </SidebarMenuSubButton>
          <SidebarItemActions name={project.name} path={`/api/projects/${project.id}`} href={canViewTasks ? `/tasks?project_id=${project.id}` : `/projects/${project.id}`} archived={Boolean(project.archived_at)} onSaved={() => { reload(); window.dispatchEvent(new Event('kernix:projects-changed')); window.dispatchEvent(new Event('kernix:task-folders-changed')) }} onRemoved={() => { if (selected === String(project.id) || location.pathname === `/projects/${project.id}`) navigate('/tasks') }} />
          </div>
          {canViewTasks && (expanded[String(project.id)] ?? true) && <ProjectFolderNavigation projectId={project.id} showArchived={showArchived} projectArchived={Boolean(project.archived_at)} />}
        </SidebarMenuSubItem>
      ))}
      </SidebarMenuSub>
      </nav>
    </div>
  )
}

/** Close the mobile drawer after navigation without disturbing desktop panels. */
function MobileNavigationDismiss() {
  const { pathname, search } = useLocation()
  const { setOpenMobile } = useSidebar()
  useEffect(() => { setOpenMobile(false) }, [pathname, search, setOpenMobile])
  return null
}

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
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [panelWidth, setPanelWidth] = useState(() => {
    try { return Math.max(240, Math.min(420, Number(localStorage.getItem('kernix:project-panel-width')) || 280)) }
    catch { return 280 }
  })
  useEffect(() => {
    try { localStorage.setItem('kernix:project-panel-width', String(panelWidth)) } catch { /* Storage is optional. */ }
  }, [panelWidth])
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
  const showProjects = visibleNavigation.some(item => item.to === '/projects')

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
    <SidebarProvider style={{ '--sidebar-width': `${72 + (projectsOpen ? panelWidth : 0)}px` } as CSSProperties}>
      <MobileNavigationDismiss />
      <Sidebar collapsible="offcanvas">
        <div className="relative flex h-full min-h-0">
        <aside aria-label="Workspace navigation" className="flex w-14 shrink-0 flex-col border-r md:w-[72px]">
          <div className="flex h-16 shrink-0 items-center justify-center"><span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground" aria-label="Kernix">K</span></div>
          <nav aria-label="Workspace areas" className="min-h-0 flex-1 overflow-y-auto px-1">
              <ul className="space-y-1">
                {visibleNavigation.map((item) => {
                  const active = item.to === '/'
                    ? location.pathname === '/'
                    : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
                  return (
                    <li key={item.to} className="relative">
                      <NavLink end={item.to === '/'} to={item.to} title={item.label} aria-label={item.label} onClick={() => { if (item.to === '/projects') setProjectsOpen(true) }} className={cn('flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-0.5 py-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-ring', active && 'bg-sidebar-accent text-sidebar-foreground')}>
                        <item.icon aria-hidden="true" className="size-[18px]" />
                        <span className="max-w-full truncate text-[9px] font-medium md:text-[10px]">{item.label === 'Dashboard' ? 'Home' : item.label}</span>
                        {item.live && <span aria-hidden="true" className="absolute right-2 top-2 size-1 rounded-full bg-good" />}
                        {((item.badge === 'unread' && unread > 0) || (item.badge === 'tasks' && openTasks > 0)) && <span className="absolute right-0 top-0 rounded bg-primary px-1 text-[9px] text-primary-foreground">{Math.min(item.badge === 'unread' ? unread : openTasks, 99)}</span>}
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
              {!visibleNavigation.length && (
                <p className="px-1 py-1.5 text-[10px] text-muted-foreground">
                  No workspace areas are assigned to this role.
                </p>
              )}
          </nav>
          <button type="button" aria-label={projectsOpen ? 'Collapse project panel' : 'Expand project panel'} aria-expanded={projectsOpen} onClick={() => setProjectsOpen(value => !value)} className="mx-2 mb-2 hidden h-9 shrink-0 items-center justify-center rounded hover:bg-sidebar-accent md:flex" title={projectsOpen ? 'Collapse project panel' : 'Expand project panel'}>{projectsOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}</button>

        <SidebarFooter className="shrink-0 border-t px-1">
          {can('time.track') && <Popover><PopoverTrigger asChild><button type="button" aria-label="Open clock controls" title="Clock controls" className="flex h-10 items-center justify-center rounded hover:bg-sidebar-accent"><Clock className={cn('size-4', clockedIn && 'text-good')} /></button></PopoverTrigger><PopoverContent side="right" align="end" className="w-72 p-2"><TimerBox timer={timer} /></PopoverContent></Popover>}

          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" aria-label="Account menu" title="Account menu" className="justify-center px-0 data-[state=open]:bg-sidebar-accent">
                    <Avatar user={user} />
                    <span className="sr-only">
                      <span className="truncate font-medium">{user?.name || user?.username}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {user?.email || `@${user?.username ?? ''}`}
                      </span>
                    </span>
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
        </aside>
        <section aria-label="Project panel" className={cn('flex min-h-0 min-w-0 flex-1 flex-col', !projectsOpen && 'md:hidden')}>
          <SidebarHeader className="shrink-0 pb-4 pr-8 md:pr-2"><WorkspaceSwitcher onSwitched={async () => { await refreshWorkspace(); navigate(0) }} /></SidebarHeader>
          <SidebarTrigger className="absolute right-1 top-2 md:hidden" />
          {showProjects ? <ProjectNavigation key={user?.id} canViewTasks={can('tasks.view')} /> : <div className="flex-1 p-3 text-sm text-muted-foreground">Choose a workspace area from the app rail.</div>}
          {can('time.track') && <div className="shrink-0 border-t p-3"><TimerBox timer={timer} /></div>}
        </section>
        {projectsOpen && <div role="separator" aria-label="Resize project panel" aria-orientation="vertical" aria-valuemin={240} aria-valuemax={420} aria-valuenow={panelWidth} tabIndex={0} className="absolute inset-y-0 -right-1 z-20 hidden w-2 cursor-col-resize touch-none hover:bg-primary/20 focus-visible:bg-primary/20 md:block"
          onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId) }}
          onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setPanelWidth(Math.max(240, Math.min(420, event.clientX - 72))) }}
          onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
          onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); setPanelWidth(value => Math.max(240, Math.min(420, value + (event.key === 'ArrowRight' ? 16 : -16)))) } }}
        />}
        </div>
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
                'flex min-h-0 flex-1 flex-col gap-5 px-4 pt-12 pb-4 md:px-7 md:pt-[18px] md:pb-14',
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
