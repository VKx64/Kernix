import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'

export interface SelectOption { value: string; label: string }

interface PopupPosition { top: number; left: number; width: number }

// Menus are portalled to the body and positioned against their trigger so a
// modal's scrolling body cannot clip them.
export function useAnchoredPopup(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  popupRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  const [position, setPosition] = useState<PopupPosition | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const place = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const height = popupRef.current?.offsetHeight ?? 0
      const width = popupRef.current?.offsetWidth ?? rect.width
      const gap = 6
      const spaceBelow = window.innerHeight - rect.bottom - gap
      const above = height > spaceBelow && rect.top - gap > spaceBelow
      setPosition({
        top: above ? Math.max(8, rect.top - gap - height) : rect.bottom + gap,
        left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8)),
        width: rect.width,
      })
    }
    place()
    // Re-place once the popup has rendered and can report its own size.
    const frame = window.requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, popupRef, triggerRef])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return
      onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [onDismiss, open, popupRef, triggerRef])

  return position
}

export function Select({
  id,
  label,
  value,
  options,
  placeholder = 'Select…',
  disabled = false,
  required = false,
  invalid = false,
  className = '',
  icon,
  describedBy,
  onChange,
}: {
  id?: string
  label: string
  value: string
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  required?: boolean
  invalid?: boolean
  className?: string
  icon?: IconName
  describedBy?: string
  onChange: (value: string) => void
}) {
  const listId = useId()
  const optionId = useId()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLUListElement>(null)

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const close = useCallback(() => {
    setOpen(false)
    setActiveIndex(-1)
  }, [])
  const position = useAnchoredPopup(open, triggerRef, popupRef, close)

  useEffect(() => {
    if (!open || activeIndex < 0) return
    const option = popupRef.current?.querySelector(`[data-index="${activeIndex}"]`)
    option?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, open])

  const openMenu = () => {
    if (disabled) return
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    close()
    triggerRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openMenu()
      }
      return
    }
    switch (event.key) {
      case 'Escape':
        // Keep the surrounding modal open; this key belongs to the menu.
        event.preventDefault()
        event.stopPropagation()
        close()
        break
      case 'Tab':
        close()
        break
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((current) => Math.min(options.length - 1, current + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((current) => Math.max(0, current - 1))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(options.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        choose(activeIndex)
        break
      default:
        break
    }
  }

  return (
    <>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`select-trigger ${className} ${selected ? '' : 'is-placeholder'} ${open ? 'is-open' : ''}`.replace(/\s+/g, ' ').trim()}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${optionId}-${activeIndex}` : undefined}
        aria-label={label}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
      >
        {icon && <Icon className="select-lead" name={icon} size={15} />}
        <span>{selected?.label ?? placeholder}</span>
        <Icon name="chevron-down" size={15} />
      </button>
      {open && position && createPortal(
        <ul
          className="field-popup select-menu"
          id={listId}
          ref={popupRef}
          role="listbox"
          aria-label={label}
          style={{ top: position.top, left: position.left, minWidth: position.width }}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${optionId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={option.value === value}
              className={`select-option ${index === activeIndex ? 'is-active' : ''} ${option.value === value ? 'is-selected' : ''}`.trim()}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Icon name="check" size={14} />}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  )
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function toISO(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function fromISO(value: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!parts) return null
  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function monthGrid(month: Date) {
  const first = startOfMonth(month)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
}

export function DatePicker({
  id,
  label,
  value,
  min,
  placeholder = 'Select a date',
  disabled = false,
  invalid = false,
  className = '',
  icon,
  describedBy,
  onChange,
}: {
  id?: string
  label: string
  value: string
  min?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
  icon?: IconName
  describedBy?: string
  onChange: (value: string) => void
}) {
  const dialogId = useId()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  const selected = fromISO(value)
  const minDate = min ? fromISO(min) : null
  const today = new Date()

  const [month, setMonth] = useState(() => startOfMonth(selected ?? today))
  const [active, setActive] = useState(() => selected ?? today)

  const close = useCallback(() => setOpen(false), [])
  const position = useAnchoredPopup(open, triggerRef, popupRef, close)

  // Reopening should land on the committed value, not wherever browsing stopped.
  useEffect(() => {
    if (!open) return
    const anchor = fromISO(value) ?? new Date()
    setActive(anchor)
    setMonth(startOfMonth(anchor))
  }, [open, value])

  useEffect(() => {
    if (!open) return
    popupRef.current?.querySelector<HTMLButtonElement>(`[data-day="${toISO(active)}"]`)?.focus()
  }, [active, open])

  const blocked = (day: Date) => Boolean(minDate && day < minDate && !sameDay(day, minDate))

  const commit = (day: Date) => {
    if (blocked(day)) return
    onChange(toISO(day))
    close()
    triggerRef.current?.focus()
  }

  const shift = (days: number) => {
    const next = new Date(active)
    next.setDate(active.getDate() + days)
    setActive(next)
    setMonth(startOfMonth(next))
  }

  const shiftMonth = (delta: number) => {
    const next = new Date(active.getFullYear(), active.getMonth() + delta, active.getDate())
    setActive(next)
    setMonth(startOfMonth(next))
  }

  const onPopupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        close()
        triggerRef.current?.focus()
        break
      case 'Tab':
        event.preventDefault()
        close()
        triggerRef.current?.focus()
        break
      case 'ArrowLeft': event.preventDefault(); shift(-1); break
      case 'ArrowRight': event.preventDefault(); shift(1); break
      case 'ArrowUp': event.preventDefault(); shift(-7); break
      case 'ArrowDown': event.preventDefault(); shift(7); break
      case 'PageUp': event.preventDefault(); shiftMonth(-1); break
      case 'PageDown': event.preventDefault(); shiftMonth(1); break
      default: break
    }
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (open) return
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen(true)
    }
  }

  const days = monthGrid(month)

  return (
    <>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`select-trigger date-trigger ${className} ${selected ? '' : 'is-placeholder'} ${open ? 'is-open' : ''}`.replace(/\s+/g, ' ').trim()}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        {icon && <Icon className="select-lead" name={icon} size={15} />}
        <span>{selected ? selected.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : placeholder}</span>
        <Icon name="calendar" size={15} />
      </button>
      {open && position && createPortal(
        <div
          className="field-popup date-popup"
          id={dialogId}
          ref={popupRef}
          role="dialog"
          aria-label={label}
          style={{ top: position.top, left: position.left }}
          onKeyDown={onPopupKeyDown}
        >
          <header className="date-popup-head">
            <button type="button" className="icon-button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
              <Icon name="chevron-down" size={16} />
            </button>
            <strong aria-live="polite">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
            <button type="button" className="icon-button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
              <Icon name="chevron-down" size={16} />
            </button>
          </header>
          <div className="date-weekdays" aria-hidden="true">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="date-grid" role="grid" aria-label={label}>
            {days.map((day) => {
              const outside = day.getMonth() !== month.getMonth()
              const isBlocked = blocked(day)
              return (
                <button
                  key={toISO(day)}
                  type="button"
                  data-day={toISO(day)}
                  tabIndex={sameDay(day, active) ? 0 : -1}
                  disabled={isBlocked}
                  aria-current={sameDay(day, today) ? 'date' : undefined}
                  aria-selected={selected ? sameDay(day, selected) : false}
                  className={`date-cell ${outside ? 'is-outside' : ''} ${selected && sameDay(day, selected) ? 'is-selected' : ''} ${sameDay(day, today) ? 'is-today' : ''}`.trim()}
                  onClick={() => commit(day)}
                  onFocus={() => setActive(day)}
                >
                  {day.getDate()}
                </button>
              )
            })}
          </div>
          <footer className="date-popup-foot">
            <button type="button" className="text-link" onClick={() => { onChange(''); close(); triggerRef.current?.focus() }}>Clear</button>
            <button type="button" className="text-link" disabled={blocked(today)} onClick={() => commit(today)}>Today</button>
          </footer>
        </div>,
        document.body,
      )}
    </>
  )
}
