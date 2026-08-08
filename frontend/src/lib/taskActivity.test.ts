import { activityPhrase } from './taskActivity'

describe('activityPhrase', () => {
  it('reads as the second half of "Sam ______"', () => {
    expect(activityPhrase('task.subtask.complete')).toBe('completed a step')
    expect(activityPhrase('task.note.create')).toBe('commented')
    expect(activityPhrase('task.archive')).toBe('archived this task')
  })

  it('degrades an unmapped key to its last segment rather than the dotted string', () => {
    // So an action added on the server side later is still legible here.
    expect(activityPhrase('task.estimate_request.escalated')).toBe('escalated')
    expect(activityPhrase('task.retro_note.added')).toBe('added')
  })

  it('has something to say when there is no action at all', () => {
    expect(activityPhrase(null)).toBe('made a change')
    expect(activityPhrase('')).toBe('made a change')
  })
})
