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
 * pipeline, whose six-lane board needs the room, D-25, and on the offer wizard, whose form sits beside the document preview). No suite chrome
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
/**
 * The offer wizard's frame (owner D20), from `xl` up: the tool's own frame is taken out of the flow and laid over the
 * whole content scroller (`<main>` is `relative`), a flex column of title, tabs and the page area, so the scroller never
 * scrolls on this route; the page area (`.tool-main`) is the one place that may, for a state taller than the screen (the
 * template list with no draft yet). Under `min-h` the frame stops shrinking and the scroller scrolls instead. Below `xl`
 * nothing here applies. Written as variants on the frame because `ToolLayout` takes no class names.
 */
const OFFER_FRAME = [
  'xl:absolute xl:inset-0 xl:flex xl:min-h-[40rem] xl:flex-col',
  'xl:[&>div]:flex xl:[&>div]:min-h-0 xl:[&>div]:flex-1 xl:[&>div]:flex-col',
  'xl:[&>div>.tool-main]:flex xl:[&>div>.tool-main]:min-h-0 xl:[&>div>.tool-main]:flex-1 xl:[&>div>.tool-main]:flex-col',
  // the page area scrolls, so it is also the containing block of what is absolutely positioned in it (D21): nothing may
  // escape its clip to the frame and lengthen `<main>`
  'xl:[&>div>.tool-main]:relative xl:[&>div>.tool-main]:overflow-y-auto xl:[&>div>.tool-main]:pb-0 xl:[&>div>.tool-main]:pt-4',
].join(' ')

const loadScope = (signal: AbortSignal) => getScope({ signal })

export default function CrmShell() {
  const scope = useResource(loadScope)

  let content: ReactNode
  const matchRoute = useMatchRoute()
  const offer = Boolean(matchRoute({ to: '/deals/$id/offer' }))
  const wide = Boolean(matchRoute({ to: '/pipeline' }) || offer)
  if (scope.status === 'loading') content = <Loading label={strings.nav.loading} />
  else if (scope.status === 'error') content = <LoadFailure error={scope.error} onRetry={scope.retry} />
  else
    content = (
      <ScopeContext.Provider value={scope.data!}>
        <Outlet />
      </ScopeContext.Provider>
    )

  // always wrapped (a class that comes and goes, never an element that does): moving between routes keeps the page mounted
  return (
    <div className={offer ? OFFER_FRAME : undefined} data-testid="crm-shell-frame">
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
    </div>
  )
}
