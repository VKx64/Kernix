import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { TaskAttachments } from './TaskAttachments'
import type { TaskAttachment } from '../types/api'

const apiDelete = vi.hoisted(() => vi.fn(async () => null))
const apiPost = vi.hoisted(() => vi.fn(async (_path: string, _body?: unknown) => ({ data: [] })))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, post: apiPost, delete: apiDelete } }
})

const attachments: TaskAttachment[] = [
  { id: 3, task_id: 9, original_name: 'storyboard.png', mime_type: 'image/png', file_size: 2048, can_preview: true, uploaded_by: { id: 2, first_name: 'Casey', last_name: 'Worker' } },
  { id: 4, task_id: 9, original_name: 'contract.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file_size: 51200, can_preview: false },
]

function renderPanel(overrides: Partial<ComponentProps<typeof TaskAttachments>> = {}) {
  const onChanged = vi.fn()
  const props: ComponentProps<typeof TaskAttachments> = {
    taskId: 9,
    attachments,
    canManage: true,
    onChanged,
    ...overrides,
  }

  return { ...render(<TaskAttachments {...props} />), onChanged }
}

describe('TaskAttachments', () => {
  beforeEach(() => {
    apiPost.mockClear()
    apiDelete.mockClear()
  })

  it('lists files with a download link and previews only what is safe to render', async () => {
    const actor = userEvent.setup()
    renderPanel()

    expect(screen.getByText('storyboard.png')).toBeInTheDocument()
    expect(screen.getByText('2 KB')).toBeInTheDocument()
    expect(screen.getByText('Casey Worker')).toBeInTheDocument()
    expect(screen.getByLabelText('Download storyboard.png')).toHaveAttribute('href', '/api/tasks/9/attachments/3')
    expect(screen.getByLabelText('Download contract.docx')).toBeInTheDocument()
    expect(screen.queryByLabelText('View contract.docx')).not.toBeInTheDocument()

    await actor.click(screen.getByLabelText('View storyboard.png'))
    const dialog = await screen.findByRole('dialog', { name: 'storyboard.png' })
    expect(dialog.querySelector('img')).toHaveAttribute('src', '/api/tasks/9/attachments/3?inline=1')
  })

  it('uploads picked files and refreshes the task', async () => {
    const actor = userEvent.setup()
    const { onChanged } = renderPanel()

    await actor.upload(screen.getByLabelText('Upload attachments'), new File(['frame'], 'shot.png', { type: 'image/png' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledOnce())
    expect(apiPost.mock.calls[0][0]).toBe('/api/tasks/9/attachments')
    expect(apiPost.mock.calls[0][1]).toBeInstanceOf(FormData)
    expect(onChanged).toHaveBeenCalled()
  })

  it('deletes after confirmation and leaves the file alone when cancelled', async () => {
    const actor = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPanel()

    await actor.click(screen.getByLabelText('Delete storyboard.png'))
    expect(apiDelete).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await actor.click(screen.getByLabelText('Delete storyboard.png'))
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/tasks/9/attachments/3', undefined))
    confirm.mockRestore()
  })

  it('hides upload and delete without the permission', () => {
    renderPanel({ canManage: false })

    expect(screen.queryByLabelText('Upload attachments')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Delete storyboard.png')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Download storyboard.png')).toBeInTheDocument()
  })

  it('blocks archived tasks from gaining new files', () => {
    renderPanel({ readOnly: true })

    expect(screen.queryByLabelText('Upload attachments')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Delete storyboard.png')).not.toBeInTheDocument()
  })
})
