import type { ComponentProps, ReactNode } from 'react'
import { RotateCcw, Search } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar as AvatarRoot, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { displayName, fieldLabel } from '@/lib/api'
import type { UserSummary } from '@/types/api'

export function Avatar({ user, className, ...props }: { user?: UserSummary | null } & ComponentProps<typeof AvatarRoot>) {
  const image = user?.avatar ?? user?.profileImage ?? user?.profile_image
  const initials = displayName(user)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <AvatarRoot className={cn('size-8', className)} {...props}>
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback className="text-[0.7rem] font-medium">{initials || '?'}</AvatarFallback>
    </AvatarRoot>
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
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        {eyebrow && (
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="text-sm text-muted-foreground text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/**
 * Card wrapper used for every boxed region. Kept as its own component so pages
 * never hand-assemble a Card header and drift apart on spacing.
 */
export function Panel({
  children,
  className,
  contentClassName,
  title,
  action,
}: {
  children: ReactNode
  className?: string
  contentClassName?: string
  title?: string
  action?: ReactNode
}) {
  return (
    <Card className={className}>
      {(title || action) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {action && <CardAction>{action}</CardAction>}
        </CardHeader>
      )}
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  )
}

/**
 * Status pill. The palette is monochrome, so a status is carried by the label
 * plus a dot whose color comes from the server when one is configured.
 */
export function StatusBadge({ value, color }: { value: unknown; color?: string | null }) {
  const label = fieldLabel(value)
  const objectColor = value && typeof value === 'object' && 'color' in value
    ? String((value as { color?: string }).color ?? '')
    : ''
  const chosen = color || objectColor

  return (
    <Badge variant="outline" className="gap-1.5 rounded-full font-normal">
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full bg-muted-foreground"
        style={chosen ? { backgroundColor: chosen } : undefined}
      />
      {label}
    </Badge>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon: IconComponent = Search,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <IconComponent className="size-5" />
      </span>
      <div className="space-y-1">
        <h3 className="font-medium">{title}</h3>
        {description && <p className="text-sm text-muted-foreground text-pretty">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle className="sr-only">Error</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{message}</span>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw />
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}

export function LoadingRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2" aria-label="Loading" role="status">
      {Array.from({ length: rows }, (_, row) => (
        <div
          className="grid gap-3"
          key={row}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(90px, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton className="h-8" key={column} />
          ))}
        </div>
      ))}
    </div>
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
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function Minutes({ value }: { value?: number | null }) {
  const total = Math.max(0, value ?? 0)
  const hours = Math.floor(total / 60)
  const minutes = Math.round(total % 60)
  return (
    <span className="font-mono tabular-nums">
      {hours ? `${hours}h ${minutes ? `${minutes}m` : ''}` : `${minutes}m`}
    </span>
  )
}
