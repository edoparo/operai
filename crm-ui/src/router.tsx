import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router'
import type { RouteComponent } from '@tanstack/react-router'
import type { WizardStep } from './components/offerWizard/steps'
import CompaniesPage from './pages/CompaniesPage'
import CompanyDetailPage from './pages/CompanyDetailPage'
import ContactDetailPage from './pages/ContactDetailPage'
import ContactsPage from './pages/ContactsPage'
import DealDetailPage from './pages/DealDetailPage'
import NotFoundPage from './pages/NotFoundPage'
import OfferWizardPage from './pages/OfferWizardPage'
import PipelinePage from './pages/PipelinePage'
import SettingsPage from './pages/SettingsPage'
import TasksPage from './pages/TasksPage'
import { TemplateEditPage, TemplateNewPage } from './pages/TemplateEditorPage'

/** The wizard's address: `?step=` (the step shown), and `?kind=&offer=` when it was opened to edit or revise an offer that needs a template first. */
export type OfferWizardSearch = { step?: WizardStep; kind?: 'edit' | 'revision'; offer?: string }

const WIZARD_STEPS: readonly string[] = ['template', 'client', 'scope', 'conditions', 'costs', 'annexes', 'preview']

const offerWizardSearch = (search: Record<string, unknown>): OfferWizardSearch => ({
  ...(typeof search['step'] === 'string' && WIZARD_STEPS.includes(search['step'])
    ? { step: search['step'] as WizardStep }
    : {}),
  ...((search['kind'] === 'edit' || search['kind'] === 'revision') && typeof search['offer'] === 'string' && search['offer'] !== ''
    ? { kind: search['kind'], offer: search['offer'] }
    : {}),
})

/**
 * crm-ui's inner router (specs/20261101-crm plan.md § UI), basepath `/crm`:
 *
 *   /companies          Companies list         /contacts/$id   Contact detail
 *   /companies/$id      Company detail         /pipeline       Pipeline board
 *   /contacts           Contacts list          /deals/$id      Deal detail
 *   /deals/$id/offer    Offer wizard (?step=, ?kind=&offer=)
 *   /tasks              Tasks                  /settings       Settings (deal:manage)
 *                                              /settings/templates/new/$entity  New offer template
 *                                              /settings/templates/$templateId  Offer template editor
 *                                              /               → /companies
 *
 * No auth guard and no chrome (ADR 20260709-suite-frontend-module-federation). `Root` is the layout seam: App.tsx
 * passes `CrmShell`; tests may render a page under a bare `<Outlet/>`.
 */
export function createAppRouter(basepath?: string, Root: RouteComponent = Outlet) {
  const rootRoute = createRootRoute({ component: Root })

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
      throw redirect({ to: '/companies' })
    },
  })
  const companiesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/companies', component: CompaniesPage })
  const companyRoute = createRoute({ getParentRoute: () => rootRoute, path: '/companies/$id', component: CompanyDetailPage })
  const contactsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/contacts', component: ContactsPage })
  const contactRoute = createRoute({ getParentRoute: () => rootRoute, path: '/contacts/$id', component: ContactDetailPage })
  const pipelineRoute = createRoute({ getParentRoute: () => rootRoute, path: '/pipeline', component: PipelinePage })
  const dealRoute = createRoute({ getParentRoute: () => rootRoute, path: '/deals/$id', component: DealDetailPage })
  const offerRoute = createRoute({ getParentRoute: () => rootRoute, path: '/deals/$id/offer',
    component: OfferWizardPage,
    validateSearch: offerWizardSearch,
  })
  const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage })
  const templateNewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/templates/new/$entity',
    component: TemplateNewPage,
  })
  const templateRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/templates/$templateId',
    component: TemplateEditPage,
  })
  const tasksRoute = createRoute({ getParentRoute: () => rootRoute, path: '/tasks', component: TasksPage })

  const routeTree = rootRoute.addChildren([
    indexRoute,
    companiesRoute,
    companyRoute,
    contactsRoute,
    contactRoute,
    pipelineRoute,
    dealRoute,
    offerRoute,
    tasksRoute,
    settingsRoute,
    templateNewRoute,
    templateRoute,
  ])

  return createRouter({ routeTree, basepath, defaultNotFoundComponent: NotFoundPage })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
  /** What a navigation to the deal after generating an offer carries, for the deal page's confirmation. */
  interface HistoryState {
    generated?: string
    proposePrompt?: boolean
  }
}
