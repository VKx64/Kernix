import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useCan } from '@/lib/permissions'

export function NotFoundPage() {
  const can = useCan()
  const destination = can('dashboard.view') ? '/' : '/profile'

  return (
    <section className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="font-mono text-5xl font-semibold tabular-nums text-muted-foreground">404</span>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">That page wandered off.</h1>
        <p className="text-muted-foreground text-pretty">
          The address may be old, or this item may no longer be available.
        </p>
      </div>
      <Button asChild>
        <Link to={destination}>{destination === '/' ? 'Return to dashboard' : 'Open profile'}</Link>
      </Button>
    </section>
  )
}
