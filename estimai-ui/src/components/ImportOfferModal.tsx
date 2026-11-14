/**
 * ImportOfferModal — three-phase modal for the one-time legacy localStorage
 * import offer (US-5, AC-5.1, AC-5.2, AC-5.3, AC-5.4).
 *
 * Phases:
 *   1. offer      — lists found estimates; "Import all" and "Skip for now" actions
 *   2. importing  — spinner while POST /estimates/import is in-flight; Escape
 *                   suppressed, close button hidden (per design.md Screen D a11y)
 *   3. results    — per-estimate outcome table; status shown with glyph + text
 *                   (never colour alone); "Close" action
 *
 * Presentational: all data and callbacks arrive via props. The container
 * (EstimatesPage / useImportOffer) owns the logic — this component only renders.
 *
 * Frame: @operai/ui's `Dialog` (ADR 20261031-shared-ui-library-consumed-as-source, INC-09) — modal, labelled by its
 * title, Tab trapped over every enabled control (× included), focus returned
 * to the trigger on close. Skip is `ghost`, Import all and the results-phase
 * Close acknowledgement are `primary`.
 *
 * A11y (design.md):
 *   • role="dialog" aria-modal="true" aria-labelledby (the Dialog's title)
 *   • Focus: the primary action on open and on each phase change
 *   • Escape / backdrop / × = Skip during offer phase, Close in results;
 *     all suppressed during importing (the Dialog is busy, × disabled)
 *   • aria-live="polite" results region announced once when results arrive
 *   • Status badges: the library StatusBadge (icon + text, not colour alone)
 *   • results in the library DataTable (INC-14): caption, scope="col" headers,
 *     the estimate name as the row header
 */

import { useEffect, useRef } from 'react'
import { Button, DataTable, Dialog, Spinner, StatusBadge } from '@operai/ui'
import { strings } from '../strings'
import type { EstimateImportResult } from '../lib/estimatesApi'
import type { ProjectMeta } from '../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImportPhase = 'offer' | 'importing' | 'results'

export type ImportOfferModalProps = {
  /** Local estimate metadata — drives the offer count + name preview. */
  localEstimates: ProjectMeta[]
  /** Current phase of the 3-step flow. */
  phase: ImportPhase
  /** Results returned by POST /estimates/import (only non-null in "results" phase). */
  results: EstimateImportResult[] | null
  /** Called when the user clicks "Import all". */
  onAccept: () => void
  /** Called when the user clicks "Skip for now", the "×" close, or presses Escape. */
  onDecline: () => void
  /** Called when the user clicks "Close" in the results phase. */
  onClose: () => void
}

/** One results row: the outcome plus the local name it is matched back to. */
type ResultRow = { rowId: string; name: string; result: EstimateImportResult }

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const t = strings.importOffer

/**
 * An import outcome as a status (INC-23): imported = `active` (accepted, in
 * effect), failed = `failed`. Icon + text, colour never the only signal.
 */
const ImportStatusBadge = ({ status }: { status: 'imported' | 'failed' }) =>
  status === 'imported' ? (
    <StatusBadge status="active">{t.imported}</StatusBadge>
  ) : (
    <StatusBadge status="failed">{t.failed}</StatusBadge>
  )

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ImportOfferModal({
  localEstimates,
  phase,
  results,
  onAccept,
  onDecline,
  onClose,
}: ImportOfferModalProps) {
  const primaryBtnRef = useRef<HTMLButtonElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const n = localEstimates.length

  // Focus management on phase change (the Dialog handles the open-time focus):
  // the results phase moves focus to its Close acknowledgement.
  useEffect(() => {
    if (phase === 'results') closeBtnRef.current?.focus()
    else if (phase === 'offer') primaryBtnRef.current?.focus()
  }, [phase])

  // Derived counts for the results phase.
  const importedCount = results?.filter((r) => r.status === 'imported').length ?? 0
  const totalCount = results?.length ?? 0
  const allSuccess = importedCount === totalCount && totalCount > 0

  // Results summary colour: green if all imported, amber otherwise.
  const summaryClass = allSuccess ? 'text-grn-text' : 'text-org-text'

  // Header title per phase.
  const title =
    phase === 'offer'
      ? t.titleOffer
      : phase === 'importing'
        ? t.titleImporting
        : allSuccess
          ? t.titleComplete
          : t.titleFinished

  return (
    <Dialog
      title={title}
      onClose={phase === 'results' ? onClose : onDecline}
      closeLabel={t.close}
      busy={phase === 'importing'}
      initialFocusRef={phase === 'results' ? closeBtnRef : primaryBtnRef}
      testIdPrefix="import-offer"
      backdropTestId="import-offer-modal"
    >
      <div className="dialog-body flex flex-col gap-4">
        {/* PHASE: offer */}
        {phase === 'offer' && (
          <>
            <p className="text-sm text-text leading-relaxed">
              <span className="font-semibold text-acc-text">{t.count(n)}</span> {t.foundBody(n)}
            </p>

            {/* Name preview — up to 3 names */}
            {localEstimates.length > 0 && (
              <ul className="flex flex-col gap-0.5 list-disc pl-4" aria-label={t.previewLabel}>
                {localEstimates.slice(0, 3).map((p) => (
                  <li key={p.id} className="text-2xs text-soft font-mono truncate">
                    {p.name || t.untitled}
                  </li>
                ))}
                {localEstimates.length > 3 && (
                  <li className="text-2xs text-soft font-mono">{t.andMore(localEstimates.length - 3)}</li>
                )}
              </ul>
            )}
          </>
        )}

        {/* PHASE: importing */}
        {phase === 'importing' && (
          <div className="flex items-center gap-3 py-2" aria-live="polite">
            <Spinner />
            <span className="text-sm text-text">{t.importing(n)}</span>
          </div>
        )}

        {/* PHASE: results */}
        {phase === 'results' && results && (
          <>
            {/* aria-live region — announced once when results arrive */}
            <p className={`text-sm font-medium ${summaryClass}`} aria-live="polite">
              {t.summary(importedCount, totalCount)}
            </p>

            <DataTable
              caption={t.caption}
              columns={[
                {
                  id: 'estimate',
                  header: t.colEstimate,
                  rowHeader: true,
                  render: (row: ResultRow) => <span className="font-medium text-text">{row.name}</span>,
                },
                {
                  id: 'status',
                  header: t.colStatus,
                  render: ({ result }: ResultRow) => (
                    <>
                      <ImportStatusBadge status={result.status} />
                      {result.status === 'failed' && result.error && (
                        <div className="text-soft text-2xs mt-0.5">{result.error}</div>
                      )}
                    </>
                  ),
                },
              ]}
              rows={results.map((result, idx) => ({
                rowId: result.localId ?? String(idx),
                // Match result back to the local estimate by localId for the name.
                name: localEstimates.find((p) => p.id === result.localId)?.name || result.localId || t.untitled,
                result,
              }))}
              getRowKey={(row) => row.rowId}
              testId="import-results-table"
            />

            <p className="text-2xs text-soft">{t.copiesKept}</p>
          </>
        )}
      </div>

      {/* Footer actions */}
      {phase !== 'importing' && (
        <div className="dialog-footer">
          {phase === 'offer' && (
            <>
              <Button variant="ghost" onClick={onDecline}>
                {t.skip}
              </Button>
              <Button ref={primaryBtnRef} variant="primary" onClick={onAccept}>
                {t.importAll}
              </Button>
            </>
          )}

          {phase === 'results' && (
            <Button ref={closeBtnRef} variant="primary" onClick={onClose} data-testid="import-results-close">
              {t.close}
            </Button>
          )}
        </div>
      )}
    </Dialog>
  )
}
