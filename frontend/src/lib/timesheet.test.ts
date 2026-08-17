import { countRows, formatSheetDate, hoursLabel, parseHours, timesheetText } from './timesheet'
import type { TimesheetLane } from '../types/api'

/**
 * The clipboard payload is the whole point of this screen, so it is pinned
 * hard: four columns, tab-separated, no total row, nothing that would land
 * outside A:D and disturb a formula.
 */

const lanes: TimesheetLane[] = [
  {
    client_id: 4,
    client: 'Northwind Creative',
    minutes: 155,
    entry_count: 2,
    rows: [
      {
        task_id: 87,
        date: '2026-08-03',
        description: 'Fixed broken checkout links',
        generated: 'Fixed broken checkout links',
        edited: false,
        minutes: 95,
        hours: 1.58,
        tracked_minutes: null,
      needs_hours: false,
      typed: false,
      task_title: 'Fix broken checkout links',
      },
      {
        task_id: 88,
        date: '2026-08-11',
        description: 'Sat with the client on the brief',
        generated: 'Client call',
        edited: true,
        minutes: 60,
        hours: 1,
        tracked_minutes: null,
      needs_hours: false,
      typed: false,
      task_title: 'Client call',
      },
    ],
  },
  {
    client_id: null,
    client: 'No client',
    minutes: 37,
    entry_count: 1,
    rows: [
      {
        task_id: 90,
        date: '2026-08-04',
        description: 'Tidied the shared drive',
        generated: 'Tidied the shared drive',
        edited: false,
        minutes: 37,
        hours: 0.62,
        tracked_minutes: null,
      needs_hours: false,
      typed: false,
      task_title: 'Tidy the shared drive',
      },
    ],
  },
]

it('writes exactly the four columns a person would type, tab-separated', () => {
  const text = timesheetText(lanes)

  expect(text.split('\n')).toEqual([
    'Northwind Creative\t8-3\tFixed broken checkout links\t1.58',
    'Northwind Creative\t8-11\tSat with the client on the brief\t1',
    'No client\t8-4\tTidied the shared drive\t0.62',
  ])
  expect(text).not.toMatch(/Total/)
})

it('leaves the header off by default and adds it only when asked', () => {
  expect(timesheetText(lanes).startsWith('Client\t')).toBe(false)
  expect(timesheetText(lanes, { header: true }).split('\n')[0]).toBe('Client\tDate\tDescription\tHours')
})

it('copies one client at a time for the lane button', () => {
  const text = timesheetText(lanes, { clientId: 4 })

  expect(text.split('\n')).toHaveLength(2)
  expect(text).not.toMatch(/No client/)
})

it('scopes the row count the same way the copy does', () => {
  expect(countRows(lanes)).toBe(3)
  expect(countRows(lanes, 4)).toBe(2)
  expect(countRows(lanes, null)).toBe(1)
})

it('carries an edited description into the sheet rather than the generated one', () => {
  expect(timesheetText(lanes)).toContain('Sat with the client on the brief')
  expect(timesheetText(lanes)).not.toContain('\tClient call\t')
})

describe('sheet dates', () => {
  it('writes the day that was worked, whatever timezone the browser is in', () => {
    // Parsed by hand: `new Date('2026-08-03')` is UTC midnight, which is the
    // 2nd anywhere west of Greenwich.
    expect(formatSheetDate('2026-08-03')).toBe('8-3')
  })

  it('offers the three formats the sheet might expect', () => {
    expect(formatSheetDate('2026-08-03', 'short')).toBe('8-3')
    expect(formatSheetDate('2026-08-03', 'pad')).toBe('08-03')
    expect(formatSheetDate('2026-08-03', 'mon')).toBe('Aug 3')
  })
})

describe('hours label', () => {
  it('reads as hours and minutes, never as bare minutes past an hour', () => {
    expect(hoursLabel(37)).toBe('37m')
    expect(hoursLabel(60)).toBe('1h')
    expect(hoursLabel(95)).toBe('1h 35m')
    expect(hoursLabel(0)).toBe('0m')
  })
})


/**
 * People write the same span three ways depending on the day, and a payroll
 * cell that only accepts one of them gets worked around rather than used.
 */
it('reads hours however somebody happens to write them', () => {
  expect(parseHours('1.5')).toBe(90)
  expect(parseHours('2')).toBe(120)
  expect(parseHours('1:30')).toBe(90)
  expect(parseHours('0:45')).toBe(45)
  expect(parseHours('90m')).toBe(90)
  expect(parseHours('90 mins')).toBe(90)
  expect(parseHours('2h')).toBe(120)
  expect(parseHours('1.5 hrs')).toBe(90)
  expect(parseHours('  45m  ')).toBe(45)
})

it('treats an empty box as clearing the cell, not as zero', () => {
  expect(parseHours('')).toBeNull()
  expect(parseHours('   ')).toBeNull()
  // Zero is a person saying the task took no billable time, and survives.
  expect(parseHours('0')).toBe(0)
})

it('refuses what it cannot read rather than guessing a number', () => {
  expect(parseHours('half an hour')).toBeNull()
  expect(parseHours('1:75')).toBeNull()
  expect(parseHours('-2')).toBeNull()
  expect(parseHours('2pm')).toBeNull()
})
