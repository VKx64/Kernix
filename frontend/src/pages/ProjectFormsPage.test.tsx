import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ProjectFormsPage } from './ProjectFormsPage'
import type { Project, ProjectForm } from '../types/api'

/**
 * Screen A. The review queue must never render as an empty table — it is
 * either a populated section or entirely absent from the page.
 */

const project: Project = { id: 5, name: 'Northwind Health', client: { id: 2, name: 'Northwind' } }

const forms = vi.hoisted(() => ({ list: [] as ProjectForm[] }))

const apiGet = vi.hoisted(() => vi.fn(async (path: string): Promise<unknown> => {
  if (path === '/api/projects/5') return { data: project }
  if (path === '/api/projects/5/forms') return { data: forms.list }
  throw new Error(`Unexpected GET ${path}`)
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet } }
})

vi.mock('@/lib/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/permissions')>()
  return { ...actual, useCan: () => () => true }
})

function renderForms() {
  return render(
    <MemoryRouter initialEntries={['/projects/5/forms']}>
      <Routes>
        <Route path="projects/:projectId/forms" element={<ProjectFormsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProjectFormsPage', () => {
  beforeEach(() => { apiGet.mockClear() })

  it('renders the empty state with no review queue when the project has no forms', async () => {
    forms.list = []
    renderForms()

    expect(await screen.findByText('No intake forms yet')).toBeInTheDocument()
    expect(screen.queryByText('Awaiting review')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('hides the review queue when every form has zero pending submissions', async () => {
    forms.list = [{
      id: 1, project_id: 5, title: 'Bug Report', blurb: '', slug: 'abc', state: 'live',
      fields: [], require_email: false, auto_convert: false, notify: true,
      submissions_count: 12, pending_submissions_count: 0,
    }]
    renderForms()

    expect(await screen.findByText('Bug Report')).toBeInTheDocument()
    expect(screen.queryByText('Awaiting review')).not.toBeInTheDocument()
  })

  it('shows the queue only once a form actually has a submission waiting', async () => {
    forms.list = [{
      id: 1, project_id: 5, title: 'Bug Report', blurb: '', slug: 'abc', state: 'live',
      fields: [], require_email: false, auto_convert: false, notify: true,
      submissions_count: 1, pending_submissions_count: 1,
    }]
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/projects/5') return { data: project }
      if (path === '/api/projects/5/forms') return { data: forms.list }
      if (path === '/api/project-forms/1/submissions') {
        return {
          data: [{
            id: 33, project_form_id: 1, status: 'new', answers: {}, created_at: new Date().toISOString(),
            form_snapshot: { id: 1, title: 'Bug Report', fields: [] },
            submitter_name: 'Dana W.',
          }],
          current_page: 1, last_page: 1, per_page: 50, total: 1,
        }
      }
      throw new Error(`Unexpected GET ${path}`)
    })
    renderForms()

    expect(await screen.findByText('Awaiting review')).toBeInTheDocument()
    expect(await screen.findByText('Dana W.')).toBeInTheDocument()
  })
})
