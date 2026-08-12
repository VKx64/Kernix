import { render, screen } from '@testing-library/react'
import { healthDetail, healthOf, type PortfolioStats } from '@/lib/health'
import { ClientTile, type ClientStats } from './ClientTile'
import { ProjectCard } from './ProjectCard'

/**
 * The two cards Phase 5 introduces.
 *
 * The server owns health and the counts; what is pinned here is the editorial
 * layer on top — which fact wins the one line of space, and which figures
 * disappear rather than showing a misleading zero.
 */

function stats(overrides: Partial<PortfolioStats> = {}): PortfolioStats {
  return {
    total: 10, done: 4, open: 6, overdue: 0, blocked: 0, unowned: 0,
    logged_minutes: 4200, estimated_minutes: 6000, budget_minutes: 4800,
    percent_complete: 40, health: 'ontrack',
    ...overrides,
  }
}

function clientStats(overrides: Partial<ClientStats> = {}): ClientStats {
  return {
    projects: 3, open_tasks: 12, overdue: 0, blocked: 0, logged_minutes: 9400,
    retainer_minutes: 4800, retainer_used_minutes: 3400, health: 'ontrack', owner: null,
    ...overrides,
  }
}

describe('the one line under a project name', () => {
  it('names trouble before volume', () => {
    expect(healthDetail({ overdue: 2, blocked: 1, open: 7 })).toBe('2 overdue · 1 blocked')
  })

  it('falls back to what is left only when nothing is wrong', () => {
    expect(healthDetail({ overdue: 0, blocked: 0, open: 7 })).toBe('7 open')
  })
})

describe('health presentation', () => {
  it('gives each state its own word and colour', () => {
    expect(healthOf('offtrack').label).toBe('Off track')
    expect(healthOf('atrisk').label).toBe('At risk')
    expect(healthOf('done').label).toBe('Complete')
    expect(healthOf('ontrack').color).toBe('var(--good)')
  })

  it('treats an unknown value as on track rather than blowing up', () => {
    expect(healthOf(undefined).label).toBe('On track')
  })
})

describe('project card', () => {
  it('shows logged against budget, and flags going over', () => {
    render(<ProjectCard name="Website Relaunch" stats={stats({ logged_minutes: 5400 })} team={[]} />)

    const budget = screen.getByText('90h / 80h')
    expect(budget).toBeInTheDocument()
    expect(budget.className).toMatch(/text-danger/)
  })

  it('hides the budget line entirely when no budget is set', () => {
    render(<ProjectCard name="Website Relaunch" stats={stats({ budget_minutes: null })} team={[]} />)

    // A "/ 0m" would read as a budget of nothing rather than none set.
    expect(screen.queryByText(/\/ 0m/)).not.toBeInTheDocument()
    expect(screen.queryByText(/70h \//)).not.toBeInTheDocument()
  })

  it('carries a state pill only when the project is not simply running', () => {
    const { rerender } = render(<ProjectCard name="Website Relaunch" stats={stats()} team={[]} />)
    expect(screen.queryByText('On hold')).not.toBeInTheDocument()

    rerender(<ProjectCard name="Website Relaunch" stats={stats()} stateLabel="On hold" team={[]} />)
    expect(screen.getByText('On hold')).toBeInTheDocument()
  })

  it('caps the team at four faces and counts the rest', () => {
    const team = [1, 2, 3, 4, 5, 6].map((id) => ({ id, first_name: `P${id}`, last_name: 'X' }))
    render(<ProjectCard name="Website Relaunch" stats={stats()} team={team} />)

    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('fills its grid column instead of capping out and leaving a gap', () => {
    render(<ProjectCard name="Website Relaunch" stats={stats()} team={[]} />)

    const root = screen.getByText('Website Relaunch').closest('button')?.parentElement
    expect(root?.className).toMatch(/\bw-full\b/)
    expect(root?.className).not.toMatch(/\bmax-w-sm\b/)
  })

  it('centres the actions cluster on the header row despite the height mismatch', () => {
    // jsdom doesn't lay out boxes, so this can't measure the actual centre
    // line. `text-title` (13.5px / 1.3 line-height ≈ 17.6px) is shorter than
    // the optional state pill's h-5 (20px), so the header row needs a floor
    // (min-h-5) to keep a stable height whether or not a project has a state
    // label — otherwise no single offset below could centre both cases. The
    // action buttons are size-7 (28px) — taller than that 20px row — so
    // matching top offsets the way ClientTile does would not centre them.
    // What's pinned here is the offset that accounts for the difference:
    // pt-4 (the button's own top padding, where the row starts) and top-3
    // on the actions wrapper (pt-4's 16px minus half the 8px height gap).
    render(<ProjectCard name="Website Relaunch" stats={stats()} team={[]} actions={<button>Edit</button>} />)

    const button = screen.getByText('Website Relaunch').closest('button')
    expect(button?.className).toMatch(/\bpt-4\b/)

    const headerRow = screen.getByText('Website Relaunch').parentElement
    expect(headerRow?.className).toMatch(/\bmin-h-5\b/)

    const actionsWrapper = screen.getByText('Edit').parentElement
    expect(actionsWrapper?.className).toMatch(/\btop-3\b/)
  })

  it('reserves enough room for the worst-case action cluster (sparkle, edit, delete)', () => {
    // A pure-CSS overlap check isn't possible in jsdom (bug #2's collision
    // — "On Hold" under the sparkle icon — was only visible in a real
    // layout). What's checkable here is the arithmetic behind the
    // reservation, computed from the real markup rather than guessed: up to
    // three size-7 (28px) buttons — sparkle, edit, delete — separated by two
    // 4px gaps (gap-1, both in the outer actions wrapper and inside
    // RowActions), sitting right-2.5 (10px) from the card edge. That has to
    // clear the button's own 17px right padding. If a fourth action button
    // is ever added to this cluster in EntityPages.tsx, MAX_BUTTONS must
    // grow here and pr-24 must grow in ProjectCard.tsx.
    const BUTTON_PX = 28 // Button size="icon-sm" -> size-7
    const MAX_BUTTONS = 3 // sparkle (AI memory) + edit + delete
    const GAP_PX = 4 // gap-1
    const RIGHT_OFFSET_PX = 10 // right-2.5
    const BUTTON_BASE_PADDING_PX = 17 // the button's own px-[17px]
    const TAILWIND_UNIT_PX = 4 // pr-N reserves N * 4px

    const worstCaseClusterWidth = MAX_BUTTONS * BUTTON_PX + (MAX_BUTTONS - 1) * GAP_PX
    const requiredReservation = RIGHT_OFFSET_PX + worstCaseClusterWidth - BUTTON_BASE_PADDING_PX
    const reservedByPr24 = 24 * TAILWIND_UNIT_PX

    expect(reservedByPr24).toBeGreaterThanOrEqual(requiredReservation)

    const { rerender } = render(
      <ProjectCard name="Website Relaunch" stats={stats()} team={[]} actions={<button>Edit</button>} />,
    )
    const headerRow = screen.getByText('Website Relaunch').parentElement
    expect(headerRow?.className).toMatch(/\bpr-24\b/)

    rerender(<ProjectCard name="Website Relaunch" stats={stats()} team={[]} />)
    const headerRowWithoutActions = screen.getByText('Website Relaunch').parentElement
    expect(headerRowWithoutActions?.className).not.toMatch(/\bpr-24\b/)
  })
})

describe('client tile', () => {
  it('leads with delivery health and never mentions money', () => {
    render(<ClientTile name="Northwind Creative" stats={clientStats({ health: 'atrisk', overdue: 2 })} />)

    expect(screen.getByText('At risk')).toBeInTheDocument()
    expect(screen.getByText('3 projects · 12 open · 2 overdue')).toBeInTheDocument()
    expect(screen.queryByText(/outstanding|invoice|\$/i)).not.toBeInTheDocument()
  })

  it('shows the retainer as hours against the monthly allowance', () => {
    render(<ClientTile name="Northwind Creative" stats={clientStats()} />)

    expect(screen.getByText('56h 40m of 80h')).toBeInTheDocument()
  })

  it('drops the retainer bar for a client that has no allowance', () => {
    render(<ClientTile name="Northwind Creative" stats={clientStats({ retainer_minutes: null, retainer_used_minutes: null })} />)

    expect(screen.queryByText('Retainer this month')).not.toBeInTheDocument()
  })

  it('leaves overdue out of the footer when there is none', () => {
    render(<ClientTile name="Northwind Creative" stats={clientStats()} />)

    expect(screen.getByText('3 projects · 12 open')).toBeInTheDocument()
  })

  it('reserves room for actions so they never sit over the health label', () => {
    // The actions cluster floats absolutely over the card rather than
    // sitting in flow (so it can live outside the open button without
    // nesting one button inside another). A pure-CSS overlap check isn't
    // possible in jsdom, so this asserts the DOM contract that prevents
    // it: the header row that carries the health label reserves space with
    // pr-16 whenever actions are present, and drops that reservation when
    // there is nothing to clear. pr-16 (64px) covers ClientTile's smaller,
    // two-button worst case (edit + archive/restore); ProjectCard's cluster
    // can hold a third (sparkle) button and reserves more (pr-24) — see
    // ProjectCard's own reservation test for that math.
    const { rerender } = render(
      <ClientTile name="Northwind Creative" stats={clientStats()} actions={<button>Edit</button>} />,
    )
    const healthLabel = screen.getByText('On track')
    const headerRow = healthLabel.parentElement
    expect(headerRow?.className).toMatch(/\bpr-16\b/)

    rerender(<ClientTile name="Northwind Creative" stats={clientStats()} />)
    const headerRowWithoutActions = screen.getByText('On track').parentElement
    expect(headerRowWithoutActions?.className).not.toMatch(/\bpr-16\b/)
  })

  it('anchors the actions cluster to the same top offset the header row starts from', () => {
    // jsdom doesn't lay out boxes, so the actual centre line can't be
    // measured here. What is checkable is the structural contract that
    // makes the two line up: the actions wrapper's top offset (top-3.5)
    // matches the button's own top padding (pt-3.5), so both the header
    // row and the actions cluster start from the same line. They then
    // share a centre because the monogram (28px) and the action buttons
    // (size-7, also 28px) are the same height. The name is also asserted
    // as non-wrapping (truncate), since that's what keeps the header row's
    // height — and thus this whole alignment — stable regardless of name
    // length.
    render(<ClientTile name="Northwind Creative" stats={clientStats()} actions={<button>Edit</button>} />)

    const button = screen.getByText('Northwind Creative').closest('button')
    expect(button?.className).toMatch(/\bpt-3\.5\b/)

    const actionsWrapper = screen.getByText('Edit').parentElement
    expect(actionsWrapper?.className).toMatch(/\btop-3\.5\b/)

    const nameSpan = screen.getByText('Northwind Creative')
    expect(nameSpan.className).toMatch(/\btruncate\b/)
  })
})
