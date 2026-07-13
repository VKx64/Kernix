import { Link } from 'react-router'
import { useCan } from '../lib/permissions'

export function NotFoundPage() {
  const can = useCan()
  const destination = can('dashboard.view') ? '/' : '/profile'
  return <section className="standalone-state"><span className="state-code">404</span><h1>That page wandered off.</h1><p>The address may be old, or this item may no longer be available.</p><Link className="btn btn-primary" to={destination}>{destination === '/' ? 'Return to dashboard' : 'Open profile'}</Link></section>
}
