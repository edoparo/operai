import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Badge, Drawer, Icon, Tabs, VisuallyHidden, tabPanelProps } from '@operai/ui'
import type { WizardAnswers, WizardContext } from '../../lib/offerEngine/answers'
import { outline as outlineOf, type Outline, type OutlineItem } from '../../lib/offerEngine/outline'
import { resolveOffer, type InvalidCode, type ResolvedOffer } from '../../lib/offerEngine/resolve'
import type { TemplateAst } from '../../lib/offerEngine/syntax'
import { useCrmCapabilities } from '../../hooks/scopeContext'
import { strings } from '../../strings'
import DocumentPreview, { type EffortAnnexPreview } from './DocumentPreview'
import ServicePreview from './ServicePreview'
import StepPanel, { type StepPanelProps } from './StepPanel'
import type { TemplateStepProps } from './TemplateStep'
import type { Letterhead } from './useLetterhead'
import { useServicePreview, type ServicePreviewSource } from './useServicePreview'
import WizardActionBar from './WizardActionBar'
import { issueCounts, wizardSteps, type WizardMode, type WizardStep } from './steps'
import { useWideViewport } from './useWideViewport'
import type { ValidityEntry } from './validityEntry'

const t = strings.offerWizard

const ID_PREFIX = 'offer-wizard'

const everyItem = (items: readonly OutlineItem[]): OutlineItem[] =>
  items.flatMap((item) => (item.type === 'block' ? [item, ...everyItem(item.children)] : [item]))

/** Whether the validity control the entry came from is still in the outline (a template or a switch may have removed it). */
function entryHasControl(outline: Outline, entry: ValidityEntry): boolean {
  const bound = outline.steps
    .flatMap((step) => everyItem(step.items))
    .filter((item) => item.type === 'field' && item.system === 'validityDays' && !item.derived)
  return entry.name === 'validityDays'
    ? bound.length === 0 && outline.steps.some((step) => step.key === 'costs')
    : bound.some((item) => item.type === 'field' && item.name === entry.name)
}

/**
 * The engine's issues plus the validity the person typed that is not a valid number of days (the answers cannot hold
 * it): an empty entry is a missing answer, any other an invalid one, both naming the control (AC-3.5, AC-3.6).
 */
function withValidityEntry(resolved: ResolvedOffer, entry: ValidityEntry | null): ResolvedOffer {
  if (entry === null) return resolved
  const issue = { name: entry.name, label: entry.label, step: entry.step }
  if (entry.reason === 'empty') return { ...resolved, missing: [...resolved.missing, issue] }
  // the engine's codes are a closed set shared with the server; this one is the wizard's own, with its own reason text
  return { ...resolved, invalid: [...resolved.invalid, { ...issue, code: entry.reason as InvalidCode }] }
}

export interface OfferWizardProps {
  /** `deal`: the page's wizard on a draft. `sample`: the editor's Try view — no deal, no Template step, no Generate. */
  mode: WizardMode
  ast: TemplateAst
  answers: WizardAnswers
  /** Receives the next answers; the wizard never mutates `answers`. */
  onAnswersChange: (next: WizardAnswers) => void
  context: WizardContext
  /** The current step when the page owns it (`?step=`); omit and the wizard keeps its own. */
  step?: WizardStep
  onStepChange?: (step: WizardStep) => void
  /** The whole form is read-only (conflict, gone draft, archived template, no manage right); steps and the bar still work. */
  readOnly?: boolean
  onGenerate?: () => void
  generating?: boolean
  /** A reason beyond the answers that stops Generate (no ready estimate); shown beside it. */
  generateBlockedReason?: string
  /** Told when the narrow screens' Preview button opens the preview drawer (the wizard owns the preview itself). */
  onOpenPreview?: () => void
  /** The effort-detail annex's figures for the offer's language and the AI-assisted choice, for the preview. */
  effortAnnex?: EffortAnnexPreview | null
  /** What the Client step says about the reference instead of "assigned when the offer is generated". */
  referenceNote?: string
  /** A 422 `offer_incomplete` body as the server sent it: the Preview step lists it instead of its own issues. */
  serverIssues?: StepPanelProps['serverIssues']
  /** The Preview step's issues heading, which the page focuses when a Generate is refused. */
  issuesHeadingRef?: StepPanelProps['issuesHeadingRef']
  /** Saves answers before the hand-edit dialog closes (see `StepPanelProps.commitAnswers`). */
  commitAnswers?: StepPanelProps['commitAnswers']
  /** The draft's template name, shown in the Preview step's deal context line (deal mode). */
  templateName?: string
  /** The Template step's inputs (deal mode); the step shows nothing without them. */
  templateStep?: TemplateStepProps
  /**
   * The page's one letterhead attempt (`useLetterhead`), drawn by the inline pane and by the Drawer alike (AC-11.6, D-32).
   * Absent, the previews have no letterhead layer.
   */
  letterhead?: Letterhead
  /**
   * What the service path asks the layout service with (specs/20261116-letterhead-service F12, F15). Used only when the CRM's
   * `letterheadService` is on, in deal mode (a deal's draft) or sample mode (the editor's Try view, through try-preview):
   * then the pane and the Drawer show the service's pages and `letterhead` is not read. Off or absent, the browser-drawn
   * preview is what the wizard shows, as before.
   */
  servicePreview?: ServicePreviewSource
  /** The issuer's name in the preview's band and notice when the context's legal name is blank (AC-12.7). */
  issuerLabel?: string
  /**
   * The page gives the wizard the whole height of the content scroller (owner D20): at `xl` the form column and the
   * preview pane scroll on their own, so the page, its title, the step tabs and the action bar never scroll away. Off
   * (the template editor's Try view) the page scrolls and the pane sticks beside the form, sized by `useFitToScrollport`.
   */
  fill?: boolean
  /** Replaces the dispatch for the step panel — a test seam; every real step is a case of `StepPanel`. */
  renderStep?: (props: StepPanelProps) => ReactNode
}

/**
 * The offer wizard's frame (design S1; AC-1.2, AC-1.6, AC-3.5): the step tabs, the step panel and the action
 * bar, over answers the parent owns. Everything it shows is derived from the engine on every render: the steps
 * from `outline(ast, answers)`, the counts and Generate's state from `resolveOffer`. Moving between steps writes
 * nothing; the answers are the only state that matters.
 */
export default function OfferWizard({
  mode,
  ast,
  answers,
  onAnswersChange,
  context,
  step,
  onStepChange,
  readOnly = false,
  onGenerate,
  generating = false,
  generateBlockedReason,
  onOpenPreview,
  effortAnnex,
  referenceNote,
  serverIssues,
  issuesHeadingRef,
  commitAnswers,
  templateStep,
  templateName,
  letterhead,
  servicePreview,
  issuerLabel,
  fill: fillRequested = false,
  renderStep,
}: OfferWizardProps) {
  const outline = useMemo(() => outlineOf(ast, answers), [ast, answers])
  const [validityState, setValidityState] = useState<{ ast: typeof ast; entry: ValidityEntry | null }>({
    ast,
    entry: null,
  })
  // another template has other controls: an entry belongs to the one it was typed in
  const validityEntry =
    validityState.ast === ast && validityState.entry !== null && entryHasControl(outline, validityState.entry)
      ? validityState.entry
      : null
  const resolved = useMemo(
    () => withValidityEntry(resolveOffer(ast, answers, context), validityEntry),
    [ast, answers, context, validityEntry],
  )
  const steps = useMemo(() => wizardSteps(outline, mode, context), [outline, mode, context])
  const counts = useMemo(() => issueCounts(resolved), [resolved])

  const wide = useWideViewport()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const showDrawer = drawerOpen && !wide
  // the same breakpoint as the pane itself: below it the page scrolls as it always did (Drawer, 200 % zoom)
  const fill = wide && fillRequested

  const [own, setOwn] = useState<WizardStep | null>(null)
  // "Discount as: Percent" with no value yet is not an answer the draft can hold; it is kept here (see StepPanelProps)
  const [percentState, setPercentState] = useState<{ ast: typeof ast; chosen: ReadonlySet<string> }>({
    ast,
    chosen: new Set(),
  })
  // another template has other lines: the choices of the first are not the new one's
  const percentChosen = percentState.ast === ast ? percentState.chosen : new Set<string>()
  const requested = step ?? own ?? steps[0]!
  // a step the template no longer asks for (an option switched off) falls back to the Client step
  const current: WizardStep = steps.includes(requested) ? requested : 'client'
  const index = steps.indexOf(current)

  // The path is chosen here, once (design § Which path the UI takes): both slots below follow it, and the old preview is
  // never asked about the switch. Absent, `false` or not yet loaded is the old path.
  const { letterheadService } = useCrmCapabilities()
  // both modes: a deal's draft, and the template editor's Try view (AC-10.14); the view gives no source when it cannot ask
  const serviceSource = letterheadService ? servicePreview : undefined
  // a preview is on screen to keep up to date: the wide pane after the Template step, the Drawer while it is open
  const service = useServicePreview({
    source: serviceSource,
    answers,
    asking: wide ? current !== 'template' : showDrawer,
  })
  const issuer = issuerLabel ?? context.issuerLegalName
  const addressUnset =
    resolved.systemRead.includes('issuerAddress') && context.issuerAddressLines.every((line) => line.trim() === '')
  const previewOf = (slot: { heading: boolean; fit?: boolean; fill?: boolean }) =>
    serviceSource ? (
      <ServicePreview
        preview={service}
        entity={serviceSource.entity}
        language={context.language}
        missing={counts.missing}
        addressUnset={addressUnset}
        issuer={issuer}
        heading={slot.heading}
        fill={slot.fill ?? false}
      />
    ) : (
      <DocumentPreview
        ast={ast}
        answers={answers}
        context={context}
        effortAnnex={effortAnnex}
        letterhead={letterhead}
        issuerLabel={issuerLabel}
        heading={slot.heading}
        {...(slot.fit !== undefined ? { fit: slot.fit } : {})}
        {...(slot.fill !== undefined ? { fill: slot.fill } : {})}
      />
    )

  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusHeading = useRef(false)
  useEffect(() => {
    if (focusHeading.current) {
      focusHeading.current = false
      headingRef.current?.focus()
    }
  }, [current])

  const goTo = (next: WizardStep) => {
    setOwn(next)
    onStepChange?.(next)
  }
  // Back and Next move focus to the new panel's heading; a tab keeps focus on itself (design § Accessibility)
  const move = (to: number) => {
    const next = steps[to]
    if (next === undefined) return
    focusHeading.current = true
    goTo(next)
  }

  const intro = (t.steps.intro as Partial<Record<WizardStep, string>>)[current]
  const panelProps: StepPanelProps = {
    step: current,
    mode,
    ast,
    answers,
    onAnswersChange,
    context,
    outline,
    resolved,
    onGoToStep: goTo,
    percentChosen,
    onPercentChosen: (chosen) => setPercentState({ ast, chosen }),
    validityEntry,
    onValidityEntry: (entry) => setValidityState({ ast, entry }),
    referenceNote,
    serverIssues,
    issuesHeadingRef,
    commitAnswers,
    templateStep,
    ...(mode === 'deal'
      ? {
          generate: {
            ...(onGenerate ? { onGenerate } : {}),
            generating,
            missing: counts.missing,
            invalid: counts.invalid,
            ...(generateBlockedReason !== undefined ? { blockedReason: generateBlockedReason } : {}),
          },
          ...(templateName !== undefined ? { templateName } : {}),
        }
      : {}),
  }

  return (
    <div className={`flex flex-col gap-4${fill ? ' min-h-0 flex-1' : ''}`} data-testid="offer-wizard">
      <Tabs
        label={t.steps.label}
        idPrefix={ID_PREFIX}
        value={current}
        onChange={goTo}
        tabs={steps.map((id) => {
          const count = counts.byStep[id] ?? 0
          return {
            id,
            label: (
              <span className="inline-flex items-center gap-2">
                <span>{t.steps[id]}</span>
                {count > 0 ? (
                  <>
                    <Badge tone="warning" glyph={<Icon name="alert" />}>
                      {count}
                    </Badge>
                    <VisuallyHidden>{t.steps.count(count)}</VisuallyHidden>
                  </>
                ) : null}
              </span>
            ),
          }
        })}
      />
      <div
        className={
          fill
            ? 'grid min-h-0 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-6'
            : wide
              ? 'grid grid-cols-2 items-start gap-6'
              : undefined
        }
        data-testid="offer-wizard-body"
      >
        <div
          {...tabPanelProps(ID_PREFIX, current)}
          // the form column scrolls on its own; the small negative margin and padding keep a focus ring at its edge from being clipped.
          // `relative` makes it the containing block of the absolutely positioned helpers inside the form (a visually-hidden
          // legend or file input, a hidden live text): without it they belong to the shell frame, escape this scroller's clip and
          // lengthen `<main>` (QE D21, the same class as D19)
          className={`flex min-w-0 flex-col gap-4${fill ? ' relative -m-1 min-h-0 overflow-y-auto overscroll-contain p-1 [scrollbar-gutter:stable]' : ''}`}
          data-testid="offer-wizard-form"
        >
          <div>
            <h3 ref={headingRef} tabIndex={-1} className="font-disp text-base text-text">
              {t.steps[current]}
            </h3>
            {intro ? <p className="text-sm text-soft">{intro}</p> : null}
          </div>
          <fieldset
            disabled={readOnly && current !== 'template'}
            className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
          >
            {renderStep ? renderStep(panelProps) : <StepPanel {...panelProps} />}
          </fieldset>
        </div>
        {wide ? (
          <aside
            className={fill ? 'flex min-h-0 min-w-0 flex-col' : 'sticky top-4 min-w-0'}
            data-testid="offer-wizard-pane"
          >
            {previewOf({ heading: true, fit: !fill, fill })}
          </aside>
        ) : null}
      </div>
      <WizardActionBar
        position={index + 1}
        total={steps.length}
        stepName={t.steps[current]}
        onBack={() => move(index - 1)}
        onNext={index < steps.length - 1 ? () => move(index + 1) : undefined}
        showGenerate={mode === 'deal' && current === 'preview'}
        onGenerate={onGenerate}
        generating={generating}
        missing={counts.missing}
        invalid={counts.invalid}
        blockedReason={generateBlockedReason}
        onOpenPreview={
          wide
            ? undefined
            : () => {
                setDrawerOpen(true)
                onOpenPreview?.()
              }
        }
      />
      {showDrawer ? (
        <Drawer
          title={t.preview.drawerTitle}
          closeLabel={strings.common.close}
          onClose={() => setDrawerOpen(false)}
          testIdPrefix="crm-wizard-preview-drawer"
        >
          {previewOf({ heading: false })}
        </Drawer>
      ) : null}
    </div>
  )
}
