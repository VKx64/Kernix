import { act, renderHook, waitFor } from '@testing-library/react'
import { useAutosave } from './useAutosave'

/**
 * The one autosave hook in the app — this file is its contract test. The
 * builder's own test covers the "no Save button in the UI" half of the
 * acceptance check; this half covers the debounce/in-flight guarantees the
 * hook itself promises.
 */
describe('useAutosave', () => {
  it('does not save on first render, then saves once after a change settles', async () => {
    const onSave = vi.fn(async () => {})
    const { rerender } = renderHook(({ value }) => useAutosave({ value, onSave, delay: 30 }), {
      initialProps: { value: { title: 'A' } },
    })

    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(onSave).not.toHaveBeenCalled()

    rerender({ value: { title: 'B' } })
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({ title: 'B' })
  })

  it('coalesces rapid changes into a single trailing save', async () => {
    const onSave = vi.fn(async () => {})
    const { rerender } = renderHook(({ value }) => useAutosave({ value, onSave, delay: 30 }), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'ab' })
    rerender({ value: 'abc' })
    rerender({ value: 'abcd' })

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith('abcd')
  })

  it('queues exactly one more save for a change that lands while a save is in flight', async () => {
    let resolveFirst: (() => void) | null = null
    let callCount = 0
    const onSave = vi.fn(() => new Promise<void>((resolve) => {
      callCount += 1
      if (callCount === 1) resolveFirst = resolve
      else resolve()
    }))
    const { rerender } = renderHook(({ value }) => useAutosave({ value, onSave, delay: 10 }), {
      initialProps: { value: 'first' },
    })

    rerender({ value: 'first-changed' })
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))

    // A second change lands while the first save is still in flight.
    rerender({ value: 'second-changed' })
    await new Promise((resolve) => setTimeout(resolve, 40))
    // Still only the one in-flight call — last-write-wins, not a flood.
    expect(onSave).toHaveBeenCalledTimes(1)

    act(() => resolveFirst?.())
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    expect(onSave).toHaveBeenLastCalledWith('second-changed')
  })

  it('exposes savedAt only after a save resolves', async () => {
    const onSave = vi.fn(async () => {})
    const { result, rerender } = renderHook(({ value }) => useAutosave({ value, onSave, delay: 10 }), {
      initialProps: { value: 1 },
    })
    expect(result.current.savedAt).toBeNull()

    rerender({ value: 2 })
    await waitFor(() => expect(result.current.savedAt).not.toBeNull())
  })
})
