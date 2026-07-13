import type { ApiEnvelope, Paginated } from '../types/api'

type QueryValue = string | number | boolean | null | undefined
type RequestBody = BodyInit | Record<string, unknown> | unknown[] | null

const configuredOrigin = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim()
export const apiOrigin = configuredOrigin?.replace(/\/$/, '') ?? ''

export class ApiError extends Error {
  status: number
  details: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

function cookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function requestUrl(path: string, query?: Record<string, QueryValue>): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = new URL(`${apiOrigin}${normalizedPath}`, window.location.origin)

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  return url.toString()
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
  return status === 422 ? 'Please check the highlighted information.' : 'The request could not be completed.'
}

async function request<T>(
  path: string,
  options: Omit<RequestInit, 'body'> & { body?: RequestBody } = {},
  query?: Record<string, QueryValue>,
): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  headers.set('X-Requested-With', 'XMLHttpRequest')

  const method = (options.method ?? 'GET').toUpperCase()
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  const xsrf = cookie('XSRF-TOKEN')
  if (mutating && xsrf) headers.set('X-XSRF-TOKEN', decodeURIComponent(xsrf))

  let body = options.body
  if (body && !(body instanceof FormData) && !(body instanceof Blob) && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(body)
  }

  const response = await fetch(requestUrl(path, query), {
    ...options,
    method,
    headers,
    body: body as BodyInit | null | undefined,
    credentials: 'include',
  })
  const payload = await parseResponse(response)

  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new CustomEvent('auth:unauthorized'))
    throw new ApiError(errorMessage(payload, response.status), response.status, payload)
  }

  return payload as T
}

export const api = {
  get<T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal) {
    return request<T>(path, { signal }, query)
  },
  post<T>(path: string, body?: RequestBody) {
    return request<T>(path, { method: 'POST', body })
  },
  put<T>(path: string, body?: RequestBody) {
    return request<T>(path, { method: 'PUT', body })
  },
  patch<T>(path: string, body?: RequestBody) {
    return request<T>(path, { method: 'PATCH', body })
  },
  delete<T>(path: string, body?: RequestBody) {
    return request<T>(path, { method: 'DELETE', body })
  },
  csrf() {
    return request<unknown>('/sanctum/csrf-cookie')
  },
}

export function unwrap<T>(payload: T | ApiEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as ApiEnvelope<T>).data
  }
  return payload as T
}

export function normalizePage<T>(payload: Paginated<T> | ApiEnvelope<Paginated<T>> | T[]): Paginated<T> {
  if (Array.isArray(payload)) {
    return { data: payload, current_page: 1, last_page: 1, per_page: payload.length || 20, total: payload.length }
  }

  // A list response itself uses `data`; it is not necessarily an ApiEnvelope.
  // Preserve sibling `meta`/Laravel pagination keys before considering unwrap.
  if (payload && typeof payload === 'object' && Array.isArray((payload as Paginated<T>).data)) {
    return payload as Paginated<T>
  }

  const value = unwrap(payload as ApiEnvelope<Paginated<T>>)
  if (Array.isArray(value)) {
    return { data: value, current_page: 1, last_page: 1, per_page: value.length || 20, total: value.length }
  }
  return value
}

export function displayName(user?: { name?: string; firstName?: string; first_name?: string; lastName?: string; last_name?: string; username?: string } | null): string {
  if (!user) return 'Unassigned'
  return user.name || [user.firstName ?? user.first_name, user.lastName ?? user.last_name].filter(Boolean).join(' ') || user.username || 'Unknown user'
}

export function fieldLabel(value: unknown): string {
  if (!value) return '—'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    const field = value as { label?: string; name?: string; key?: string }
    return field.label ?? field.name ?? field.key ?? '—'
  }
  return '—'
}

export function valueOf<T>(record: Record<string, unknown> | undefined, camel: string, snake: string): T | undefined {
  return (record?.[camel] ?? record?.[snake]) as T | undefined
}
