import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Naming a saved view, inside the same menu that lists them. Creation is the
 * one thing the design allows a modal, but this is a single field on top of a
 * menu that is already open — a dialog here would cost the context of what is
 * being saved.
 */
export function SaveViewForm({ onSave, onCancel }: { onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => { field.current?.focus() }, [])

  return (
    <form
      className="flex items-center gap-1.5 p-1"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) onSave(name.trim())
      }}
    >
      <input
        ref={field}
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name this view"
        aria-label="Name this view"
        // The menu around this field runs a typeahead over its items, which
        // would steal focus on every letter typed here.
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onCancel()
        }}
        className="h-[27px] w-40 rounded-md border border-line bg-transparent px-2 text-meta text-t1 outline-none placeholder:text-t4 focus:border-line-strong"
      />
      <Button type="submit" size="sm" disabled={!name.trim()}>Save</Button>
    </form>
  )
}
