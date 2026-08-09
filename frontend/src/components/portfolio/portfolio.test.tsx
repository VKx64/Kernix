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
})
