import { Button, Icon } from '@operai/ui'
import { useCallback, useId, useState } from 'react'
import AgendaChecklist from '../components/agenda/AgendaChecklist'
import { AGENDA_LIVE_POLL_MS } from '../components/agenda/AgendaCard'
import { usePolling } from '../hooks/usePolling'
import { errorMessage } from '../lib/errors'
import { getAgenda, setAgendaPointCovered } from '../lib/meetingsApi'
import { useWritable } from '../components/agenda/useWritable'
import type { Agenda, AgendaPoint } from '../lib/types'
import { strings } from '../strings'

/**
 * DockAgenda — the agenda inside the recorder widget: a "Show agenda" toggle with how many points are
 * covered and, opened, the titles with their ticks (for an agenda editor), so the person follows the list
 * without leaving the page they are on. Read every few seconds while the widget is up. It never touches the
 * recording: an agenda that cannot be loaded, or is empty, shows nothing.
 */
export default function DockAgenda({ meetingId }: { meetingId: string }) {
  const t = strings.agenda
  const listId = useId()
  const fetcher = useCallback((signal: AbortSignal) => getAgenda(meetingId, { signal }), [meetingId])
  const polling = usePolling(fetcher, { baseMs: AGENDA_LIVE_POLL_MS, factor: 1, maxMs: AGENDA_LIVE_POLL_MS })
  // What a write returned wins until the next read.
  const [shown, setShown] = useWritable<Agenda>(polling.data)
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (shown === null || shown.points.length === 0) return null

  const tick = async (point: AgendaPoint, covered: boolean) => {
    setBusyId(point.id)
    setError(null)
    try {
      setShown(await setAgendaPointCovered(meetingId, point.id, covered))
    } catch (failure) {
      setError(errorMessage(failure))
      polling.retry()
    } finally {
      setBusyId(null)
    }
  }

  const covered = shown.points.filter((p) => p.covered).length
  return (
    <div className="basis-full" data-testid="meetings-dock-agenda">
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        data-testid="meetings-dock-agenda-toggle"
      >
        <Icon name={open ? 'chevron-up' : 'chevron-down'} /> {open ? t.dock.hide : t.dock.show}
        <span className="text-xs text-soft">{t.dock.progress(covered, shown.points.length)}</span>
      </Button>
      <div id={listId} hidden={!open} className="max-h-60 overflow-y-auto">
        <AgendaChecklist
          points={shown.points}
          canTick={shown.can.edit}
          busyId={busyId}
          onTick={(point, value) => void tick(point, value)}
          compact
          testIdPrefix="meetings-dock-agenda"
        />
      </div>
      {error !== null && (
        <p role="alert" className="text-xs text-red-text">
          {error}
        </p>
      )}
    </div>
  )
}
