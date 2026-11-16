import { useCallback, useId, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  StatePanel,
  VisuallyHidden,
  buttonClassName,
  resolveLocale,
} from '@operai/ui'
import { listOfferTemplatesOf } from '../../lib/crmApi'
import { offerFailure } from '../../lib/offerErrors'
import type {
  ClassicTemplateRow,
  Deal,
  Offer,
  OfferLanguage,
  OfferTemplateRow,
  WizardContextResponse,
  WizardTemplate,
} from '../../lib/types'
import { useCrmCapabilities } from '../../hooks/scopeContext'
import { useResource } from '../../hooks/useResource'
import { strings } from '../../strings'
import GenerateOfferDialog from '../GenerateOfferDialog'
import { LoadFailure, Loading } from '../LoadState'

const t = strings.offerWizard

const MAX_USES = 6

/** The offer the step was entered to continue in the wizard: a classic one (AC-7.3), or a wizard one whose template was archived (DD-28). */
export interface TemplateTarget {
  reference: string
  reason: 'legacy' | 'archived'
}

export interface TemplateStepProps {
  deal: Deal
  /** The context route's estimate state: `missing` blocks every card (AC-2.4), `override` only says figures are unavailable. */
  estimateState: 'ready' | 'override' | 'missing'
  /** The deal's newest offer: unsent, a new offer cannot start before it is sent or deleted (018 AC-7.1). */
  latestOffer: WizardContextResponse['latestOffer']
  /** Set when the step was entered with a target (`?target=`): the unsent-offer notice does not apply then. */
  target: TemplateTarget | null
  /** The draft's template, when a draft exists: its card is marked and choosing another asks first (AC-6.5). */
  currentTemplateId: string | null
  /**
   * What choosing a template does: create the draft, or switch it. Rejects with the request's failure, which the
   * step shows (on the card, or in the confirmation of a switch); resolves once it is done.
   */
  onChoose: (template: WizardTemplate) => Promise<void>
  /** "Edit it instead" on the unsent-offer notice. */
  onEditLatest: () => void
  /** A classic offer was generated through the legacy dialog. */
  onClassicGenerated: (offer: Offer) => void
}

const isWizard = (row: OfferTemplateRow): row is WizardTemplate => row.format === 'wizard'

/**
 * The Template step (design S2; AC-1.1, AC-2.4, AC-6.5, AC-7.3, DD-9): the entity's active wizard templates as cards
 * grouped by language; below them the classic templates of a language that has none, which open the 018 form
 * unchanged. A new offer needs a ready estimate (or an admin's override) and no unsent newest offer; both leave the
 * cards `aria-disabled`, reachable, with the reason in their description. With a draft, choosing another template
 * asks first: the answers specific to the template are replaced, the client block is kept (the hook does that).
 */
export default function TemplateStep({
  deal,
  estimateState,
  latestOffer,
  target,
  currentTemplateId,
  onChoose,
  onEditLatest,
  onClassicGenerated,
}: TemplateStepProps) {
  const { entity } = deal
  const entityLabel = strings.badges.entity[entity]
  const { canManageDealsOf } = useCrmCapabilities()
  const load = useCallback(
    (signal: AbortSignal) => listOfferTemplatesOf(entity, false, 'sections,wizard', { signal }),
    [entity],
  )
  const templates = useResource(load)

  const baseId = useId()
  const estimateId = `${baseId}-estimate`
  const unsentId = `${baseId}-unsent`

  const [startingId, setStartingId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [switching, setSwitching] = useState<WizardTemplate | null>(null)
  const [switchBusy, setSwitchBusy] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [switched, setSwitched] = useState<string | null>(null)
  const [classicOpen, setClassicOpen] = useState(false)

  const unsent = target === null && latestOffer !== null && !latestOffer.sent
  const blockedBy = [estimateState === 'missing' ? estimateId : null, unsent ? unsentId : null].filter(
    (id): id is string => id !== null,
  )
  const blocked = blockedBy.length > 0

  const groups = useMemo(() => {
    const items = templates.data?.items ?? []
    const wizard = items.filter((row): row is WizardTemplate => isWizard(row) && !row.archived)
    const wizardLanguages = new Set(wizard.map((row) => row.language))
    const classic = items.filter(
      (row): row is ClassicTemplateRow => !isWizard(row) && !row.archived && !wizardLanguages.has(row.language),
    )
    const preferred = resolveLocale()
    const order = (languages: Iterable<OfferLanguage>) =>
      [...new Set(languages)].sort((a, b) => Number(b === preferred) - Number(a === preferred))
    return {
      languages: order(wizard.map((row) => row.language)),
      wizard,
      classic: [...classic].sort((a, b) => a.name.localeCompare(b.name)),
    }
  }, [templates.data])

  const choose = (template: WizardTemplate) => {
    if (blocked || startingId !== null) return
    setStartError(null)
    setSwitched(null)
    if (currentTemplateId !== null && currentTemplateId !== template.id) {
      setSwitchError(null)
      setSwitching(template)
      return
    }
    setStartingId(template.id)
    onChoose(template).then(
      () => setStartingId(null),
      (failure: unknown) => {
        setStartingId(null)
        setStartError(offerFailure(failure))
      },
    )
  }

  const confirmSwitch = () => {
    if (switching === null) return
    const template = switching
    setSwitchBusy(true)
    setSwitchError(null)
    onChoose(template).then(
      () => {
        setSwitchBusy(false)
        setSwitching(null)
        setSwitched(t.template.switch.done(template.name))
      },
      (failure: unknown) => {
        setSwitchBusy(false)
        setSwitchError(offerFailure(failure))
      },
    )
  }

  if (templates.status === 'loading') return <Loading label={t.page.loading} rows={3} />
  if (templates.status === 'error') return <LoadFailure error={templates.error} onRetry={templates.retry} />

  const empty = groups.wizard.length === 0 && groups.classic.length === 0
  const uiLanguage = resolveLocale()
  const describedBy = blocked ? blockedBy.join(' ') : undefined

  return (
    <div className="flex flex-col gap-4" data-testid="crm-wizard-template-step">
      {target ? (
        <Banner tone="info" data-testid="crm-wizard-template-target">
          {target.reason === 'legacy' ? t.target.legacy(target.reference) : t.target.archived(target.reference)}
        </Banner>
      ) : null}
      {estimateState === 'missing' ? (
        <Banner
          id={estimateId}
          tone="warning"
          live="polite"
          data-testid="crm-wizard-estimate-missing"
          actions={
            <Link
              to="/deals/$id"
              params={{ id: deal.id }}
              className={buttonClassName({ variant: 'secondary', size: 'sm' })}
            >
              {t.estimate.go}
            </Link>
          }
        >
          {t.estimate.missing}
        </Banner>
      ) : null}
      {estimateState === 'override' ? (
        <Banner tone="info" compact data-testid="crm-wizard-estimate-override">
          {t.estimate.override}
        </Banner>
      ) : null}
      {unsent ? (
        <Banner
          id={unsentId}
          tone="info"
          data-testid="crm-wizard-unsent"
          actions={
            <Button size="sm" onClick={onEditLatest}>
              {t.unsent.editInstead}
            </Button>
          }
        >
          {t.unsent.body(latestOffer.reference)}
        </Banner>
      ) : null}
      {startError ? (
        <Banner tone="danger" data-testid="crm-wizard-template-error">
          {startError}
        </Banner>
      ) : null}
      <VisuallyHidden live role="status">
        {switched ?? ''}
      </VisuallyHidden>

      {empty ? (
        <StatePanel
          headingLevel={4}
          title={t.template.empty.title(entityLabel)}
          testId="crm-wizard-template-empty"
          action={
            canManageDealsOf(entity) ? (
              <Link to="/settings" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
                {t.template.openSettings}
              </Link>
            ) : undefined
          }
        >
          {t.template.empty.body}
        </StatePanel>
      ) : null}

      {groups.languages.map((language) => (
        <LanguageGroup key={language} heading={t.template.heading(strings.offers.languageName[language])}>
          {groups.wizard
            .filter((template) => template.language === language)
            .map((template) => {
              const current = template.id === currentTemplateId
              const starting = startingId === template.id
              const lang = template.language !== uiLanguage ? template.language : undefined
              return (
                <Card
                  key={template.id}
                  headingLevel={4}
                  title={template.name}
                  data-testid={`crm-wizard-template-${template.id}`}
                  action={
                    current ? (
                      <Badge tone="accent">{t.template.current}</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        busy={starting}
                        aria-label={t.template.useOf(template.name)}
                        aria-disabled={blocked || (startingId !== null && !starting) || undefined}
                        aria-describedby={describedBy}
                        onClick={() => choose(template)}
                      >
                        {starting ? t.template.starting : t.template.use}
                      </Button>
                    )
                  }
                >
                  <div className="flex flex-col gap-2">
                    {template.description ? (
                      <p lang={lang} className="text-sm text-soft">
                        {template.description}
                      </p>
                    ) : null}
                    {template.uses.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-2xs text-soft">{t.template.uses}</span>
                        <ul lang={lang} className="m-0 flex list-none flex-wrap gap-1 p-0">
                          {template.uses.slice(0, MAX_USES).map((use) => (
                            <li key={use}>
                              <Badge>{use}</Badge>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </Card>
              )
            })}
        </LanguageGroup>
      ))}

      {groups.classic.length > 0 ? (
        <Card headingLevel={4} title={t.template.classic.title} data-testid="crm-wizard-template-classic">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-soft">{t.template.classic.intro}</p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {groups.classic.map((template) => (
                <li key={template.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2 text-sm text-text">
                    <span>{template.name}</span>
                    <Badge>{strings.offers.languageName[template.language]}</Badge>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={t.template.classic.useOf(template.name)}
                    aria-disabled={blocked || undefined}
                    aria-describedby={describedBy}
                    onClick={() => (blocked ? undefined : setClassicOpen(true))}
                  >
                    {t.template.classic.use}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}

      {switching ? (
        <ConfirmDialog
          title={t.template.switch.title}
          confirmLabel={t.template.switch.confirm}
          busyLabel={t.template.switch.busy}
          cancelLabel={strings.common.cancel}
          closeLabel={strings.common.close}
          busy={switchBusy}
          error={switchError}
          onConfirm={confirmSwitch}
          onCancel={() => setSwitching(null)}
          testIdPrefix="crm-wizard-switch"
        >
          {t.template.switch.body(switching.name)}
        </ConfirmDialog>
      ) : null}

      {classicOpen ? (
        <GenerateOfferDialog
          deal={deal}
          onCancel={() => setClassicOpen(false)}
          onGenerated={(offer) => {
            setClassicOpen(false)
            onClassicGenerated(offer)
          }}
        />
      ) : null}
    </div>
  )
}

/** One language's cards under their heading: a labelled region, so the group is named by its heading. */
function LanguageGroup({ heading, children }: { heading: string; children: React.ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="@container flex flex-col gap-3">
      <h4 id={id} className="font-disp text-sm text-text">
        {heading}
      </h4>
      {/* by the width of this column (a container query), not the screen's: beside the preview the column is half as wide */}
      <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">{children}</div>
    </section>
  )
}
