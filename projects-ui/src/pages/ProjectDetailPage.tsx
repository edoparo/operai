import { useCallback, useId, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { Banner, Button, Card, FactList, Icon, PageHeader, StatePanel, formatDate } from '@operai/ui'
import { EntityBadge, ProjectStateBadge, ProjectTypeBadge } from '../components/Badges'
import ProjectEditDialog from '../components/ProjectEditDialog'
import { LoadFailure, Loading, Saved, StaleWriteBanner } from '../components/LoadState'
import PurchaseOrderCard from '../components/PurchaseOrderCard'
import StateActions from '../components/StateActions'
import TeamCard from '../components/TeamCard'
import TermsCard from '../components/TermsCard'
import { useCurrentUserId } from '../hooks/useCurrentUserId'
import { useResource } from '../hooks/useResource'
import { useScope } from '../hooks/useScope'
import { statusOf } from '../lib/errors'
import { personName } from '../lib/people'
import { getProject } from '../lib/projectsApi'
import type { Project } from '../lib/types'
import { strings } from '../strings'

const BackLink = () => (
  <Link to="/" className="link" data-testid="project-detail-back">
    <Icon name="arrow-left" /> {strings.project.back}
  </Link>
)

/** What the company row says: the client (every client type, `saas` included, has one — D40) or "Internal". */
function companyFact(project: Project): { term: string; value: string } {
  const t = strings.project.details
  if (project.type === 'internal') return { term: t.company, value: t.internal }
  return { term: t.company, value: project.company?.name ?? t.companyUnavailable }
}

/**
 * ProjectDetailPage — one project (specs/021 US-1; specs/022 US-2, US-3, US-5): its details with the dates
 * from its terms, the team, and — by what the project has — a **Purchase order** card (a project made from a
 * won deal: the deal, the "no longer won" notice, the estimate, the Bexio order id, its terms) or a **Terms**
 * card (a hand-made one, which never has a purchase order, AC-5.2). A holder of manage projects for the
 * project's entity gets the state actions and the edit dialogs; anyone else reads (the server's 403 is
 * the gate, ADR-0014). The type of a project never changes (A30), so there is no control for it.
 */
export default function ProjectDetailPage() {
  const t = strings.project
  const { id } = useParams({ from: '/$id' })
  const titleId = useId()
  const currentUserId = useCurrentUserId()
  const load = useCallback((signal: AbortSignal) => getProject(id, { signal }), [id])
  const resource = useResource(load)
  const { canManageEntity } = useScope()
  const [saved, setSaved] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  if (resource.status === 'loading') return <Loading label={t.loading} />
  if (resource.status === 'error') {
    if (statusOf(resource.error) === 404)
      return (
        <section aria-labelledby={titleId}>
          <PageHeader title={t.notFoundTitle} titleId={titleId} back={<BackLink />} />
          <StatePanel role="alert" focusOnMount title={t.notFoundTitle} testId="project-not-found">
            {t.notFoundBody}
          </StatePanel>
        </section>
      )
    return <LoadFailure error={resource.error} onRetry={resource.retry} />
  }

  const project = resource.data!
  const canManage = canManageEntity(project.entity)
  const changed = (next: Project, message: string) => {
    resource.replace(next)
    setSaved(message)
    setStale(false)
    setActionError(null)
  }
  // A write of the terms or the purchase order changes what the project derives from them (dates, versions): read it again.
  const recordChanged = (message: string) => {
    setSaved(message)
    setStale(false)
    setActionError(null)
    getProject(id).then(resource.replace, () => resource.retry())
  }
  const company = companyFact(project)
  // The deal behind this project, when it is no longer won in the CRM: read live, nothing is changed by it (AC-2.3).
  const po = project.purchaseOrder
  const reopenedDeal = po?.deal.won === false ? (po.deal.title ?? strings.purchaseOrder.card.dealUnavailable) : null
  const dateFacts = [
    {
      id: 'start',
      term: t.details.startDate,
      value: project.startDate ? formatDate(project.startDate) : strings.common.none,
    },
    {
      id: 'end',
      term: t.details.endDate,
      value: project.endDate
        ? formatDate(project.endDate)
        : project.terms !== null
          ? t.details.openEnded
          : strings.common.none,
    },
  ]

  return (
    <section aria-labelledby={titleId} data-testid="project-detail-page" data-project-id={project.id}>
      <PageHeader
        title={project.name}
        titleId={titleId}
        status={<ProjectStateBadge state={project.state} />}
        back={<BackLink />}
        actions={
          canManage && (
            <StateActions
              project={project}
              onChanged={changed}
              onStale={() => setStale(true)}
              onError={setActionError}
            />
          )
        }
      />
      <div className="flex flex-col gap-4">
        {stale && (
          <StaleWriteBanner
            onReload={() => {
              setStale(false)
              resource.retry()
            }}
          />
        )}
        {actionError && (
          <Banner
            tone="danger"
            title={t.errors.title}
            onDismiss={() => setActionError(null)}
            dismissLabel={strings.common.dismiss}
            data-testid="project-action-error"
          >
            {actionError}
          </Banner>
        )}
        {saved && <Saved message={saved} onDismiss={() => setSaved(null)} />}
        {!canManage && <Banner tone="info">{t.readOnly}</Banner>}
        {reopenedDeal !== null && (
          <Banner tone="warning" title={t.dealNotWon.title} data-testid="project-deal-not-won">
            {t.dealNotWon.body(reopenedDeal)}
          </Banner>
        )}
        <Card
          title={t.details.title}
          action={
            canManage && (
              <Button size="sm" aria-haspopup="dialog" onClick={() => setEditing(true)} data-testid="project-edit">
                {t.details.edit}
              </Button>
            )
          }
        >
          <FactList
            testId="project-facts"
            items={[
              { id: 'type', term: t.details.type, value: <ProjectTypeBadge type={project.type} /> },
              { id: 'entity', term: t.details.entity, value: <EntityBadge entity={project.entity} /> },
              { id: 'company', term: company.term, value: company.value },
              {
                id: 'pm',
                term: t.details.projectManager,
                value: project.awaitingProjectManager
                  ? t.details.awaitingProjectManager
                  : personName(project.projectManager, currentUserId),
              },
              ...dateFacts,
            ]}
          />
        </Card>
        <TeamCard
          project={project}
          currentUserId={currentUserId}
          canManage={canManage}
          onSaved={(next) => changed(next, t.saved.team)}
          onStale={() => setStale(true)}
        />
        {project.purchaseOrder !== null ? (
          <PurchaseOrderCard
            project={project}
            canManage={canManage}
            onChanged={recordChanged}
            onStale={() => setStale(true)}
          />
        ) : (
          <TermsCard project={project} canManage={canManage} onChanged={recordChanged} onStale={() => setStale(true)} />
        )}
      </div>
      {editing && (
        <ProjectEditDialog
          project={project}
          currentUserId={currentUserId}
          onCancel={() => setEditing(false)}
          onSaved={(next) => {
            setEditing(false)
            changed(next, t.saved.details)
          }}
          onStale={() => {
            setEditing(false)
            setStale(true)
          }}
        />
      )}
    </section>
  )
}
