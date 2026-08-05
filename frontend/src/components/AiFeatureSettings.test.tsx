import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiFeatureSettings } from './AiFeatureSettings'
import type { AiFeatureSetting } from '../types/api'

const features: AiFeatureSetting[] = [
  {
    key: 'completion_audit',
    label: 'AI completion audit',
    description: 'Checks submitted proof of completion.',
    enabled: true,
    prompt: '',
    default_prompt: 'You audit proof that a task was completed.',
    enabled_field: 'ai_completion_audit_enabled',
    prompt_field: 'ai_completion_audit_prompt',
  },
  {
    key: 'task_creation',
    label: 'AI task creation',
    description: 'Turns a request into draft tasks.',
    enabled: false,
    prompt: 'Write terse tasks.',
    default_prompt: 'You convert a request into tasks.',
    enabled_field: 'ai_task_creation_enabled',
    prompt_field: 'ai_task_creation_prompt',
  },
]

function renderPanel(overrides: Partial<Parameters<typeof AiFeatureSettings>[0]> = {}) {
  const onSave = vi.fn()
  render(<AiFeatureSettings features={features} canEdit busy={false} onSave={onSave} {...overrides} />)

  return { onSave }
}

describe('AiFeatureSettings', () => {
  it('lists every feature with its toggle state', () => {
    renderPanel()

    expect(screen.getByLabelText('Enable AI completion audit')).toBeChecked()
    expect(screen.getByLabelText('Enable AI task creation')).not.toBeChecked()
    expect(screen.getByRole('button', { name: /Default prompt/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Custom prompt/ })).toBeInTheDocument()
  })

  it('saves toggles and prompts together, and only once something changed', async () => {
    const actor = userEvent.setup()
    const { onSave } = renderPanel()

    const save = screen.getByRole('button', { name: 'Save AI features' })
    expect(save).toBeDisabled()

    await actor.click(screen.getByLabelText('Enable AI completion audit'))
    await actor.click(screen.getByRole('button', { name: /Default prompt/ }))
    await actor.type(screen.getByLabelText('AI completion audit system prompt'), 'Demand a dated screenshot.')
    await actor.click(save)

    expect(onSave).toHaveBeenCalledWith({
      ai_completion_audit_enabled: false,
      ai_completion_audit_prompt: 'Demand a dated screenshot.',
      ai_task_creation_enabled: false,
      ai_task_creation_prompt: 'Write terse tasks.',
    })
  })

  it('shows the built-in prompt as the placeholder and can restore it', async () => {
    const actor = userEvent.setup()
    renderPanel()

    await actor.click(screen.getByRole('button', { name: /Custom prompt/ }))
    const box = screen.getByLabelText('AI task creation system prompt')
    expect(box).toHaveAttribute('placeholder', 'You convert a request into tasks.')

    await actor.click(screen.getByRole('button', { name: 'Restore default' }))
    expect(box).toHaveValue('')
    expect(screen.getByText('Empty: the built-in prompt shown above is used.')).toBeInTheDocument()
  })

  it('stays read-only without the settings permission', () => {
    renderPanel({ canEdit: false })

    expect(screen.getByLabelText('Enable AI completion audit')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save AI features' })).not.toBeInTheDocument()
  })
})
