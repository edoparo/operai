import { FormDialog, SectionsEditor, focusFirstInvalid } from '@operai/ui'
import type { SectionRowErrors } from '@operai/ui'
import { useRef, useState } from 'react'
import { StaleWriteBanner } from '../LoadState'
import { isStaleWrite } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { saveAgenda } from '../../lib/meetingsApi'
import type { Agenda } from '../../lib/types'
import { strings } from '../../strings'
import { AGENDA_MAX_POINTS, blankAgendaRow, inputsOf, rowsOf, validateAgendaRows, type AgendaRow } from './agendaRows'

export type EditAgendaDialogProps = {
  meetingId: string
  agenda: Agenda
  onClose: () => void
  onSaved: (agenda: Agenda) => void
  /** Someone else changed the agenda meanwhile: load it again (the dialog stays open on the old rows). */
  onReload: () => void
}

/**
 * EditAgendaDialog — the whole list at once: add, edit, remove and reorder points (the library's
 * SectionsEditor, keyboard reordering included). Saved with the version it was opened at, so a change
 * someone else made meanwhile is never overwritten: the save is refused and the person reloads.
 * Covered marks are not part of the list and survive any edit.
 */
export default function EditAgendaDialog({ meetingId, agenda, onClose, onSaved, onReload }: EditAgendaDialogProps) {
  const t = strings.agenda.dialog
  const [rows, setRows] = useState<AgendaRow[]>(() => rowsOf(agenda.points))
  const [rowErrors, setRowErrors] = useState<(SectionRowErrors | null)[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const fieldsRef = useRef<HTMLDivElement>(null)

  const submit = async () => {
    const errors = validateAgendaRows(rows)
    setRowErrors(errors)
    if (errors !== null) {
      requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
      return
    }
    setBusy(true)
    setError(null)
    try {
      onSaved(await saveAgenda(meetingId, agenda.version, inputsOf(rows)))
      onClose()
    } catch (failure) {
      if (isStaleWrite(failure)) setStale(true)
      else setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title={t.title}
      description={t.description}
      submitLabel={t.save}
      busyLabel={t.saving}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      size="lg"
      testIdPrefix="meetings-agenda-dialog"
    >
      <div ref={fieldsRef} className="flex flex-col gap-3">
        {stale && <StaleWriteBanner onReload={onReload} />}
        <SectionsEditor
          sections={rows}
          onChange={(next) => {
            setRows(next)
            if (rowErrors !== null) setRowErrors(validateAgendaRows(next))
          }}
          createSection={blankAgendaRow}
          max={AGENDA_MAX_POINTS}
          rowErrors={rowErrors ?? undefined}
          disabled={busy}
          testIdPrefix="meetings-agenda"
          copy={t.sections}
        />
      </div>
    </FormDialog>
  )
}
