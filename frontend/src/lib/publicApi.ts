/**
 * The public form's own fetch helper — deliberately not `lib/api.ts`. That
 * helper sends `credentials: 'include'`, attaches the XSRF header, and
 * dispatches `auth:unauthorized` on a 401. A public intake page reached by
 * an anonymous client must never carry a staff session cookie to the server,
 * and a 401/404 here must never log a signed-in user out in another tab.
 */
const configuredOrigin = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim()
export const publicApiOrigin = configuredOrigin?.replace(/\/$/, '') ?? ''

export class PublicApiError extends Error {
  status: number
  details: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'PublicApiError'
    this.status = status
    this.details = details
  }
}

function requestUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return new URL(`${publicApiOrigin}${normalizedPath}`, window.location.origin).toString()
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const type = response.headers.get('content-type') ?? ''
  if (type.includes('application/json')) return response.json()
  const text = await response.text()
  return text || null
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const candidate = payload as { message?: string; errors?: Record<string, string[]> }
    if (candidate.message) return candidate.message
    const first = candidate.errors && Object.values(candidate.errors).flat()[0]
    if (first) return first
  }
  return status === 422 ? 'Please check the highlighted fields.' : 'That did not go through.'
}

async function request<T>(path: string, options: Omit<RequestInit, 'body'> & { body?: BodyInit | Record<string, unknown> | null } = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')

  let body = options.body
  if (body && !(body instanceof FormData) && !(body instanceof Blob) && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(body)
  }

  const response = await fetch(requestUrl(path), {
    ...options,
    headers,
    body: body as BodyInit | null | undefined,
    // No staff session ever travels with a public submission, and no expired
    // session on this page should ever be treated as "you are logged out".
    credentials: 'omit',
  })
  const payload = await parseResponse(response)

  if (!response.ok) {
    throw new PublicApiError(errorMessage(payload, response.status), response.status, payload)
  }

  return payload as T
}

export const publicApi = {
  get<T>(path: string) {
    return request<T>(path, { method: 'GET' })
  },
  post<T>(path: string, body?: BodyInit | Record<string, unknown> | null) {
    return request<T>(path, { method: 'POST', body })
  },
}
