import { describe, expect, it } from 'vitest'
import { normalizeWorkspaceOrigin, permissionPattern } from './origin'

describe('workspace origins', () => {
  it('accepts HTTPS origins and strips a trailing slash', () => {
    expect(normalizeWorkspaceOrigin('https://kernix.example.com/')).toBe('https://kernix.example.com')
  })

  it('accepts loopback HTTP and requests host access without a port', () => {
    const origin = normalizeWorkspaceOrigin('http://localhost:5173/')
    expect(origin).toBe('http://localhost:5173')
    expect(permissionPattern(origin)).toBe('http://localhost/*')
  })

  it.each([
    'http://kernix.example.com',
    'https://kernix.example.com/tasks',
    'https://user:password@kernix.example.com',
    'kernix.example.com',
  ])('rejects unsafe or non-origin input: %s', (value) => {
    expect(() => normalizeWorkspaceOrigin(value)).toThrow()
  })
})
