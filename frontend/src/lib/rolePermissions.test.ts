import { lockedPermissions, normalizePermissionCatalog, withRequiredPermissions } from './rolePermissions'

const response = {
  data: [
    { group: 'Dashboard', permissions: [{ key: 'dashboard.view', label: 'View dashboard', description: 'Open the dashboard.', requires: [] }] },
    { group: 'Time', permissions: [{ key: 'time.track', label: 'Track time', description: 'Use the work timer.', requires: ['dashboard.view'] }] },
    { group: 'Tasks', permissions: [
      { key: 'tasks.view', label: 'View tasks', description: 'See tasks.', requires: ['dashboard.view'] },
      { key: 'tasks.edit', label: 'Edit tasks', description: 'Edit task metadata.', requires: ['tasks.view', 'time.track'] },
    ] },
  ],
}

describe('role permission catalog', () => {
  it('normalizes Laravel grouped metadata without a frontend permission list', () => {
    const groups = normalizePermissionCatalog(response)
    expect(groups.map((group) => group.label)).toEqual(['Dashboard', 'Time', 'Tasks'])
    expect(groups[2].permissions[1]).toMatchObject({ key: 'tasks.edit', requires: ['tasks.view', 'time.track'] })
  })

  it('adds mandatory and transitive dependencies', () => {
    const groups = normalizePermissionCatalog(response)
    expect(new Set(withRequiredPermissions(['tasks.edit'], groups))).toEqual(new Set(['dashboard.view', 'time.track', 'tasks.view', 'tasks.edit']))
  })

  it('locks requirements while a dependent permission is selected', () => {
    const groups = normalizePermissionCatalog(response)
    expect(lockedPermissions(['tasks.edit'], groups)).toEqual(new Set(['dashboard.view', 'tasks.view', 'time.track']))
  })
})
