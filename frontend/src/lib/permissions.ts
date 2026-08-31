import { useCallback } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { EntityId, Task, User } from '../types/api'

export const administrationPermissions = ['settings.view', 'users.view', 'roles.view', 'fields.view'] as const

export function isAdministrator(user: User | null | undefined): boolean {
  return Boolean(user?.isAdmin ?? user?.is_admin)
}

export function hasPermission(user: User | null | undefined, permission: string): boolean {
  if (!user) return false
  if (isAdministrator(user)) return true
  return (user.permissions ?? []).includes(permission)
}

export function hasAnyPermission(user: User | null | undefined, permissions: readonly string[]): boolean {
  return permissions.some((permission) => hasPermission(user, permission))
}

/**
 * Task work is restricted to the assignee server-side. This mirrors the
 * exceptions the backend honors so the UI can gate controls the same way
 * instead of letting mutations 409.
 *
 * It lives here rather than on the task detail page because the drawer gates
 * the same actions from the list.
 */
export function isAssignmentGranted(task: Task, userId: EntityId | undefined, can: (permission: string) => boolean, isAdmin: boolean): boolean {
  return Boolean(
    isAdmin
    || can('tasks.work_unassigned')
    || String(task.creator?.id ?? '') === String(userId ?? '')
    || String(task.assignee?.id ?? '') === String(userId ?? '')
    || (task.subtasks ?? []).some((subtask) => String(subtask.assignee?.id ?? '') === String(userId ?? '')),
  )
}

export function useCan() {
  const { user } = useAuth()
  return useCallback((permission: string) => hasPermission(user, permission), [user])
}
