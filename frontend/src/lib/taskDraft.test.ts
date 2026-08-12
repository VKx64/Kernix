import { parseTaskDraftTitle } from './taskDraft'
import type { FieldValue, Project, UserSummary } from '../types/api'

const users: UserSummary[] = [
  { id: 9, first_name: 'Casey', last_name: 'Worker', username: 'caseyw' },
  { id: 12, first_name: 'Marco', last_name: 'Diaz', username: 'marcod' },
]
const urgencyOptions: FieldValue[] = [
  { id: 41, label: 'High' },
  { id: 42, label: 'Low' },
]
const projects: Project[] = [
  { id: 3, name: 'Website Relaunch' },
  { id: 4, name: 'Website Audit' },
  { id: 5, name: 'Investor Deck' },
]
// A Wednesday, so weekday math is unambiguous.
const now = new Date(2026, 7, 5)

/**
 * Settled by default: these cases describe what a finished title resolves to.
 * The unsettled behaviour — a token still being typed at the end of the string
 * — is covered on its own further down.
 */
function context(
  overrides: Partial<{ users: UserSummary[]; urgencyOptions: FieldValue[]; projects: Project[]; settled: boolean }> = {},
) {
  return { users, urgencyOptions, projects, now, settled: true, ...overrides }
}

describe('parseTaskDraftTitle', () => {
  it('lifts an @mention matched by first name', () => {
    const result = parseTaskDraftTitle('Call the client @casey', context())
    expect(result.title).toBe('Call the client')
    expect(result.assigneeUserIds).toEqual(['9'])
  })

  it('lifts an @mention matched by username', () => {
    const result = parseTaskDraftTitle('Call the client @caseyw', context())
    expect(result.assigneeUserIds).toEqual(['9'])
  })

  it('lifts every @mention, in the order they were typed', () => {
    const result = parseTaskDraftTitle('Call the client @marco @casey', context())
    expect(result.title).toBe('Call the client')
    expect(result.assigneeUserIds).toEqual(['12', '9'])
  })

  it('names the same person once however many times they are mentioned', () => {
    const result = parseTaskDraftTitle('Call the client @casey and @caseyw', context())
    expect(result.title).toBe('Call the client and')
    expect(result.assigneeUserIds).toEqual(['9'])
  })

  it('keeps the mentions it knows when one of them matches nobody', () => {
    const result = parseTaskDraftTitle('Call the client @casey @nobody about it', context())
    expect(result.title).toBe('Call the client @nobody about it')
    expect(result.assigneeUserIds).toEqual(['9'])
  })

  it('lifts a #project matched on its name with the spaces removed', () => {
    const result = parseTaskDraftTitle('Fix the nav #websiterelaunch', context())
    expect(result.title).toBe('Fix the nav')
    expect(result.projectId).toBe('3')
  })

  it('refuses a #project prefix that two projects share', () => {
    // "Website Relaunch" and "Website Audit" both match, so filing it either
    // way would put the task somewhere nobody chose.
    const result = parseTaskDraftTitle('Fix the nav #website', context())
    expect(result.title).toBe('Fix the nav #website')
    expect(result.projectId).toBeUndefined()
  })

  it('accepts a #project prefix only one project shares', () => {
    const result = parseTaskDraftTitle('Fix the nav #investor', context())
    expect(result.projectId).toBe('5')
  })

  it('leaves a #project token alone when no project list is supplied', () => {
    const result = parseTaskDraftTitle('Fix the nav #websiterelaunch', context({ projects: undefined }))
    expect(result.title).toBe('Fix the nav #websiterelaunch')
    expect(result.projectId).toBeUndefined()
  })

  it('leaves an @mention that matches nobody untouched', () => {
    const result = parseTaskDraftTitle('Call the client @nobody', context())
    expect(result.title).toBe('Call the client @nobody')
    expect(result.assigneeUserIds).toBeUndefined()
  })

  it('maps !high directly to the matching urgency option', () => {
    const result = parseTaskDraftTitle('Ship it !high', context())
    expect(result.title).toBe('Ship it')
    expect(result.urgencyValueId).toBe('41')
  })

  it('maps !urgent onto the High option when no Urgent option exists', () => {
    const result = parseTaskDraftTitle('Ship it !urgent', context())
    expect(result.urgencyValueId).toBe('41')
  })

  it('maps !low to the matching urgency option', () => {
    const result = parseTaskDraftTitle('Ship it !low', context())
    expect(result.urgencyValueId).toBe('42')
  })

  it('leaves an unrecognised !word untouched', () => {
    const result = parseTaskDraftTitle('Ship it !soon', context())
    expect(result.title).toBe('Ship it !soon')
    expect(result.urgencyValueId).toBeUndefined()
  })

  it('leaves a priority keyword untouched when no matching option exists', () => {
    const result = parseTaskDraftTitle('Ship it !normal', context({ urgencyOptions: [{ id: 41, label: 'High' }] }))
    expect(result.title).toBe('Ship it !normal')
    expect(result.urgencyValueId).toBeUndefined()
  })

  it('resolves "today"', () => {
    const result = parseTaskDraftTitle('Call the client today', context())
    expect(result.dueDate).toBe('2026-08-05')
    expect(result.title).toBe('Call the client')
  })

  it('resolves "tomorrow"', () => {
    const result = parseTaskDraftTitle('Call the client tomorrow', context())
    expect(result.dueDate).toBe('2026-08-06')
  })

  it('resolves a weekday name to its next occurrence', () => {
    // now is Wednesday 2026-08-05; "monday" should land on 2026-08-10, not the Monday just passed.
    const result = parseTaskDraftTitle('Follow up monday', context())
    expect(result.dueDate).toBe('2026-08-10')
  })

  it('resolves a 3-letter weekday form', () => {
    const result = parseTaskDraftTitle('Follow up fri', context())
    expect(result.dueDate).toBe('2026-08-07')
  })

  it('resolves "next week"', () => {
    const result = parseTaskDraftTitle('Follow up next week', context())
    expect(result.dueDate).toBe('2026-08-12')
  })

  it('resolves "in N days"', () => {
    const result = parseTaskDraftTitle('Follow up in 3 days', context())
    expect(result.dueDate).toBe('2026-08-08')
  })

  it('resolves "aug 12"', () => {
    const result = parseTaskDraftTitle('Renew license aug 12', context())
    expect(result.dueDate).toBe('2026-08-12')
  })

  it('resolves "12 aug"', () => {
    const result = parseTaskDraftTitle('Renew license 12 aug', context())
    expect(result.dueDate).toBe('2026-08-12')
  })

  it('resolves an ISO date', () => {
    const result = parseTaskDraftTitle('Renew license 2026-08-12', context())
    expect(result.dueDate).toBe('2026-08-12')
  })

  it('rolls a month/day into next year once it has already passed', () => {
    const result = parseTaskDraftTitle('Renew license jan 1', context())
    expect(result.dueDate).toBe('2027-01-01')
  })

  it('combines assignee, priority and due date in one title', () => {
    const result = parseTaskDraftTitle('Ship copy tomorrow @casey !urgent', context())
    expect(result.title).toBe('Ship copy')
    expect(result.dueDate).toBe('2026-08-06')
    expect(result.assigneeUserIds).toEqual(['9'])
    expect(result.urgencyValueId).toBe('41')
  })

  it('never mutates the title when nothing matches', () => {
    const result = parseTaskDraftTitle('Just a plain title', context())
    expect(result.title).toBe('Just a plain title')
    expect(result.assigneeUserIds).toBeUndefined()
    expect(result.urgencyValueId).toBeUndefined()
    expect(result.dueDate).toBeUndefined()
  })

  describe('while the title is still being typed', () => {
    const typing = { users, urgencyOptions, now }

    it('leaves a trailing token alone so a longer name can still be typed', () => {
      const result = parseTaskDraftTitle('Call the client @casey', typing)
      expect(result.title).toBe('Call the client @casey')
      expect(result.assigneeUserIds).toBeUndefined()
    })

    it('resolves the same token once something follows it', () => {
      const result = parseTaskDraftTitle('Call the client @casey ', typing)
      // The space the user just pressed is kept, so the next word does not run
      // into the previous one.
      expect(result.title).toBe('Call the client ')
      expect(result.assigneeUserIds).toEqual(['9'])
    })

    it('resolves the mentions already finished while the last one is still being typed', () => {
      const result = parseTaskDraftTitle('Call the client @casey @mar', typing)
      expect(result.title).toBe('Call the client @mar')
      expect(result.assigneeUserIds).toEqual(['9'])
    })

    it('resolves an earlier token while the last one is still being typed', () => {
      const result = parseTaskDraftTitle('Ship it !high @cas', typing)
      expect(result.urgencyValueId).toBe('41')
      expect(result.title).toBe('Ship it @cas')
      expect(result.assigneeUserIds).toBeUndefined()
    })

    it('holds a trailing date until it is followed by something', () => {
      expect(parseTaskDraftTitle('Ship it tomorrow', typing).dueDate).toBeUndefined()
      expect(parseTaskDraftTitle('Ship it tomorrow ', typing).dueDate).toBe('2026-08-06')
    })
  })
})
