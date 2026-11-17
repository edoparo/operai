/**
 * The "who" rule and the props of Record hours on the project page (specs/20261116-record-hours-in-place
 * AC-1.1, AC-1.2, plan decision 3 and risk R10): whether the page offers the button is decided here, from
 * what the page already holds and the signed-in person's id, and only as a convenience — hours-api decides every
 * save (ADR 20261116-record-hours-widget-through-the-host-extension-seam).
 */
import { describe, expect, it } from 'vitest'
import { ADA, projectDetail } from '../test-support/fakeApi'
import type { Person } from './types'
import { MY_HOURS_HREF, mayRecordOnProject, recordHoursPropsOf } from './recordHours'

const BOB: Person = { id: 'u-bob', name: 'Bob Builder', deleted: false }
const CARA: Person = { id: 'u-cara', name: 'Cara Coder', deleted: false }

describe('mayRecordOnProject (AC-1.1, AC-1.2)', () => {
  it('is true for the project manager', () => {
    expect(mayRecordOnProject(projectDetail({ projectManager: ADA, team: [BOB] }), ADA.id)).toBe(true)
  })

  it('is true for a member of the team', () => {
    expect(mayRecordOnProject(projectDetail({ projectManager: ADA, team: [BOB, CARA] }), CARA.id)).toBe(true)
  })

  it('is false for anyone else who can read the project', () => {
    expect(mayRecordOnProject(projectDetail({ projectManager: ADA, team: [BOB] }), 'u-reader')).toBe(false)
  })

  it('is false for a person who is on the project only by an id that looks like a name', () => {
    // Ids are compared whole: a prefix, a name or a different case is somebody else.
    expect(mayRecordOnProject(projectDetail({ projectManager: ADA, team: [] }), 'u-ad')).toBe(false)
    expect(mayRecordOnProject(projectDetail({ projectManager: ADA, team: [] }), 'U-ADA')).toBe(false)
  })

  it('is false for everyone but the team while the project awaits its project manager (`projectManager: null`)', () => {
    const awaiting = projectDetail({ projectManager: null, awaitingProjectManager: true, team: [BOB] })
    expect(mayRecordOnProject(awaiting, 'u-reader')).toBe(false)
    expect(mayRecordOnProject(awaiting, BOB.id)).toBe(true)
  })

  it('is false while the session has not given the person yet (`me: null`), whoever is on the project', () => {
    expect(mayRecordOnProject(projectDetail({ projectManager: ADA, team: [BOB] }), null)).toBe(false)
    expect(mayRecordOnProject(projectDetail({ projectManager: null, team: [] }), null)).toBe(false)
  })

  it('does not depend on the project’s state: a closed or cancelled project still offers it (A5)', () => {
    for (const state of ['planned', 'active', 'on_hold', 'closed', 'cancelled'] as const) {
      expect(mayRecordOnProject(projectDetail({ state, team: [BOB] }), BOB.id), state).toBe(true)
    }
  })
})

describe('recordHoursPropsOf(project) (AC-1.1, R10)', () => {
  it('is the six plain strings of the extension, on the project, with no task and the page placement', () => {
    expect(recordHoursPropsOf(projectDetail({ id: 'p-9', name: 'Alpenstrom — portale clienti' }))).toEqual({
      on: 'project',
      targetId: 'p-9',
      targetName: 'Alpenstrom — portale clienti',
      activityId: '',
      activityName: '',
      placement: 'page',
    })
  })

  it('takes the id and the name from the one project it is given, never from two sources (R10)', () => {
    const first = projectDetail({ id: 'p-1', name: 'First' })
    const second = projectDetail({ id: 'p-2', name: 'Second' })
    const a = recordHoursPropsOf(first)
    const b = recordHoursPropsOf(second)
    expect([a.targetId, a.targetName]).toEqual(['p-1', 'First'])
    expect([b.targetId, b.targetName]).toEqual(['p-2', 'Second'])
  })
})

describe('the fallback link', () => {
  it('is a fixed path to My hours in the shell, outside this remote’s basepath', () => {
    expect(MY_HOURS_HREF).toBe('/hours')
  })
})
