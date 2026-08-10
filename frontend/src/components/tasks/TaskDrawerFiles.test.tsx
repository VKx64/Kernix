import { render, screen } from '@testing-library/react'
import { TaskDrawerFiles } from './TaskDrawerFiles'
import type { TaskAttachment } from '../../types/api'

function image(id: number, name: string): TaskAttachment {
  return { id, task_id: 48, original_name: name, mime_type: 'image/png', file_size: 2048, can_preview: true, uploaded_by: { id: 1, first_name: 'Admin', last_name: 'User' } }
}

function renderFiles(attachments: TaskAttachment[], overrides: Partial<Parameters<typeof TaskDrawerFiles>[0]> = {}) {
  return render(
    <TaskDrawerFiles
      taskId={48}
      attachments={attachments}
      canManage={false}
      onChanged={() => {}}
      {...overrides}
    />,
  )
}

describe('TaskDrawerFiles', () => {
  it('gives a lone visual file its own cell and hands the neighbouring cell to its metadata instead of a caption', () => {
    renderFiles([image(1, 'storyboard.png')])

    // The filename shows once, in the metadata cell — not as an in-tile caption.
    expect(screen.getAllByText('storyboard.png')).toHaveLength(1)
    expect(screen.getByText(/2 KB.*Admin User/)).toBeInTheDocument()
  })

  it('gives every tile a filename caption once there are two or more visual files', () => {
    renderFiles([image(1, 'first.png'), image(2, 'second.png')])

    expect(screen.getByText('first.png')).toBeInTheDocument()
    expect(screen.getByText('second.png')).toBeInTheDocument()
  })

  it('renders a non-visual file as a document row rather than a tile', () => {
    const document: TaskAttachment = {
      id: 5,
      task_id: 48,
      original_name: 'contract.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size: 51200,
    }

    renderFiles([document])

    expect(screen.getByText('contract.docx')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows a single dashed dropzone line when a manager has nothing attached yet', () => {
    renderFiles([], { canManage: true })

    expect(screen.getByText(/Drop files or/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'browse' })).toBeInTheDocument()
  })

  it('collapses past six visual files into five tiles and a counter into the lightbox', () => {
    const attachments = Array.from({ length: 7 }, (_, index) => image(index + 1, `shot-${index + 1}.png`))
    renderFiles(attachments)

    expect(screen.getByText('shot-1.png')).toBeInTheDocument()
    expect(screen.getByText('shot-5.png')).toBeInTheDocument()
    expect(screen.queryByText('shot-6.png')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View 2 more files' })).toHaveTextContent('+2')
  })
})
