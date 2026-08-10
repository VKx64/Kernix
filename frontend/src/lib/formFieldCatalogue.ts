/**
 * Frontend mirror of `App\Support\FormFieldCatalogue`. One registry the
 * builder reads from instead of hand-rolling a second list that can drift
 * from the backend's validation. Keep this in lockstep with the PHP source.
 */
export const SHORT_TEXT = 'short_text'
export const LONG_TEXT = 'long_text'
export const STEPS = 'steps'
export const SEVERITY = 'severity'
export const SELECT = 'select'
export const EMAIL = 'email'
export const DATE = 'date'
export const FILE = 'file'

export const FIELD_TYPES = [SHORT_TEXT, LONG_TEXT, STEPS, SEVERITY, SELECT, EMAIL, DATE, FILE] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export const MAP_TITLE = 'title'
export const MAP_DESCRIPTION = 'description'
export const MAP_SUBTASKS = 'subtasks'
export const MAP_URGENCY = 'urgency'
export const MAP_DUE = 'due'
export const MAP_NONE = 'none'

export const MAX_FIELDS = 12

interface TypeDefinition {
  label: string
  hasChoices: boolean
  allowedMaps: readonly string[]
}

const TYPES: Record<FieldType, TypeDefinition> = {
  [SHORT_TEXT]: { label: 'Short text', hasChoices: false, allowedMaps: [MAP_TITLE, MAP_NONE] },
  [LONG_TEXT]: { label: 'Long text', hasChoices: false, allowedMaps: [MAP_DESCRIPTION, MAP_NONE] },
  [STEPS]: { label: 'Steps', hasChoices: false, allowedMaps: [MAP_SUBTASKS, MAP_NONE] },
  [SEVERITY]: { label: 'Severity', hasChoices: true, allowedMaps: [MAP_URGENCY, MAP_NONE] },
  [SELECT]: { label: 'Select', hasChoices: true, allowedMaps: [MAP_NONE] },
  [EMAIL]: { label: 'Email', hasChoices: false, allowedMaps: [MAP_NONE] },
  [DATE]: { label: 'Date', hasChoices: false, allowedMaps: [MAP_DUE, MAP_NONE] },
  [FILE]: { label: 'File', hasChoices: false, allowedMaps: [MAP_NONE] },
}

export function isValidType(type: string): type is FieldType {
  return Object.prototype.hasOwnProperty.call(TYPES, type)
}

export function typeLabel(type: string): string {
  return isValidType(type) ? TYPES[type].label : type
}

export function fieldHasChoices(type: string): boolean {
  return isValidType(type) ? TYPES[type].hasChoices : false
}

export function allowedMaps(type: string): readonly string[] {
  return isValidType(type) ? TYPES[type].allowedMaps : [MAP_NONE]
}

export function isMapAllowed(type: string, map: string | null | undefined): boolean {
  const resolved = map || MAP_NONE
  return allowedMaps(type).includes(resolved)
}

/** Map targets that must be claimed by at most one field. */
export const EXCLUSIVE_MAPS = [MAP_TITLE, MAP_DESCRIPTION, MAP_SUBTASKS, MAP_URGENCY, MAP_DUE]

export const MAP_LABELS: Record<string, string> = {
  [MAP_TITLE]: 'Title',
  [MAP_DESCRIPTION]: 'Description',
  [MAP_SUBTASKS]: 'Subtasks',
  [MAP_URGENCY]: 'Urgency',
  [MAP_DUE]: 'Due date',
  [MAP_NONE]: 'Not mapped',
}

export function mapLabel(map: string | null | undefined): string {
  return MAP_LABELS[map || MAP_NONE] ?? 'Not mapped'
}
