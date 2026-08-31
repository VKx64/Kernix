import { useCallback } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { EntityId, Note, Task, User } from '../types/api'

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

/**
 * Whether somebody may still change a comment they wrote: their own, for a day
 * after writing it. An administrator is not held to the clock.
 *
 * Both the task detail page and the drawer gate their edit and delete controls
 * on this, so it lives here rather than in either of them.
 */
export function ownsRecentNote(note: Note, userId: EntityId | undefined, isAdmin: boolean): boolean {
  if (isAdmin) return true
  const creator = note.author?.id
    ?? (typeof note.createdBy === 'object' ? note.createdBy?.id : note.createdBy)
    ?? (typeof note.created_by === 'object' ? note.created_by?.id : note.created_by)
  const created = note.createdAt ?? note.created_at
  return String(creator) === String(userId)
    && Boolean(created)
    && Date.now() - new Date(created!).getTime() <= 86_400_000
}

export function useCan() {
  const { user } = useAuth()
  return useCallback((permission: string) => hasPermission(user, permission), [user])
}
