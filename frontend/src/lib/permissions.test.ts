import { hasAnyPermission, hasPermission, isAdministrator } from './permissions'
import type { User } from '../types/api'

const user = (permissions: string[] = [], admin = false): User => ({ id: 1, username: 'tester', permissions, is_admin: admin })

describe('permission helpers', () => {
  it('allows only explicit custom-role permissions', () => {
    expect(hasPermission(user(['tasks.view']), 'tasks.view')).toBe(true)
    expect(hasPermission(user(['tasks.view']), 'tasks.edit')).toBe(false)
    expect(hasPermission(user(['*']), 'tasks.edit')).toBe(false)
  })

  it('keeps the server-provided administrator bypass', () => {
    expect(isAdministrator(user([], true))).toBe(true)
    expect(hasPermission(user([], true), 'anything.future')).toBe(true)
  })

  it('checks administration entry points without broadening access', () => {
    expect(hasAnyPermission(user(['roles.view']), ['settings.view', 'users.view', 'roles.view'])).toBe(true)
    expect(hasAnyPermission(user(['dashboard.view']), ['settings.view', 'users.view', 'roles.view'])).toBe(false)
  })
})
