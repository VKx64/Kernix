import { useState } from 'react'
import { CalendarIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/** Dates cross the API as plain `YYYY-MM-DD` strings, never Date objects. */
function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function fromIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  disabled,
  clearable = true,
  className,
  id,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  clearable?: boolean
  className?: string
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = fromIsoDate(value)

  return (
    <div className={cn('relative', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn('w-full justify-start font-normal', !selected && 'text-muted-foreground', clearable && selected && 'pr-8')}
          >
            <CalendarIcon />
            {selected
              ? selected.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
              : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            autoFocus
            onSelect={(date) => {
              onChange(date ? toIsoDate(date) : '')
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      {clearable && selected && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 size-6 -translate-y-1/2"
          aria-label="Clear date"
          onClick={() => onChange('')}
        >
          <X />
        </Button>
      )}
    </div>
  )
}
