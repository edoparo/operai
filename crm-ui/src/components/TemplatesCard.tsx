import { useCallback, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Badge, Banner, Button, Card, DataTable, StatusBadge, buttonClassName, formatDate } from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import { duplicateOfferTemplate, listOfferTemplatesOf, setOfferTemplateArchived } from '../lib/crmApi'
import { isStaleWrite } from '../lib/api'
import { codeOf, errorMessage } from '../lib/errors'
import type { Entity, OfferTemplateRow } from '../lib/types'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'
import { LoadFailure, Loading } from './LoadState'

/**
 * TemplatesCard — one entity's offer templates (specs/20261102-crm-offer-document US-2): name,
 * format, language, last update and the row actions edit / duplicate / archive, with a
 * "show archived" toggle that turns archive into restore. Archiving is
 * recoverable, so it asks nothing; it carries the row's version (If-Match) and a
 * stale answer reloads the list.
 *
 * specs/20261115-crm-offer-wizard (AC-9.2): wizard and classic templates share the list, each marked with its
 * format; a wizard row shows its description and its copy opens in the wizard editor, a classic row keeps its
 * own editor. The last active template of a language cannot be archived and a classic one cannot be restored
 * while a wizard one is active: the card says so.
 */
export default function TemplatesCard({ entity }: { entity: Entity }) {
  const t = strings.templates.list
  const label = strings.badges.entity[entity]
  const [showArchived, setShowArchived] = useState(false)
  const navigate = useNavigate()
  const load = useCallback(
    (signal: AbortSignal) => listOfferTemplatesOf(entity, showArchived, 'sections,wizard', { signal }),
    [entity, showArchived],
  )
  const templates = useResource(load)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refusal = (failure: unknown, template: OfferTemplateRow): string => {
    const language = strings.offers.languageName[template.language]
    switch (codeOf(failure)) {
      case 'last_template':
        return t.errors.last_template(language)
      case 'template_superseded':
        return t.errors.template_superseded(language)
      default:
        return errorMessage(failure)
    }
  }

  const run = (
    template: OfferTemplateRow,
    request: Promise<{ id: string; name: string }>,
    message: (name: string) => string,
    then?: (result: { id: string; name: string }) => boolean,
  ) => {
    setBusyId(template.id)
    setError(null)
    setNotice(null)
    request.then(
      (result) => {
        setBusyId(null)
        // a wizard copy opens in its editor; otherwise the list says what happened
        if (then?.(result)) return
        setNotice(message(result.name))
        templates.retry()
      },
      (failure: unknown) => {
        setBusyId(null)
        if (isStaleWrite(failure)) {
          templates.retry()
          setError(strings.common.staleWrite.body)
          return
        }
        setError(refusal(failure, template))
      },
    )
  }

  const columns: DataTableColumn<OfferTemplateRow>[] = [
    {
      id: 'name',
      header: t.columns.name,
      rowHeader: true,
      render: (template) => (
        <span className="flex flex-wrap items-center gap-2">
          <Link
            to="/settings/templates/$templateId"
            params={{ templateId: template.id }}
            className="link"
            data-testid={`crm-template-open-${template.id}`}
          >
            {template.name}
          </Link>
          {template.archived && <StatusBadge status="voided">{t.archived}</StatusBadge>}
          {template.format === 'wizard' && template.description ? (
            <span className="basis-full text-xs text-soft">{template.description}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'format',
      header: t.format,
      render: (template) =>
        template.format === 'wizard' ? (
          <Badge tone="accent">{t.wizard}</Badge>
        ) : (
          <Badge tone="muted">{t.classic}</Badge>
        ),
    },
    {
      id: 'language',
      header: t.columns.language,
      render: (template) => strings.offers.languageName[template.language],
    },
    { id: 'updated', header: t.columns.updated, render: (template) => formatDate(template.updatedAt) },
    {
      id: 'actions',
      header: t.columns.actions,
      render: (template) => (
        <span className="flex gap-1">
          <Link
            to="/settings/templates/$templateId"
            params={{ templateId: template.id }}
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
            aria-label={t.editOf(template.name)}
          >
            {t.edit}
          </Link>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t.duplicateOf(template.name)}
            disabled={busyId !== null}
            onClick={() =>
              run(template, duplicateOfferTemplate(template.id), t.duplicated, (copy) => {
                if (template.format !== 'wizard') return false
                void navigate({ to: '/settings/templates/$templateId', params: { templateId: copy.id } })
                return true
              })
            }
            data-testid={`crm-template-duplicate-${template.id}`}
          >
            {t.duplicate}
          </Button>
          {template.archived ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t.restoreOf(template.name)}
              disabled={busyId !== null}
              onClick={() =>
                run(template, setOfferTemplateArchived(template.id, template.version, false), t.restoredDone)
              }
              data-testid={`crm-template-restore-${template.id}`}
            >
              {t.restore}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t.archiveOf(template.name)}
              disabled={busyId !== null}
              onClick={() =>
                run(template, setOfferTemplateArchived(template.id, template.version, true), t.archivedDone)
              }
              data-testid={`crm-template-archive-${template.id}`}
            >
              {t.archive}
            </Button>
          )}
        </span>
      ),
    },
  ]

  return (
    <Card
      title={t.title(label)}
      data-testid={`crm-templates-${entity}`}
      action={
        <Link
          to="/settings/templates/new/$entity"
          params={{ entity }}
          className={buttonClassName({ variant: 'primary', size: 'sm' })}
          data-testid={`crm-template-new-${entity}`}
        >
          {t.newTemplate}
        </Link>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-soft">{t.description}</p>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
            data-testid={`crm-templates-${entity}-archived`}
          />
          {t.showArchived}
        </label>
        {error && (
          <Banner
            tone="danger"
            onDismiss={() => setError(null)}
            dismissLabel={strings.common.dismiss}
            data-testid="crm-templates-error"
          >
            {error}
          </Banner>
        )}
        {notice && (
          <Banner
            tone="success"
            compact
            autoDismiss
            onDismiss={() => setNotice(null)}
            dismissLabel={strings.common.dismiss}
          >
            {notice}
          </Banner>
        )}
        {templates.status === 'loading' && <Loading label={t.loading} rows={3} />}
        {templates.status === 'error' && <LoadFailure error={templates.error} onRetry={templates.retry} />}
        {templates.status === 'ready' &&
          (templates.data!.items.length === 0 ? (
            <p className="text-sm text-soft" data-testid={`crm-templates-${entity}-empty`}>
              {t.empty}
            </p>
          ) : (
            <DataTable
              caption={t.caption(label)}
              columns={columns}
              rows={templates.data!.items}
              getRowKey={(template) => template.id}
              testId={`crm-templates-${entity}-table`}
            />
          ))}
      </div>
    </Card>
  )
}
