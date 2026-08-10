import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ProjectFormBuilderPage } from './ProjectFormBuilderPage'
import type { ProjectForm, ProjectFormField } from '../types/api'

/**
 * Screen B. Three acceptance items live here: a map target moves to whoever
 * claims it next and clears the field that held it (the backend 422s on a
 * duplicate, so the builder must never let one be submitted), the 12-field
 * cap disables Add field with its reason inline, and the whole screen saves
 * itself — there is no Save button anywhere on it.
 */

function shortTextField(id: string, label: string, maps: string): ProjectFormField {
  return { id, type: 'short_text', label, help: '', required: false, choices: [], maps }
}

const seq = vi.hoisted(() => ({ n: 900 }))
const apiState = vi.hoisted(() => ({ form: null as unknown as ProjectForm }))

const apiGet = vi.hoisted(() => vi.fn(async (path: string) => {
  if (path === '/api/project-forms/10') return { data: apiState.form }
  throw new Error(`Unexpected GET ${path}`)
}))
const apiPatch = vi.hoisted(() => vi.fn(async (_path: string, body: Record<string, unknown>) => {
  const rawFields = (body.fields as Array<Record<string, unknown>> | undefined) ?? []
  const fields = rawFields.map((field) => ({
    id: (field.id as string | undefined) ?? `fl${seq.n++}`,
    type: field.type,
    label: field.label,
    help: field.help,
    required: field.required,
    choices: field.choices,
    maps: field.maps,
  }))
  apiState.form = { ...apiState.form, ...body, fields } as ProjectForm
  return { data: apiState.form }
}))
const apiPost = vi.hoisted(() => vi.fn(async () => ({ data: {} })))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, patch: apiPatch, post: apiPost } }
})

vi.mock('@/lib/useTaskLookups', () => ({
  useTaskLookups: () => ({
    urgencyOptions: [
      { id: 1, key: 'urgent', label: 'Urgent' },
      { id: 2, key: 'high', label: 'High' },
      { id: 3, key: 'normal', label: 'Normal' },
      { id: 4, key: 'low', label: 'Low' },
    ],
  }),
}))

function renderBuilder() {
  return render(
    <MemoryRouter initialEntries={['/projects/5/forms/10']}>
      <Routes>
        <Route path="projects/:projectId/forms/:formId" element={<ProjectFormBuilderPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function baseForm(fields: ProjectFormField[]): ProjectForm {
  return {
    id: 10,
    project_id: 5,
    title: 'Bug Report',
    blurb: '',
    header_line: null,
    icon: null,
    slug: 'abc123',
    state: 'live',
    fields,
    require_email: false,
    auto_convert: false,
    notify: true,
    submissions_count: 0,
    pending_submissions_count: 0,
  }
}

describe('ProjectFormBuilderPage', () => {
  beforeEach(() => {
    apiGet.mockClear(); apiPatch.mockClear(); apiPost.mockClear()
  })

  it('moves a claimed map target to the newly-picked field and clears the old holder', async () => {
    apiState.form = baseForm([
      shortTextField('fl1', 'Title field', 'title'),
      shortTextField('fl2', 'Alt title field', 'none'),
    ])
    const actor = userEvent.setup()
    renderBuilder()

    await actor.click(await screen.findByText('Alt title field'))
    const mapsSelect = screen.getByRole('combobox', { name: 'Maps to' })
    await actor.selectOptions(mapsSelect, 'Title')

    expect(await screen.findByText(/moved from "Title field" to "Alt title field/)).toBeInTheDocument()

    await actor.click(screen.getByText('Title field'))
    expect(screen.getByRole('combobox', { name: 'Maps to' })).toHaveValue('none')
  })

  it('disables Add field at the 12-field cap with the reason shown inline', async () => {
    const fields = Array.from({ length: 12 }, (_, index) => shortTextField(`fl${index + 1}`, `Field ${index + 1}`, 'none'))
    apiState.form = baseForm(fields)
    renderBuilder()

    await screen.findByText('Field 1')
    expect(screen.getByText(/12 fields is the most a form can hold/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add field' })).not.toBeInTheDocument()
  })

  it('has no Save button and autosaves a change in the background', async () => {
    apiState.form = baseForm([shortTextField('fl1', 'Title field', 'title')])
    const actor = userEvent.setup()
    renderBuilder()

    await screen.findByText('Title field')
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument()

    const titleInput = screen.getByLabelText('Form title')
    await actor.type(titleInput, '!')

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/api/project-forms/10', expect.objectContaining({ title: 'Bug Report!' })), { timeout: 3000 })
    await screen.findByText(/Saved/i, {}, { timeout: 3000 })
  })
})
