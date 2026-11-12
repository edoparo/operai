import type { SectionRowErrors } from '@operai/ui'
import type { AgendaPoint, AgendaPointInput } from '../../lib/types'
import { strings } from '../../strings'

/** The limits the API enforces (meetings-api `AGENDA_LIMITS`, `MAX_AGENDA_POINTS`). */
export const AGENDA_MAX_POINTS = 30
export const AGENDA_TITLE_MAX = 80
export const AGENDA_NOTE_MAX = 500

/** A row of the SectionsEditor: the title is its heading, the note its body; an existing point keeps its id. */
export type AgendaRow = { heading: string; body: string; id?: string }

export const blankAgendaRow = (): AgendaRow => ({ heading: '', body: '' })

export const rowsOf = (points: readonly AgendaPoint[]): AgendaRow[] =>
  points.map((p) => ({ id: p.id, heading: p.title, body: p.note ?? '' }))

/** The rows as the API takes them: trimmed, an empty note as null. */
export const inputsOf = (rows: readonly AgendaRow[]): AgendaPointInput[] =>
  rows.map((row) => ({
    ...(row.id !== undefined ? { id: row.id } : {}),
    title: row.heading.trim(),
    note: row.body.trim() === '' ? null : row.body.trim(),
  }))

/** Per-row errors, or null when every row is valid. */
export function validateAgendaRows(rows: readonly AgendaRow[]): (SectionRowErrors | null)[] | null {
  const t = strings.agenda.dialog.errors
  let found = false
  const errors = rows.map((row) => {
    const rowErrors: SectionRowErrors = {}
    const title = row.heading.trim()
    if (title === '') rowErrors.heading = t.titleRequired
    else if (title.length > AGENDA_TITLE_MAX) rowErrors.heading = t.titleTooLong
    if (row.body.trim().length > AGENDA_NOTE_MAX) rowErrors.body = t.noteTooLong
    if (rowErrors.heading || rowErrors.body) found = true
    return rowErrors.heading || rowErrors.body ? rowErrors : null
  })
  return found ? errors : null
}
