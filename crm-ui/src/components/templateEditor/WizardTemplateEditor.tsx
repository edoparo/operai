import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  Banner,
  Button,
  Card,
  Drawer,
  Field,
  Icon,
  PageHeader,
  Tabs,
  VisuallyHidden,
  focusFirstInvalid,
  tabPanelProps,
} from '@operai/ui'
import { ApiError, isStaleWrite } from '../../lib/api'
import { createWizardTemplate, listOfferTemplatesOf, updateWizardTemplate } from '../../lib/crmApi'
import { codeOf, errorMessage, fieldErrorOf, isNulRefusal } from '../../lib/errors'
import { outline as outlineOf, suppliedFields, type OutlineItem } from '../../lib/offerEngine/outline'
import { parseTemplate, type Problem } from '../../lib/offerEngine/syntax'
import { templateProblemsOf } from '../../lib/offerErrors'
import type { Entity, OfferLanguage, WizardTemplate, WizardTemplateInput } from '../../lib/types'
import { first, maxLength, required } from '../../lib/validate'
import { useCrmCapabilities } from '../../hooks/scopeContext'
import { useResource } from '../../hooks/useResource'
import { strings } from '../../strings'
import { Saved, StaleWriteBanner } from '../LoadState'
import { WizardMarkupReference } from '../MarkupHelp'
import ListFieldEditor from '../offerWizard/ListFieldEditor'
import OutlineView from './OutlineView'
import ProblemsList from './ProblemsList'
import TemplateTextArea from './TemplateTextArea'
import TryWizardView from './TryWizardView'
import { lineRange, revealRange } from './lines'

const t = strings.templates
const w = t.wizardEditor

/** How long the live check waits after the last keystroke (design S13: ≤ 300 ms). */
const CHECK_DELAY_MS = 300
const MAX_NAME = 80
const MAX_DESCRIPTION = 160
const MAX_USES = 6
const MAX_USE = 40

type FieldErrors = Partial<Record<'name' | 'description' | 'source', string>>

const USES_ITEM: Extract<OutlineItem, { type: 'list' }> = {
  type: 'list',
  name: 'uses',
  label: w.uses,
  hint: w.usesHint,
  optional: true,
  handEditedIn: [],
}

type View = 'edit' | 'try'
const VIEWS_PREFIX = 'crm-template-view'

const isError = (problem: Problem) => problem.severity === 'error'

/** The problems of the editor's own reading and of the server's, once each, in text order. */
function mergeProblems(own: readonly Problem[], server: readonly Problem[]): Problem[] {
  const seen = new Set<string>()
  const merged: Problem[] = []
  for (const problem of [...own, ...server]) {
    const key = `${problem.line}:${problem.code}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(problem)
  }
  return merged.sort((a, b) => a.line - b.line || Number(b.severity === 'error') - Number(a.severity === 'error'))
}

const BackLink = () => (
  <Link to="/settings" className="link" data-testid="crm-template-back">
    <Icon name="arrow-left" /> {t.editor.back}
  </Link>
)

export interface WizardTemplateEditorProps {
  entity: Entity
  /** The template being edited; null for a new one of `entity`. */
  template: WizardTemplate | null
  onSaved: (template: WizardTemplate) => void
  onReload: () => void
}

/**
 * The wizard template editor (design S13; AC-8.1 to AC-8.3, AC-9.2): the template's details, its text, the problems
 * the shared parser finds in it as it is typed, and the outline of what the wizard will ask. Save is refused —
 * `aria-disabled`, reachable, with its reason — while the text has errors; a warning never blocks it. The check
 * Save makes is of the text as typed, not of the last live reading, so a quick Save cannot slip an error past it.
 * A save carries the template's version as If-Match; a stale answer shows the reload banner and keeps the typing.
 */
export default function WizardTemplateEditor({ entity, template, onSaved, onReload }: WizardTemplateEditorProps) {
  const titleId = useId()
  const reasonId = useId()
  const navigate = useNavigate()
  const { canManageDealsOf } = useCrmCapabilities()
  const readOnly = !canManageDealsOf(entity) || template?.archived === true
  const fieldsRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const problemsRef = useRef<HTMLHeadingElement>(null)

  const [name, setName] = useState(template?.name ?? '')
  const [language, setLanguage] = useState<OfferLanguage>(template?.language ?? 'it')
  const [description, setDescription] = useState(template?.description ?? '')
  const [uses, setUses] = useState<string[]>(template?.uses ?? [])
  const [text, setText] = useState(template?.source ?? '')

  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [syntaxOpen, setSyntaxOpen] = useState(false)
  const [serverProblems, setServerProblems] = useState<Problem[]>([])
  const [view, setView] = useState<View>('edit')

  // The live check: the text as it was a moment ago, read by the same parser the server runs.
  const [settled, setSettled] = useState(text)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text])
  const parsed = useMemo(() => parseTemplate(settled), [settled])
  const problems = useMemo(() => mergeProblems(parsed.problems, serverProblems), [parsed, serverProblems])
  const errorCount = problems.filter(isError).length

  // The outline of the last reading without errors: while the text is being broken and mended it keeps the
  // author's picture of the template instead of an outline of half a sentence.
  const current = useMemo(
    () => ({ outline: outlineOf(parsed.ast, null), supplied: suppliedFields(parsed.ast) }),
    [parsed],
  )
  const clean = !parsed.problems.some(isError)
  const [lastClean, setLastClean] = useState<typeof current | null>(clean ? current : null)
  if (clean && lastClean !== current) setLastClean(current)
  const shown = clean ? current : (lastClean ?? current)

  // Whether saving makes this the first wizard template of the language: the classic ones of it are archived.
  const load = useCallback(
    (signal: AbortSignal) => listOfferTemplatesOf(entity, false, 'sections,wizard', { signal }),
    [entity],
  )
  const siblings = useResource(load)
  const archivedByThis = useMemo(() => {
    if (readOnly) return 0
    const rows = siblings.data?.items ?? []
    const hasWizard = rows.some(
      (row) => row.format === 'wizard' && row.language === language && row.id !== template?.id,
    )
    if (hasWizard) return 0
    return rows.filter((row) => row.format !== 'wizard' && row.language === language).length
  }, [siblings.data, language, template?.id, readOnly])

  const languageName = strings.offers.languageName
  const blocked = errorCount > 0

  const focusProblems = () => problemsRef.current?.focus()
  // The Try view cannot run a text with errors: back to Edit, with the problem list's heading focused.
  const focusOnReturn = useRef(false)
  useEffect(() => {
    if (view === 'edit' && focusOnReturn.current) {
      focusOnReturn.current = false
      problemsRef.current?.focus()
    }
  }, [view])
  const goToProblem = (problem: Problem) => {
    const box = textRef.current
    if (!box || box.disabled) return
    const [start, end] = lineRange(box.value, problem.line)
    box.focus()
    revealRange(box, start, end)
  }

  const validate = (): FieldErrors => ({
    name: first(required(name), maxLength(name, MAX_NAME)) ?? undefined,
    description: maxLength(description, MAX_DESCRIPTION) ?? undefined,
  })

  const submit = () => {
    setSaved(null)
    setError(null)
    setServerProblems([])
    // The text as typed now, not as last read: a Save pressed within the delay must not pass an error.
    const reading = parseTemplate(text)
    setSettled(text)
    if (reading.problems.some(isError)) {
      focusProblems()
      return
    }
    const found = validate()
    setErrors(found)
    if (Object.values(found).some(Boolean)) {
      setError(t.editor.fixErrors)
      requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
      return
    }
    const input: WizardTemplateInput = {
      name: name.trim(),
      language,
      description: description.trim(),
      uses: uses.map((use) => use.trim()).filter((use) => use !== ''),
      source: text,
    }
    setBusy(true)
    const request = template
      ? updateWizardTemplate(template.id, template.version, input)
      : createWizardTemplate(entity, input)
    request.then(
      (next) => {
        setBusy(false)
        if (template) {
          setSaved(t.editor.saved)
          onSaved(next)
        } else {
          void navigate({ to: '/settings/templates/$templateId', params: { templateId: next.id } })
        }
      },
      (failure: unknown) => {
        setBusy(false)
        if (isStaleWrite(failure)) return setStale(true)
        if (failure instanceof ApiError && failure.code === 'template_name_taken') {
          setErrors({ name: t.editor.errors.nameTaken })
          requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
          return
        }
        const refused = templateProblemsOf(failure)
        if (refused.length > 0) {
          setServerProblems(refused)
          focusProblems()
          return
        }
        switch (codeOf(failure)) {
          case 'template_archived':
            return setError(t.editor.errors.archived)
          case 'out_of_scope':
            return setError(t.editor.errors.outOfScope)
          // moving the only active template away from its language: the message names the language it leaves
          case 'last_template':
            return setError(t.list.errors.last_template(languageName[template?.language ?? language]))
          case 'template_superseded':
            return setError(t.list.errors.template_superseded(languageName[language]))
        }
        // A character the server cannot store lands on the field it named, with our own sentence; focus goes there
        // (the person is on Save, far from the text), back in the Edit view when they were trying the template.
        const noNul = isNulRefusal(failure) ? fieldErrorOf(failure) : null
        if (noNul && (noNul.field === 'name' || noNul.field === 'description' || noNul.field === 'source')) {
          setErrors({ [noNul.field]: noNul.message })
          setView('edit')
          requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
          return
        }
        const field = fieldErrorOf(failure)
        setError(field ? field.message : errorMessage(failure))
      },
    )
  }

  const label = strings.badges.entity[entity]
  return (
    <section aria-labelledby={titleId} data-testid="crm-template-page">
      <PageHeader
        title={template ? t.editor.editHeading(template.name) : t.editor.newHeading}
        titleId={titleId}
        description={t.editor.description(label)}
        back={<BackLink />}
        actions={
          !readOnly && (
            <>
              <Button
                variant="primary"
                busy={busy}
                aria-disabled={blocked || undefined}
                aria-describedby={blocked ? reasonId : undefined}
                onClick={submit}
                data-testid="crm-template-save"
              >
                {busy ? t.editor.saving : template ? t.editor.save : t.editor.create}
              </Button>
              {blocked ? <VisuallyHidden id={reasonId}>{w.saveBlocked(errorCount)}</VisuallyHidden> : null}
            </>
          )
        }
      />
      <div className="flex flex-col gap-4">
        {stale && <StaleWriteBanner onReload={onReload} />}
        {saved && <Saved message={saved} onDismiss={() => setSaved(null)} />}
        {!canManageDealsOf(entity) && <Banner tone="info">{t.editor.readOnly}</Banner>}
        {template?.archived && <Banner tone="info">{t.editor.archivedNotice}</Banner>}
        {error && (
          <Banner tone="danger" data-testid="crm-template-error">
            {error}
          </Banner>
        )}
        <Tabs
          label={w.views}
          idPrefix={VIEWS_PREFIX}
          value={view}
          onChange={setView}
          tabs={[
            { id: 'edit', label: w.edit },
            { id: 'try', label: w.tryLabel },
          ]}
        />
        {view === 'edit' ? (
          <div {...tabPanelProps(VIEWS_PREFIX, 'edit')}>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-5 xl:items-start">
              <div ref={fieldsRef} className="flex min-w-0 flex-col gap-4 xl:col-span-3">
                <fieldset disabled={readOnly || busy} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
                  <Card title={w.details}>
                    <div className="flex flex-col gap-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label={t.editor.fields.name} required error={errors.name} testId="crm-template-name">
                          {(control) => (
                            <input {...control} value={name} onChange={(event) => setName(event.target.value)} />
                          )}
                        </Field>
                        <Field label={t.editor.fields.language} testId="crm-template-language">
                          {(control) => (
                            <select
                              {...control}
                              value={language}
                              onChange={(event) => setLanguage(event.target.value as OfferLanguage)}
                            >
                              {(['it', 'en'] as const).map((option) => (
                                <option key={option} value={option}>
                                  {languageName[option]}
                                </option>
                              ))}
                            </select>
                          )}
                        </Field>
                      </div>
                      {archivedByThis > 0 ? (
                        <Banner tone="info" compact live="polite" data-testid="crm-template-supersede">
                          {w.supersede(languageName[language], archivedByThis)}
                        </Banner>
                      ) : null}
                      <Field
                        label={w.description}
                        hint={
                          <>
                            {w.descriptionHint}{' '}
                            <span className="font-mono">
                              {description.length} / {MAX_DESCRIPTION}
                            </span>
                          </>
                        }
                        error={errors.description}
                        testId="crm-template-description"
                      >
                        {(control) => (
                          <input
                            {...control}
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                          />
                        )}
                      </Field>
                      <ListFieldEditor
                        item={USES_ITEM}
                        items={uses}
                        language="en"
                        maxItems={MAX_USES}
                        maxChars={MAX_USE}
                        limitText={w.usesLimit}
                        onChange={setUses}
                      />
                    </div>
                  </Card>
                  <TemplateTextArea
                    value={text}
                    onChange={(next) => {
                      setText(next)
                      // the server's problems were about the text it was sent
                      setServerProblems([])
                      setErrors((current) => (current.source ? { ...current, source: undefined } : current))
                    }}
                    textareaRef={textRef}
                    disabled={readOnly || busy}
                    errorCount={errorCount}
                    {...(errors.source ? { error: errors.source } : {})}
                    onGoToProblems={focusProblems}
                    onOpenSyntax={() => setSyntaxOpen(true)}
                  />
                </fieldset>
              </div>
              <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
                <ProblemsList problems={problems} onSelect={goToProblem} headingRef={problemsRef} />
                <OutlineView
                  outline={shown.outline}
                  supplied={shown.supplied}
                  stale={!clean && lastClean !== null}
                  language={language}
                />
              </div>
            </div>
          </div>
        ) : (
          <div {...tabPanelProps(VIEWS_PREFIX, 'try')}>
            <TryWizardView
              entity={entity}
              template={template}
              source={text}
              language={language}
              onGoToProblems={() => {
                focusOnReturn.current = true
                setView('edit')
              }}
            />
          </div>
        )}
      </div>
      {syntaxOpen ? (
        <Drawer
          title={t.markup.wizard.summary}
          closeLabel={w.syntaxClose}
          onClose={() => setSyntaxOpen(false)}
          testIdPrefix="crm-template-syntax"
        >
          <WizardMarkupReference />
        </Drawer>
      ) : null}
    </section>
  )
}
