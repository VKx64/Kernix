export function normalizeWorkspaceOrigin(input: string): string {
  const value = input.trim()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter the full workspace URL, including https://.')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use only the workspace origin, without credentials, paths, queries, or fragments.')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Deployed workspaces must use HTTPS. HTTP is allowed only for local development.')
  }

  return url.origin
}

export function permissionPattern(origin: string): string {
  const url = new URL(origin)
  return `${url.protocol}//${url.hostname}/*`
}
