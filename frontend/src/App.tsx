import { Navigate, Route, Routes, useLocation } from 'react-router'
import { useAuth } from './auth/AuthProvider'
import { WorkspaceProvider } from './auth/WorkspaceProvider'
import { AppShell } from './layout/AppShell'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { BRAND_MARK } from './lib/brand'
import { useCan } from './lib/permissions'
import { ClientsPage, ContactsPage, FieldsPage, ProjectsPage, RolesPage, UsersPage } from './pages/EntityPages'
import { DashboardPage } from './pages/DashboardPage'
import { DesignSystemPage } from './pages/DesignSystemPage'
import { InviteAcceptPage } from './pages/InviteAcceptPage'
import { LoginPage } from './pages/LoginPage'
import { MessagesPage } from './pages/MessagesPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProfilePage } from './pages/ProfilePage'
import { ProjectMemoryPage } from './pages/ProjectMemoryPage'
import { SettingsPage } from './pages/SettingsPage'
import { TaskDetailPage } from './pages/TasksPage'
import { TasksTriagePage } from './pages/TasksTriagePage'

function ProtectedApp() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-lg font-semibold text-primary-foreground">
          {BRAND_MARK}
        </span>
        <Skeleton className="h-2 w-40" />
        <p className="text-sm text-muted-foreground">Opening your workspace…</p>
      </main>
    )
  }
  if (status === 'guest') return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />

  return (
    <WorkspaceProvider>
      <AppShell />
    </WorkspaceProvider>
  )
}

function PermissionRoute({ permission, children }: { permission: string; children: React.ReactNode }) {
  const can = useCan()
  return can(permission) ? children : <AccessDenied />
}

function AccessDenied() {
  const can = useCan()
  const hasDashboard = can('dashboard.view')
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="font-mono text-5xl font-semibold tabular-nums text-muted-foreground">403</span>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {hasDashboard ? 'This area is not in your role.' : 'Your role has no workspace access.'}
        </h1>
        <p className="text-muted-foreground text-pretty">
          {hasDashboard
            ? 'Ask an administrator if you need access to this part of the workspace.'
            : 'Your profile and sign out remain available while an administrator repairs your role.'}
        </p>
      </div>
      <Button asChild>
        <a href={hasDashboard ? '/' : '/profile'}>{hasDashboard ? 'Return to dashboard' : 'Open profile'}</a>
      </Button>
    </section>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      {/* The primitive gallery. Unauthenticated and outside the shell so it can
          be opened without a backend, which is also why it never ships: it is
          registered in development builds only. */}
      {import.meta.env.DEV && <Route path="/design" element={<DesignSystemPage />} />}
      <Route element={<ProtectedApp />}>
        <Route index element={<PermissionRoute permission="dashboard.view"><DashboardPage /></PermissionRoute>} />
        <Route path="messages" element={<PermissionRoute permission="messages.view"><MessagesPage /></PermissionRoute>} />
        <Route path="messages/:messageId" element={<PermissionRoute permission="messages.view"><MessagesPage /></PermissionRoute>} />
        <Route path="tasks" element={<PermissionRoute permission="tasks.view"><TasksTriagePage /></PermissionRoute>} />
        <Route path="tasks/:taskId" element={<PermissionRoute permission="tasks.view"><TaskDetailPage /></PermissionRoute>} />
        <Route path="projects" element={<PermissionRoute permission="projects.view"><ProjectsPage /></PermissionRoute>} />
        <Route path="projects/:projectId/memory" element={<PermissionRoute permission="projects.view"><ProjectMemoryPage /></PermissionRoute>} />
        <Route path="clients" element={<PermissionRoute permission="clients.view"><ClientsPage /></PermissionRoute>} />
        <Route path="contacts" element={<PermissionRoute permission="contacts.view"><ContactsPage /></PermissionRoute>} />
        <Route path="analytics" element={<Navigate to="/" replace />} />
        <Route path="settings" element={<PermissionRoute permission="settings.view"><SettingsPage /></PermissionRoute>} />
        <Route path="settings/users" element={<PermissionRoute permission="users.view"><UsersPage /></PermissionRoute>} />
        <Route path="settings/roles" element={<PermissionRoute permission="roles.view"><RolesPage /></PermissionRoute>} />
        <Route path="settings/fields" element={<PermissionRoute permission="fields.view"><FieldsPage /></PermissionRoute>} />
        <Route path="users" element={<Navigate to="/settings/users" replace />} />
        <Route path="roles" element={<Navigate to="/settings/roles" replace />} />
        <Route path="fields" element={<Navigate to="/settings/fields" replace />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
