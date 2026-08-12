import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EntityForm, type FormFieldSpec } from './entity-form'

/**
 * The Create contact dialog, and every other form built from `EntityForm`.
 *
 * The asterisk beside a required label is `aria-hidden`, so before this nothing
 * about "required" reached anyone not reading the screen: the input had neither
 * `required` nor `aria-required`, and the select had no `aria-required` either.
 * Each select also shipped a second, unlabelled combobox — Radix's hidden
 * native `<select>`, which carries `aria-hidden` on a still-focusable element.
 */

const contactFields: FormFieldSpec[] = [
  {
    name: 'client_id',
    label: 'Client',
    type: 'select',
    required: true,
    options: [{ label: 'Acme Media', value: 3 }],
  },
  { name: 'first_name', label: 'First name', required: true },
  { name: 'last_name', label: 'Last name' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: [{ label: 'Active', value: 'active' }],
  },
  { name: 'notes', label: 'Notes', type: 'textarea' },
]

describe('EntityForm accessibility', () => {
  it('exposes required fields as required, not only as an asterisk', () => {
    render(<EntityForm fields={contactFields} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText(/^First name/)).toBeRequired()
    expect(screen.getByRole('combobox', { name: /^Client/ })).toHaveAttribute('aria-required', 'true')

    // And says nothing about the ones that are not.
    expect(screen.getByLabelText(/^Last name/)).not.toBeRequired()
    expect(screen.getByRole('combobox', { name: /^Status/ })).not.toHaveAttribute('aria-required', 'true')
  })

  it('leaves exactly one control per field, with no anonymous twin beside it', async () => {
    render(<EntityForm fields={contactFields} onSubmit={vi.fn()} />)

    expect(screen.getAllByRole('combobox')).toHaveLength(2)

    // Radix's hidden native selects stay in the DOM for native submission,
    // which nothing here uses. Inert takes them out of the accessibility tree
    // and out of reach of the focus order.
    const bubbles = () => Array.from(document.querySelectorAll('select[aria-hidden="true"]'))
    expect(bubbles()).toHaveLength(2)
    await waitFor(() => {
      for (const bubble of bubbles()) expect(bubble).toHaveAttribute('inert')
    })
  })

  it('keeps the hidden native select inert after Radix replaces it', async () => {
    const actor = userEvent.setup()
    render(<EntityForm fields={contactFields} onSubmit={vi.fn()} />)

    // Opening the menu mounts the options, which changes the bubble's key and
    // remounts it — a one-shot fix on mount would be undone right here.
    await actor.click(screen.getByRole('combobox', { name: /^Client/ }))
    await actor.click(await screen.findByRole('option', { name: 'Acme Media' }))

    await waitFor(() => {
      const bubbles = Array.from(document.querySelectorAll('select[aria-hidden="true"]'))
      expect(bubbles).toHaveLength(2)
      for (const bubble of bubbles) expect(bubble).toHaveAttribute('inert')
    })
  })

  it('announces the validation message and moves focus to the field that failed', async () => {
    const actor = userEvent.setup()
    const onSubmit = vi.fn()
    render(<EntityForm fields={contactFields} onSubmit={onSubmit} />)

    await actor.click(screen.getByRole('button', { name: 'Save' }))

    // Announced on appearance — `aria-describedby` alone is only read once the
    // field is reached again, which is too late to explain a refused submit.
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((node) => node.textContent)).toEqual(['Client is required.', 'First name is required.'])
    expect(onSubmit).not.toHaveBeenCalled()

    // The first field that failed is a select, so its trigger has to take focus
    // — a message nobody is taken to is a message nobody hears.
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^Client/ })).toHaveFocus())
  })

  it('ties each message to its own field and clears it once the field is filled', async () => {
    const actor = userEvent.setup()
    render(<EntityForm fields={contactFields} onSubmit={vi.fn()} />)

    await actor.click(screen.getByRole('button', { name: 'Save' }))

    const firstName = await screen.findByLabelText(/^First name/)
    await waitFor(() => expect(firstName).toHaveAttribute('aria-invalid', 'true'))
    const describedBy = firstName.getAttribute('aria-describedby') ?? ''
    const message = describedBy.split(' ').map((id) => document.getElementById(id)).find(Boolean)
    expect(message).toHaveTextContent('First name is required.')

    await actor.type(firstName, 'Casey')
    await waitFor(() => expect(screen.queryByText('First name is required.')).not.toBeInTheDocument())
    expect(firstName).toHaveAttribute('aria-invalid', 'false')
  })
})
