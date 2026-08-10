import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EntityForm, type FormFieldSpec } from './entity-form'
import { Dialog, DialogContent } from '@/components/ui/dialog'

describe('EntityForm', () => {
  it('submits a select with numeric option values, keeping the value a number', async () => {
    const actor = userEvent.setup()
    const onSubmit = vi.fn()
    const fields: FormFieldSpec[] = [
      {
        name: 'project_id',
        label: 'Project',
        type: 'select',
        required: true,
        options: [
          { label: 'Trailer Cut', value: 12 },
          { label: 'Full Feature', value: 34 },
        ],
      },
    ]

    render(<EntityForm fields={fields} onSubmit={onSubmit} />)

    await actor.click(screen.getByRole('combobox', { name: /project/i }))
    await actor.click(await screen.findByRole('option', { name: 'Full Feature' }))
    await actor.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).toHaveBeenCalledWith({ project_id: 34 })
    expect(onSubmit).not.toHaveBeenCalledWith({ project_id: '34' })
  })

  it('rejects a required select with no selection', async () => {
    const actor = userEvent.setup()
    const onSubmit = vi.fn()
    const fields: FormFieldSpec[] = [
      {
        name: 'status_value_id',
        label: 'Status',
        type: 'select',
        required: true,
        options: [{ label: 'In Progress', value: 5 }],
      },
    ]

    render(<EntityForm fields={fields} onSubmit={onSubmit} />)

    await actor.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Status is required.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects a required text field of only whitespace', async () => {
    const actor = userEvent.setup()
    const onSubmit = vi.fn()
    const fields: FormFieldSpec[] = [
      { name: 'title', label: 'Title', type: 'text', required: true },
    ]

    render(<EntityForm fields={fields} onSubmit={onSubmit} />)

    await actor.type(screen.getByLabelText(/^Title/), '   ')
    await actor.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Title is required.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('lets a select carrying a numeric id survive submission from prefilled initial values', async () => {
    const actor = userEvent.setup()
    const onSubmit = vi.fn()
    const fields: FormFieldSpec[] = [
      {
        name: 'assignee_user_id',
        label: 'Assignee',
        type: 'select',
        options: [
          { label: 'Alex', value: 1 },
          { label: 'Sam', value: 2 },
        ],
      },
    ]

    render(<EntityForm fields={fields} initialValues={{ assignee_user_id: 1 }} onSubmit={onSubmit} />)

    await actor.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).toHaveBeenCalledWith({ assignee_user_id: 1 })
  })

  it('submits on the first Save click even while the closing select is still exit-animating', async () => {
    const actor = userEvent.setup()
    const onSubmit = vi.fn()
    const fields: FormFieldSpec[] = [
      {
        name: 'urgency',
        label: 'Urgency',
        type: 'select',
        required: true,
        options: [
          { label: 'Normal', value: 'normal' },
          { label: 'High', value: 'high' },
        ],
      },
    ]

    // jsdom never runs real CSS animations, so Radix's Presence machine
    // always sees `animation-name: none` and unmounts the closing
    // SelectContent synchronously — which hides the bug entirely in a plain
    // render. In the browser, an exit animation on SelectContent (Tailwind's
    // `data-[state=closed]:animate-out` utilities, if present) gives it a
    // real `animation-name`, and Presence keeps a still-animating node
    // mounted (`unmountSuspended`) until `animationend` fires. For as long as
    // that node stays mounted, its DismissableLayer stays registered as the
    // "highest" layer with outside-pointer-events disabled, which leaves the
    // Dialog's own DismissableLayer — and therefore everything inside the
    // dialog, including Save — at `pointer-events: none`. A click on Save
    // that lands inside that window is swallowed.
    //
    // This spy derives a fake `animation-name` from the select content's own
    // rendered `data-state` and class list, the same signal
    // `getComputedStyle` would report in a real browser, so it reflects
    // whatever exit-animation classes select.tsx actually renders rather
    // than an assumption baked into the test.
    const realGetComputedStyle = window.getComputedStyle.bind(window)
    const gcsSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = realGetComputedStyle(el as Element, pseudo ?? undefined)
      const element = el as HTMLElement
      if (element.getAttribute?.('data-slot') !== 'select-content') return style
      return new Proxy(style, {
        get(target, prop, receiver) {
          if (prop === 'animationName') {
            const hasExitAnimationClass = element.className.includes('animate-out')
            const isClosing = element.getAttribute('data-state') === 'closed'
            return hasExitAnimationClass && isClosing ? 'radix-exit-mock' : 'none'
          }
          return Reflect.get(target, prop, receiver)
        },
      })
    })

    try {
      render(
        <Dialog open>
          <DialogContent>
            <EntityForm fields={fields} initialValues={{ urgency: 'normal' }} onSubmit={onSubmit} />
          </DialogContent>
        </Dialog>,
      )

      await actor.click(screen.getByRole('combobox', { name: /urgency/i }))

      await actor.click(await screen.findByRole('option', { name: 'High' }))

      // Without the fix, the dialog content is itself left aria-hidden (and
      // pointer-events: none) while the select's exit animation is still in
      // flight — its own "hide everything else" cleanup hasn't unwound yet —
      // so the accessible query has to opt in with `hidden: true` to find it
      // at all, and a real click on it is inert.
      const saveButton = screen.getByRole('button', { name: 'Save', hidden: true })

      // This is the actual bug: a single click here, while Save sits behind
      // the still-registered exit-animation layer, must still submit the
      // form. Before the fix this click is swallowed (pointer-events: none)
      // and the assertion below fails.
      await actor.click(saveButton)
      expect(onSubmit).toHaveBeenCalledWith({ urgency: 'high' })
    } finally {
      gcsSpy.mockRestore()
    }
  })
})
