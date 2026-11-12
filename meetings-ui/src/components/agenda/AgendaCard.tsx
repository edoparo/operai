import { Banner, Button, Card, SkeletonRows, VisuallyHidden } from '@operai/ui'
import { useCallback, useEffect, useState } from 'react'
import { Saved } from '../LoadState'
import { codeOf, errorMessage } from '../../lib/errors'
import { getAgenda, setAgendaPointCovered } from '../../lib/meetingsApi'
import { useWritable } from './useWritable'
import type { Agenda, AgendaPoint } from '../../lib/types'
import { usePolling } from '../../hooks/usePolling'
import { strings } from '../../strings'
import AgendaChecklist from './AgendaChecklist'
import EditAgendaDialog from './EditAgendaDialog'

export type AgendaCardProps = {
  meetingId: string
  /** The meeting is being recorded: the agenda is watched, so others' ticks and edits show up. */
  live: boolean
}

/** While recording, the agenda is read again this often (others tick points too). */
export const AGENDA_LIVE_POLL_MS = 10_000

/**
 * AgendaCard — the meeting's agenda on the meeting page, in every status: the points in order with
 * their covered marks, how many are covered, and for an agenda editor (the creator or an Operai
 * participant with Meetings access, on a meeting that is not frozen; the server's `can.edit`) the
 * ticks and "Edit agenda". During a recording it is read again every few seconds, so everyone sees
 * the same list. A tick needs no reload: two people can tick different points at once.
 */
export default function AgendaCard({ meetingId, live }: AgendaCardProps) {
  const t = strings.agenda.card
  const fetcher = useCallback((signal: AbortSignal) => getAgenda(meetingId, { signal }), [meetingId])
  const polling = usePolling(fetcher, {
    baseMs: AGENDA_LIVE_POLL_MS,
    factor: 1,
    maxMs: AGENDA_LIVE_POLL_MS,
    until: () => !live,
  })
  const { retry } = polling
  // A recording that starts (or a meeting that changes) watches again; one that ends stops after the next read.
  useEffect(() => {
    if (live) retry()
  }, [live, retry])

  // What a write returned wins until the next read.
  const [shown, setShown] = useWritable<Agenda>(polling.data)

  const [editing, setEditing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const tick = async (point: AgendaPoint, covered: boolean) => {
    setBusyId(point.id)
    setError(null)
    try {
      setShown(await setAgendaPointCovered(meetingId, point.id, covered))
    } catch (failure) {
      setError(errorMessage(failure))
      // The point was removed by someone else: show the agenda as it is now.
      if (codeOf(failure) === 'agenda_point_not_found') retry()
    } finally {
      setBusyId(null)
    }
  }

  const agenda = shown
  const editor = agenda?.can.edit === true
  const empty = agenda !== null && agenda.points.length === 0
  const covered = agenda?.points.filter((p) => p.covered).length ?? 0

  return (
    <Card
      title={t.title}
      data-testid="meetings-agenda-card"
      action={
        editor ? (
          <Button
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            onClick={() => setEditing(true)}
            data-testid="meetings-agenda-edit"
          >
            {empty ? t.add : t.edit}
          </Button>
        ) : undefined
      }
    >
      {saved !== null && <Saved message={saved} onDismiss={() => setSaved(null)} />}

      {agenda === null ? (
        polling.status === 'error' ? (
          <Banner tone="warning" onRetry={retry} retryLabel={t.reload}>
            {t.loadFailed}
          </Banner>
        ) : (
          <>
            <VisuallyHidden live>{t.loading}</VisuallyHidden>
            <SkeletonRows rows={2} />
          </>
        )
      ) : empty ? (
        <p className="text-sm text-soft" data-testid="meetings-agenda-empty">
          {editor ? t.emptyEditor : t.emptyReader}
        </p>
      ) : (
        <>
          <p className="mb-1 text-xs text-soft" data-testid="meetings-agenda-progress">
            {t.progress(covered, agenda.points.length)}
          </p>
          <AgendaChecklist
            points={agenda.points}
            canTick={editor}
            busyId={busyId}
            onTick={(point, value) => void tick(point, value)}
            testIdPrefix="meetings-agenda"
          />
        </>
      )}

      {error !== null && (
        <p role="alert" className="form-error mt-2" data-testid="meetings-agenda-error">
          {error}
        </p>
      )}

      {editing && agenda !== null && (
        <EditAgendaDialog
          meetingId={meetingId}
          agenda={agenda}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            setShown(next)
            setSaved(t.saved)
          }}
          onReload={() => {
            setEditing(false)
            retry()
          }}
        />
      )}
    </Card>
  )
}
