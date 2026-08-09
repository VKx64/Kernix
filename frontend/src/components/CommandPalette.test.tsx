import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { CommandPalette } from './CommandPalette'
import { ShortcutsDialog } from './ShortcutsDialog'

/**
 * The two global overlays.
 *
 * The palette is both a finder and a capture tool, and the second half is the
 * one worth protecting: typing something that matches nothing and pressing
 * Enter has to make it a task, or the box is just a search field.
 */

const navigate = vi.hoisted(() => vi.fn())
const apiGet = vi.hoisted(() => vi.fn(async () => ({ data: [] as unknown[] })))
const timerState = vi.hoisted(() => ({ state: 'idle' as string, start: vi.fn(), stop: vi.fn(), resume: vi.fn() }))

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>()
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet } }
})

vi.mock('../lib/permissions', () => ({ useCan: () => () => true, isAdministrator: () => false }))
vi.mock('../lib/features', () => ({ useFeature: () => () => true }))
vi.mock('../lib/useTimer', () => ({ useTimerContext: () => timerState }))

function renderPalette(onShortcuts = vi.fn(), onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <CommandPalette open onClose={onClose} onShortcuts={onShortcuts} />
    </MemoryRouter>,
  )
  return { onShortcuts, onClose }
}

beforeEach(() => {
  navigate.mockClear()
  apiGet.mockClear()
  apiGet.mockResolvedValue({ data: [] })
  timerState.state = 'idle'
})

describe('the command palette', () => {
  it('searches tasks on the server rather than filtering what it already has', async () => {
    const actor = userEvent.setup()
    renderPalette()

    await actor.type(screen.getByRole('textbox'), 'checkout')

    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith(
      '/api/tasks',
      expect.objectContaining({ search: 'checkout' }),
      expect.anything(),
    ))
  })

  it('lists matching tasks and opens the one chosen', async () => {
    const actor = userEvent.setup()
    apiGet.mockResolvedValue({ data: [{ id: 12, title: 'Fix broken checkout links', project: { id: 5, name: 'Website Relaunch' } }] })
    renderPalette()

    await actor.click(await screen.findByRole('button', { name: /Fix broken checkout links/ }))

    expect(navigate).toHaveBeenCalledWith('/tasks?open=12')
  })

  it('filters commands as you type', async () => {
    const actor = userEvent.setup()
    renderPalette()

    expect(await screen.findByRole('button', { name: /Timesheet/ })).toBeInTheDocument()
    await actor.type(screen.getByRole('textbox'), 'timesh')

    await waitFor(() => expect(screen.queryByRole('button', { name: /Dashboard/ })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Timesheet/ })).toBeInTheDocument()
  })

  it('takes an unmatched query as a new task on Enter', async () => {
    const actor = userEvent.setup()
    renderPalette()

    await actor.type(screen.getByRole('textbox'), 'ring the printer people')
    await waitFor(() => expect(screen.getByText(/Press ↵ to create it as a task/)).toBeInTheDocument())
    await actor.keyboard('{Enter}')

    expect(navigate).toHaveBeenCalledWith('/tasks?new=1&title=ring%20the%20printer%20people')
  })

  it('offers the timer command that matches the timer’s state', async () => {
    renderPalette()
    expect(await screen.findByRole('button', { name: /Start the timer/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Back to work/ })).not.toBeInTheDocument()
  })

  it('offers the way back from a break instead', async () => {
    timerState.state = 'break'
    renderPalette()

    expect(await screen.findByRole('button', { name: /Back to work/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Start the timer/ })).not.toBeInTheDocument()
  })

  it('hands off to the shortcuts sheet', async () => {
    const actor = userEvent.setup()
    const { onShortcuts } = renderPalette()

    await actor.click(await screen.findByRole('button', { name: /Shortcuts/ }))

    expect(onShortcuts).toHaveBeenCalled()
  })
})

describe('the shortcuts sheet', () => {
  it('lists the keys the app actually binds', () => {
    render(<ShortcutsDialog open onClose={vi.fn()} />)

    expect(screen.getByText('Search & commands')).toBeInTheDocument()
    expect(screen.getByText('Break / resume')).toBeInTheDocument()
    expect(screen.getByText('Toggle done')).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<ShortcutsDialog open={false} onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
