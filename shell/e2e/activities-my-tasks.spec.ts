/**
 * specs/028-activities T21 — My tasks in the project module (`/projects/tasks`), through the REAL assembled
 * shell, projects-ui and crm-ui against the REAL activities-api, crm-api, projects-api and auth.
 *
 *   AC-7.2  the caller's project tasks and pre-sales tasks in one list, in the order of AC-3.4, every pre-sales
 *           task with a visible "Pre-sales" badge
 *   AC-7.3  a pre-sales task can be marked done / not done there (under the CRM's rules) and opened in the CRM;
 *           nothing else about it can be changed from the project module
 *   AC-7.4  a caller who cannot read the CRM sees no pre-sales task (and no notice about it)
 *
 * AC-7.5 (CRM unreachable: project tasks still listed, a notice says pre-sales ones could not be loaded) needs
 * activities-api to fail to reach crm-api, which this harness cannot cause without stopping a service; it is
 * covered by activities-api's tasks.test.ts and MyTasksPage.test.tsx.
 *
 * Prerequisites: see the header of activities-crm.spec.ts (same stack, same env).
 */
import { expect, test } from '@playwright/test'
import {
  ACTIVITIES_API_URL,
  activitiesAdmin,
  apiCall,
  changePersona,
  cleanupPeople,
  createCompanyViaApi,
  createProjectViaApi,
  createTaskViaApi,
  getTaskViaApi,
  newRunId,
  personContext,
  seedPerson,
  setTeamViaApi,
  type CompanyRow,
  type Person,
  type ProjectRow,
  type TaskRow,
} from './helpers/activitiesFixtures'

const runId = newRunId()

test.describe.configure({ mode: 'serial' })

test.describe('specs/028 T21: My tasks with pre-sales tasks (US-7)', () => {
  let admin: Person
  let sales: Person
  let company: CompanyRow
  let project: ProjectRow
  // The caller's tasks: a pre-sales one due first, a project one due later, a project one with no due date.
  let preSales: TaskRow
  let dueLater: TaskRow
  let noDue: TaskRow
  let someoneElses: TaskRow

  test.beforeAll(async () => {
    admin = await activitiesAdmin()
    sales = await seedPerson('my-sales', 'sales', runId)
    company = await createCompanyViaApi(admin, `Act MyTasks Co ${runId}`)
    project = await setTeamViaApi(admin, await createProjectViaApi(admin, `Act MyTasks ${runId}`), [sales.userId])
    preSales = await createTaskViaApi(sales, {
      subject: `Send the proposal ${runId}`,
      companyId: company.id,
      assigneeUserId: sales.userId,
      dueDate: '2030-01-01',
    })
    dueLater = await createTaskViaApi(admin, {
      subject: `Prepare the demo ${runId}`,
      projectId: project.id,
      assigneeUserId: sales.userId,
      dueDate: '2030-03-01',
    })
    noDue = await createTaskViaApi(admin, {
      subject: `Tidy the backlog ${runId}`,
      projectId: project.id,
      assigneeUserId: sales.userId,
    })
    someoneElses = await createTaskViaApi(admin, { subject: `Admin only ${runId}`, projectId: project.id })
  })

  test.afterAll(async () => {
    await cleanupPeople(runId)
  })

  test('one list of the caller’s project and pre-sales tasks, earliest due first, pre-sales marked (AC-7.2)', async ({
    browser,
  }) => {
    const ctx = await personContext(browser, sales)
    const page = await ctx.newPage()
    // Reached from the projects tool's own navigation, like a person would.
    await page.goto('/projects')
    await page.getByRole('link', { name: 'My tasks', exact: true }).click()
    await expect(page).toHaveURL(/\/projects\/tasks$/)
    await expect(page.getByRole('heading', { name: 'My tasks', exact: true })).toBeVisible({ timeout: 30_000 })
    const list = page.getByTestId('my-tasks-list')
    await expect(list).toBeVisible({ timeout: 30_000 })

    const rows = [preSales, dueLater, noDue].map((task) => page.getByTestId(`my-task-${task.id}`))
    for (const row of rows) await expect(row).toBeVisible()
    // The server's order, unsorted by the page: pre-sales (2030-01-01), project (2030-03-01), no due date last.
    const ys: number[] = []
    for (const row of rows) ys.push((await row.boundingBox())!.y)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    // Someone else's task is not mine.
    await expect(page.getByTestId(`my-task-${someoneElses.id}`)).toHaveCount(0)

    // The Pre-sales badge is on the pre-sales row only, with its company; project rows name their project.
    await expect(rows[0]!).toContainText('Pre-sales')
    await expect(rows[0]!).toContainText(`Company: ${company.name}`)
    await expect(rows[1]!).not.toContainText('Pre-sales')
    await expect(rows[1]!.getByRole('link', { name: project.name })).toBeVisible()
    await expect(rows[2]!).not.toContainText('Pre-sales')
    await expect(page.getByTestId('my-tasks-unavailable')).toHaveCount(0)
    await ctx.close()
  })

  test('a pre-sales task is marked done and not done from the project module and opened in the CRM, nothing more (AC-7.3)', async ({
    browser,
  }) => {
    const ctx = await personContext(browser, sales)
    const page = await ctx.newPage()
    await page.goto('/projects/tasks')
    const row = page.getByTestId(`my-task-${preSales.id}`)
    await expect(row).toBeVisible({ timeout: 30_000 })

    // Only the toggle and the CRM link: no Edit, no Delete, whatever the CRM would allow its author.
    await expect(row.getByRole('button')).toHaveCount(1)
    await expect(row.getByRole('button', { name: 'Mark done' })).toBeVisible()
    await expect(row.getByRole('button', { name: /Edit|Delete/ })).toHaveCount(0)
    const crmLink = row.getByRole('link', { name: `Open in CRM: ${preSales.subject}` })
    await expect(crmLink).toHaveAttribute('href', `/crm/companies/${company.id}`)

    // Done: leaves Open, appears in Done, and the CRM agrees (same record, same state).
    await page.getByTestId(`my-task-${preSales.id}-toggle`).click()
    await expect(page.getByText('Task marked done.')).toBeVisible({ timeout: 15_000 })
    await expect(row).toHaveCount(0)
    await page.getByTestId('my-tasks-tabs').getByRole('tab', { name: 'Done' }).click()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row).toContainText('Pre-sales')
    expect((await getTaskViaApi(sales, preSales.id, { companyId: company.id }))?.task.completedAt).toBeTruthy()
    await page.goto('/crm/tasks')
    await page.getByTestId('crm-tasks-tabs').getByRole('tab', { name: 'Done' }).click()
    await expect(page.getByTestId('crm-tasks-list').getByText(preSales.subject)).toBeVisible({ timeout: 30_000 })

    // Not done again, from the project module's Done view.
    await page.goto('/projects/tasks')
    await page.getByTestId('my-tasks-tabs').getByRole('tab', { name: 'Done' }).click()
    await page.getByTestId(`my-task-${preSales.id}-toggle`).click()
    await expect(page.getByText('Task marked not done.')).toBeVisible({ timeout: 15_000 })
    await expect(row).toHaveCount(0)
    expect((await getTaskViaApi(sales, preSales.id, { companyId: company.id }))?.task.completedAt).toBeNull()

    // "Open in CRM" lands on the company page in the CRM.
    await page.getByTestId('my-tasks-tabs').getByRole('tab', { name: 'Open' }).click()
    await page
      .getByTestId(`my-task-${preSales.id}`)
      .getByRole('link', { name: `Open in CRM: ${preSales.subject}` })
      .click()
    await expect(page).toHaveURL(new RegExp(`/crm/companies/${company.id}$`), { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: company.name })).toBeVisible({ timeout: 30_000 })

    // Anything else is the CRM's rules, not the project module's: a colleague who did not write the task is
    // refused an edit (specs/017 AC-4.2), whichever tool asks, and the task is unchanged.
    const edit = await apiCall(ACTIVITIES_API_URL, admin, 'PATCH', `/activities/${preSales.id}`, { subject: 'changed' })
    expect(edit.status).toBe(403)
    expect((await getTaskViaApi(sales, preSales.id, { companyId: company.id }))?.subject).toBe(preSales.subject)
    await ctx.close()
  })

  test('someone who cannot read the CRM sees their project tasks but no pre-sales task and no notice (AC-7.4)', async ({
    browser,
  }) => {
    // A salesperson holds a pre-sales task and a project task, then loses the CRM (keeps the projects module).
    let lost = await seedPerson('my-lost-crm', 'sales', runId)
    const lostProject = await setTeamViaApi(admin, await createProjectViaApi(admin, `Act MyTasks lost ${runId}`), [
      lost.userId,
    ])
    const hiddenPreSales = await createTaskViaApi(lost, {
      subject: `Chase the invoice ${runId}`,
      companyId: company.id,
      assigneeUserId: lost.userId,
    })
    const visibleProject = await createTaskViaApi(admin, {
      subject: `Update the roadmap ${runId}`,
      projectId: lostProject.id,
      assigneeUserId: lost.userId,
    })
    lost = await changePersona(lost, 'accounting')

    const ctx = await personContext(browser, lost)
    const page = await ctx.newPage()
    await page.goto('/projects/tasks')
    await expect(page.getByTestId(`my-task-${visibleProject.id}`)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId(`my-task-${hiddenPreSales.id}`)).toHaveCount(0)
    await expect(page.getByText('Pre-sales', { exact: true })).toHaveCount(0)
    // Silent by design: not being able to read the CRM is not an outage.
    await expect(page.getByTestId('my-tasks-unavailable')).toHaveCount(0)
    // The API says the same: no pre-sales item and nothing named unavailable.
    const mine = await apiCall<{ items: (TaskRow & { kind: string })[]; unavailable?: string[] }>(
      ACTIVITIES_API_URL,
      lost,
      'GET',
      '/tasks?kind=all&assignee=me&status=open',
    )
    expect(mine.status).toBe(200)
    expect(mine.body.items.map((task) => task.kind)).toEqual(['operational'])
    expect(mine.body.unavailable ?? []).toEqual([])
    await ctx.close()
  })
})
