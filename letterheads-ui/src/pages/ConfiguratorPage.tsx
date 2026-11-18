import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import * as shellSession from 'shell/session'
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Drawer,
  PageHeader,
  resolveLocale,
  StatePanel,
  Tabs,
  tabPanelProps,
  VisuallyHidden,
} from '@operai/ui'
import { ErrorSummary } from '../components/ErrorSummary'
import { HistoryPanel } from '../components/HistoryPanel'
import { VersionBanner } from '../components/HistoryPanelVersion'
import { PreviewPane } from '../components/PreviewPane'
import { describePreview, PreviewRefusedError, usePreviewRequest } from '../components/PreviewPaneRequest'
import type { PreviewLanguage } from '../components/PreviewPaneRequest'
import { LoadFailure, Loading } from '../components/LoadState'
import { SaveBar } from '../components/SaveBar'
import { useSaveFlow } from '../components/SaveBarFlow'
import { TextsHelp } from '../components/TextsHelp'
import { VariantCard } from '../components/VariantCard'
import { BoolField, ColourField, NumberField, SelectField } from '../components/VariantCardFields'
import { useLetterheads } from '../hooks/useLetterheads'
import { useResource } from '../hooks/useResource'
import { comparePointers, describeProblem, findControl, firstRefusedControl, focusControl } from '../lib/fieldPath'
import { statusOf } from '../lib/errors'
import { createFormState, formReducer, isDirty, limitsFromCatalog, pointer } from '../lib/formState'
import { FormContext, useForm } from '../lib/formStateContext'
import type { FormContextValue } from '../lib/formStateContext'
import { getVersion } from '../lib/formStateLoad'
import type { VersionAnswer } from '../lib/formStateLoad'
import { readCatalog, VARIANTS } from '../lib/formStateTypes'
import type { FormCatalog, FormConfig, Problem } from '../lib/formStateTypes'
import { getLetterheads } from '../lib/letterheadsApi'
import { ENTITIES } from '../lib/types'
import type { Entity, EntitySummary, LetterheadList } from '../lib/types'
import { strings } from '../strings'

/**
 * The tool's one page (`/letterheads`, design S1): the entity tabs, the entity's header, and the form of
 * its letterhead — page setup, the look of the document, then the default, first and last pages — with the
 * help card on top, the live preview beside it, and the save bar under it. The entity is the `?entity` search
 * param, else the first entity the person may change, else the first one.
 *
 * Saving (T24; design F7, S3, S4, F9; AC-4.1, AC-4.8, AC-8.3, AC-8.8):
 * - **Save as version n+1** posts the form with the version it was loaded from (`baseVersion`, 0 for an entity
 *   with none). A 201 makes the form's baseline the configuration that was sent (edits made while it ran stay
 *   unsaved), refreshes the shell's list, and leaves focus on the button;
 * - a refusal of values shows the summary (`ErrorSummary`) and the sentence next to each control, and puts focus
 *   on the first refused control in page order; a newer version shows the conflict banner and disables Save
 *   until the person reloads; a 403 turns the page read-only; any other failure says nothing was saved;
 * - leaving with unsaved changes (or an upload in flight) asks: the shell's own confirmation for another tool
 *   (`registerNavigationBlocker`), the page's `ConfirmDialog` for another entity, the browser's for a closed tab.
 *
 * History and the older versions (T25; design F8, F10, F11, S5, S6, S8; AC-8.7, AC-4.2, AC-8.2): the **Settings |
 * History** tabs (`?view=history`), the version table with **Open** and **Restore**, an older version opened
 * read-only with its own banner (`?version=n`) and previewed on its own `layoutVersion` (G6), and the restore
 * after its confirmation. Whether the person may change an entity is the service's answer (`canManage`, G4), never
 * worked out here: without it the form is a `fieldset disabled` and neither Save nor Restore is offered. Moving
 * between the two views keeps the form on screen as it is (hidden, not unmounted), so no edit is lost by looking
 * at the history; the address is replaced, not pushed, by every one of these moves, so that the browser's Back can
 * never step over a form with unsaved changes.
 */
export default function ConfiguratorPage() {
  const { catalog: rawCatalog, letterheads } = useLetterheads()
  const catalog = useMemo(() => readCatalog(rawCatalog), [rawCatalog])
  const search = useSearch({ strict: false }) as { entity?: unknown; view?: unknown; version?: unknown }
  const navigate = useNavigate()
  const entity = chooseEntity(search.entity, letterheads)
  const view: ViewName = search.view === 'history' ? 'history' : 'settings'
  const versionParam = readVersionParam(search.version)
  const [said, setSaid] = useState({ text: '', count: 0 })
  // The preview language is a viewing choice, not saved: the person's language at first (design F3.6, F4).
  // It lives here so that it survives a reload of the form (a conflict, T25's restore) but not a reload of the page.
  const [previewLanguage, setPreviewLanguage] = useState<PreviewLanguage>(() => resolveLocale())
  // Asked of the form on screen: does it hold changes, or an upload in flight, that leaving would lose?
  const dirtyProbeRef = useRef<() => boolean>(() => false)
  // What the person chose while the form held changes (another entity, an older version): the leave dialog is open
  // for it (design F9).
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null)
  // A number that changes when the form must be loaded again from the active version (a restore, design F8).
  const [generation, setGeneration] = useState(0)

  // A polite line for assistive technology. The same text twice in a row is a change too (the trailing space).
  const announce = useCallback((text: string) => setSaid((last) => ({ text, count: last.count + 1 })), [])

  // The address is replaced, never pushed: the entity, the view and the version are where the person is, not a path
  // through the tool, and a push would let the browser's Back leave a form with unsaved changes without asking.
  const go = (change: { entity?: Entity; view?: ViewName; version?: number | null }) => {
    void navigate({
      search: ((previous: Record<string, unknown>) => {
        const next = { ...previous }
        if (change.entity !== undefined) next.entity = change.entity
        if (change.view !== undefined) next.view = change.view === 'history' ? 'history' : undefined
        if (change.version !== undefined) next.version = change.version ?? undefined
        return next
      }) as never,
      replace: true,
    })
  }

  const goTo = (next: Entity) => {
    go({ entity: next, version: null })
    announce(strings.page.showing(strings.entity[next]))
  }

  const switchEntity = (next: Entity) => {
    if (next === entity) return
    if (dirtyProbeRef.current()) setPendingLeave({ kind: 'entity', entity: next })
    else goTo(next)
  }

  // Open an older version (design F8): the active one is the Settings view itself. Opening discards what the form holds.
  const showVersion = (version: number, discard: boolean) => {
    if (version === letterheads[entity].activeVersion) {
      if (discard) setGeneration((current) => current + 1)
      go({ view: 'settings', version: null })
    } else go({ view: 'settings', version })
  }
  const openVersion = (version: number) => {
    if (dirtyProbeRef.current()) setPendingLeave({ kind: 'version', version })
    else showVersion(version, false)
  }

  if (catalog === null) {
    return (
      <section data-testid="letterheads-page" aria-label={strings.nav.heading}>
        <Banner tone="warning" data-testid="letterheads-catalog-invalid" title={strings.common.loadErrorTitle}>
          {strings.common.unknownError}
        </Banner>
      </section>
    )
  }

  return (
    <section data-testid="letterheads-page" aria-label={strings.nav.heading} className="flex flex-col gap-4">
      <Tabs
        label={strings.entity.tabs}
        tabs={ENTITIES.map((id) => ({ id, label: strings.entity[id] }))}
        value={entity}
        onChange={switchEntity}
        idPrefix="letterheads-entity"
        testId="letterheads-entity-tabs"
      />
      <div {...tabPanelProps('letterheads-entity', entity)} className="flex flex-col gap-4">
        <EntityEditor
          key={entity}
          entity={entity}
          letterheads={letterheads}
          catalog={catalog}
          announce={announce}
          previewLanguage={previewLanguage}
          onPreviewLanguage={setPreviewLanguage}
          dirtyProbeRef={dirtyProbeRef}
          view={view}
          versionParam={versionParam}
          generation={generation}
          onView={(next) => go({ view: next, version: null })}
          onOpenVersion={openVersion}
          onBumpGeneration={() => setGeneration((current) => current + 1)}
        />
      </div>
      <VisuallyHidden live role="status" data-testid="letterheads-announcer">
        {said.text + (said.count % 2 === 0 ? '' : ' ')}
      </VisuallyHidden>
      {pendingLeave !== null && (
        <ConfirmDialog
          title={strings.leave.title}
          confirmLabel={pendingLeave.kind === 'entity' ? strings.leave.switchEntity : strings.leave.openVersion}
          busyLabel={pendingLeave.kind === 'entity' ? strings.leave.switchEntity : strings.leave.openVersion}
          cancelLabel={strings.leave.keep}
          closeLabel={strings.leave.close}
          busy={false}
          error={null}
          onConfirm={() => {
            const next = pendingLeave
            setPendingLeave(null)
            if (next.kind === 'entity') goTo(next.entity)
            else showVersion(next.version, true)
          }}
          onCancel={() => setPendingLeave(null)}
          testIdPrefix="letterheads-leave"
        >
          {strings.leave.body(strings.entity[entity])}
        </ConfirmDialog>
      )}
    </section>
  )
}

type ViewName = 'settings' | 'history'

/** What the person asked for while the form held changes, and is waiting on the leave dialog. */
type PendingLeave = { kind: 'entity'; entity: Entity } | { kind: 'version'; version: number }

/**
 * `?version` as a version number, or `null` when it is absent or not one. The router has read the text as JSON, so
 * `3` is a number; a text of digits is also taken. Anything else (`0`, `-1`, `1.5`, `abc`) names no version.
 */
function readVersionParam(value: unknown): number | null {
  const number = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= 1 ? number : null
}

/** `?entity` when it names an entity, else the first entity the person may change, else the first. */
function chooseEntity(requested: unknown, letterheads: LetterheadList): Entity {
  const named = ENTITIES.find((id) => id === requested)
  return named ?? ENTITIES.find((id) => letterheads[id].canManage) ?? ENTITIES[0]
}

/** What the page gives every form it shows. */
interface SharedProps {
  entity: Entity
  letterheads: LetterheadList
  catalog: FormCatalog
  announce: (text: string) => void
  /** The language of the preview (a viewing choice) and its setter. */
  previewLanguage: PreviewLanguage
  onPreviewLanguage: (language: PreviewLanguage) => void
  /** The form on screen puts here the question "would leaving lose something?" (design F9). */
  dirtyProbeRef: MutableRefObject<() => boolean>
}

interface EntityEditorProps extends SharedProps {
  /** `?view`: Settings or History (design F8). */
  view: ViewName
  /** `?version` read as a number, or `null` (design F8): an older version is open when it is not the active one. */
  versionParam: number | null
  /** Changes when the form must be loaded again from the active version. */
  generation: number
  /** The person chose a view: the address changes and the open version, if any, is left. */
  onView: (view: ViewName) => void
  /** **Open** in the history: the page asks to leave unsaved changes first, then shows the version. */
  onOpenVersion: (version: number) => void
  onBumpGeneration: () => void
}

/**
 * One entity: its header, the Settings | History tabs, then its form once the active version is loaded (or the
 * starting values, if it has none), the history, or an older version.
 */
function EntityEditor({
  entity,
  letterheads,
  catalog,
  view,
  versionParam,
  generation,
  onView,
  onOpenVersion,
  onBumpGeneration,
  ...rest
}: EntityEditorProps) {
  const { refresh } = useLetterheads()
  const { activeVersion, canManage } = letterheads[entity]
  const name = strings.entity[entity]
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Focus goes to the page heading after a restore and after Back to the active version (design § Accessibility).
  // Asked for through a number, not at once: the dialog or the banner that held focus is still on screen at that
  // point, and the library gives focus back to a dialog's opener when the dialog goes.
  const [headingAsked, setHeadingAsked] = useState(0)
  useEffect(() => {
    if (headingAsked > 0) headingRef.current?.focus()
  }, [headingAsked])
  // The confirmation of a restore stays with the page: the form it was made on is replaced by the new version.
  const [restored, setRestored] = useState<{ next: number; from: number } | null>(null)
  const header = (
    <PageHeader
      title={name}
      description={activeVersion === null ? strings.page.none : strings.page.active(activeVersion)}
      headingTestId="letterheads-entity-heading"
      headingRef={headingRef}
      focusableHeading
    />
  )

  // Someone who may not change this entity sees what it holds; with nothing saved there is nothing to see (design S2).
  if (activeVersion === null && !canManage) {
    return (
      <>
        {header}
        <StatePanel title={strings.page.emptyReadOnlyTitle} testId="letterheads-empty-readonly">
          {strings.page.emptyReadOnlyBody}
        </StatePanel>
      </>
    )
  }

  // An older version is open when `?version` names one that is not the active one; the active one is the Settings view.
  const viewing = versionParam !== null && versionParam !== activeVersion ? versionParam : null
  const shownView: ViewName = viewing !== null ? 'settings' : view
  const summary = letterheads[entity]
  const history = {
    view: shownView,
    onOpenVersion,
    // A restore made version `next` active: the list follows at once, the form is loaded again on it, the page is the
    // Settings view of the active version, and the confirmation is said where the person is looking.
    onRestored: (next: number, from: number) => {
      setRestored({ next, from })
      onBumpGeneration()
      onView('settings')
      void refresh?.({ entity, activeVersion: next })
      setHeadingAsked((current) => current + 1)
    },
    // A restore found a newer version than the list knew (409): the list is asked again.
    onStale: () => void refresh?.(),
    onBack: () => {
      onView('settings')
      setHeadingAsked((current) => current + 1)
    },
  }

  return (
    <>
      {header}
      {restored !== null && (
        <Banner
          tone="success"
          compact
          autoDismiss
          dismissible={false}
          onDismiss={() => setRestored(null)}
          data-testid="letterheads-restored"
        >
          {strings.restore.done(restored.next, restored.from)}
        </Banner>
      )}
      <Tabs
        label={strings.view.tabs}
        tabs={[
          { id: 'settings', label: strings.view.settings },
          { id: 'history', label: strings.view.history },
        ]}
        value={shownView}
        onChange={onView}
        idPrefix="letterheads-view"
        testId="letterheads-view-tabs"
      />
      {/* Its content holds controls and, in the History view, a scrollable table: the panel is not a tab stop of its own. */}
      <div {...tabPanelProps('letterheads-view', shownView)} tabIndex={-1} className="flex flex-col gap-4">
        {viewing === null ? (
          <VersionForm
            key={generation}
            entity={entity}
            initialVersion={activeVersion}
            summary={summary}
            letterheads={letterheads}
            catalog={catalog}
            focusHeading={() => headingRef.current?.focus()}
            {...history}
            {...rest}
          />
        ) : (
          <VersionView
            key={`${entity}-${viewing}`}
            entity={entity}
            version={viewing}
            summary={summary}
            letterheads={letterheads}
            catalog={catalog}
            focusHeading={() => headingRef.current?.focus()}
            {...history}
            {...rest}
          />
        )}
      </div>
    </>
  )
}

/** What the form on screen was started from: the version, its configuration, and a number that changes on a reload. */
interface Shown {
  generation: number
  version: number
  config: FormConfig
}

type VersionFormProps = Omit<FormEditorProps, 'baseline' | 'version' | 'onSaved' | 'onReloaded' | 'mode'> & {
  /** The active version the list gave when the entity was opened; `null`: the entity has none (G2). */
  initialVersion: number | null
}

/**
 * Holds the version the form is on, so that saving it does not rebuild the form: loads the active version
 * (design F1.3) or takes the catalog's starting values (G2), shows the form on it, moves on to the version a
 * save made without touching what the person is looking at (focus, edits made while the save ran), and
 * replaces the form when a reload brings another version (a conflict, design F7.4).
 */
function VersionForm({ initialVersion, catalog, ...rest }: VersionFormProps) {
  const { entity } = rest
  const [target, setTarget] = useState(initialVersion ?? 0)
  const [shown, setShown] = useState<Shown | null>(() =>
    initialVersion === null ? { generation: 0, version: 0, config: catalog.defaultConfig } : null,
  )
  if (shown !== null && shown.version === target) {
    return (
      <FormEditor
        key={shown.generation}
        {...rest}
        mode={EDITING}
        catalog={catalog}
        baseline={shown.config}
        version={shown.version}
        onSaved={(version, config) => {
          setShown({ generation: shown.generation, version, config })
          setTarget(version)
        }}
        onReloaded={(answer) => {
          setShown({ generation: shown.generation + 1, version: answer.version, config: answer.config })
          setTarget(answer.version)
        }}
      />
    )
  }
  return (
    <LoadVersion
      key={target}
      entity={entity}
      version={target}
      onLoaded={(answer) =>
        setShown({ generation: (shown?.generation ?? 0) + 1, version: target, config: answer.config })
      }
    />
  )
}

/** Loads one version (design F1.3): a skeleton, then `onLoaded`; a failure with Retry. */
function LoadVersion({
  entity,
  version,
  onLoaded,
}: {
  entity: Entity
  version: number
  onLoaded: (answer: VersionAnswer) => void
}) {
  const fetcher = useCallback((signal: AbortSignal) => getVersion(entity, version, { signal }), [entity, version])
  const loaded = useResource(fetcher)
  const answer = loaded.status === 'ready' ? loaded.data : null
  const report = useRef(onLoaded)
  useEffect(() => {
    report.current = onLoaded
  })
  useEffect(() => {
    if (answer !== null) report.current(answer)
  }, [answer])
  if (loaded.status === 'error' || (loaded.status === 'ready' && answer === null)) {
    return <LoadFailure error={loaded.error} onRetry={loaded.retry} />
  }
  return <Loading label={strings.nav.loading} rows={6} />
}

/**
 * How the form is used: to **edit** the active version (or the first one), or to **look at** an older one
 * (design S6): read-only whatever the person may change, no Save bar, its own banner, and the preview on the
 * layout that version was saved with (G6, `layoutVersion`).
 */
type EditorMode = { kind: 'edit' } | { kind: 'version'; layoutVersion: number | undefined }

const EDITING: EditorMode = { kind: 'edit' }

/** Loads an older version (design F8) and shows it in the read-only form: a skeleton, then the form; a failure with Retry. */
function VersionView({
  version,
  ...rest
}: Omit<FormEditorProps, 'baseline' | 'version' | 'onSaved' | 'onReloaded' | 'mode' | 'view'> & {
  version: number
}) {
  const { entity, onBack } = rest
  const fetcher = useCallback((signal: AbortSignal) => getVersion(entity, version, { signal }), [entity, version])
  const loaded = useResource(fetcher)
  const answer = loaded.status === 'ready' ? loaded.data : null
  if (loaded.status === 'loading') return <Loading label={strings.nav.loading} rows={6} />
  if (loaded.status === 'error' && statusOf(loaded.error) === 404) {
    // A version that does not exist (a link that is wrong): the way back is the one thing to offer.
    return (
      <Banner
        tone="warning"
        data-testid="letterheads-version-notfound"
        actions={
          <Button size="sm" variant="secondary" onClick={onBack} data-testid="letterheads-version-back">
            {strings.version.back}
          </Button>
        }
      >
        {strings.version.notFound}
      </Banner>
    )
  }
  if (answer === null || typeof answer.config !== 'object' || answer.config === null) {
    return <LoadFailure error={loaded.error} onRetry={loaded.retry} />
  }
  return (
    <FormEditor
      {...rest}
      view="settings"
      mode={{
        kind: 'version',
        layoutVersion: Number.isInteger(answer.layoutVersion) ? answer.layoutVersion : undefined,
      }}
      baseline={answer.config}
      version={answer.version}
      onSaved={() => undefined}
      onReloaded={() => undefined}
    />
  )
}

interface FormEditorProps extends SharedProps {
  summary: EntitySummary
  /** Settings or History: the form stays mounted, hidden, while the history shows (design F8). */
  view: ViewName
  mode: EditorMode
  /** **Open** in the history. */
  onOpenVersion: (version: number) => void
  /** A restore made version `next` from `from`. */
  onRestored: (next: number, from: number) => void
  /** A restore found a newer version than the page's list knew (409). */
  onStale: () => void
  /** **Back to the active version**. */
  onBack: () => void
  /** The configuration to start from: the loaded version's, or the catalog's starting values (G2). */
  baseline: FormConfig
  /** The version the baseline is (0: none saved yet, the first save sends `baseVersion: 0`). */
  version: number
  /** Moves focus to the page's heading (after a reload, design § Accessibility "Focus management"). */
  focusHeading: () => void
  /** `config` was saved as version `version`: the form stays as it is, its baseline moves. */
  onSaved: (version: number, config: FormConfig) => void
  /** A newer version was loaded after a conflict: the form is replaced by one on it. */
  onReloaded: (answer: VersionAnswer) => void
}

type ProblemSource = 'preview' | 'save' | null

/**
 * The shell's navigation blocker (design F9): while `shouldBlock()` is true the shell asks before it leaves for
 * another tool. A shell that predates the seam has no such export (and a federated module may throw on a missing
 * one): the page then has the browser's own prompt only.
 */
function registerBlocker(shouldBlock: () => boolean, message: string): () => void {
  try {
    const register = (
      shellSession as unknown as {
        registerNavigationBlocker?: (shouldBlock: () => boolean, message: string) => () => void
      }
    ).registerNavigationBlocker
    return typeof register === 'function' ? register(shouldBlock, message) : () => undefined
  } catch {
    return () => undefined
  }
}

/** The form of one entity's letterhead on its reducer. Remounted (keyed) when the entity or a reload changes its version. */
function FormEditor({
  entity,
  summary,
  catalog,
  announce,
  previewLanguage,
  onPreviewLanguage,
  baseline,
  version,
  letterheads,
  dirtyProbeRef,
  focusHeading,
  onSaved,
  onReloaded,
  view,
  mode,
  onOpenVersion,
  onRestored,
  onStale,
  onBack,
}: FormEditorProps) {
  const { refresh } = useLetterheads()
  const [state, dispatch] = useReducer(formReducer, undefined, () =>
    createFormState(
      baseline,
      limitsFromCatalog(catalog.bounds.maxLinesPerZone, catalog.bounds.lineSizePt, catalog.defaultConfig),
    ),
  )
  // The person may no longer change this letterhead (a 403 on a save or an upload): read-only, edits kept (F7.5).
  const [lost, setLost] = useState(false)
  // A newer version exists (409): Save waits for the reload (F7.4). `reload`: the request for it.
  const [conflict, setConflict] = useState<{ currentVersion: number | null } | null>(null)
  const [reload, setReload] = useState<'idle' | 'busy' | 'failed'>('idle')
  // The problems of the last refused save, as they were (the summary), and the request to focus the first.
  const [refusal, setRefusal] = useState<readonly Problem[] | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  const formRef = useRef<HTMLDivElement>(null)
  const bannersRef = useRef<HTMLDivElement>(null)
  // Who put the problems on the form: a preview clears only its own (design S4, T22).
  const problemSource = useRef<ProblemSource>(null)

  const { config } = state
  const dirty = isDirty(state)
  // An older version is only ever looked at, whatever the person may change (design S6); the grant is the service's
  // answer (`canManage`, G4), and 403 on a write takes it away for good (`lost`).
  const versionMode = mode.kind === 'version'
  const canChange = summary.canManage && !lost
  const readOnly = !canChange || versionMode
  const own = ENTITIES.find((id) => letterheads[id].canManage)

  // Leaving (design F9): "dirty" is a form that differs from its version, or an upload that has not answered.
  const dirtyNow = useRef(dirty)
  useEffect(() => {
    dirtyNow.current = dirty
  })
  const wouldLose = useCallback(
    () => dirtyNow.current || formRef.current?.querySelector('[data-asset-field][aria-busy="true"]') != null,
    [],
  )
  useEffect(() => {
    dirtyProbeRef.current = wouldLose
    return () => {
      dirtyProbeRef.current = () => false
    }
  }, [dirtyProbeRef, wouldLose])
  useEffect(() => registerBlocker(wouldLose, strings.leave.message(strings.entity[entity])), [entity, wouldLose])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!wouldLose()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [wouldLose])

  const accessLost = useCallback(() => {
    setLost(true)
    // With a version saved the list is refreshed, so `canManage` is no longer stale; with none, the page would
    // swap the form for "no letterhead yet" and the edits would vanish.
    if (version > 0) void refresh?.()
  }, [version, refresh])

  // Save (design F7).
  const flow = useSaveFlow({
    entity,
    baseVersion: version,
    config,
    onSaved: (saved, sent) => {
      problemSource.current = null
      dispatch({ type: 'problemsSet', problems: [] })
      dispatch({ type: 'saved', config: sent })
      setRefusal(null)
      setConflict(null)
      onSaved(saved, sent)
      void refresh?.({ entity, activeVersion: saved })
    },
    onRefused: (problems) => {
      problemSource.current = 'save'
      dispatch({ type: 'problemsSet', problems })
      setRefusal(problems)
      setFocusTick((tick) => tick + 1)
    },
    onConflict: (currentVersion) => setConflict({ currentVersion }),
    onLost: accessLost,
  })
  const save = () => {
    setRefusal(null)
    flow.save()
  }

  // Focus goes to the first refused control in page order, once the errors are drawn (design F7.3, AC-8.3).
  useEffect(() => {
    if (focusTick === 0 || refusal === null || formRef.current === null) return
    const first = firstRefusedControl(formRef.current, refusal)
    if (first !== null) focusControl(first)
  }, [focusTick, refusal])

  // A banner the person did not ask to see (a conflict, a failed save, a lost grant) is brought into view: the
  // button they pressed is at the bottom of a long form and the banners are at its top.
  const failed = flow.outcome.kind === 'failed'
  const hasConflict = conflict !== null
  useEffect(() => {
    if (hasConflict || failed || lost) bannersRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' })
  }, [hasConflict, failed, lost])

  // Reload after a conflict (design F7.4): the newest version replaces the form, errors and edits included.
  const reloadNewest = async () => {
    if (conflict === null || reload === 'busy') return
    setReload('busy')
    try {
      let newest = conflict.currentVersion
      if (newest === null || newest < 1) newest = (await getLetterheads())[entity].activeVersion
      if (newest === null) throw new Error('no active version')
      const answer = await getVersion(entity, newest)
      focusHeading()
      onReloaded(answer)
      void refresh?.({ entity, activeVersion: answer.version })
    } catch {
      setReload('failed')
    }
  }

  const describe = useCallback((problem: Problem) => describeProblem(problem, catalog, config), [catalog, config])
  const context = useMemo<FormContextValue>(
    () => ({
      catalog,
      dispatch,
      problemsAt: (path) => state.problems[path] ?? [],
      describeProblem: describe,
      announce,
      accessLost,
    }),
    [catalog, state.problems, describe, announce, accessLost],
  )

  // The summary stays as the save left it (it is announced once, and a list that shrinks as the person types would
  // be announced again); it goes when no value it names is marked any more, or when the next save starts.
  const summarised = useMemo(
    () => (refusal === null ? [] : [...refusal].sort((a, b) => comparePointers(a.path, b.path))),
    [refusal],
  )
  const summaryShown =
    refusal !== null &&
    refusal.some((problem) => (state.problems[problem.path] ?? []).some((marked) => marked.reason === problem.reason))
  const goTo = (path: string) => {
    const control = formRef.current === null ? null : findControl(formRef.current, path)
    if (control !== null) focusControl(control)
  }

  // The live preview of the form as it is now, saved or not (AC-8.4). Always asked for, also while the narrow
  // Drawer is closed: the refused values it reports are marked in the form, wherever the preview is shown.
  const request = usePreviewRequest({
    entity,
    config,
    language: previewLanguage,
    // An older version is drawn on the layout it was saved with (G6).
    ...(mode.kind === 'version' && mode.layoutVersion !== undefined ? { layoutVersion: mode.layoutVersion } : {}),
  })
  const previewView = describePreview(request)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { status, error } = request
  const markedByPreview = useRef(0)
  useEffect(() => {
    // A refused preview marks every refused value next to its control; one that is answered clears only what a
    // preview marked (a refused save's own problems stay until the next save or an edit of the control, T24).
    // A failed one changes nothing.
    if (status === 'failed' && error instanceof PreviewRefusedError) {
      problemSource.current = 'preview'
      dispatch({ type: 'problemsSet', problems: error.problems })
      if (error.problems.length !== markedByPreview.current)
        announce(strings.problem.previewCount(error.problems.length))
      markedByPreview.current = error.problems.length
    } else if (status === 'ready' && problemSource.current === 'preview') {
      problemSource.current = null
      markedByPreview.current = 0
      dispatch({ type: 'problemsSet', problems: [] })
    }
  }, [status, error, announce])
  const refusedByPreview = useMemo(
    () =>
      (request.lastRefusal?.problems ?? [])
        .slice()
        .sort((a, b) => comparePointers(a.path, b.path))
        .map((problem) => ({ problem, text: describe(problem) })),
    [request.lastRefusal, describe],
  )
  // From the Drawer, the control is behind it: the Drawer closes first, then focus moves.
  const goFromPreview = (path: string) => {
    if (!drawerOpen) return goTo(path)
    setDrawerOpen(false)
    requestAnimationFrame(() => goTo(path))
  }
  const pane = (className?: string, heading = false) => (
    <PreviewPane
      view={previewView}
      language={previewLanguage}
      onLanguage={onPreviewLanguage}
      onRetry={request.retry}
      problems={refusedByPreview}
      onGo={goFromPreview}
      heading={heading}
      className={className}
    />
  )

  return (
    <FormContext.Provider value={context}>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2" data-testid="letterheads-layout">
        <div
          ref={formRef}
          className="flex min-w-0 flex-col gap-4"
          data-testid="letterheads-form"
          data-entity={entity}
          data-version={version}
        >
          {versionMode && (
            <VersionBanner
              entity={entity}
              version={version}
              activeFallback={summary.activeVersion}
              canRestore={canChange}
              onBack={onBack}
              onRestored={onRestored}
              onLost={accessLost}
              onConflict={onStale}
            />
          )}
          <div ref={bannersRef} className="flex flex-col gap-4 empty:hidden">
            {conflict !== null && (
              <Banner
                tone="danger"
                live="assertive"
                title={strings.conflict.title}
                data-testid="letterheads-conflict"
                actions={
                  <Button
                    size="sm"
                    variant="secondary"
                    busy={reload === 'busy'}
                    onClick={() => void reloadNewest()}
                    data-testid="letterheads-conflict-reload"
                  >
                    {reload === 'busy' ? strings.conflict.reloading : strings.conflict.reload}
                  </Button>
                }
              >
                {strings.conflict.body}
                {reload === 'failed' && (
                  <span className="mt-2 block" role="alert" data-testid="letterheads-conflict-failed">
                    {strings.conflict.reloadFailed}
                  </span>
                )}
              </Banner>
            )}
            {lost && (
              <Banner tone="warning" live="assertive" title={strings.save.lostTitle} data-testid="letterheads-lost">
                {strings.page.readOnlyLost}
              </Banner>
            )}
            {summaryShown && view === 'settings' && (
              <ErrorSummary problems={summarised} describe={describe} onGo={goTo} />
            )}
            {flow.outcome.kind === 'failed' && (
              <Banner
                tone="danger"
                live="assertive"
                title={strings.save.failedTitle}
                data-testid="letterheads-save-failed"
                onRetry={flow.outcome.retryable ? save : undefined}
                retryLabel={strings.save.retry}
                retryTestId="letterheads-save-retry"
                onDismiss={flow.dismiss}
                dismissLabel={strings.common.dismiss}
              >
                {flow.outcome.message}
              </Banner>
            )}
          </div>
          {view === 'history' && (
            <HistoryPanel
              entity={entity}
              canRestore={canChange}
              onOpen={onOpenVersion}
              onRestored={onRestored}
              onLost={accessLost}
              wouldLose={wouldLose}
              onConflict={onStale}
            />
          )}
          {/* The History view hides the form without unmounting it: what the person typed is still there on return. */}
          <div hidden={view === 'history'}>
            <div className="flex flex-col gap-4">
              {version === 0 && summary.canManage && !lost && (
                <Banner tone="info" live="off" data-testid="letterheads-empty-banner">
                  {strings.page.emptyBanner(strings.entity[entity])}
                </Banner>
              )}
              {readOnly && !lost && !versionMode && (
                <Banner tone="info" live="off" data-testid="letterheads-readonly-banner">
                  {own === undefined ? strings.page.readOnlyAccess : strings.page.readOnlyScoped(strings.entity[own])}
                </Banner>
              )}
              <TextsHelp />
              {/* Read-only: everything that edits is inert and not shown; the help card above stays usable (design S5). */}
              <fieldset
                disabled={readOnly}
                className={`m-0 flex min-w-0 flex-col gap-4 border-0 p-0${readOnly ? ' [&_button]:hidden' : ''}`}
              >
                <PageSetupCard config={config} />
                <LookCard config={config} />
                {VARIANTS.map((variant) => (
                  <VariantCard key={variant} entity={entity} name={variant} variant={config.variants[variant]} />
                ))}
              </fieldset>
            </div>
          </div>
          <SaveBar
            dirty={dirty}
            nextVersion={version + 1}
            saving={flow.saving}
            conflict={conflict !== null}
            readOnly={readOnly || view === 'history'}
            onSave={save}
            onPreview={() => setDrawerOpen(true)}
            notice={
              flow.outcome.kind === 'saved' && (
                <Banner
                  tone="success"
                  compact
                  autoDismiss
                  dismissible={false}
                  onDismiss={flow.dismiss}
                  data-testid="letterheads-saved"
                >
                  {strings.save.saved(flow.outcome.version)}
                </Banner>
              )
            }
          />
        </div>
        {/* Wide: beside the form and sticky. Narrow: hidden, the same pane opens in the Drawer. */}
        <aside
          className="hidden min-w-0 xl:sticky xl:top-4 xl:block xl:self-start"
          data-testid="letterheads-preview-aside"
        >
          {pane('xl:max-h-[75vh]', true)}
        </aside>
      </div>
      {drawerOpen && (
        <Drawer
          title={strings.preview.title}
          closeLabel={strings.preview.close}
          onClose={() => setDrawerOpen(false)}
          testIdPrefix="letterheads-preview-drawer"
        >
          {pane('max-h-[80vh]')}
        </Drawer>
      )}
    </FormContext.Provider>
  )
}

function Group({ legend, hint, children }: { legend: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-1 text-sm font-semibold text-text">{legend}</legend>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </fieldset>
  )
}

const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-4'

/** Page setup (AC-5.1, 7.5): the four margins and the three fonts. */
function PageSetupCard({ config }: { config: FormConfig }) {
  const { catalog } = useForm()
  const { marginMm, bodyMinWidthMm, bodyMinHeightMm } = catalog.bounds
  const fonts = catalog.fonts.map((font) => ({ value: font, label: font }))
  return (
    <Card title={strings.form.setup.title} headingLevel={3}>
      <Group
        legend={strings.form.margins.legend}
        hint={strings.form.margins.hint(marginMm.min, marginMm.max, bodyMinWidthMm, bodyMinHeightMm)}
      >
        <div className={GRID}>
          <NumberField
            label={strings.form.margins.top}
            pointer={pointer('margins', 'top')}
            value={config.margins.top}
          />
          <NumberField
            label={strings.form.margins.bottom}
            pointer={pointer('margins', 'bottom')}
            value={config.margins.bottom}
          />
          <NumberField
            label={strings.form.margins.left}
            pointer={pointer('margins', 'left')}
            value={config.margins.left}
          />
          <NumberField
            label={strings.form.margins.right}
            pointer={pointer('margins', 'right')}
            value={config.margins.right}
          />
        </div>
      </Group>
      <Group legend={strings.form.fonts.legend}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SelectField
            label={strings.form.fonts.body}
            pointer={pointer('fonts', 'body')}
            value={config.fonts.body}
            options={fonts}
          />
          <SelectField
            label={strings.form.fonts.heading}
            pointer={pointer('fonts', 'heading')}
            value={config.fonts.heading}
            options={fonts}
          />
          <SelectField
            label={strings.form.fonts.frame}
            pointer={pointer('fonts', 'frame')}
            value={config.fonts.frame}
            options={fonts}
          />
        </div>
      </Group>
    </Card>
  )
}

/** Look of the document (AC-5.9): the three heading levels, the body text, tables and bulleted lists. */
function LookCard({ config }: { config: FormConfig }) {
  const { look } = config
  return (
    <Card title={strings.form.look.title} headingLevel={3}>
      {look.headings.map((heading, index) => {
        const at = pointer('look', 'headings', index)
        return (
          <Group key={index} legend={strings.form.look.heading(index + 1)}>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <NumberField
                className="w-24"
                label={strings.form.look.size}
                pointer={`${at}/size`}
                value={heading.size}
              />
              <BoolField
                className="pb-2"
                label={strings.form.look.bold}
                pointer={`${at}/bold`}
                checked={heading.bold}
              />
              <ColourField label={strings.form.look.colour} pointer={`${at}/color`} value={heading.color} />
            </div>
          </Group>
        )
      })}
      <Group legend={strings.form.look.documentTitle}>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <NumberField
            className="w-24"
            label={strings.form.look.size}
            pointer={pointer('look', 'title', 'size')}
            value={look.title.size}
          />
          <BoolField
            className="pb-2"
            label={strings.form.look.bold}
            pointer={pointer('look', 'title', 'bold')}
            checked={look.title.bold}
          />
          <ColourField
            label={strings.form.look.colour}
            pointer={pointer('look', 'title', 'color')}
            value={look.title.color}
          />
        </div>
      </Group>
      <Group legend={strings.form.look.bodyText}>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <NumberField
            className="w-24"
            label={strings.form.look.size}
            pointer={pointer('look', 'body', 'size')}
            value={look.body.size}
          />
          <NumberField
            className="w-28"
            label={strings.form.look.lineSpacing}
            pointer={pointer('look', 'body', 'lineSpacing')}
            value={look.body.lineSpacing}
          />
        </div>
      </Group>
      <Group legend={strings.form.look.table}>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <ColourField
            label={strings.form.look.headerFill}
            pointer={pointer('look', 'table', 'headerFill')}
            value={look.table.headerFill}
          />
          <BoolField
            className="pb-2"
            label={strings.form.look.borders}
            pointer={pointer('look', 'table', 'borders')}
            checked={look.table.borders}
          />
          <ColourField
            label={strings.form.look.borderColour}
            pointer={pointer('look', 'table', 'borderColor')}
            value={look.table.borderColor}
          />
        </div>
      </Group>
      <SelectField
        className="max-w-xs"
        label={strings.form.look.marker}
        pointer={pointer('look', 'bulletMarker')}
        value={look.bulletMarker}
        options={[
          { value: 'bullet', label: strings.form.look.bullet },
          { value: 'dash', label: strings.form.look.dash },
        ]}
      />
    </Card>
  )
}
