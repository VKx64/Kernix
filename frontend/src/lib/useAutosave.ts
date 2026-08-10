import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The one autosave pattern in the app. Nothing else here debounces a change
 * and pushes it to the server without an explicit Save button, so every
 * builder-style screen that wants the "Saved 12s ago" flash should go through
 * this hook rather than growing its own timer.
 *
 * Guarantees: a single in-flight request, last-write-wins (a change that
 * lands mid-request schedules exactly one more save once the first settles),
 * and a `beforeunload` prompt while a change has not yet reached the server.
 */
export function useAutosave<T>({
  value,
  onSave,
  enabled = true,
  delay = 600,
}: {
  value: T
  onSave: (value: T) => Promise<void>
  enabled?: boolean
  delay?: number
}): { savedAt: number | null; saving: boolean; error: string; dirty: boolean } {
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)

  const latestValue = useRef(value)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)
  const pending = useRef(false)
  const version = useRef(0)
  const firstRun = useRef(true)
  const onSaveRef = useRef(onSave)
  // Refs are written from effects, never during render, so a render never
  // has the side effect of mutating one.
  useEffect(() => { onSaveRef.current = onSave }, [onSave])
  useEffect(() => { latestValue.current = value }, [value])

  // `flush` recurses (a change that lands mid-request re-queues itself once
  // the in-flight request settles) — routed through a ref so the recursive
  // call always reaches the latest closure without becoming a lint-unsafe
  // self-reference inside `useCallback`.
  const flushRef = useRef<() => void>(() => {})
  const flush = useCallback(() => {
    if (inFlight.current) {
      pending.current = true
      return
    }
    inFlight.current = true
    pending.current = false
    setSaving(true)
    setError('')
    const startVersion = version.current
    const toSave = latestValue.current
    onSaveRef.current(toSave)
      .then(() => {
        if (version.current === startVersion) setDirty(false)
        setSavedAt(Date.now())
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Could not save changes.')
      })
      .finally(() => {
        inFlight.current = false
        setSaving(false)
        if (pending.current) flushRef.current()
      })
  }, [])
  useEffect(() => { flushRef.current = flush }, [flush])

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (!enabled) return
    version.current += 1
    setDirty(true)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(flush, delay)
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
    // Only the value (and the config that changes how it is scheduled) should
    // re-arm the timer — `flush` is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled, delay])

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  return { savedAt, saving, error, dirty }
}

/** "Saved 12s ago" — the exact label the spec's builder header shows. */
export function savedAgoLabel(savedAt: number | null, now = Date.now()): string {
  if (savedAt == null) return ''
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000))
  if (seconds < 2) return 'Saved just now'
  if (seconds < 60) return `Saved ${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `Saved ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return `Saved ${hours}h ago`
}
