import { useCallback, useMemo, useState } from 'react'
import { Banner, Button } from '@operai/ui'
import { useResource } from '../../hooks/useResource'
import { listEntityProfiles } from '../../lib/crmApi'
import {
  sampleAnswers,
  sampleContext,
  type OfferLanguage,
  type WizardAnswers,
  type WizardContext,
} from '../../lib/offerEngine/answers'
import { parseTemplate, type TemplateAst } from '../../lib/offerEngine/syntax'
import type { Entity } from '../../lib/types'
import { strings } from '../../strings'
import OfferWizard from '../offerWizard/OfferWizard'
import { useLetterhead, type Letterhead } from '../offerWizard/useLetterhead'

const w = strings.templates.wizardEditor

export interface TryWizardViewProps {
  /** The template's entity: its profile gives the issuer's name, address and letterhead (AC-12.8, AC-12.13, AC-11.9). */
  entity: Entity
  /** The template text as typed — saved or not. */
  source: string
  /** The editor's language now, which is the document's. */
  language: OfferLanguage
  /** A text with errors cannot be tried: this takes the author back to the problem list. */
  onGoToProblems: () => void
}

/** The wizard itself, on one reading of the text with sample answers; `key`ed by its caller so a new text starts afresh. */
function TrySession({
  ast,
  language,
  issuer,
  letterhead,
}: {
  ast: TemplateAst
  language: OfferLanguage
  issuer: Issuer
  letterhead: Letterhead
}) {
  const context = useMemo<WizardContext>(
    () => ({
      ...sampleContext(language),
      ...(issuer.profile
        ? { issuerLegalName: issuer.profile.legalName, issuerAddressLines: issuer.profile.addressLines }
        : {}),
    }),
    [language, issuer.profile],
  )
  const [answers, setAnswers] = useState<WizardAnswers>(() => sampleAnswers(ast, language))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Banner tone="info" live="off" compact data-testid="crm-template-try-banner">
          {w.try.banner}
        </Banner>
        <Button size="sm" variant="secondary" onClick={() => setAnswers(sampleAnswers(ast, language))}>
          {w.try.reset}
        </Button>
      </div>
      {issuer.sampled ? (
        <Banner tone="info" live="off" compact data-testid="crm-template-try-issuer-sample">
          {w.try.issuerSample(issuer.label)}
        </Banner>
      ) : null}
      <OfferWizard
        mode="sample"
        ast={ast}
        answers={answers}
        onAnswersChange={setAnswers}
        context={context}
        letterhead={letterhead}
        // a sample name is never spoken as the supplier's: the band and notice name the entity by its badge
        {...(issuer.profile ? {} : { issuerLabel: issuer.label })}
      />
      <p className="text-xs text-soft">{w.try.noGenerate}</p>
    </div>
  )
}

/** What the view knows of the issuer: the profile's name and address, or nothing (samples), and the entity's badge label. */
type Issuer = {
  /** The template's entity profile, when it was read and its legal name is not blank; otherwise the samples print. */
  profile: { legalName: string; addressLines: string[] } | null
  /** The profile read is over and gave nothing usable: the note says the supplier's name and address are samples. */
  sampled: boolean
  label: string
}

/**
 * The editor's "Try the wizard" view (design S13; AC-8.5): the real wizard in `sample` mode on the text being
 * edited, with the sample context of the editor's language and sample answers. There is no deal and no draft: the
 * answers live in this component, nothing is saved, and Generate does not exist. The only reads are the entity
 * profiles list, once per mount (the issuer's name and address, DD-62), and the letterhead through the one attempt of
 * `useLetterhead` (AC-11.9). They are made here, above the keyed session, so a changed text never repeats them.
 * The view renders at once on the sample issuer; the note appears only once the read has settled with nothing
 * usable, because one shown while it runs would say something untrue (D-28).
 */
export default function TryWizardView({ entity, source, language, onGoToProblems }: TryWizardViewProps) {
  const loadProfiles = useCallback((signal: AbortSignal) => listEntityProfiles({ signal }), [])
  const profiles = useResource(loadProfiles)
  const reading = profiles.status === 'loading'
  const row = profiles.status === 'ready' ? (profiles.data?.items.find((item) => item.entity === entity) ?? null) : null
  const named = row !== null && row.legalName.trim() !== ''
  const issuer: Issuer = {
    profile: named ? { legalName: row.legalName, addressLines: row.addressLines } : null,
    sampled: !reading && !named,
    label: strings.badges.entity[entity],
  }
  // `null` keeps the attempt pending until the read answers (G11); a profile that cannot be read gives the failure band
  // (AC-11.9: never an error), not a wait that never ends
  const attempt = useLetterhead({ entity, present: row ? row.letterhead !== null : null })
  const letterhead: Letterhead = !reading && row === null ? { state: 'failed', request: attempt.request } : attempt
  const parsed = useMemo(() => parseTemplate(source), [source])
  const errors = parsed.problems.filter((problem) => problem.severity === 'error').length
  if (errors > 0)
    return (
      <Banner
        tone="warning"
        actions={
          <Button size="sm" variant="secondary" onClick={onGoToProblems}>
            {w.try.goProblems}
          </Button>
        }
        data-testid="crm-template-try-blocked"
      >
        {w.try.blocked(errors)}
      </Banner>
    )
  return (
    <TrySession
      key={`${language}:${source}`}
      ast={parsed.ast}
      language={language}
      issuer={issuer}
      letterhead={letterhead}
    />
  )
}
