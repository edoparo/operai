import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import { useNavigate, useRouter } from '@tanstack/react-router'
import Header from './components/Header'
import { authClient } from './lib/authClient'
import MetricsBar from './components/MetricsBar'
import ActivityTable from './components/ActivityTable'
import SummaryTable from './components/SummaryTable'
import ParametersPanel from './components/ParametersPanel'
import { pertCalc } from './hooks/useEstimator'
import { useEstimatorContext } from './context/EstimatorContext'
import { strings } from './strings'
import { exportPdf } from './lib/pdfExport'
import { renderGanttPng } from './lib/ganttChart'
import { svgToDataUrl } from './lib/logoUtils'
import { computeActivityNums } from './lib/activityNums'
import { computeHealthWarnings } from './lib/healthWarnings'
import ShortcutsModal from './components/ShortcutsModal'
import HealthWarningsModal from './components/HealthWarningsModal'
import TemplatePicker from './components/TemplatePicker'
import HelpDrawer from './components/HelpDrawer'
import ConflictBanner from './components/ConflictBanner'
import CollaboratorsDialog from './components/CollaboratorsDialog'
import { formatIdentity } from './lib/identity'
import * as estimatesApi from './lib/estimatesApi'
import {
  Banner,
  Button,
  ConfirmDialog,
  Icon,
  StatePanel,
  Tabs,
  VisuallyHidden,
  formatDate,
  tabPanelProps,
  useFocusOnMount,
} from '@operai/ui'
import { EXPORT_LOCALE, exportCopy } from './strings/exportCopy'
import { whole } from './lib/figures'

type EditorTab = 'activities' | 'summary' | 'parameters'

/** Ids of the editor's view tabs and their panels (`Tabs` + `tabPanelProps`). */
const TABS_ID = 'estimai-editor'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'

/**
 * T22 (specs/013-estimate-sharing/tasks.md; design.md "## Toolbar
 * composition decision"): tiny local label helper for the "Shared by
 * {owner} · {level}" chip. Mirrors `CollaboratorsDialog.tsx`'s own private
 * `levelLabel` — duplicated here rather than exported from that
 * already-merged, self-contained file for a single two-line helper.
 */
function accessLevelLabel(level: 'editor' | 'viewer'): string {
  return level === 'editor' ? strings.sharing.dialog.levelEditor : strings.sharing.dialog.levelViewer
}

/** The message for a close/reopen that failed for a reason other than the estimate's state. */
function lifecycleErrorMessage(err: unknown): string {
  return err instanceof estimatesApi.ApiError
    ? strings.lifecycle.actionFailed(String(err.status))
    : strings.lifecycle.actionNetwork
}

export default function EstimatorApp() {
  // The suite-level chrome (logo/About, avatar menu + sign-out, theme toggle)
  // is now owned by the shell (specs/003-suite-shell, T6/T9/T14) — it is not
  // rendered here. `authClient.useSession()` is still read below, but only to
  // source the author-backfill value; `shell/session` (via T13's authClient
  // facade) is what actually supplies the session.
  const { data: session } = authClient.useSession()
  const sessionUser = session?.user ?? null
  const navigate = useNavigate()
  const router = useRouter()

  const [tab, setTab] = useState<EditorTab>('activities')
  // INC-30: arriving on the editor (from the list, or after "Reload latest"
  // remounts it) replaces the page, so focus moves to its h1.
  const headingRef = useFocusOnMount<HTMLHeadingElement>()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showHealthWarnings, setShowHealthWarnings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showCollaborators, setShowCollaborators] = useState(false)
  const [dismissedPicker, setDismissedPicker] = useState(false)
  // Release pending deletion — confirmed in a ConfirmDialog (INC-18), never window.confirm().
  const [releaseToDelete, setReleaseToDelete] = useState<string | null>(null)
  // INC-19: leaving a shared estimate confirms here, where the person acted.
  const [leftNotice, setLeftNotice] = useState(false)
  // INC-18/20: a failed "Save as a copy" is a failed save → red Banner.
  const [saveAsCopyError, setSaveAsCopyError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.shiftKey && e.key === '?') {
        e.preventDefault()
        setShowShortcuts((v) => !v)
      }
      if (e.shiftKey && e.key === 'H') {
        e.preventDefault()
        setShowHealthWarnings((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const {
    projectId,
    name,
    author,
    params,
    releases,
    acts,
    summary,
    totals,
    byProfile,
    saveStatus,
    saveError,
    clearSaveError,
    showSavedToast,
    dismissSavedToast,
    setName,
    setAuthor,
    updAct,
    addAct,
    delAct,
    reorderActs,
    updRel,
    addRel,
    delRel,
    updP,
    loadTemplate,
    canEdit,
    conflict,
    access,
    owner,
    collaboratorCount,
    hasUnsavedChanges,
    canChangeLifecycle,
    closedAt,
    closedBy,
    closeEstimate,
    reopenEstimate,
    applyServerEstimate,
    closedWhileEditing,
    dismissClosedWhileEditing,
  } = useEstimatorContext()

  // Close/reopen (the CRM's "estimate ready" signal). Closing asks first; the
  // request's error stays inline in the dialog. Reopening is immediate.
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [lifecycleBusy, setLifecycleBusy] = useState(false)
  const [closeDialogError, setCloseDialogError] = useState<string | null>(null)
  const [lifecycleError, setLifecycleError] = useState<string | null>(null)
  const [lifecycleNotice, setLifecycleNotice] = useState<'closed' | 'reopened' | null>(null)
  // Closing is only offered once everything typed has been stored: a pending
  // debounce, a save in flight, a failed save or a conflict all keep it off.
  const closeBlocked = hasUnsavedChanges || saveStatus === 'saving' || conflict !== null

  // T17 (specs/013-estimate-sharing/tasks.md; design.md S5 "single canEdit
  // gate"): the ONE place this component derives readOnly — every child
  // below reads this same value, never re-deriving `canEdit` itself (plan
  // risk R5).
  const readOnly = !canEdit

  // T18 (specs/013-estimate-sharing/tasks.md; design.md S4) — the two
  // ConflictBanner actions.
  //
  // "Reload latest": a route invalidate re-runs the current route's loader
  // (estimatesApi.get), which returns a fresh `version` — EstimatePage.tsx's
  // `providerKey={estimate.version}` then remounts a brand-new
  // EstimatorProvider on that key, discarding only what was superseded.
  const handleReloadLatest = useCallback(() => {
    void router.invalidate()
  }, [router])

  // "Save as a copy instead": POST /estimates of the CURRENT local content
  // (the in-progress edits the conflict never touched, AC-4.2) — a zero-API-
  // cost escape hatch that never risks the server's refusal again, since it
  // creates a brand-new estimate rather than retrying the guarded PUT.
  const handleSaveAsCopy = useCallback(() => {
    setSaveAsCopyError(null)
    void estimatesApi
      .create({ name, author, content: { params, releases, acts } })
      .then((created) => {
        navigate({ to: '/estimates/$estimateId', params: { estimateId: created.id } })
      })
      .catch((err: unknown) => {
        // The ConflictBanner stays up so the user can retry either action;
        // the failure itself is said in a danger Banner under it (INC-20).
        console.error('Save as a copy failed:', err)
        setSaveAsCopyError(strings.editor.saveAsCopyFailed)
      })
  }, [name, author, params, releases, acts, navigate])

  // The author is the logged-in user — there is no manual author input anymore.
  // Backfill it from the session for estimates created without one (e.g. new or
  // imported), without overwriting an author already recorded on the estimate.
  useEffect(() => {
    // A closed estimate is read-only: never change its document locally.
    if (author || closedAt) return
    const sessionAuthor = sessionUser?.name || sessionUser?.email
    if (sessionAuthor) setAuthor(sessionAuthor)
  }, [author, closedAt, sessionUser, setAuthor])

  // Someone else closed/reopened or changed the estimate since it was loaded:
  // there is nothing unsaved here (closing requires it), so the latest server
  // copy replaces the page in place. Falls back to a route reload.
  const reloadInPlace = useCallback(async () => {
    try {
      applyServerEstimate(await estimatesApi.get(projectId))
    } catch {
      void router.invalidate()
    }
  }, [applyServerEstimate, projectId, router])

  const runLifecycle = useCallback(
    async (action: 'close' | 'reopen') => {
      setLifecycleBusy(true)
      setCloseDialogError(null)
      setLifecycleError(null)
      setLifecycleNotice(null)
      try {
        await (action === 'close' ? closeEstimate() : reopenEstimate())
        setShowCloseConfirm(false)
        setLifecycleNotice(action === 'close' ? 'closed' : 'reopened')
      } catch (err: unknown) {
        if (err instanceof estimatesApi.EstimateStateError || err instanceof estimatesApi.ConflictError) {
          // Already closed/reopened by someone else (the reloaded page shows
          // it), or changed meanwhile (say so: the person should look again).
          setShowCloseConfirm(false)
          if (!(err instanceof estimatesApi.EstimateStateError)) setLifecycleError(strings.lifecycle.changedMeanwhile)
          await reloadInPlace()
        } else if (action === 'close') {
          setCloseDialogError(lifecycleErrorMessage(err))
        } else {
          setLifecycleError(lifecycleErrorMessage(err))
        }
      } finally {
        setLifecycleBusy(false)
      }
    },
    [closeEstimate, reopenEstimate, reloadInPlace],
  )

  const rnames = useMemo(() => releases.map((r) => r.name), [releases])

  const handleDeleteRelease = useCallback((id: string) => setReleaseToDelete(id), [])

  const releaseDeleteBody = useMemo(() => {
    if (releaseToDelete === null) return null
    const rel = releases.find((r) => r.id === releaseToDelete)
    const count = acts.filter((a) => a.release === rel?.name).length
    return strings.editor.deleteReleaseBody(rel?.name || strings.editor.thisRelease, count)
  }, [releaseToDelete, releases, acts])

  const warnings = useMemo(() => computeHealthWarnings(acts, releases, summary), [acts, releases, summary])

  // Exports are client documents: English copy (strings/exportCopy.ts), the
  // suite's numeric date, numeric cells left as numbers for the spreadsheet.
  const exportXLSX = useCallback(() => {
    const x = exportCopy
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        x.parameters.header,
        [x.parameters.project, name],
        [x.parameters.author, author],
        [x.parameters.date, formatDate(new Date())],
        [],
        [x.parameters.parallelism, params.parallelism],
        [x.parameters.sprintDays, params.sprintDays],
        [x.parameters.workingDaysMonth, params.workingDaysMonth],
        [x.parameters.qaDeployDays, params.qaDeployDays],
        [x.parameters.qaTestDays, params.qaTestDays],
        [x.parameters.pmDays, params.pmDays],
      ]),
      x.sheets.parameters,
    )
    const nums = computeActivityNums(acts)
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        x.detailHeader,
        ...acts.map((a) => {
          const pv = pertCalc(a.o, a.ml, a.p)
          const actGain =
            a.aiGain !== undefined && a.aiGain !== null && (a.aiGain as unknown as string) !== ''
              ? Number(a.aiGain)
              : params.aiGain
          return [
            nums.get(a.id) ?? '',
            a.epic,
            a.act,
            a.prof,
            +a.o,
            +a.ml,
            +a.p,
            +pv.toFixed(1),
            +a.risk,
            +(pv + (Number(a.risk) || 0)).toFixed(1),
            Math.round(actGain * 100),
            a.notes,
            a.release,
          ]
        }),
      ]),
      x.sheets.detail,
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        x.summaryHeader,
        ...summary.map((s) =>
          s.res
            ? [
                s.name,
                s.fte,
                s.res.ind,
                s.res.plan,
                s.res.base,
                s.res.el,
                s.res.tm,
                s.res.mo,
                s.res.best,
                s.res.worst,
                x.daysRange(whole(s.res.best, EXPORT_LOCALE), whole(s.res.worst, EXPORT_LOCALE)),
                s.res.aiCost,
                s.res.aiElapsed,
                s.res.aiTotalMD,
              ]
            : [s.name, s.fte, ...Array(12).fill(x.empty)],
        ),
        [
          x.total,
          '',
          +totals.ind.toFixed(1),
          '',
          +totals.base.toFixed(1),
          totals.el,
          totals.tm,
          totals.mo,
          totals.best,
          totals.worst,
          x.daysRange(whole(totals.best, EXPORT_LOCALE), whole(totals.worst, EXPORT_LOCALE)),
          totals.aiCost,
          totals.aiElapsed,
          totals.aiTotalMD,
        ],
      ]),
      x.sheets.summary,
    )
    XLSX.writeFile(wb, `${name.replace(/\s+/g, '_')}_${x.fileStem}.xlsx`)
  }, [acts, summary, totals, params, name, author])

  const exportClient = useCallback(async () => {
    const wdm = params.workingDaysMonth || 20
    const active = summary.filter((s) => s.res)

    const x = exportCopy
    const wb = new ExcelJS.Workbook()
    wb.creator = author || x.product
    wb.created = new Date()
    const ws = wb.addWorksheet(x.sheets.client)

    // ── Column widths ──────────────────────────────────────────────────
    ws.columns = [
      { key: 'release', width: 22 },
      { key: 'mo', width: 18 },
      { key: 'best', width: 18 },
      { key: 'worst', width: 18 },
      { key: 'tm', width: 18 },
    ]

    // ── Logo + project info (rows 1-2) ─────────────────────────────────
    ws.getRow(1).height = 36
    ws.getRow(2).height = 8 // spacer

    const logoDataUrl = await svgToDataUrl('/estimai-light.svg', 128)
    const logoImgId = wb.addImage({ base64: logoDataUrl.split(',')[1], extension: 'png' })
    ws.addImage(logoImgId, {
      tl: { col: 0, row: 0 } as ExcelJS.Anchor,
      ext: { width: 32, height: 32 },
      editAs: 'absolute',
    })

    const nameCell = ws.getCell('B1')
    nameCell.value = name || x.untitled
    nameCell.font = { bold: true, size: 12 }
    nameCell.alignment = { vertical: 'middle' }

    if (author) {
      const authorCell = ws.getCell('C1')
      authorCell.value = author
      authorCell.font = { size: 9, color: { argb: 'FF888888' } }
      authorCell.alignment = { vertical: 'middle' }
    }

    const dateCell = ws.getCell('E1')
    dateCell.value = formatDate(new Date())
    dateCell.alignment = { horizontal: 'right', vertical: 'middle' }
    dateCell.font = { size: 9, color: { argb: 'FF888888' } }

    // ── Table header (row 3) ───────────────────────────────────────────
    const headerRow = ws.getRow(3)
    x.clientHeader.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1)
      cell.value = h
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B6AF7' } }
      cell.alignment = { horizontal: 'center' }
    })

    // ── Data rows (row 4+) ─────────────────────────────────────────────
    let nextRow = 4
    for (const s of active) {
      const res = s.res!
      const row = ws.getRow(nextRow)
      const vals = [s.name, +res.mo.toFixed(1), +(res.best / wdm).toFixed(1), +(res.worst / wdm).toFixed(1), res.tm]
      vals.forEach((v, i) => {
        const cell = row.getCell(i + 1)
        cell.value = v
        cell.alignment = { horizontal: 'center' }
        if (nextRow % 2 === 0) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0FF' } }
        }
      })
      nextRow++
    }

    // ── Total row ──────────────────────────────────────────────────────
    const totalRow = ws.getRow(nextRow)
    const totalVals = [
      x.total,
      +totals.mo.toFixed(1),
      +(totals.best / wdm).toFixed(1),
      +(totals.worst / wdm).toFixed(1),
      totals.tm,
    ]
    totalVals.forEach((v, i) => {
      const cell = totalRow.getCell(i + 1)
      cell.value = v
      cell.font = { bold: true }
      cell.alignment = { horizontal: 'center' }
    })
    nextRow++

    // ── Gantt chart image ──────────────────────────────────────────────
    const png = renderGanttPng(summary, wdm)
    if (png) {
      const chartRows = active.length
      const chartH = 52 + chartRows * 48 + 28 // must match ganttChart.ts layout
      const chartW = 668 // (16+120+500+32) logical px

      const imgId = wb.addImage({ base64: png, extension: 'png' })
      ws.addImage(imgId, {
        tl: { col: 0, row: nextRow + 1 } as ExcelJS.Anchor,
        ext: { width: chartW, height: chartH },
      })
      // Reserve rows for the image so the sheet scrolls correctly
      const imgRowCount = Math.ceil(chartH / 20) + 1
      for (let r = 0; r < imgRowCount; r++) ws.getRow(nextRow + 1 + r)
    }

    // ── Download ───────────────────────────────────────────────────────
    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name.replace(/\s+/g, '_') || x.fileStem}_client.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }, [summary, totals, params, name, author])

  const exportPDF = useCallback(() => {
    exportPdf({ name, author, acts, summary, totals, params })
  }, [name, author, acts, summary, totals, params])

  return (
    <div className="min-h-full w-full">
      {/* INC-30: the editor's h1. The sticky header has no room for a visible
          title (its centre is the editable name), so the h1 is visually
          hidden: the tool title plus the estimate's name. The views' own
          headings (Activity detail, Release summary, Model parameters) are
          h2s under it. */}
      <h1 ref={headingRef} tabIndex={-1} className="visually-hidden" data-testid="estimai-editor-heading">
        {strings.editor.heading(name)}
      </h1>
      <Header name={name} saveStatus={saveStatus} onNameChange={setName} readOnly={readOnly} />

      <MetricsBar
        totals={totals}
        activityCount={acts.length}
        releaseCount={releases.length}
        profileCount={byProfile.length}
      />

      <div className="flex items-end gap-px px-5.5 pt-2.5 pb-0 border-b border-rule bg-ink-soft">
        {/* INC-30/INC-32: the three views of the SAME estimate are an in-page
            switch → the library Tabs (a real tablist: one tab stop, arrow
            keys, aria-selected), each view a tabpanel (tabPanelProps). */}
        <Tabs<EditorTab>
          label={strings.editor.tabsLabel}
          idPrefix={TABS_ID}
          value={tab}
          onChange={setTab}
          testId="estimai-editor-tabs"
          tabs={(
            [
              ['activities', strings.editor.tabActivities, warnings.activityCount],
              ['summary', strings.editor.tabSummary, warnings.releaseCount],
              ['parameters', strings.editor.tabParameters, 0],
            ] as const
          ).map(([id, label, warnCount]) => ({
            id,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {label}
                {warnCount > 0 && (
                  <>
                    <span
                      aria-hidden="true"
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full text-2xs font-bold leading-none bg-org/20 text-org-text"
                    >
                      {warnCount}
                    </span>
                    <VisuallyHidden>{strings.editor.tabWarnings(warnCount)}</VisuallyHidden>
                  </>
                )}
              </span>
            ),
          }))}
        />
        <div className="flex-1" />
        <div className="flex items-center gap-1 mb-1">
          {/* Sharing an estimate is account-based only: the owner opens
              CollaboratorsDialog in owner mode, a collaborator sees a
              non-actionable-looking chip that opens the same dialog in its
              read-only member mode. The anonymous "Share link" (lz-string
              payload in a URL fragment + /share page) that used to sit here
              was removed on 2026-08-09 — see specs/013's US-8 amendment. */}
          {access === 'owner' ? (
            <Button
              size="sm"
              onClick={() => setShowCollaborators(true)}
              title={strings.editor.manageCollaborators}
              aria-label={
                collaboratorCount ? strings.sharing.toolbar.collaboratorsWithCount(collaboratorCount) : undefined
              }
              data-testid="collaborators-button"
            >
              <Icon name="users" />
              {strings.sharing.toolbar.collaborators}
              {!!collaboratorCount && (
                <span
                  aria-hidden="true"
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-2xs font-bold leading-none bg-muted/20 text-soft"
                >
                  {collaboratorCount}
                </span>
              )}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowCollaborators(true)}
              title={strings.editor.viewCollaboration}
              data-testid="collaborators-chip"
            >
              {strings.sharing.toolbar.sharedByChip(
                formatIdentity(owner ?? { status: 'unknown', name: null }),
                accessLevelLabel(access),
              )}
            </Button>
          )}
          {canChangeLifecycle &&
            (closedAt === null ? (
              <Button
                size="sm"
                onClick={() => {
                  setCloseDialogError(null)
                  setShowCloseConfirm(true)
                }}
                disabled={closeBlocked}
                title={closeBlocked ? strings.lifecycle.closeUnsavedTitle : undefined}
                aria-haspopup="dialog"
                data-testid="close-estimate-button"
              >
                <Icon name="lock" />
                {strings.lifecycle.closeAction}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void runLifecycle('reopen')}
                busy={lifecycleBusy}
                data-testid="reopen-estimate-button"
              >
                <Icon name="edit" />
                {lifecycleBusy ? strings.lifecycle.reopenBusy : strings.lifecycle.reopenAction}
              </Button>
            ))}
          <div className="w-px h-4 bg-rule mx-0.5" />
          <Button size="sm" onClick={exportClient} title={strings.editor.exportClientTitle}>
            {strings.editor.exportClient}
          </Button>
          <Button size="sm" onClick={exportPDF} title={strings.editor.exportPdfTitle}>
            {strings.editor.exportPdf}
          </Button>
          <Button size="sm" onClick={exportXLSX}>
            {strings.editor.exportExcel}
          </Button>
          <div className="w-px h-4 bg-rule mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => setShowHelp(true)}
            aria-haspopup="dialog"
            title={strings.editor.modelReference}
            aria-label={strings.editor.modelReference}
          >
            <Icon name="help" />
          </Button>
        </div>
      </div>

      {/* T18 (design.md S4): the ConflictBanner owns this zone EXCLUSIVELY
          while a conflict is active — it never stacks with the ordinary
          save toast (EstimatorContext.tsx already clears saveError/
          showSavedToast the moment it enters `conflict`, but the explicit
          branch here makes that exclusivity a render-time guarantee too). */}
      {closedAt !== null && (
        <Banner
          tone={closedWhileEditing ? 'warning' : 'info'}
          title={strings.lifecycle.closedTitle}
          className="mx-5.5 mt-2"
          data-testid="estimate-closed-banner"
          {...(closedWhileEditing
            ? { onDismiss: dismissClosedWhileEditing, dismissLabel: strings.editor.dismiss }
            : {})}
        >
          {closedWhileEditing && <span className="block">{strings.lifecycle.closedMeanwhile}</span>}
          <span className="block">
            {closedBy && closedBy.status !== 'unknown'
              ? strings.lifecycle.closedBy(formatIdentity(closedBy), formatDate(closedAt))
              : strings.lifecycle.closedOn(formatDate(closedAt))}{' '}
            {canChangeLifecycle ? strings.lifecycle.closedReadOnly : strings.lifecycle.closedReadOnlyViewer}
          </span>
        </Banner>
      )}
      {lifecycleError && (
        <Banner
          tone="danger"
          compact
          className="mx-5.5 mt-2"
          onDismiss={() => setLifecycleError(null)}
          dismissLabel={strings.editor.dismiss}
          data-testid="estimate-lifecycle-error"
        >
          {lifecycleError}
        </Banner>
      )}
      {lifecycleNotice && (
        <Banner
          tone="success"
          compact
          autoDismiss
          className="mx-5.5 mt-2"
          onDismiss={() => setLifecycleNotice(null)}
          dismissLabel={strings.editor.dismiss}
          data-testid="estimate-lifecycle-notice"
        >
          {lifecycleNotice === 'closed' ? strings.lifecycle.closedConfirmation : strings.lifecycle.reopenedConfirmation}
        </Banner>
      )}

      {conflict ? (
        <>
          <ConflictBanner conflict={conflict} onReloadLatest={handleReloadLatest} onSaveAsCopy={handleSaveAsCopy} />
          {saveAsCopyError && (
            <Banner
              tone="danger"
              className="mx-5.5 mt-2"
              onDismiss={() => setSaveAsCopyError(null)}
              dismissLabel={strings.editor.dismiss}
              data-testid="save-as-copy-error"
            >
              {saveAsCopyError}
            </Banner>
          )}
        </>
      ) : (
        <>
          {/* Library Banner (INC-19): a failed save is red and stays until
              dismissed; "Changes stored" is a compact success that dismisses
              itself. Never the shell's ToastHost. */}
          {saveError && (
            <Banner
              tone="danger"
              compact
              className="mx-5.5 mt-2"
              onDismiss={clearSaveError}
              dismissLabel={strings.editor.dismiss}
              data-testid="save-error-banner"
            >
              {saveError}
            </Banner>
          )}
          {!saveError && showSavedToast && (
            <Banner
              tone="success"
              compact
              autoDismiss
              className="mx-5.5 mt-2"
              onDismiss={dismissSavedToast}
              dismissLabel={strings.editor.dismiss}
              data-testid="save-success-banner"
            >
              {strings.editor.savedToast}
            </Banner>
          )}
          {leftNotice && (
            <Banner
              tone="success"
              compact
              autoDismiss
              className="mx-5.5 mt-2"
              onDismiss={() => setLeftNotice(false)}
              dismissLabel={strings.editor.dismiss}
              data-testid="left-estimate-notice"
            >
              {strings.sharing.dialog.leftNotice}
            </Banner>
          )}
        </>
      )}

      {/* Not a <main>: the shell's layout owns the page's one main landmark (INC-29). */}
      <div className="flex-1 p-5 px-5.5 overflow-x-auto" {...tabPanelProps(TABS_ID, tab)}>
        {tab === 'activities' &&
          (acts.length === 0 && !canEdit ? (
            // T17 (design.md S5): TemplatePicker's whole contract is content
            // creation — the wrong verb for a viewer. A small inline state
            // replaces it; no call to action, because there is none
            // available to a viewer.
            <StatePanel title={strings.sharing.emptyActivitiesViewer.title} testId="viewer-empty-activities">
              {strings.sharing.emptyActivitiesViewer.body}
            </StatePanel>
          ) : acts.length === 0 && !dismissedPicker ? (
            <TemplatePicker
              onSelect={(t) => {
                loadTemplate(t)
                setDismissedPicker(true)
              }}
              onBlank={() => setDismissedPicker(true)}
            />
          ) : (
            <ActivityTable
              activities={acts}
              releaseNames={rnames}
              globalAiGain={params.aiGain}
              activityWarnings={warnings.activityWarnings}
              onUpdate={updAct}
              onDelete={delAct}
              onAdd={addAct}
              onAddRelease={addRel}
              onReorder={reorderActs}
              readOnly={readOnly}
            />
          ))}
        {tab === 'summary' && (
          <SummaryTable
            summary={summary}
            releases={releases}
            totals={totals}
            byProfile={byProfile}
            params={params}
            releaseWarnings={warnings.releaseWarnings}
            onUpdateRelease={updRel}
            onAddRelease={addRel}
            onDeleteRelease={handleDeleteRelease}
            readOnly={readOnly}
          />
        )}
        {tab === 'parameters' && <ParametersPanel params={params} onUpdate={updP} readOnly={readOnly} />}
      </div>

      {/* Shortcuts affordance, pinned to the bottom of the SCROLLPORT, not the
          viewport. It used to be `fixed bottom-0 right-0`, which anchored it to
          the viewport — and inside the shell the viewport's bottom-right corner
          is where the shell's own `<footer>` (version + copyright) sits, so the
          two overlapped (reported 2026-08-10).

          `sticky` keeps the always-visible behaviour `fixed` gave us while
          scoping it to `<main>`'s own scroll container (ShellLayout gives
          `<main>` `relative` + `overflow-y-auto`), so it now stops above the
          shell chrome instead of on top of it. A remote must not position
          anything against the viewport — that space belongs to the shell
          (ADR-0006). */}
      <footer className="sticky bottom-0 z-10 flex justify-end px-4 py-2 pointer-events-none">
        <Button
          variant="ghost"
          size="sm"
          className="pointer-events-auto font-mono"
          onClick={() => setShowShortcuts((v) => !v)}
          title={strings.editor.shortcutsTitle}
        >
          <kbd className="inline-flex items-center px-1 py-0.5 rounded border border-rule bg-ink-mid text-2xs leading-none">
            {strings.editor.shortcutsKey}
          </kbd>
          <span>{strings.editor.shortcuts}</span>
        </Button>
      </footer>

      {showHealthWarnings && (
        <HealthWarningsModal
          activityWarnings={warnings.activityWarnings}
          releaseWarnings={warnings.releaseWarnings}
          activities={acts}
          releases={releases}
          onClose={() => setShowHealthWarnings(false)}
        />
      )}
      {releaseToDelete !== null && releaseDeleteBody !== null && (
        <ConfirmDialog
          title={strings.editor.deleteReleaseTitle}
          confirmLabel={strings.confirmDelete.confirm}
          busyLabel={strings.confirmDelete.busy}
          cancelLabel={strings.confirmDelete.cancel}
          closeLabel={strings.confirmDelete.close}
          busy={false}
          error={null}
          onConfirm={() => {
            delRel(releaseToDelete)
            setReleaseToDelete(null)
          }}
          onCancel={() => setReleaseToDelete(null)}
          testIdPrefix="release-delete"
        >
          <p>{releaseDeleteBody}</p>
        </ConfirmDialog>
      )}
      {showCloseConfirm && (
        <ConfirmDialog
          tone="primary"
          title={strings.lifecycle.confirmTitle}
          confirmLabel={strings.lifecycle.confirmLabel}
          busyLabel={strings.lifecycle.confirmBusy}
          cancelLabel={strings.lifecycle.cancel}
          closeLabel={strings.lifecycle.close}
          busy={lifecycleBusy}
          error={closeDialogError}
          onConfirm={() => void runLifecycle('close')}
          onCancel={() => setShowCloseConfirm(false)}
          testIdPrefix="close-estimate"
        >
          <p>{strings.lifecycle.confirmBody}</p>
        </ConfirmDialog>
      )}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {showHelp && <HelpDrawer onClose={() => setShowHelp(false)} />}
      {showCollaborators && (
        <CollaboratorsDialog
          estimateId={projectId}
          access={access}
          owner={owner}
          onClose={() => setShowCollaborators(false)}
          onLeft={() => setLeftNotice(true)}
        />
      )}

      <Analytics />
      <SpeedInsights />
    </div>
  )
}
