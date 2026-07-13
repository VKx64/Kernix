import { unwrap } from './api'

export interface PermissionDefinition {
  key: string
  label: string
  description: string
  requires: string[]
}

export interface PermissionGroup {
  key: string
  label: string
  permissions: PermissionDefinition[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function definition(value: unknown): PermissionDefinition | null {
  if (typeof value === 'string') {
    return { key: value, label: value.split('.').slice(1).join(' ') || value, description: '', requires: [] }
  }
  const record = asRecord(value)
  const key = String(record?.key ?? '')
  if (!key) return null
  return {
    key,
    label: String(record?.label ?? key.split('.').slice(1).join(' ') ?? key),
    description: String(record?.description ?? ''),
    requires: Array.isArray(record?.requires) ? record.requires.map(String) : [],
  }
}

export function normalizePermissionCatalog(payload: unknown): PermissionGroup[] {
  const unwrapped = unwrap(payload as never) as unknown
  const root = asRecord(unwrapped)
  const source = Array.isArray(unwrapped)
    ? unwrapped
    : Array.isArray(root?.groups)
      ? root.groups
      : Array.isArray(root?.permissions)
        ? root.permissions
        : []

  return source.flatMap((value, index) => {
    const group = asRecord(value)
    if (!group) return []
    const rawPermissions = Array.isArray(group.permissions) ? group.permissions : Array.isArray(group.items) ? group.items : []
    const permissions = rawPermissions.map(definition).filter((item): item is PermissionDefinition => Boolean(item))
    if (!permissions.length) return []
    const label = String(group.label ?? group.name ?? group.group ?? `Group ${index + 1}`)
    return [{ key: String(group.key ?? label.toLowerCase().replace(/\s+/g, '-')), label, permissions }]
  })
}

export function permissionMap(groups: PermissionGroup[]): Map<string, PermissionDefinition> {
  return new Map(groups.flatMap((group) => group.permissions).map((permission) => [permission.key, permission]))
}

export function withRequiredPermissions(selected: Iterable<string>, groups: PermissionGroup[]): string[] {
  const catalog = permissionMap(groups)
  const result = new Set(selected)
  if (catalog.has('dashboard.view')) result.add('dashboard.view')
  const visit = (key: string, stack = new Set<string>()) => {
    if (stack.has(key)) return
    stack.add(key)
    for (const requirement of catalog.get(key)?.requires ?? []) {
      result.add(requirement)
      visit(requirement, stack)
    }
  }
  for (const key of [...result]) visit(key)
  return [...result]
}

export function lockedPermissions(selected: Iterable<string>, groups: PermissionGroup[]): Set<string> {
  const catalog = permissionMap(groups)
  const locked = new Set<string>()
  if (catalog.has('dashboard.view')) locked.add('dashboard.view')
  for (const key of selected) {
    for (const requirement of catalog.get(key)?.requires ?? []) locked.add(requirement)
  }
  return locked
}
