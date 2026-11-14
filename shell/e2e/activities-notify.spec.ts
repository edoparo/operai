/**
 * specs/20261110-activities T21 — a project task assigned to a team member reaches their notification center
 * (AC-6.1), through the REAL assembled shell, projects-ui and notify-ui against the REAL activities-api (which
 * pushes as `system:activities-api`), notify-api, projects-api and auth.
 *
 *   AC-6.1  the project manager assigns a task in the dialog -> the member's `/notify` lists it with the origin
 *           "Projects", and the row opens `/projects/<id>` (the project page, on its Tasks card);
 *           the person assigning is not notified of their own action
 *
 * The notification is best effort and async (AC-6.4): the spec polls notify-api for it, then drives the UI.
 * Needs activities-api's NOTIFY_INTERNAL_URL / SERVICE_CLIENT_ID / SERVICE_CLIENT_SECRET, the matching
 * `activities-api` SERVICE_CLIENTS entry in auth (scope `notifications.push emails.send`) and notify-api's origin
 * binding for it: without them nothing is pushed and this spec fails at the poll with that explanation.
 * Prerequisites in full: see the header of activities-crm.spec.ts.
 */
import { expect, test } from '@playwright/test'
import {
  activitiesAdmin,
  cleanupPeople,
  createProjectViaApi,
  createTaskViaApi,
  findProjectTaskId,
  listNotificationsViaApi,
  newRunId,
  personContext,
  seedPerson,
  setTeamViaApi,
  type Person,
} from './helpers/activitiesFixtures'

const runId = newRunId()

test.describe('specs/20261110-activities T21: a project task reaches the assignee’s notifications (AC-6.1)', () => {
  let admin: Person
  let member: Person

  test.beforeAll(async () => {
    admin = await activitiesAdmin()
    member = await seedPerson('notify-member', 'accounting', runId)
  })

  test.afterAll(async () => {
    await cleanupPeople(runId)
  })

  test('assigning a task to a team member notifies them under "Projects" and the row opens the project', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const project = await setTeamViaApi(admin, await createProjectViaApi(admin, `Act notify ${runId}`), [member.userId])
    // A task the manager keeps for themselves: assigning to yourself notifies nobody.
    await createTaskViaApi(admin, { subject: `Own task ${runId}`, projectId: project.id })

    // The manager assigns a new task to the member, in the real dialog.
    const title = `Review the contract ${runId}`
    const managerCtx = await personContext(browser, admin)
    const manager = await managerCtx.newPage()
    await manager.goto(`/projects/${project.id}`)
    await expect(manager.getByTestId('project-tasks')).toBeVisible({ timeout: 30_000 })
    await manager.getByTestId('project-tasks-add').click()
    const dialog = manager.getByRole('dialog', { name: 'Add task' })
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByLabel('Due date').fill('2031-02-01')
    await dialog.getByLabel('Assignee').selectOption({ label: member.name })
    await manager.getByTestId('task-form-submit').click()
    await expect(manager.getByText('Task added.')).toBeVisible({ timeout: 15_000 })
    const taskId = await findProjectTaskId(admin, project.id, title)
    await managerCtx.close()

    // The push lands in notify-api (best effort, so polled): English copy, origin projects, link to the project.
    let notificationId = ''
    await expect
      .poll(
        async () => {
          const found = (await listNotificationsViaApi(member)).find((n) => n.title === `New task: ${title}`)
          notificationId = found?.id ?? ''
          return found ? [found.originApp, found.link?.href] : null
        },
        {
          timeout: 30_000,
          message:
            'no notification reached the assignee: is activities-api configured to push (NOTIFY_INTERNAL_URL, SERVICE_CLIENT_*), ' +
            'does auth list its client with scope "notifications.push emails.send", and does notify-api bind it to origin "projects"?',
        },
      )
      .toEqual(['projects', `/projects/${project.id}`])
    // The person who assigned is not told about their own action, nor about the task they kept.
    const adminTitles = (await listNotificationsViaApi(admin)).map((n) => n.title)
    expect(adminTitles).not.toContain(`New task: ${title}`)
    expect(adminTitles).not.toContain(`New task: Own task ${runId}`)

    // The member opens their notification center: the row names the origin and opens the project.
    const memberCtx = await personContext(browser, member)
    const page = await memberCtx.newPage()
    await page.goto('/notify')
    const item = page.getByTestId(`notification-item-${notificationId}`)
    await expect(item).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId(`notification-origin-${notificationId}`)).toHaveText('Projects')
    await expect(page.getByTestId(`notification-title-${notificationId}`)).toHaveText(`New task: ${title}`)
    await expect(item).toContainText(`Project: Act notify ${runId}`)
    await item.click()
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`), { timeout: 30_000 })
    // The project page lands on its Tasks card, where the task is the member's to mark done.
    await expect(page.getByTestId('project-tasks')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId(`project-task-${taskId}`)).toContainText(title)
    await expect(page.getByTestId(`project-task-${taskId}-toggle`)).toBeVisible()
    await memberCtx.close()
  })
})
