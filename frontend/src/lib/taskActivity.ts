/**
 * Audit actions, in words.
 *
 * The activity log stores machine keys — `task.subtask.complete` — and the
 * drawer prints them into one sentence with the actor's name in front of it, so
 * each entry has to read as the second half of "Sam ______". A key with no
 * phrase here degrades to its own last segment rather than showing the whole
 * dotted string, which keeps an action added later legible without a change
 * here.
 */
const PHRASES: Record<string, string> = {
  'task.create': 'created this task',
  'task.update': 'changed this task',
  'task.project': 'moved this task to another project',
  'task.archive': 'archived this task',
  'task.restore': 'restored this task',
  'task.delete': 'deleted this task',
  'task.note.create': 'commented',
  'task.note.update': 'edited a comment',
  'task.note.delete': 'deleted a comment',
  'task.subtask.create': 'added a step',
  'task.subtask.update': 'edited a step',
  'task.subtask.complete': 'completed a step',
  'task.subtask.delete': 'removed a step',
  'task.attachment.create': 'attached a file',
  'task.attachment.delete': 'removed a file',
  'task.email.send': 'sent an email',
  'task.email.delete': 'removed an email',
  'task.completion_proof.submit': 'submitted completion proof',
  'task.completion_proof.approve': 'approved the completion proof',
  'task.completion_proof.reject': 'rejected the completion proof',
  'task.estimate_request.create': 'asked for more time',
  'task.estimate_request.approve': 'approved the estimate change',
  'task.estimate_request.reject': 'rejected the estimate change',
  'task.estimate_request.override': 'overrode the estimate',
  'task.work_request.create': 'asked to work on this',
  'task.work_request.approve': 'approved the work request',
  'task.work_request.decline': 'declined the work request',
  'task.work_request.withdraw': 'withdrew the work request',
}

export function activityPhrase(action: string | null | undefined): string {
  if (!action) return 'made a change'
  const known = PHRASES[action]
  if (known) return known
  return action.split('.').pop()?.replace(/_/g, ' ') ?? 'made a change'
}
