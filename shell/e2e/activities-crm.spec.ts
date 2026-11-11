/**
 * specs/028-activities T21 — the CRM side of the activities move, through the REAL assembled shell and
 * crm-ui against the REAL crm-api, activities-api, projects-api and auth.
 *
 *   AC-1.1  the CRM's activities, tasks and blockers behave as before the move (log a note, a task, a task
 *           blocked by another; complete / reopen / edit / delete; participants; the deal link)
 *   AC-7.1  the CRM's Tasks list shows pre-sales tasks only, never a project task
 *   AC-1.5  with activities-api unreachable the CRM pages still load and say activities are unavailable
 *
 * The other activities journeys: activities-projects.spec.ts (the project Tasks card, AC-3.x/4.x/5.2),
 * activities-my-tasks.spec.ts (My tasks, AC-7.2..7.4) and activities-notify.spec.ts (AC-6.1). Meeting
 * activities on a deal (AC-1.4) stay covered by meetings-deal.spec.ts, which runs in the `meetings` project.
 *
 * ═══ PREREQUISITES (what must be running, with which env) ═══════════════════════════════════════════════
 * Everything below is the specs/028 wiring on top of the stack the other e2e specs already need
 * (Postgres/MinIO, auth :3001 with ENABLE_TEST_AUTH=true, notify-api :8081, crm-api :8084, projects-api :8086).
 * A stack started BEFORE this feature lacks all of it and these specs then fail at setup (401/404/503 from the
 * fixture calls, which say so in their message), they do not skip.
 *
 *  activities-api (:8087, `cd activities-api && direnv exec . bun run dev`; DB `activities` migrated with
 *  `bun run db:deploy`; copy .env.example, which lists every key):
 *    DATABASE_URL, AUTH_JWKS_URL, AUTH_ISSUER, AUTH_AUDIENCE (= the other services'), AUTH_BASE_URL,
 *    ALLOWED_ORIGINS=http://localhost:5173 (the SHELL origin: the remotes run inside it; with E2E_SHELL_PORT
 *    use that origin), CRM_API_URL=http://localhost:8084, PROJECTS_API_URL=http://localhost:8086,
 *    ACTIVITIES_MAINTENANCE=false (or unset),
 *    NOTIFY_INTERNAL_URL=http://localhost:8081 + SERVICE_CLIENT_ID=activities-api +
 *    SERVICE_CLIENT_SECRET (>= 32 chars)  -- all three or none; without them AC-6.1 cannot pass,
 *    SERVICE_AUDIENCE (= auth's SERVICE_AUDIENCE, different from AUTH_AUDIENCE).
 *  auth (:3001): SERVICE_CLIENTS gains
 *    "activities-api":{"secret":"<the SERVICE_CLIENT_SECRET above>","scope":"notifications.push emails.send"}
 *    and the existing "crm-api" client gains the scope `activities.write` (crm-api's calls to activities-api);
 *    the auth seed must have run (roles sales/accounting, the projects catalog).
 *  crm-api (:8084): ACTIVITIES_API_URL=http://localhost:8087 (with its SERVICE_CLIENT_ID/SECRET already set),
 *    ALLOWED_ORIGINS containing the shell origin.
 *  projects-api (:8086): ALLOWED_ORIGINS containing the shell origin; ACTIVITIES_API_URL is not needed (the
 *    project is a host that ANSWERS activities-api's resolve calls).
 *  notify-api (:8081): SERVICE_AUDIENCE set; origin binding for `system:activities-api` to `crm` and `projects`.
 *  shell build: VITE_ACTIVITIES_API_URL=http://localhost:8087 and VITE_PROJECTS_API_URL=http://localhost:8086
 *    (shell/playwright.config.ts passes both to its `build && preview` webServer; an ALREADY RUNNING shell on
 *    :5173 is reused as is and must have been built with them), plus PROJECTS_REMOTE_URL (set by the config).
 *  frontends: shell, notify-ui, crm-ui, projects-ui (the config builds and serves them; to reuse a `mise run dev`
 *    stack: E2E_CRM_REMOTE_PORT=5179 E2E_MEETINGS_REMOTE_PORT=5180 E2E_PROJECTS_REMOTE_PORT=5181).
 *  run:  cd shell && pnpm e2e activities-            (all four specs)   |   pnpm e2e activities-crm.spec.ts
 *
 * "activities-api in maintenance" (AC-1.5) is simulated in the browser (helpers/activitiesFixtures.ts
 * `stubActivitiesApi`): the harness never restarts a service other journeys share. The real
 * ACTIVITIES_MAINTENANCE=true answer is covered by activities-api's own maintenance.test.ts.
 */
import { expect, test } from '@playwright/test'
import {
  activitiesAdmin,
  cleanupPeople,
  createCallViaApi,
  createCompanyViaApi,
  createDealViaApi,
  createProjectViaApi,
  createTaskViaApi,
  findCompanyActivityId,
  newRunId,
  personContext,
  seedPerson,
  setTeamViaApi,
  stubActivitiesApi,
  type CompanyRow,
  type DealRow,
  type Person,
} from './helpers/activitiesFixtures'

const runId = newRunId()

test.describe.configure({ mode: 'serial' })

test.describe('specs/028 T21: the CRM keeps working (US-1) and shows only pre-sales tasks (AC-7.1)', () => {
  let admin: Person
  let sales: Person
  let company: CompanyRow
  let deal: DealRow

  test.beforeAll(async () => {
    admin = await activitiesAdmin()
    sales = await seedPerson('crm-sales', 'sales', runId)
    company = await createCompanyViaApi(admin, `Act CRM Co ${runId}`)
    deal = await createDealViaApi(admin, company.id, `Act deal ${runId}`)
  })

  test.afterAll(async () => {
    await cleanupPeople(runId)
  })

  test('company page: log a note, a task and a task blocked by it; complete, reopen, edit, delete (AC-1.1)', async ({
    browser,
  }) => {
    const ctx = await personContext(browser, sales)
    const page = await ctx.newPage()
    const noteSubject = `Intro call notes ${runId}`
    const firstTask = `Send the offer ${runId}`
    const secondTask = `Review the offer ${runId}`

    await page.goto(`/crm/companies/${company.id}`)
    await expect(page.getByRole('heading', { name: company.name })).toBeVisible({ timeout: 30_000 })
    const card = page.getByTestId('crm-activity-card')
    await expect(card).toBeVisible()
    await expect(card.getByText('No activity yet')).toBeVisible()

    // A note (the dialog's default type).
    await page.getByTestId('crm-activity-log').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Subject').fill(noteSubject)
    await page.getByTestId('crm-activity-form-submit').click()
    await expect(page.getByText('Activity logged.')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('crm-activity-list').getByText(noteSubject)).toBeVisible()

    // A task with a due date, assigned to its author by default.
    await page.getByTestId('crm-activity-log').click()
    await page.getByLabel('Type').selectOption('task')
    await page.getByRole('dialog').getByLabel('Subject').fill(firstTask)
    await page.getByRole('dialog').getByLabel('Due date').fill('2031-04-01')
    await page.getByTestId('crm-activity-form-submit').click()
    await expect(page.getByTestId('crm-activity-list').getByText(firstTask)).toBeVisible({ timeout: 15_000 })
    const firstId = await findCompanyActivityId(sales, company.id, firstTask)
    const firstRow = page.getByTestId(`crm-activity-${firstId}`)
    await expect(firstRow).toContainText('Due 01.04.2031')
    await expect(firstRow).toContainText(`Assigned to ${sales.name}`)

    // A task blocked by the first one (US-6): shown Blocked, waiting on it, and Mark done is inert.
    await page.getByTestId('crm-activity-log').click()
    await page.getByLabel('Type').selectOption('task')
    await page.getByRole('dialog').getByLabel('Subject').fill(secondTask)
    await page.getByRole('checkbox', { name: firstTask }).check()
    await page.getByTestId('crm-activity-form-submit').click()
    await expect(page.getByTestId('crm-activity-list').getByText(secondTask)).toBeVisible({ timeout: 15_000 })
    const secondId = await findCompanyActivityId(sales, company.id, secondTask)
    const secondRow = page.getByTestId(`crm-activity-${secondId}`)
    await expect(secondRow).toContainText('Blocked')
    await expect(page.getByTestId(`crm-activity-${secondId}-waiting`)).toContainText(`Waiting on: ${firstTask}`)
    const secondToggle = page.getByTestId(`crm-activity-${secondId}-toggle`)
    await expect(secondToggle).toHaveAttribute('aria-disabled', 'true')
    // aria-disabled: Playwright would wait forever for it to become enabled, so force the (ignored) click
    await secondToggle.click({ force: true })
    await expect(secondRow).toContainText('Blocked') // the click was ignored: still waiting

    // Completing the blocker unblocks the second task, which can then be completed and reopened.
    await page.getByTestId(`crm-activity-${firstId}-toggle`).click()
    await expect(page.getByText('Activity saved.')).toBeVisible({ timeout: 15_000 })
    await expect(firstRow).toContainText('Done')
    await expect(page.getByTestId(`crm-activity-${secondId}-waiting`)).toHaveCount(0)
    await expect(secondToggle).not.toHaveAttribute('aria-disabled', 'true')
    await secondToggle.click()
    await expect(secondRow).toContainText('Done', { timeout: 15_000 })
    await expect(secondToggle).toHaveText('Reopen')
    await secondToggle.click()
    await expect(secondRow).not.toContainText('Done', { timeout: 15_000 })
    await expect(secondToggle).toHaveText('Mark done')

    // The author edits and deletes their own activity (AC-4.2 of specs/017).
    await firstRow.getByRole('button', { name: 'Edit' }).click()
    const editDialog = page.getByRole('dialog')
    await editDialog.getByLabel('Subject').fill(`${firstTask} (revised)`)
    await page.getByTestId('crm-activity-form-submit').click()
    await expect(page.getByTestId('crm-activity-list').getByText(`${firstTask} (revised)`)).toBeVisible({
      timeout: 15_000,
    })
    await page.getByTestId(`crm-activity-${firstId}`).getByRole('button', { name: 'Delete' }).click()
    await page.getByTestId('crm-activity-delete-confirm').click()
    await expect(page.getByText('Activity deleted.')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId(`crm-activity-${firstId}`)).toHaveCount(0)
    // The other task is untouched by it.
    await expect(page.getByTestId(`crm-activity-${secondId}`)).toBeVisible()
    await ctx.close()
  })

  test('a participant is shown ("With …") and an activity logged from the deal page keeps its deal (AC-1.1, specs/017 US-8)', async ({
    browser,
  }) => {
    const subject = `Kickoff call ${runId}`
    await createCallViaApi(sales, { subject, companyId: company.id, participantIds: [admin.userId] })

    const ctx = await personContext(browser, sales)
    const page = await ctx.newPage()
    await page.goto(`/crm/companies/${company.id}`)
    const callId = await findCompanyActivityId(sales, company.id, subject)
    await expect(page.getByTestId(`crm-activity-${callId}`)).toContainText(`With ${admin.name}`, { timeout: 30_000 })

    // From the deal page the composer fixes the deal: no deal choice, and the company timeline says "About <deal>".
    const dealNote = `Deal note ${runId}`
    await page.goto(`/crm/deals/${deal.id}`)
    await expect(page.getByTestId('crm-activity-card')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('crm-activity-log').click()
    await page.getByRole('dialog').getByLabel('Subject').fill(dealNote)
    await page.getByTestId('crm-activity-form-submit').click()
    await expect(page.getByTestId('crm-activity-list').getByText(dealNote)).toBeVisible({ timeout: 15_000 })
    await page.goto(`/crm/companies/${company.id}`)
    const noteId = await findCompanyActivityId(sales, company.id, dealNote)
    await expect(page.getByTestId(`crm-activity-${noteId}`)).toContainText(`About ${deal.title}`, { timeout: 30_000 })
    await ctx.close()
  })

  test('the CRM Tasks list shows pre-sales tasks only, never a project task (AC-7.1)', async ({ browser }) => {
    const preSales = `Call the client back ${runId}`
    const projectTaskSubject = `Deliver the report ${runId}`
    // Both tasks get the earliest due dates so they sort to the top of page 1 (earliest due first) however
    // many open tasks the local database has accumulated: the Everyone list is paginated (25 a page), and a
    // task with no due date sorts last and fell to page 2. A leaked project task would be on page 1 too.
    await createTaskViaApi(sales, { subject: preSales, companyId: company.id, dueDate: '2000-01-01' })
    // A project task assigned to the same person (the project's team must include them to be assignable).
    const project = await setTeamViaApi(admin, await createProjectViaApi(admin, `Act AC-7.1 ${runId}`), [sales.userId])
    await createTaskViaApi(admin, {
      subject: projectTaskSubject,
      projectId: project.id,
      assigneeUserId: sales.userId,
      dueDate: '2000-01-01',
    })

    const ctx = await personContext(browser, sales)
    const page = await ctx.newPage()
    await page.goto('/crm/tasks')
    await expect(page.getByTestId('crm-tasks-page')).toBeVisible({ timeout: 30_000 })
    const list = page.getByTestId('crm-tasks-list')
    await expect(list.getByText(preSales)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(projectTaskSubject)).toHaveCount(0)

    // "Everyone" widens the people, not the kind: the project task still does not appear.
    await page.getByLabel('Assigned to').selectOption('any')
    await expect(list.getByText(preSales)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(projectTaskSubject)).toHaveCount(0)
    await ctx.close()
  })

  test('activities-api in maintenance: the company page still loads and says activities are paused; Retry recovers (AC-1.5)', async ({
    browser,
  }) => {
    const quiet = await createCompanyViaApi(admin, `Act quiet Co ${runId}`)
    const ctx = await personContext(browser, sales)
    const page = await ctx.newPage()
    const lift = await stubActivitiesApi(page, 'maintenance')

    await page.goto(`/crm/companies/${quiet.id}`)
    // The page frame renders: header, the other cards, the activity card itself.
    await expect(page.getByRole('heading', { name: quiet.name })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Contacts', exact: true })).toBeVisible()
    await expect(page.getByTestId('crm-activity-card')).toBeVisible()
    // The list area says activities are unavailable, in the maintenance words, with Retry (not the auth outage).
    const banner = page.getByTestId('crm-activities-unavailable')
    await expect(banner).toBeVisible({ timeout: 30_000 })
    await expect(banner).toContainText('Activities are paused for maintenance')
    await expect(page.getByText('Authorization service unavailable')).toHaveCount(0)

    // Back up: Retry reaches the real service and the empty timeline appears.
    await lift()
    await page.getByTestId('crm-activities-unavailable-retry').click()
    await expect(banner).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByTestId('crm-activity-card').getByText('No activity yet')).toBeVisible()
    await ctx.close()
  })

  test('activities-api cannot confirm access: the Tasks page keeps its frame and says so (AC-1.5)', async ({
    browser,
  }) => {
    const ctx = await personContext(browser, sales)
    const page = await ctx.newPage()
    await stubActivitiesApi(page, 'host_unavailable')

    await page.goto('/crm/tasks')
    await expect(page.getByTestId('crm-tasks-page')).toBeVisible({ timeout: 30_000 })
    // The filters and the tabs stay; only the list area is replaced.
    await expect(page.getByLabel('Assigned to')).toBeVisible()
    await expect(page.getByTestId('crm-tasks-tabs')).toBeVisible()
    const banner = page.getByTestId('crm-activities-unavailable')
    await expect(banner).toBeVisible({ timeout: 30_000 })
    await expect(banner).toContainText('Activities cannot be shown right now')
    await expect(page.getByText('Authorization service unavailable')).toHaveCount(0)
    await ctx.close()
  })
})
