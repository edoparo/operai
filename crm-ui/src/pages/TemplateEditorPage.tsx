import { useCallback, useId, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Banner, Button, Card, Field, Icon, PageHeader, focusFirstInvalid } from '@operai/ui'
import { CostColumnSwitches, TemplateCostLinesEditor } from '../components/CostLinesEditor'
import { LoadFailure, Loading, Saved, StaleWriteBanner } from '../components/LoadState'
import MarkupHelp from '../components/MarkupHelp'
import SectionsEditor from '../components/SectionsEditor'
import { ApiError, isStaleWrite } from '../lib/api'
import { createOfferTemplate, getOfferTemplate, updateOfferTemplate } from '../lib/crmApi'
import type { OfferTemplateInput } from '../lib/crmApi'
import { codeOf, errorMessage, fieldErrorOf } from '../lib/errors'
import {
  LIMITS,
  blankSection,
  blankTemplateLine,
  checkSections,
  checkTemplateLines,
  linesValid,
  sectionsValid,
  templateLineToDraft,
  templateLineToWire,
} from '../lib/offerRules'
import type { TemplateLineDraft } from '../lib/offerRules'
import { ENTITIES } from '../lib/types'
import type { CostColumns, Entity, OfferLanguage, OfferSection, OfferTemplate } from '../lib/types'
import { first, maxLength, optional, required } from '../lib/validate'
import { useCrmCapabilities } from '../hooks/scopeContext'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'

type FieldErrors = Partial<Record<'name' | 'salutation' | 'opening' | 'acceptance', string>>

const BackLink = () => (
  <Link to="/settings" className="link" data-testid="crm-template-back">
    <Icon name="arrow-left" /> {strings.templates.editor.back}
  </Link>
)

/**
 * TemplateEditor — one offer template as a full page (specs/20261102-crm-offer-document US-2): texts,
 * the section list, the default cost lines with the table columns and the
 * annex switch. The same client rules as the server (`lib/offerRules`). A save
 * carries the template's version as If-Match; a stale answer shows the reload
 * banner and keeps what was typed until the person reloads.
 */
function TemplateEditor({
  entity,
  template,
  onSaved,
  onReload,
}: {
  entity: Entity
  template: OfferTemplate | null
  onSaved: (template: OfferTemplate) => void
  onReload: () => void
}) {
  const t = strings.templates.editor
  const titleId = useId()
  const navigate = useNavigate()
  const { canManageDealsOf } = useCrmCapabilities()
  const readOnly = !canManageDealsOf(entity) || template?.archived === true
  const fieldsRef = useRef<HTMLDivElement>(null)

  const [name, setName] = useState(template?.name ?? '')
  const [language, setLanguage] = useState<OfferLanguage>(template?.language ?? 'it')
  const [salutation, setSalutation] = useState(template?.salutation ?? '')
  const [opening, setOpening] = useState(template?.opening ?? '')
  const [sections, setSections] = useState<OfferSection[]>(template?.sections ?? [{ ...blankSection(), costs: true }])
  const [lines, setLines] = useState<TemplateLineDraft[]>(
    template ? template.costLines.map(templateLineToDraft) : [blankTemplateLine()],
  )
  const [columns, setColumns] = useState<CostColumns>(template?.costColumns ?? { position: true, unit: false })
  const [showTotal, setShowTotal] = useState(template?.showTotal ?? false)
  const [acceptance, setAcceptance] = useState(template?.acceptanceLabel ?? '')
  const [annex, setAnnex] = useState(template?.annex ?? false)

  const [validated, setValidated] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const sectionsCheck = checkSections(sections)
  const linesCheck = checkTemplateLines(lines, columns)

  const setColumnsAndFixQuantities = (next: CostColumns) => {
    setColumns(next)
    // Without the unit columns every quantity is 1 (and "man-days" is a quantity).
    if (!next.unit) setLines(lines.map((line) => ({ ...line, quantity: '1', quantityMode: 'number' })))
  }

  const validate = (): FieldErrors => ({
    name: first(required(name), maxLength(name, LIMITS.name)) ?? undefined,
    salutation: first(required(salutation), maxLength(salutation, LIMITS.salutation)) ?? undefined,
    opening: first(required(opening), maxLength(opening, LIMITS.opening)) ?? undefined,
    acceptance: maxLength(acceptance, LIMITS.acceptance) ?? undefined,
  })

  const submit = () => {
    const found = validate()
    setErrors(found)
    setValidated(true)
    setError(null)
    setSaved(null)
    if (Object.values(found).some(Boolean) || !sectionsValid(sectionsCheck) || !linesValid(linesCheck)) {
      setError(t.fixErrors)
      requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
      return
    }
    const input: OfferTemplateInput = {
      name: name.trim(),
      language,
      salutation: salutation.trim(),
      opening: opening.trim(),
      sections: sections.map((section) => ({ ...section, heading: section.heading.trim() })),
      costLines: lines.map(templateLineToWire),
      costColumns: columns,
      showTotal,
      acceptanceLabel: optional(acceptance),
      annex,
    }
    setBusy(true)
    const request = template
      ? updateOfferTemplate(template.id, template.version, input)
      : createOfferTemplate(entity, input)
    request.then(
      (next) => {
        setBusy(false)
        if (template) {
          setSaved(t.saved)
          onSaved(next)
        } else {
          void navigate({ to: '/settings/templates/$templateId', params: { templateId: next.id } })
        }
      },
      (failure: unknown) => {
        setBusy(false)
        if (isStaleWrite(failure)) return setStale(true)
        if (failure instanceof ApiError && failure.code === 'template_name_taken') {
          setErrors({ name: t.errors.nameTaken })
          requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
          return
        }
        if (codeOf(failure) === 'template_archived') return setError(t.errors.archived)
        if (codeOf(failure) === 'out_of_scope') return setError(t.errors.outOfScope)
        const field = fieldErrorOf(failure)
        setError(field ? field.message : errorMessage(failure))
      },
    )
  }

  const label = strings.badges.entity[entity]
  return (
    <section aria-labelledby={titleId} data-testid="crm-template-page">
      <PageHeader
        title={template ? t.editHeading(template.name) : t.newHeading}
        titleId={titleId}
        description={t.description(label)}
        back={<BackLink />}
        actions={
          !readOnly && (
            <Button variant="primary" busy={busy} onClick={submit} data-testid="crm-template-save">
              {busy ? t.saving : template ? t.save : t.create}
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-4">
        {stale && <StaleWriteBanner onReload={onReload} />}
        {saved && <Saved message={saved} onDismiss={() => setSaved(null)} />}
        {!canManageDealsOf(entity) && <Banner tone="info">{t.readOnly}</Banner>}
        {template?.archived && <Banner tone="info">{t.archivedNotice}</Banner>}
        {error && (
          <Banner tone="danger" data-testid="crm-template-error">
            {error}
          </Banner>
        )}
        <div ref={fieldsRef} className="flex flex-col gap-4">
          <fieldset disabled={readOnly || busy} className="contents">
            <Card title={t.sectionTexts}>
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t.fields.name} required error={errors.name} testId="crm-template-name">
                    {(control) => <input {...control} value={name} onChange={(event) => setName(event.target.value)} />}
                  </Field>
                  <Field label={t.fields.language} testId="crm-template-language">
                    {(control) => (
                      <select
                        {...control}
                        value={language}
                        onChange={(event) => setLanguage(event.target.value as OfferLanguage)}
                      >
                        {(['it', 'en'] as const).map((option) => (
                          <option key={option} value={option}>
                            {strings.offers.languageName[option]}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                </div>
                <Field
                  label={t.fields.salutation}
                  hint={t.fields.salutationHint}
                  required
                  error={errors.salutation}
                  testId="crm-template-salutation"
                >
                  {(control) => (
                    <input {...control} value={salutation} onChange={(event) => setSalutation(event.target.value)} />
                  )}
                </Field>
                <Field
                  label={t.fields.opening}
                  hint={t.fields.openingHint}
                  required
                  error={errors.opening}
                  testId="crm-template-opening"
                >
                  {(control) => (
                    <textarea
                      {...control}
                      rows={5}
                      value={opening}
                      onChange={(event) => setOpening(event.target.value)}
                    />
                  )}
                </Field>
                <MarkupHelp />
              </div>
            </Card>
            <Card title={t.sectionsCard}>
              <SectionsEditor
                sections={sections}
                onChange={setSections}
                check={validated ? sectionsCheck : undefined}
                disabled={readOnly || busy}
                testIdPrefix="crm-template"
              />
            </Card>
            <Card title={t.costsCard}>
              <div className="flex flex-col gap-4">
                <TemplateCostLinesEditor
                  lines={lines}
                  onChange={setLines}
                  check={validated ? linesCheck : undefined}
                  unitColumns={columns.unit}
                  disabled={readOnly || busy}
                />
                <CostColumnSwitches
                  columns={columns}
                  showTotal={showTotal}
                  onColumns={setColumnsAndFixQuantities}
                  onShowTotal={setShowTotal}
                  disabled={readOnly || busy}
                  testIdPrefix="crm-template-cost"
                />
                <Field
                  label={t.fields.acceptanceLabel}
                  hint={t.fields.acceptanceHint}
                  error={errors.acceptance}
                  testId="crm-template-acceptance"
                >
                  {(control) => (
                    <input {...control} value={acceptance} onChange={(event) => setAcceptance(event.target.value)} />
                  )}
                </Field>
                <label className="flex items-start gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={annex}
                    onChange={(event) => setAnnex(event.target.checked)}
                    data-testid="crm-template-annex"
                  />
                  <span>
                    {t.fields.annex}
                    <span className="block text-xs text-soft">{t.fields.annexHint}</span>
                  </span>
                </label>
              </div>
            </Card>
          </fieldset>
        </div>
      </div>
    </section>
  )
}

/** `/settings/templates/$templateId` — loads the template, then edits it. */
export function TemplateEditPage() {
  const { templateId } = useParams({ strict: false }) as { templateId: string }
  const load = useCallback((signal: AbortSignal) => getOfferTemplate(templateId, { signal }), [templateId])
  const resource = useResource(load)
  if (resource.status === 'loading')
    return (
      <div data-testid="crm-template-page">
        <Loading label={strings.templates.editor.loading} rows={5} />
      </div>
    )
  if (resource.status === 'error') return <LoadFailure error={resource.error} onRetry={resource.retry} />
  const template = resource.data!
  return (
    <TemplateEditor
      key={template.id}
      entity={template.entity}
      template={template}
      onSaved={resource.replace}
      onReload={resource.retry}
    />
  )
}

/** `/settings/templates/new/$entity` — a blank template of the entity in the path. */
export function TemplateNewPage() {
  const { entity } = useParams({ strict: false }) as { entity: string }
  if (!(ENTITIES as readonly string[]).includes(entity))
    return <Banner tone="warning">{strings.templates.editor.unknownEntity}</Banner>
  return (
    <TemplateEditor entity={entity as Entity} template={null} onSaved={() => undefined} onReload={() => undefined} />
  )
}
