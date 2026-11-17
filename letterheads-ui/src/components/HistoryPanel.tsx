/**
 * HistoryPanel — the History view of one entity (task T25; design F8, S8; AC-8.7, AC-4.2): a `DataTable` of the
 * versions, newest first, with the number (an **Active** badge on the highest and "Restored from version {m}"
 * under a restored one), who saved it, when, and the names of what changed (a restore says "Same settings as
 * version {m}"). Row actions: **Open** (everyone with access; the page decides what opening means) and
 * **Restore** (managers in scope, never on the active row), which asks first in `RestoreDialog`.
 *
 * It loads the history when it appears. The rows are the fresh truth about which version is active: a restore
 * is based on the highest one they show, and a 409 loads them again behind the open dialog.
 */
import { useState } from 'react'
import { Badge, Button, DataTable, StatePanel } from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import type { Entity } from '../lib/types'
import { strings } from '../strings'
import { LoadFailure, Loading } from './LoadState'
import { describeChanged, formatSavedAt, newestVersion, useVersionHistory } from './HistoryPanelApi'
import type { HistoryRow } from './HistoryPanelApi'
import { RestoreDialog } from './HistoryPanelRestore'

export interface HistoryPanelProps {
  entity: Entity
  /** The person may change this entity's letterhead and has not lost the grant: Restore is offered. */
  canRestore: boolean
  /** Open version `version` in the preview (the page asks to leave unsaved changes first). */
  onOpen: (version: number) => void
  /** A restore made version `next` from `from`; it is active (the page shows it). */
  onRestored: (next: number, from: number) => void
  /** A restore was refused with 403. */
  onLost: () => void
  /** Does the form hold changes that a restore would replace? Asked when the dialog opens. */
  wouldLose: () => boolean
  /** A restore found a newer version than the one the page knew (409): the page's own list is stale. */
  onConflict: () => void
}

export function HistoryPanel({
  entity,
  canRestore,
  onOpen,
  onRestored,
  onLost,
  wouldLose,
  onConflict,
}: HistoryPanelProps) {
  const history = useVersionHistory(entity)
  // The version whose restore the person is confirming, and whether the form held edits when they asked.
  const [restoring, setRestoring] = useState<{ version: number; discardsEdits: boolean } | null>(null)
  const { rows } = history
  const active = newestVersion(rows)

  const columns: DataTableColumn<HistoryRow>[] = [
    {
      id: 'version',
      header: strings.history.version,
      rowHeader: true,
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <span className="flex items-center gap-2">
            <span>{row.version}</span>
            {row.version === active && <Badge tone="accent">{strings.history.active}</Badge>}
          </span>
          {row.restoredFrom !== null && (
            <span className="text-xs text-soft">{strings.history.restoredFrom(row.restoredFrom)}</span>
          )}
        </div>
      ),
    },
    { id: 'savedBy', header: strings.history.savedBy, render: (row) => row.savedBy },
    {
      id: 'savedAt',
      header: strings.history.savedAt,
      render: (row) => <time dateTime={row.createdAt}>{formatSavedAt(row.createdAt)}</time>,
    },
    { id: 'changed', header: strings.history.changed, render: describeChanged },
    {
      id: 'actions',
      header: strings.history.actions,
      render: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-label={strings.history.open(row.version)}
            onClick={() => onOpen(row.version)}
            data-testid={`letterheads-history-open-${row.version}`}
          >
            {strings.history.openLabel}
          </Button>
          {canRestore && row.version !== active && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={strings.history.restore(row.version)}
              aria-haspopup="dialog"
              onClick={() => setRestoring({ version: row.version, discardsEdits: wouldLose() })}
              data-testid={`letterheads-history-restore-${row.version}`}
            >
              {strings.history.restoreLabel}
            </Button>
          )}
        </div>
      ),
    },
  ]

  let body
  if (rows === null) {
    body =
      history.status === 'error' ? (
        <LoadFailure error={history.error} onRetry={history.reload} />
      ) : (
        <Loading label={strings.history.loading} rows={4} />
      )
  } else if (rows.length === 0) {
    body = <StatePanel title={strings.history.empty} testId="letterheads-history-empty" />
  } else {
    body = (
      <>
        {history.status === 'error' && <LoadFailure error={history.error} onRetry={history.reload} />}
        <DataTable
          caption={strings.history.caption(strings.entity[entity])}
          columns={columns}
          rows={rows}
          getRowKey={(row) => String(row.version)}
          testId="letterheads-history-table"
          rowTestIdPrefix="letterheads-history-row"
        />
      </>
    )
  }

  return (
    <section className="flex flex-col gap-4" data-testid="letterheads-history" data-entity={entity}>
      {body}
      {restoring !== null && (
        <RestoreDialog
          entity={entity}
          version={restoring.version}
          active={active ?? 0}
          discardsEdits={restoring.discardsEdits}
          onCancel={() => setRestoring(null)}
          onRestored={(next) => {
            setRestoring(null)
            onRestored(next, restoring.version)
          }}
          onConflict={() => {
            history.reload()
            onConflict()
          }}
          onLost={onLost}
        />
      )}
    </section>
  )
}
