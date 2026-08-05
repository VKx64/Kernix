import { useCallback, useEffect, useState } from 'react'
import { api, normalizePage } from './api'
import type { ApiEnvelope, Paginated, PaginationMeta } from '../types/api'

interface CollectionOptions {
  search?: string
  page?: number
  filters?: Record<string, string | number | boolean | null | undefined>
  /**
   * Ask the API for the whole list in one request. Tables sort, filter, and
   * paginate in the browser, so they need every row rather than one page. The
   * server still caps how much it will return.
   */
  all?: boolean
}

export function useCollection<T>(path: string, options: CollectionOptions = {}) {
  const { search = '', page = 1, filters = {}, all = false } = options
  const [data, setData] = useState<T[]>([])
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, perPage: 20, total: 0, lastPage: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const filterKey = JSON.stringify(filters)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const response = await api.get<Paginated<T> | ApiEnvelope<Paginated<T>> | T[]>(path, {
        page: all ? 1 : page,
        per_page: all ? 'all' : undefined,
        search: search.trim() || undefined,
        ...(JSON.parse(filterKey) as CollectionOptions['filters']),
      }, signal)
      const normalized = normalizePage(response)
      const nestedMeta = normalized.meta as Record<string, number> | undefined
      setData(normalized.data ?? [])
      setMeta({
        page: normalized.current_page ?? nestedMeta?.current_page ?? nestedMeta?.page ?? page,
        perPage: normalized.per_page ?? nestedMeta?.per_page ?? nestedMeta?.perPage ?? 20,
        total: normalized.total ?? nestedMeta?.total ?? normalized.data?.length ?? 0,
        lastPage: normalized.last_page ?? nestedMeta?.last_page ?? nestedMeta?.lastPage ?? 1,
      })
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(reason instanceof Error ? reason.message : 'Unable to load this list.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [path, page, search, filterKey, all])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => void load(controller.signal), search ? 250 : 0)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [load, search])

  return { data, meta, loading, error, reload: () => load() }
}
