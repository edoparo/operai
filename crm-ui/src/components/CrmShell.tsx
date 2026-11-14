import { Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { TabNav, ToolLayout, tabLinkClassName } from '@operai/ui'
import { getScope } from '../lib/crmApi'
import { ScopeContext } from '../hooks/scopeContext'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'
import { LoadFailure, Loading } from './LoadState'

/**
 * CrmShell — crm-ui's root layout: the tool title (h1), its four tabs and the
 * routed page (ToolLayout `default` width, building-pages § 1; `wide` on the
 * pipeline, whose six-lane board needs the room, D-25). No suite chrome
 * and no auth guard: the shell owns both and mounts this remote only for
 * `crm:access` holders (ADR 20260709-suite-frontend-module-federation, ADR 20260713-authz-hand-rolled-rbac-abac-epoch-claims).
 *
 * Every tab is open to every CRM user (D-3: reading is `crm:access`), so none
 * is hidden. What varies per person is `GET /scope` — the entities they manage
 * deals for and whether they may erase a contact — loaded once here and handed
 * to the pages through `ScopeContext`. Until it answers the page area shows the
 * loading state; a failure shows the retry banner (the 503 "authorization
 * service unavailable" variant for a fail-closed `auth`, ADR 20260716-refund-api-authorization-enforcing-resource-server) and a 403
 * PermissionDenied. The title and tabs stay on screen in every state.
 */
const loadScope = (signal: AbortSignal) => getScope({ signal })

export default function CrmShell() {
  const scope = useResource(loadScope)

  let content: ReactNode
  const matchRoute = useMatchRoute()
  const wide = Boolean(matchRoute({ to: '/pipeline' }))
  if (scope.status === 'loading') content = <Loading label={strings.nav.loading} />
  else if (scope.status === 'error') content = <LoadFailure error={scope.error} onRetry={scope.retry} />
  else
    content = (
      <ScopeContext.Provider value={scope.data!}>
        <Outlet />
      </ScopeContext.Provider>
    )

  return (
    <ToolLayout
      title={strings.nav.heading}
      width={wide ? 'wide' : 'default'}
      testId="crm-shell"
      nav={
        <TabNav label={strings.nav.landmarkLabel}>
          <Link to="/companies" className={tabLinkClassName}>
            {strings.nav.companies}
          </Link>
          <Link to="/contacts" className={tabLinkClassName}>
            {strings.nav.contacts}
          </Link>
          <Link to="/pipeline" className={tabLinkClassName}>
            {strings.nav.pipeline}
          </Link>
          <Link to="/tasks" className={tabLinkClassName}>
            {strings.nav.tasks}
          </Link>
          {/* Offer letterhead and terms: a deal:manage holder's screen (specs/20261101-crm-sales-flow). */}
          {scope.status === 'ready' && scope.data!.deal.length > 0 && (
            <Link to="/settings" className={tabLinkClassName} data-testid="crm-nav-settings">
              {strings.nav.settings}
            </Link>
          )}
        </TabNav>
      }
    >
      {content}
    </ToolLayout>
  )
}
