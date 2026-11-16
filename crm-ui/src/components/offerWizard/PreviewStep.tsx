import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  FactList,
  Icon,
  VisuallyHidden,
  formatNumber,
  type DataTableColumn,
  type Fact,
} from '@operai/ui'
import type { WizardAnswers } from '../../lib/offerEngine/answers'
import { resolveSectionForEdit } from '../../lib/offerEngine/edit'
import type { Issue } from '../../lib/offerEngine/resolve'
import { offerFailure } from '../../lib/offerErrors'
import { strings } from '../../strings'
import { jumpToField } from './focusTarget'
import GenerateControl from './GenerateControl'
import HandEditDialog from './HandEditDialog'
import { plainText, sectionRows, withHandEdit, withoutHandEdit, type SectionRow } from './handEdits'
import IssuesList, { type IssueWithCode } from './IssuesList'
import { MarkedText } from './MarkedText'
import type { StepPanelProps } from './StepPanel'
import TemplateText from './TemplateText'
import { useElementWidth } from './useElementWidth'

const t = strings.offerWizard

const TOO_LONG: readonly string[] = ['section_too_long', 'heading_too_long']

/** Below this width of its own the Sections list is a stack of cards: a table that wide scrolls sideways and hides its actions. */
const CARDS_BELOW = 640

/**
 * The Preview step (design S7; AC-3.4, AC-3.5, AC-3.6): what is missing and what is to correct — the engine's one
 * issue list, or a 422 `offer_incomplete` body as it is — the sections table with the hand edit, and the text of
 * hand edits that no longer match a section. Generate sits in the issues card too, the action bar's own control
 * (design S7.1), and a deal context line lists what the offer is made with (S7.4).
 */
export default function PreviewStep({
  ast,
  answers,
  onAnswersChange,
  context,
  resolved,
  onGoToStep,
  serverIssues,
  issuesHeadingRef,
  commitAnswers,
  generate,
  templateName,
}: StepPanelProps) {
  const missing: readonly Issue[] = serverIssues ? serverIssues.missing : resolved.missing
  const invalid: readonly IssueWithCode[] = serverIssues ? serverIssues.invalid : resolved.invalid
  const [copied, setCopied] = useState('')
  const { ref: sectionsRef, width: sectionsWidth } = useElementWidth<HTMLDivElement>()
  // 0 is an element nobody has laid out (a test, a hidden tab): the table, as before it could be measured
  const asCards = sectionsWidth !== null && sectionsWidth > 0 && sectionsWidth < CARDS_BELOW
  const [announce, setAnnounce] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreFailure, setRestoreFailure] = useState<string | null>(null)

  /** Makes `next` the answers: through the page's save when it has one (it rejects with the failure), else at once. */
  const commit = async (next: WizardAnswers) => {
    if (commitAnswers) await commitAnswers(next)
    else onAnswersChange(next)
  }

  /** Opens the step that holds the issue and focuses its target; a section's target is on this very step. */
  const select = (issue: Issue) => {
    onGoToStep(issue.name.startsWith('section:') ? 'preview' : issue.step)
    jumpToField(issue.name)
  }

  const tooLong = new Set(invalid.filter((issue) => TOO_LONG.includes(issue.code)).map((issue) => issue.name))
  const rows = sectionRows(resolved)
  const rowOf = (sectionKey: string): SectionRow | undefined => rows.find(({ section }) => section.key === sectionKey)

  const saveText = async (sectionKey: string, heading: string, body: string) => {
    await commit(withHandEdit(answers, sectionKey, heading, body))
    setEditing(null)
    setAnnounce(t.edit.savedLive(heading))
  }

  const restore = async (sectionKey: string) => {
    setRestoreBusy(true)
    setRestoreFailure(null)
    try {
      // the wizard's own heading, for the announcement: resolved from the answers without the edit
      const without = withoutHandEdit(answers, sectionKey)
      const heading = resolveSectionForEdit(ast, without, context, sectionKey)?.heading ?? sectionKey
      await commit(without)
      setRestoring(null)
      setEditing(null)
      setAnnounce(t.edit.restoredLive(plainText(heading)))
      jumpToField(`section:${sectionKey}`)
    } catch (error) {
      setRestoreFailure(offerFailure(error))
    } finally {
      setRestoreBusy(false)
    }
  }
  const columns: DataTableColumn<SectionRow>[] = [
    {
      id: 'section',
      header: t.sections.section,
      rowHeader: true,
      render: ({ section, annex }) => (
        <>
          <TemplateText language={resolved.language}>
            <MarkedText text={section.heading} />
          </TemplateText>
          {annex !== null ? (
            <span className="block text-xs text-soft">
              <TemplateText language={resolved.language}>{t.sections.annexOf(plainText(annex))}</TemplateText>
            </span>
          ) : null}
        </>
      ),
    },
    { id: 'step', header: t.sections.step, render: ({ section }) => t.steps[section.step] },
    {
      id: 'status',
      header: t.sections.status,
      render: ({ section }) => (
        <span className="flex flex-wrap gap-1">
          {section.handEdited ? (
            <Badge tone="accent" glyph={<Icon name="edit" />}>
              {t.sections.edited}
            </Badge>
          ) : null}
          {tooLong.has(`section:${section.key}`) ? (
            <Badge tone="danger" glyph={<Icon name="x-circle" />}>
              {t.sections.tooLong}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t.sections.actions,
      render: ({ section }) => (
        <span className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-haspopup="dialog"
            aria-label={t.sections.edit(plainText(section.heading))}
            data-wizard-field={`section:${section.key}`}
            onClick={() => setEditing(section.key)}
          >
            {t.sections.editShort}
          </Button>
          {section.handEdited ? (
            <Button
              size="sm"
              variant="ghost"
              aria-haspopup="dialog"
              aria-label={t.sections.restore(plainText(section.heading))}
              onClick={() => setRestoring(section.key)}
            >
              {t.edit.restore}
            </Button>
          ) : null}
        </span>
      ),
    },
  ]

  const f = t.facts
  const facts: Fact[] | null =
    templateName === undefined
      ? null
      : [
          { id: 'template', term: f.template, value: templateName },
          { id: 'language', term: f.language, value: f.languageName[context.language] },
          { id: 'currency', term: f.currency, value: context.currency },
          { id: 'validity', term: f.validity, value: f.days(answers.validityDays) },
          { id: 'effort', term: f.effortAnnex, value: answers.effortAnnex ? f.included : f.notIncluded },
          { id: 'pdfs', term: f.pdfs, value: formatNumber(answers.attachmentIds.length) },
        ]

  const copy = (text: string, heading: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(`${t.sections.copied}: ${heading}`),
      () => setCopied(''),
    )
  }

  return (
    <div className="flex flex-col gap-4" data-testid="crm-wizard-preview-step">
      <Card aria-label={t.issues.title}>
        <IssuesList
          missing={missing}
          invalid={invalid}
          onSelect={select}
          headingRef={issuesHeadingRef}
          {...(generate?.blockedReason ? { blockedReason: generate.blockedReason } : {})}
        />
        {generate ? (
          <GenerateControl
            {...generate}
            reasonShownAbove={missing.length + invalid.length === 0 && Boolean(generate.blockedReason)}
            className="mt-4 flex flex-wrap items-center gap-3"
            testId="crm-wizard-card-generate"
          />
        ) : null}
      </Card>
      <Card title={t.sections.caption}>
        <div ref={sectionsRef}>
          {asCards ? (
            <ul
              aria-label={t.sections.caption}
              className="m-0 flex list-none flex-col gap-3 p-0"
              data-testid="crm-wizard-sections"
            >
              {rows.map((row) => {
                const column = (id: string) => columns.find((candidate) => candidate.id === id)!
                const flagged = row.section.handEdited || tooLong.has(`section:${row.section.key}`)
                return (
                  <li key={row.section.key} className="flex flex-col gap-2 rounded-md border border-rule p-3">
                    <h4 className="text-sm text-text">{column('section').render(row)}</h4>
                    <dl className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <div className="flex gap-1">
                        <dt className="text-soft">{column('step').header}</dt>
                        <dd className="m-0 text-text">{column('step').render(row)}</dd>
                      </div>
                      {flagged ? (
                        <div className="flex gap-1">
                          <dt className="text-soft">{column('status').header}</dt>
                          <dd className="m-0">{column('status').render(row)}</dd>
                        </div>
                      ) : null}
                    </dl>
                    {column('actions').render(row)}
                  </li>
                )
              })}
            </ul>
          ) : (
            <DataTable
              caption={t.sections.caption}
              columns={columns}
              rows={rows}
              getRowKey={({ section }) => section.key}
              testId="crm-wizard-sections"
            />
          )}
        </div>
      </Card>
      {answers.orphanedEdits.length > 0 ? (
        <Card title={t.changed.orphans.title}>
          <p className="mb-3 text-sm text-soft">{t.changed.orphans.body}</p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {answers.orphanedEdits.map((edit, index) => (
              <li key={index} className="rounded-md border border-rule p-3">
                <h4 className="mb-1 text-sm text-text">{edit.heading}</h4>
                <pre
                  className="mb-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-soft"
                  tabIndex={0}
                >
                  {edit.body}
                </pre>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={t.sections.orphanCopy(edit.heading)}
                  onClick={() => copy(`${edit.heading}\n\n${edit.body}`, edit.heading)}
                >
                  <Icon name="copy" /> {t.changed.dialog.copy}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {facts ? (
        <Card title={f.title}>
          <FactList items={facts} testId="crm-wizard-facts" />
        </Card>
      ) : null}
      <VisuallyHidden live>{announce || copied}</VisuallyHidden>
      {editing !== null && rowOf(editing) ? (
        <HandEditDialog
          ast={ast}
          answers={answers}
          context={context}
          sectionKey={editing}
          edited={rowOf(editing)!.section.handEdited}
          onSave={(heading, body) => saveText(editing, heading, body)}
          onRestore={() => setRestoring(editing)}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {restoring !== null && rowOf(restoring) ? (
        <ConfirmDialog
          title={t.restore.title}
          confirmLabel={t.restore.confirm}
          busyLabel={t.restore.busy}
          cancelLabel={strings.common.cancel}
          closeLabel={strings.common.close}
          busy={restoreBusy}
          error={restoreFailure}
          onConfirm={() => void restore(restoring)}
          onCancel={() => {
            setRestoring(null)
            setRestoreFailure(null)
          }}
          testIdPrefix="crm-wizard-restore"
        >
          {t.restore.body(plainText(rowOf(restoring)!.section.heading))}
        </ConfirmDialog>
      ) : null}
    </div>
  )
}
