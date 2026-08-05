import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AvatarUpload } from './AvatarUpload'
import type { UserSummary } from '../types/api'

const apiPost = vi.hoisted(() => vi.fn(async () => ({ data: {} })))
const apiDelete = vi.hoisted(() => vi.fn(async () => ({ data: {} })))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, post: apiPost, delete: apiDelete } }
})

// react-easy-crop measures the element it renders into, which jsdom cannot do.
// The dialog's own behaviour is what matters here, not the crop maths.
vi.mock('react-easy-crop', () => ({
  default: () => <div data-testid="cropper" />,
}))

const withPicture: UserSummary = {
  id: 4,
  username: 'casey',
  name: 'Casey Worker',
  profile_image: '/api/users/4/avatar?v=01JR',
}

const withoutPicture: UserSummary = { id: 5, username: 'sam', name: 'Sam Newcomer' }

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

describe('profile picture control', () => {
  it('offers to add a picture when the account has none, and to change one when it does', () => {
    const { unmount } = render(<AvatarUpload user={withoutPicture} />)
    expect(screen.getByRole('button', { name: 'Add picture' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    unmount()

    render(<AvatarUpload user={withPicture} />)
    expect(screen.getByRole('button', { name: 'Change picture' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  it('refuses a file that is not an image without opening the cropper', async () => {
    render(<AvatarUpload user={withoutPicture} />)

    // The accept attribute is a hint, not a guarantee — a file dialog set to
    // "all files" hands over anything — so the change is fired directly here
    // rather than through upload(), which applies the filter itself.
    const input = screen.getByLabelText('Choose a profile picture') as HTMLInputElement
    const file = new File(['not an image'], 'payload.php', { type: 'text/plain' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)

    expect(await screen.findByRole('alert')).toHaveTextContent('Use a JPEG, PNG, WebP, or GIF image.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('opens the cropper for an accepted image', async () => {
    const actor = userEvent.setup()
    render(<AvatarUpload user={withoutPicture} />)

    await actor.upload(
      screen.getByLabelText('Choose a profile picture'),
      new File(['binary'], 'me.png', { type: 'image/png' }),
    )

    const dialog = await screen.findByRole('dialog', { name: 'Frame the picture' })
    expect(within(dialog).getByTestId('cropper')).toBeInTheDocument()
    expect(within(dialog).getByRole('slider', { name: 'Zoom' })).toBeInTheDocument()
    // Nothing is sent until a crop has been chosen.
    expect(within(dialog).getByRole('button', { name: 'Save picture' })).toBeDisabled()
  })

  it('confirms before removing, then calls the profile endpoint for your own account', async () => {
    const actor = userEvent.setup()
    render(<AvatarUpload user={withPicture} />)

    await actor.click(screen.getByRole('button', { name: 'Remove' }))
    const confirmation = await screen.findByRole('alertdialog')
    expect(confirmation).toHaveTextContent('Casey Worker')
    await actor.click(within(confirmation).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/profile/avatar'))
  })

  it('targets the user endpoint when editing someone else', async () => {
    const actor = userEvent.setup()
    render(<AvatarUpload user={withPicture} userId={4} />)

    await actor.click(screen.getByRole('button', { name: 'Remove' }))
    const confirmation = await screen.findByRole('alertdialog')
    await actor.click(within(confirmation).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/users/4/avatar'))
  })
})
