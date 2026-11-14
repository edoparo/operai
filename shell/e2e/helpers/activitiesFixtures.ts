/**
 * Test-only fixture bridge for specs/20261110-activities e2e (T21).
 *
 * Two kinds of helper live here, and the specs keep them apart:
 *
 *   - SETUP and out-of-band VERIFICATION go through the real REST APIs (crm-api, projects-api,
 *     activities-api) with a real, seeded Bearer token. Nothing here writes a row behind an API's back.
 *   - Everything a journey asserts about what a person SEES or DOES is driven through the browser.
 *
 * People. Access is by real roles set through auth's admin API (`PUT /admin/users/:id/roles`, which bumps
 * `perm_epoch`), exactly as meetingsFixtures does, so activities-api's live host resolution sees them like
 * any admin-granted user:
 *
 *   admin       the real `admin` role: manages every project (project:manage unconditioned) and reads the CRM
 *   sales       `employee` + `sales`: crm:access + projects:access (reads every project, manages none unless the
 *               entity attribute matches, which a fresh test user does not have)
 *   accounting  `employee` + `accounting`: projects:access only, NO CRM access (AC-7.4)
 *
 * Only dedicated `act-*` personas ever get their roles rewritten: the shared seed user and any real person
 * are refused (same guard as meetingsFixtures.setRoles).
 *
 * "activities-api is in maintenance" is simulated in the BROWSER (`stubActivitiesApi`), like
 * meetingsFixtures.blockMeetingsApi: the harness never stops or reconfigures a service other journeys share.
 */
import { signInContext, cleanupPeople, newRunId } from './meetingsFixtures'
import type { BrowserContext, Page } from '@playwright/test'
import { seedAdminSession, seedUserSession, type SeededSession } from './adminSession'

export { cleanupPeople, newRunId, signInContext }

const trim = (url: string): string => url.replace(/\/$/, '')

export const AUTH_URL = trim(process.env['E2E_AUTH_URL'] ?? process.env['VITE_AUTH_URL'] ?? 'http://localhost:3001')
export const CRM_API_URL = trim(
  process.env['E2E_CRM_API_URL'] ?? process.env['VITE_CRM_API_URL'] ?? 'http://localhost:8084',
)
export const PROJECTS_API_URL = trim(
  process.env['E2E_PROJECTS_API_URL'] ?? process.env['VITE_PROJECTS_API_URL'] ?? 'http://localhost:8086',
)
export const ACTIVITIES_API_URL = trim(
  process.env['E2E_ACTIVITIES_API_URL'] ?? process.env['VITE_ACTIVITIES_API_URL'] ?? 'http://localhost:8087',
)
export const NOTIFY_API_URL = trim(
  process.env['E2E_NOTIFY_API_URL'] ?? process.env['VITE_NOTIFY_API_URL'] ?? 'http://localhost:8081',
)

type Json = Record<string, unknown>

// ─── People ─────────────────────────────────────────────────────────────────

export type ActivitiesPersona = 'sales' | 'accounting' | 'admin'

const PERSONA_ROLES: Record<Exclude<ActivitiesPersona, 'admin'>, string[]> = {
  sales: ['employee', 'sales'],
  accounting: ['employee', 'accounting'],
}

export interface Person extends SeededSession {
  name: string
  persona: ActivitiesPersona
}

let sharedAdmin: SeededSession | null = null

/** One admin session per worker process. A fixed e-mail: idempotent, and never removed by cleanupPeople. */
export async function activitiesAdmin(): Promise<Person> {
  sharedAdmin ??= await seedAdminSession('act-qe-admin@operai.test', 'Activities QE Admin')
  return { ...sharedAdmin, name: 'Activities QE Admin', persona: 'admin' }
}

async function authAdminCall<T = Json>(
  admin: SeededSession,
  method: string,
  route: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${AUTH_URL}${route}`, {
    method,
    headers: {
      // auth's own /admin/* routes are cookie-session guarded (the Bearer form 401s)
      Cookie: admin.cookieHeader,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`[activitiesFixtures] ${method} ${route} -> ${res.status}: ${text}`)
  return (text ? JSON.parse(text) : {}) as T
}

async function setRoles(userId: string, roleNames: string[], email: string): Promise<void> {
  if (!/^act-[a-z-]+-[0-9-]+@operai\.test$/.test(email)) {
    throw new Error(`[activitiesFixtures] refusing to change roles of ${email}: not a dedicated activities persona`)
  }
  const admin = await activitiesAdmin()
  const roles = await authAdminCall<{ items?: { id: string; name: string }[] } | { id: string; name: string }[]>(
    admin,
    'GET',
    '/admin/roles',
  )
  const list = Array.isArray(roles) ? roles : (roles.items ?? [])
  const roleIds = roleNames.map((name) => {
    const role = list.find((r) => r.name === name)
    if (!role) throw new Error(`[activitiesFixtures] role "${name}" does not exist (has the auth seed run?)`)
    return role.id
  })
  await authAdminCall(admin, 'PUT', `/admin/users/${userId}/roles`, { roleIds })
}

/** Seeds a session for a new `@operai.test` user left with the persona's roles (a per-run e-mail, see newRunId). */
export async function seedPerson(
  label: string,
  persona: Exclude<ActivitiesPersona, 'admin'>,
  runId: string,
): Promise<Person> {
  const name = `Act ${label} ${runId}`
  const email = `act-${label}-${runId}@operai.test`
  const first = await seedUserSession(email, name)
  await setRoles(first.userId, PERSONA_ROLES[persona], email)
  const session = await seedUserSession(email, name)
  return { ...session, name, persona }
}

/**
 * Replaces a dedicated persona's roles (e.g. a salesperson who loses the CRM: AC-7.4) and returns the person
 * with a FRESH token. The role change bumps `perm_epoch`, but the epoch is a claim of the token: a resource
 * server caches permissions by `(sub, perm_epoch)` for up to 30 s (ADR 20260716-refund-api-authorization-enforcing-resource-server), so the old token would still be
 * answered with the old grants. The browser gets a new token the same way, by signing in again.
 */
export async function changePersona(
  person: Person,
  persona: Exclude<ActivitiesPersona, 'admin'>,
): Promise<Person> {
  await setRoles(person.userId, PERSONA_ROLES[persona], person.email)
  const session = await seedUserSession(person.email, person.name)
  return { ...session, name: person.name, persona }
}

/** A fresh signed-in browser context for `session` (multi-person journeys). */
export async function personContext(
  browser: { newContext: () => Promise<BrowserContext> },
  session: SeededSession,
): Promise<BrowserContext> {
  const context = await browser.newContext()
  await signInContext(context, session)
  return context
}

// ─── REST ───────────────────────────────────────────────────────────────────

export interface ApiResult<T = Json> {
  status: number
  body: T
}

/** A JSON call to `base` as `session`. Never throws on a status: the caller asserts what it expects. */
export async function apiCall<T = Json>(
  base: string,
  session: SeededSession,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  route: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: unknown = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  return { status: res.status, body: parsed as T }
}

/** A setup call that must succeed: any non-2xx stops the run with the Problem body in the message. */
async function mustCall<T = Json>(
  base: string,
  session: SeededSession,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  route: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const result = await apiCall<T>(base, session, method, route, body, headers)
  if (result.status < 200 || result.status >= 300) {
    // Hint for the single most likely local fault: the stack was started before this feature.
    const hint =
      result.status === 401 || result.status === 404 || result.status === 503
        ? ' (is the stack started with the specs/20261110-activities env? see the header of activities-crm.spec.ts)'
        : ''
    throw new Error(
      `[activitiesFixtures] ${method} ${base}${route} -> ${result.status}: ${JSON.stringify(result.body).slice(0, 400)}${hint}`,
    )
  }
  return result.body
}

// ─── CRM (pre-sales) ────────────────────────────────────────────────────────

export interface CompanyRow {
  id: string
  name: string
}
export interface DealRow {
  id: string
  title: string
}

export async function createCompanyViaApi(admin: SeededSession, name: string): Promise<CompanyRow> {
  return mustCall<CompanyRow>(CRM_API_URL, admin, 'POST', '/companies', {
    name,
    status: 'prospect',
    entity: 'welld_ch',
  })
}

export async function createDealViaApi(admin: SeededSession, companyId: string, title: string): Promise<DealRow> {
  return mustCall<DealRow>(CRM_API_URL, admin, 'POST', '/deals', {
    companyId,
    title,
    currency: 'CHF',
    entity: 'welld_ch',
  })
}

// ─── Projects ───────────────────────────────────────────────────────────────

export interface ProjectRow {
  id: string
  name: string
  version: number
  state: string
}

const ifMatch = (version: number): Record<string, string> => ({ 'If-Match': `"${version}"` })

/** An internal project (no company, no contract) managed by `admin`, on the welld_ch entity. */
export async function createProjectViaApi(admin: SeededSession, name: string): Promise<ProjectRow> {
  return mustCall<ProjectRow>(PROJECTS_API_URL, admin, 'POST', '/projects', {
    name,
    type: 'internal',
    entity: 'welld_ch',
  })
}

/** Replaces the team (user ids must hold projects:access). Returns the project with its new version. */
export async function setTeamViaApi(
  admin: SeededSession,
  project: ProjectRow,
  memberIds: string[],
): Promise<ProjectRow> {
  return mustCall<ProjectRow>(
    PROJECTS_API_URL,
    admin,
    'PUT',
    `/projects/${project.id}/team`,
    { memberIds },
    ifMatch(project.version),
  )
}

/** planned -> active -> closed (AC-3.8's "closed project"). */
export async function closeProjectViaApi(admin: SeededSession, project: ProjectRow): Promise<ProjectRow> {
  const active = await mustCall<ProjectRow>(
    PROJECTS_API_URL,
    admin,
    'POST',
    `/projects/${project.id}/transitions`,
    { to: 'active' },
    ifMatch(project.version),
  )
  return mustCall<ProjectRow>(
    PROJECTS_API_URL,
    admin,
    'POST',
    `/projects/${project.id}/transitions`,
    { to: 'closed' },
    ifMatch(active.version),
  )
}

// ─── activities-api ─────────────────────────────────────────────────────────

export interface TaskRow {
  id: string
  subject: string
  task: { completedAt: string | null; blocked?: boolean; assignee: { id: string } | null }
  may: { edit: boolean; delete: boolean; complete: boolean }
}

export interface NewTask {
  subject: string
  projectId?: string
  companyId?: string
  dealId?: string
  dueDate?: string | null
  assigneeUserId?: string
  blockedByIds?: string[]
  participantIds?: string[]
}

/** The raw create call (type is always task here): returns the status so a spec can assert a refusal. */
export function tryCreateTask(session: SeededSession, input: NewTask): Promise<ApiResult<TaskRow & Json>> {
  return apiCall(ACTIVITIES_API_URL, session, 'POST', '/activities', { type: 'task', ...input })
}

/** Creates a task through the API (setup only; the journeys that test creation use the form). */
export async function createTaskViaApi(session: SeededSession, input: NewTask): Promise<TaskRow> {
  return mustCall<TaskRow>(ACTIVITIES_API_URL, session, 'POST', '/activities', { type: 'task', ...input })
}

/** A non-task activity at a company (a call), optionally with participants. */
export async function createCallViaApi(
  session: SeededSession,
  input: { subject: string; companyId: string; participantIds?: string[] },
): Promise<TaskRow> {
  return mustCall<TaskRow>(ACTIVITIES_API_URL, session, 'POST', '/activities', { type: 'call', ...input })
}

export function completeTaskViaApi(session: SeededSession, id: string): Promise<ApiResult<TaskRow & Json>> {
  return apiCall(ACTIVITIES_API_URL, session, 'POST', `/activities/${encodeURIComponent(id)}/complete`)
}

/**
 * One task as its host lists it (activities-api has no read-by-id route: a task is read through the list of the
 * project or company it belongs to, which is also what the UI does). `null` when it is not there.
 */
export async function getTaskViaApi(
  session: SeededSession,
  id: string,
  where: { projectId: string } | { companyId: string },
): Promise<TaskRow | null> {
  const pages =
    'projectId' in where
      ? await Promise.all(
          (['open', 'done'] as const).map((status) => listProjectTasksViaApi(session, where.projectId, status)),
        )
      : [
          await mustCall<{ items: TaskRow[]; total: number }>(
            ACTIVITIES_API_URL,
            session,
            'GET',
            `/activities?companyId=${encodeURIComponent(where.companyId)}&pageSize=100`,
          ),
        ]
  return pages.flatMap((page) => page.items).find((task) => task.id === id) ?? null
}

/** A project's tasks as the server lists them (the order is the server's). */
export async function listProjectTasksViaApi(
  session: SeededSession,
  projectId: string,
  status: 'open' | 'done' = 'open',
): Promise<{ items: TaskRow[]; total: number }> {
  return mustCall(
    ACTIVITIES_API_URL,
    session,
    'GET',
    `/tasks?projectId=${encodeURIComponent(projectId)}&status=${status}&pageSize=100`,
  )
}

/**
 * The id of the task titled `subject` on a project (any state), polling briefly: a task made in the browser
 * is committed before the dialog closes, but the poll keeps the helper honest about eventual reads.
 */
export async function findProjectTaskId(session: SeededSession, projectId: string, subject: string): Promise<string> {
  const deadline = Date.now() + 15_000
  for (;;) {
    for (const status of ['open', 'done'] as const) {
      const page = await listProjectTasksViaApi(session, projectId, status)
      const hit = page.items.find((task) => task.subject === subject)
      if (hit) return hit.id
    }
    if (Date.now() > deadline)
      throw new Error(`[activitiesFixtures] task "${subject}" not found on project ${projectId}`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/** The id of the pre-sales activity titled `subject` at a company. */
export async function findCompanyActivityId(
  session: SeededSession,
  companyId: string,
  subject: string,
): Promise<string> {
  const deadline = Date.now() + 15_000
  for (;;) {
    const page = await mustCall<{ items: TaskRow[] }>(
      ACTIVITIES_API_URL,
      session,
      'GET',
      `/activities?companyId=${encodeURIComponent(companyId)}&pageSize=100`,
    )
    const hit = page.items.find((activity) => activity.subject === subject)
    if (hit) return hit.id
    if (Date.now() > deadline)
      throw new Error(`[activitiesFixtures] activity "${subject}" not found at company ${companyId}`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

// ─── notify-api ─────────────────────────────────────────────────────────────

export interface NotificationRow {
  id: string
  title: string
  originApp: string
  link: { href: string } | null
}

/** The caller's notifications as notify-api lists them (newest first). */
export async function listNotificationsViaApi(session: SeededSession): Promise<NotificationRow[]> {
  const result = await mustCall<{ items: NotificationRow[] }>(NOTIFY_API_URL, session, 'GET', '/notifications')
  return result.items
}

// ─── Browser helpers ────────────────────────────────────────────────────────

export type ActivitiesOutage = 'maintenance' | 'host_unavailable'

const OUTAGE_DETAIL: Record<ActivitiesOutage, string> = {
  maintenance: 'Activities are temporarily unavailable while they are being moved. Try again shortly.',
  host_unavailable: 'The service could not confirm your access.',
}

/**
 * Makes activities-api answer 503 `maintenance` (or `host_unavailable`) to ONE page, exactly the Problem
 * body the service sends (activities-api/src/lib/maintenance.ts): the browser sees what it would see while
 * ACTIVITIES_MAINTENANCE=true. Returns a function that lifts the outage (the next request reaches the real
 * service). The CORS headers are those of the real service: without them the browser would hide the 503 as
 * a network error, which is a different state.
 */
export async function stubActivitiesApi(page: Page, code: ActivitiesOutage): Promise<() => Promise<void>> {
  const pattern = `${ACTIVITIES_API_URL}/**`
  await page.route(pattern, (route) => {
    const request = route.request()
    const origin = request.headers()['origin'] ?? ''
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers':
        request.headers()['access-control-request-headers'] ?? 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      vary: 'Origin',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    return route.fulfill({
      status: 503,
      headers: { ...cors, 'content-type': 'application/problem+json' },
      body: JSON.stringify({
        type: 'https://httpstatuses.com/503',
        title: 'Service Unavailable',
        status: 503,
        detail: OUTAGE_DETAIL[code],
        instance: new URL(request.url()).pathname,
        code,
      }),
    })
  })
  return () => page.unroute(pattern)
}
