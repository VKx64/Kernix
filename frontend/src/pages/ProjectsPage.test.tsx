import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { ProjectsPage } from './EntityPages'
import type { Project, User } from '../types/api'

const authState = vi.hoisted(() => ({ user: null as User | null }))
const reload = vi.hoisted(() => vi.fn(async () => undefined))
const collectionState = vi.hoisted(() => ({
  data: [] as Project[],
  meta: { page: 1, perPage: 20, total: 0, lastPage: 1 },
  loading: false,
  error: '',
  reload,
}))
const apiGet = vi.hoisted(() => vi.fn(async (path: string) => path === '/api/bootstrap'
  ? {
      data: {
        clients: [{ id: 7, name: 'Acme' }],
        coworkers: [{ id: 9, first_name: 'Casey', last_name: 'Worker' }],
        fields: [{ id: 10, key: 'project_status', name: 'Project status', values: [{ id: 12, label: 'Planning' }] }],
      },
    }
  : { data: [], current_page: 1, last_page: 1, per_page: 100, total: 0 }))
const apiPost = vi.hoisted(() => vi.fn(async () => ({
  data: {
    id: 44,
    name: 'Launch campaign',
    client: { id: 7, name: 'Acme' },
    manager: null,
  },
})))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: authState.user, status: 'authenticated', login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../auth/WorkspaceProvider', () => ({
  useWorkspace: () => ({ singleClientMode: false, settings: {} }),
}))

vi.mock('../lib/useCollection', () => ({
  useCollection: () => collectionState,
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, post: apiPost } }
})

function TaskHandoff() {
  const location = useLocation()
  return <p>Project handoff: {new URLSearchParams(location.search).get('project_id')}</p>
}

describe('ProjectsPage project onboarding integration', () => {
  beforeEach(() => {
    authState.user = {
      id: 2,
      username: 'producer',
      permissions: ['dashboard.view', 'projects.view', 'projects.create', 'tasks.view'],
    }
    collectionState.data = []
    collectionState.meta = { page: 1, perPage: 20, total: 0, lastPage: 1 }
    reload.mockClear()
    apiGet.mockClear()
    apiPost.mockClear()
  })

  it('unwraps the create response, reloads projects, and hands the created project to its success action', async () => {
    const actor = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <Routes>
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/tasks" element={<TaskHandoff />} />
        </Routes>
      </MemoryRouter>,
    )

    await actor.click(screen.getByRole('button', { name: 'New project' }))
    expect(await screen.findByRole('dialog', { name: 'Set up a project' })).toBeInTheDocument()

    await screen.findByRole('option', { name: 'Acme' })
    await actor.type(screen.getByLabelText(/^Project name/), 'Launch campaign')
    await actor.selectOptions(screen.getByLabelText(/^Client/), '7')
    await actor.click(screen.getByRole('button', { name: 'Continue to plan' }))
    await actor.click(screen.getByRole('button', { name: 'Review project' }))
    await actor.click(screen.getByRole('button', { name: 'Create project' }))

    expect(apiPost).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
      name: 'Launch campaign',
      client_id: '7',
    }))
    expect(await screen.findByRole('heading', { name: 'Launch campaign is ready for the team' })).toBeInTheDocument()
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))

    await actor.click(screen.getByRole('button', { name: 'Open project tasks' }))
    expect(await screen.findByText('Project handoff: 44')).toBeInTheDocument()
  })

  it('still confirms creation when refreshing the project list fails', async () => {
    const actor = userEvent.setup()
    reload.mockRejectedValueOnce(new Error('offline'))
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <ProjectsPage />
      </MemoryRouter>,
    )

    await actor.click(screen.getByRole('button', { name: 'New project' }))
    await screen.findByRole('option', { name: 'Acme' })
    await actor.type(screen.getByLabelText(/^Project name/), 'Launch campaign')
    await actor.selectOptions(screen.getByLabelText(/^Client/), '7')
    await actor.click(screen.getByRole('button', { name: 'Continue to plan' }))
    await actor.click(screen.getByRole('button', { name: 'Review project' }))
    await actor.click(screen.getByRole('button', { name: 'Create project' }))

    expect(await screen.findByRole('heading', { name: 'Launch campaign is ready for the team' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('The project was created, but the list could not be refreshed.')
  })
})
