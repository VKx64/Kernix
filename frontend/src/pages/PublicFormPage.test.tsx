import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { PublicFormPage } from './PublicFormPage'
import type { PublicForm } from '../types/api'

/**
 * Screen C. A closed form must render its title and blurb, the closed
 * message, and nothing else — no fields, no submit button, and (checked
 * elsewhere in this file) never through `lib/api.ts`, which would carry a
 * staff session cookie to an anonymous page.
 */

const publicGet = vi.hoisted(() => vi.fn())
const publicPost = vi.hoisted(() => vi.fn())

vi.mock('@/lib/publicApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/publicApi')>()
  return { ...actual, publicApi: { get: publicGet, post: publicPost } }
})

function renderPublic(slug = 'closed-slug') {
  return render(
    <MemoryRouter initialEntries={[`/f/${slug}`]}>
      <Routes>
        <Route path="/f/:slug" element={<PublicFormPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PublicFormPage', () => {
  beforeEach(() => { publicGet.mockClear(); publicPost.mockClear() })

  it('renders the closed state with title and blurb but no fields and no submit button', async () => {
    const closedForm: PublicForm = {
      title: 'Content handoff',
      blurb: 'Copy and assets for the August release.',
      closed: true,
      closed_message: "This form isn't accepting submissions right now.",
      require_email: false,
      fields: [
        { id: 'fl1', type: 'short_text', label: 'What is it?', required: true },
      ],
    }
    publicGet.mockResolvedValue(closedForm)

    renderPublic()

    expect(await screen.findByText('Content handoff')).toBeInTheDocument()
    expect(screen.getByText('Copy and assets for the August release.')).toBeInTheDocument()
    expect(screen.getByText("This form isn't accepting submissions right now.")).toBeInTheDocument()
    expect(screen.queryByText('What is it?')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument()
    expect(publicGet).toHaveBeenCalledWith('/api/public/forms/closed-slug')
  })

  it('renders an open form and lets a valid submission through, without lib/api.ts', async () => {
    const openForm: PublicForm = {
      title: 'Bug Report',
      blurb: 'Tell us what broke.',
      closed: false,
      require_email: false,
      fields: [
        { id: 'fl1', type: 'short_text', label: 'What went wrong?', required: true },
      ],
    }
    publicGet.mockResolvedValue(openForm)
    publicPost.mockResolvedValue({ reference: 'REF-1', submitted_at: new Date().toISOString(), email_on_file: false })

    renderPublic()
    expect(await screen.findByText('What went wrong?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
  })

  it('sends each file field under its own files[<fieldId>][] key, never a flat files[]', async () => {
    const twoFileForm: PublicForm = {
      title: 'Bug Report',
      closed: false,
      require_email: false,
      max_files: 5,
      max_file_bytes: 10 * 1024 * 1024,
      accepted_types: ['image/png', 'application/pdf'],
      fields: [
        { id: 'fl_shot', type: 'file', label: 'Screenshot', required: false },
        { id: 'fl_log', type: 'file', label: 'Log file', required: false },
      ],
    }
    publicGet.mockResolvedValue(twoFileForm)
    publicPost.mockResolvedValue({ reference: 'REF-2', submitted_at: new Date().toISOString(), email_on_file: false })

    renderPublic('multi-file-slug')

    const screenshotInput = (await screen.findByLabelText('Screenshot')) as HTMLInputElement
    const logInput = screen.getByLabelText('Log file') as HTMLInputElement

    const shot = new File(['shot'], 'shot.png', { type: 'image/png' })
    const log = new File(['log'], 'log.pdf', { type: 'application/pdf' })

    fireEvent.change(screenshotInput, { target: { files: [shot] } })
    fireEvent.change(logInput, { target: { files: [log] } })

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(publicPost).toHaveBeenCalledTimes(1))

    const [path, body] = publicPost.mock.calls[0] as [string, FormData]
    expect(path).toBe('/api/public/forms/multi-file-slug/submissions')
    expect(body).toBeInstanceOf(FormData)
    expect(body.getAll('files[fl_shot][]')).toEqual([shot])
    expect(body.getAll('files[fl_log][]')).toEqual([log])
    expect(body.getAll('files[]')).toEqual([])
  })

  it('blocks submit with an inline message when a field exceeds its per-field file cap, before any request is sent', async () => {
    const cappedForm: PublicForm = {
      title: 'Bug Report',
      closed: false,
      require_email: false,
      max_files: 5,
      max_file_bytes: 10 * 1024 * 1024,
      accepted_types: ['image/png'],
      fields: [
        { id: 'fl_shot', type: 'file', label: 'Screenshot', required: false, max: 1 },
      ],
    }
    publicGet.mockResolvedValue(cappedForm)

    renderPublic()

    const screenshotInput = (await screen.findByLabelText('Screenshot')) as HTMLInputElement
    const first = new File(['a'], 'a.png', { type: 'image/png' })
    const second = new File(['b'], 'b.png', { type: 'image/png' })

    fireEvent.change(screenshotInput, { target: { files: [first, second] } })

    expect(await screen.findByText(/no more than 1 file/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(publicPost).not.toHaveBeenCalled()
  })

  it('blocks submit with a whole-submission message when max_submission_files is exceeded even though each field is under its own cap', async () => {
    const form: PublicForm = {
      title: 'Bug Report',
      closed: false,
      require_email: false,
      max_files: 5,
      max_file_bytes: 10 * 1024 * 1024,
      max_submission_files: 3,
      max_submission_bytes: 30 * 1024 * 1024,
      accepted_types: ['image/png'],
      fields: [
        { id: 'fl_a', type: 'file', label: 'Field A', required: false },
        { id: 'fl_b', type: 'file', label: 'Field B', required: false },
        { id: 'fl_c', type: 'file', label: 'Field C', required: false },
      ],
    }
    publicGet.mockResolvedValue(form)

    renderPublic('agg-count-slug')

    const a = (await screen.findByLabelText('Field A')) as HTMLInputElement
    const b = screen.getByLabelText('Field B') as HTMLInputElement
    const c = screen.getByLabelText('Field C') as HTMLInputElement

    fireEvent.change(a, { target: { files: [new File(['1'], '1.png', { type: 'image/png' })] } })
    fireEvent.change(b, { target: { files: [new File(['2'], '2.png', { type: 'image/png' })] } })
    fireEvent.change(c, {
      target: {
        files: [
          new File(['3'], '3.png', { type: 'image/png' }),
          new File(['4'], '4.png', { type: 'image/png' }),
        ],
      },
    })

    expect(await screen.findByText(/allows at most 3 files total per submission, not per field/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(publicPost).not.toHaveBeenCalled()
  })

  it('blocks submit with a whole-submission message when max_submission_bytes is exceeded even though each field is under its own cap', async () => {
    const form: PublicForm = {
      title: 'Bug Report',
      closed: false,
      require_email: false,
      max_files: 5,
      max_file_bytes: 20 * 1024 * 1024,
      max_submission_files: 10,
      max_submission_bytes: 30 * 1024 * 1024,
      accepted_types: ['image/png'],
      fields: [
        { id: 'fl_a', type: 'file', label: 'Field A', required: false },
        { id: 'fl_b', type: 'file', label: 'Field B', required: false },
      ],
    }
    publicGet.mockResolvedValue(form)

    renderPublic('agg-bytes-slug')

    const a = (await screen.findByLabelText('Field A')) as HTMLInputElement
    const b = screen.getByLabelText('Field B') as HTMLInputElement

    const big1 = new File([new Uint8Array(18 * 1024 * 1024)], 'big1.png', { type: 'image/png' })
    const big2 = new File([new Uint8Array(18 * 1024 * 1024)], 'big2.png', { type: 'image/png' })

    fireEvent.change(a, { target: { files: [big1] } })
    fireEvent.change(b, { target: { files: [big2] } })

    expect(await screen.findByText(/allows at most 30\.0MB total per submission, not per field/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(publicPost).not.toHaveBeenCalled()
  })

  it('posts normally when a multi-field submission is under both the per-field and aggregate caps', async () => {
    const form: PublicForm = {
      title: 'Bug Report',
      closed: false,
      require_email: false,
      max_files: 5,
      max_file_bytes: 10 * 1024 * 1024,
      max_submission_files: 10,
      max_submission_bytes: 30 * 1024 * 1024,
      accepted_types: ['image/png'],
      fields: [
        { id: 'fl_a', type: 'file', label: 'Field A', required: false },
        { id: 'fl_b', type: 'file', label: 'Field B', required: false },
      ],
    }
    publicGet.mockResolvedValue(form)
    publicPost.mockResolvedValue({ reference: 'REF-3', submitted_at: new Date().toISOString(), email_on_file: false })

    renderPublic('agg-ok-slug')

    const a = (await screen.findByLabelText('Field A')) as HTMLInputElement
    const b = screen.getByLabelText('Field B') as HTMLInputElement

    const fileA = new File(['a'], 'a.png', { type: 'image/png' })
    const fileB = new File(['b'], 'b.png', { type: 'image/png' })

    fireEvent.change(a, { target: { files: [fileA] } })
    fireEvent.change(b, { target: { files: [fileB] } })

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(publicPost).toHaveBeenCalledTimes(1))

    const [path, body] = publicPost.mock.calls[0] as [string, FormData]
    expect(path).toBe('/api/public/forms/agg-ok-slug/submissions')
    expect(body.getAll('files[fl_a][]')).toEqual([fileA])
    expect(body.getAll('files[fl_b][]')).toEqual([fileB])
  })
})
