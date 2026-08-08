import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { stubTimer } from '@/lib/timerStub'
import type { Timer } from '@/lib/useTimer'
import { TimerBox } from './TimerBox'

/**
 * The sidebar timer answers one question from across the room: is anything
 * being recorded, and against what. These cases pin the three states it can
 * be in and the two controls that only exist while it runs.
 */

function renderBox(overrides: Partial<Timer> = {}) {
  const timer = stubTimer(overrides)
  render(<MemoryRouter><TimerBox timer={timer} /></MemoryRouter>)
  return timer
}

const workingOn = (title: string): Partial<Timer> => ({
  state: 'working',
  clockedIn: true,
  task: { id: 7, title },
  seconds: 4325,
  todayMinutes: 132,
})

it('shows the day total, and no controls, when nothing is being tracked', () => {
  renderBox({ todayMinutes: 132 })

  expect(screen.getByText('Not tracking')).toBeInTheDocument()
  expect(screen.getByText('2h 12m')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Break' })).not.toBeInTheDocument()
})

it('names the task being tracked and counts it in hours', () => {
  renderBox(workingOn('Cut the launch film'))

  expect(screen.getByText('Cut the launch film')).toBeInTheDocument()
  expect(screen.getByText('01:12:05')).toBeInTheDocument()
  expect(screen.getByText('2h 12m today')).toBeInTheDocument()
})

it('offers the five breaks with how long each is meant to last', async () => {
  const actor = userEvent.setup()
  const timer = renderBox(workingOn('Cut the launch film'))

  await actor.click(screen.getByRole('button', { name: 'Break' }))

  expect(timer.setBreakMenuOpen).toHaveBeenCalledWith(true)
})

it('lists the break kinds once the menu is open', async () => {
  renderBox({ ...workingOn('Cut the launch film'), breakMenuOpen: true })

  expect(await screen.findByRole('menuitem', { name: /Lunch/ })).toHaveTextContent('45m')
  expect(await screen.findByRole('menuitem', { name: /Open-ended/ })).toHaveTextContent('—')
})

it('counts a break up in minutes and says when it is due back', () => {
  const dueAt = new Date()
  dueAt.setHours(14, 15, 0, 0)
  renderBox({
    state: 'break',
    clockedIn: true,
    task: { id: 7, title: 'Cut the launch film' },
    breakKind: 'Lunch',
    seconds: 723,
    pausedSeconds: 4325,
    breakDueAt: dueAt,
  })

  expect(screen.getByText('Lunch')).toBeInTheDocument()
  expect(screen.getByText('12:03')).toBeInTheDocument()
  expect(screen.getByText(/Cut the launch film paused · 01:12:05/)).toBeInTheDocument()
  expect(screen.getByText(/^back ~/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
})

it('says how far over an overrunning break has gone', () => {
  renderBox({
    state: 'break',
    clockedIn: true,
    breakKind: 'Coffee',
    seconds: 1200,
    overBy: 5,
    breakDueAt: new Date(),
  })

  expect(screen.getByText('+5m over')).toBeInTheDocument()
})
