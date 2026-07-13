import { useCallback } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { User } from '../types/api'

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

export function useCan() {
  const { user } = useAuth()
  return useCallback((permission: string) => hasPermission(user, permission), [user])
}
