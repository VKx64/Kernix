import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import type { EntityId, FormPayload, FormValue, PaginationMeta, UserSummary } from '../types/api'
import { displayName, fieldLabel } from '../lib/api'

export function Avatar({ user, size = 34 }: { user?: UserSummary | null; size?: number }) {
  const image = user?.avatar ?? user?.profileImage ?? user?.profile_image
  const initials = displayName(user)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return image ? (
    <img className="avatar" src={image} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="avatar avatar-fallback" style={{ width: size, height: size, fontSize: Math.max(10, size * 0.3) }}>
      {initials || '?'}
    </span>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Panel({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: string; action?: ReactNode }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="panel-header">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function StatusBadge({ value, color }: { value: unknown; color?: string | null }) {
  const label = fieldLabel(value)
  const objectColor = value && typeof value === 'object' && 'color' in value ? String((value as { color?: string }).color ?? '') : ''
  const chosen = color || objectColor
  return (
    <span className="status-badge" style={chosen ? { '--badge-color': chosen } as React.CSSProperties : undefined}>
      <span />
      {label}
    </span>
  )
}

export function EmptyState({ title, description, action, icon = 'search' }: { title: string; description?: string; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="empty-state">
      <span className="empty-orb"><Icon name={icon} size={24} /></span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  )
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      {onRetry && <button className="btn btn-quiet" onClick={onRetry}>Try again</button>}
    </div>
  )
}

export function LoadingRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="loading-table" aria-label="Loading">
      {Array.from({ length: rows }, (_, row) => (
        <div className="loading-row" key={row} style={{ gridTemplateColumns: `repeat(${columns}, minmax(90px, 1fr))` }}>
          {Array.from({ length: columns }, (_, col) => <span className="skeleton" key={col} />)}
        </div>
      ))}
    </div>
  )
}

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
  width?: number
  minWidth?: number
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  loading,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  onRowClick,
}: {
  columns: Column<T>[]
  data: T[]
  rowKey: (row: T) => EntityId
  loading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  onRowClick?: (row: T) => void
}) {
  if (loading) return <LoadingRows columns={columns.length} />
  if (!data.length) return <EmptyState title={emptyTitle} description={emptyDescription} />

  return (
    <div className="table-scroll">
      <table
        className="data-table"
        style={columns.some((column) => column.width)
          ? { minWidth: Math.max(520, columns.reduce((total, column) => total + (column.width ?? column.minWidth ?? 120), 0)), tableLayout: 'fixed' }
          : undefined}
      >
        {columns.some((column) => column.width) && (
          <colgroup>
            {columns.map((column) => <col key={column.key} style={{ width: column.width, minWidth: column.minWidth }} />)}
          </colgroup>
        )}
        <thead>
          <tr>{columns.map((column) => <th className={column.className} key={column.key}>{column.header}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr
              className={onRowClick ? 'clickable-row' : undefined}
              key={rowKey(row)}
              onClick={() => onRowClick?.(row)}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={(event) => {
                if (onRowClick && (event.key === 'Enter' || event.key === ' ')) onRowClick(row)
              }}
            >
              {columns.map((column) => <td className={column.className} key={column.key}>{column.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Pagination({ meta, onPage }: { meta: PaginationMeta; onPage: (page: number) => void }) {
  const last = meta.lastPage ?? Math.max(1, Math.ceil(meta.total / meta.perPage))
  if (last <= 1) return null
  const pages = Array.from(new Set([1, meta.page - 1, meta.page, meta.page + 1, last])).filter((page) => page > 0 && page <= last)

  return (
    <nav className="pagination" aria-label="Pagination">
      <button className="btn btn-quiet" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</button>
      <div className="page-numbers">
        {pages.map((page, index) => (
          <span key={page} className="page-number-wrap">
            {index > 0 && page - pages[index - 1] > 1 && <span className="page-gap">…</span>}
            <button className={`page-number ${page === meta.page ? 'active' : ''}`} onClick={() => onPage(page)}>{page}</button>
          </span>
        ))}
      </div>
      <button className="btn btn-quiet" disabled={meta.page >= last} onClick={() => onPage(meta.page + 1)}>Next</button>
    </nav>
  )
}

export function SearchToolbar({
  search,
  onSearch,
  children,
  placeholder = 'Search…',
}: {
  search: string
  onSearch: (value: string) => void
  children?: ReactNode
  placeholder?: string
}) {
  return (
    <div className="toolbar">
      <label className="search-control">
        <Icon name="search" size={17} />
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} />
      </label>
      {children && <div className="toolbar-filters">{children}</div>}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md',
  closeDisabled = false,
  className = '',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
  closeDisabled?: boolean
  className?: string
}) {
  const titleId = useId()
  const descriptionId = useId()
  const modalRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    const bodyOverflow = document.body.style.overflow
    const rootOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = bodyOverflow
      document.documentElement.style.overflow = rootOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const preferred = modalRef.current?.querySelector<HTMLElement>('[data-autofocus]')
    const firstControl = modalRef.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')
    ;(preferred ?? firstControl ?? modalRef.current)?.focus()

    return () => {
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!closeDisabled) onClose()
        return
      }
      if (event.key !== 'Tab' || !modalRef.current) return

      const controls = Array.from(modalRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
      if (!controls.length) {
        event.preventDefault()
        modalRef.current.focus()
        return
      }
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || !modalRef.current.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !modalRef.current.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeDisabled, onClose, open])

  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (!closeDisabled && event.currentTarget === event.target) onClose() }}>
      <section className={`modal modal-${size} ${className}`.trim()} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}>
        <header className="modal-header">
          <div className="modal-header-copy">
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button className="icon-button" disabled={closeDisabled} onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        {children}
      </section>
    </div>
  )
}

export interface FormOption { label: string; value: string | number }
export interface FormFieldSpec {
  name: string
  label: string
  type?: 'text' | 'email' | 'password' | 'url' | 'tel' | 'date' | 'number' | 'textarea' | 'select' | 'checkbox'
  placeholder?: string
  required?: boolean
  options?: FormOption[]
  /** Offered in a dropdown but not enforced — the field stays free text. */
  suggestions?: FormOption[]
  help?: string
  min?: number
  step?: number
  wide?: boolean
  disabled?: boolean
  clearOnChange?: string[]
}

export function EntityForm({
  fields,
  initialValues,
  submitLabel = 'Save',
  busy,
  submitDisabled,
  error,
  onSubmit,
  onValuesChange,
  onCancel,
  extra,
}: {
  fields: FormFieldSpec[]
  initialValues?: FormPayload
  submitLabel?: string
  busy?: boolean
  submitDisabled?: boolean
  error?: string
  onSubmit: (values: FormPayload) => void | Promise<void>
  onValuesChange?: (values: FormPayload) => void
  onCancel?: () => void
  extra?: ReactNode
}) {
  const formId = useId()
  const defaults = useMemo(() => Object.fromEntries(fields.map((field) => [field.name, initialValues?.[field.name] ?? (field.type === 'checkbox' ? false : '')])), [fields, initialValues])
  const [values, setValues] = useState<FormPayload>(defaults)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void onSubmit(values)
  }

  return (
    <form className="entity-form" onSubmit={submit}>
      <div className="form-grid">
        {fields.map((field) => {
          const id = `${formId}-${field.name}`
          const current = values[field.name]
          const set = (value: FormValue) => {
            const next = { ...values, [field.name]: value }
            field.clearOnChange?.forEach((name) => { next[name] = '' })
            setValues(next)
            onValuesChange?.(next)
          }
          return (
            <label className={`form-field ${field.wide || field.type === 'textarea' ? 'wide' : ''} ${field.type === 'checkbox' ? 'checkbox-field' : ''}`} key={field.name} htmlFor={id}>
              {field.type === 'checkbox' ? (
                <span className="checkbox-line">
                  <input id={id} type="checkbox" checked={Boolean(current)} disabled={field.disabled} onChange={(event) => set(event.target.checked)} />
                  <span>{field.label}</span>
                </span>
              ) : (
                <>
                  <span className="field-label">{field.label}{field.required && <b aria-hidden="true"> *</b>}</span>
                  {field.type === 'textarea' ? (
                    <textarea id={id} value={String(current ?? '')} required={field.required} disabled={field.disabled} placeholder={field.placeholder} onChange={(event) => set(event.target.value)} />
                  ) : field.type === 'select' ? (
                    <select id={id} value={String(current ?? '')} required={field.required} disabled={field.disabled} onChange={(event) => set(event.target.value)}>
                      <option value="">Select…</option>
                      {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  ) : (
                    <>
                      <input
                        id={id}
                        type={field.type ?? 'text'}
                        value={String(current ?? '')}
                        required={field.required}
                        disabled={field.disabled}
                        placeholder={field.placeholder}
                        min={field.min}
                        step={field.step}
                        list={field.suggestions?.length ? `${id}-suggestions` : undefined}
                        onChange={(event) => set(field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)}
                      />
                      {field.suggestions?.length ? (
                        <datalist id={`${id}-suggestions`}>
                          {field.suggestions.map((option) => <option key={option.value} value={String(option.value)}>{option.label}</option>)}
                        </datalist>
                      ) : null}
                    </>
                  )}
                  {field.help && <span className="field-help">{field.help}</span>}
                </>
              )}
            </label>
          )
        })}
      </div>
      {extra}
      {error && <div className="form-error" role="alert">{error}</div>}
      <footer className="form-footer">
        {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn btn-primary" disabled={busy || submitDisabled}>{busy ? 'Saving…' : submitLabel}</button>
      </footer>
    </form>
  )
}

export function Minutes({ value }: { value?: number | null }) {
  const total = Math.max(0, value ?? 0)
  const hours = Math.floor(total / 60)
  const minutes = Math.round(total % 60)
  return <span className="numeric">{hours ? `${hours}h ${minutes ? `${minutes}m` : ''}` : `${minutes}m`}</span>
}
