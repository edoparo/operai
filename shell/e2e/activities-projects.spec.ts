/**
 * specs/20261110-activities T21 — the project page's Tasks card (projects-ui) through the REAL assembled shell
 * against the REAL projects-api, activities-api and auth.
 *
 *   AC-3.1  title required, due date and assignee optional (empty = the author); assignee limited to PM + team
 *   AC-3.2  create / edit / reassign / delete need manage-projects; without it the action is refused, nothing changes
 *   AC-3.3  the assignee marks a task done / not done without manage-projects
 *   AC-3.4  open tasks earliest due first, no due date last, overdue marked; a Done view
 *   AC-3.5  every projects:access holder reads every project's tasks
 *   AC-3.6  a project task is only a task (a note on a project is refused)
 *   AC-3.8  closed project: tasks readable and completable, creating / editing / deleting refused
 *   AC-4.1  blockers: no self-block, no cycle
 *   AC-4.2  a blocked task shows Blocked, lists what it waits on, cannot be marked done
 *   AC-5.2  the row shows "With …"
 *
 * Prerequisites: see the header of activities-crm.spec.ts (same stack, same env). Notifications (AC-6.1) are in
 * activities-notify.spec.ts, My tasks (AC-7.x) in activities-my-tasks.spec.ts.
 */
import { expect, test, type Page } from '@playwright/test'
import {
  ACTIVITIES_API_URL,
  activitiesAdmin,
  apiCall,
  cleanupPeople,
  closeProjectViaApi,
  completeTaskViaApi,
  createProjectViaApi,
  createTaskViaApi,
  findProjectTaskId,
  getTaskViaApi,
  listProjectTasksViaApi,
  newRunId,
  personContext,
  seedPerson,
  setTeamViaApi,
  tryCreateTask,
  type Person,
  type ProjectRow,
} from './helpers/activitiesFixtures'

const runId = newRunId()

test.describe.configure({ mode: 'serial' })

/** The Tasks card of the open project page, once it has rendered. */
async function openTasks(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}`)
  const card = page.getByTestId('project-tasks')
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(card.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible()
  return card
}

test.describe('specs/20261110-activities T21: the project Tasks card (US-3, US-4, US-5)', () => {
  let admin: Person
  let member: Person // on the team: projects:access, no manage
  let viewer: Person // NOT on the team: projects:access, no manage
  let outsider: Person // a projects user who is not on the project (AC-3.1)

  test.beforeAll(async () => {
    admin = await activitiesAdmin()
    member = await seedPerson('proj-member', 'accounting', runId)
    viewer = await seedPerson('proj-viewer', 'accounting', runId)
    outsider = await seedPerson('proj-outsider', 'sales', runId)
  })

  test.afterAll(async () => {
    await cleanupPeople(runId)
  })

  const freshProject = async (label: string, team: string[] = []): Promise<ProjectRow> => {
    const project = await createProjectViaApi(admin, `Act ${label} ${runId}`)
    return team.length > 0 ? setTeamViaApi(admin, project, team) : project
  }

  test('the manager adds, edits, reassigns, completes, reopens and deletes a task (AC-3.1, AC-3.2, AC-3.4)', async ({
    browser,
  }) => {
    const project = await freshProject('lifecycle', [member.userId])
    const ctx = await personContext(browser, admin)
    const page = await ctx.newPage()
    const card = await openTasks(page, project.id)

    // Empty state, with the pointer to Add task for a manager.
    await expect(card.getByText('No open tasks')).toBeVisible()
    await expect(card.getByText('Use Add task')).toBeVisible()

    // Add: title only; the assignee is left empty, so the task is the author's (AC-3.1).
    const title = `Write the kickoff plan ${runId}`
    await page.getByTestId('project-tasks-add').click()
    const dialog = page.getByRole('dialog', { name: 'Add task' })
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByLabel('Assignee').selectOption('')
    await page.getByTestId('task-form-submit').click()
    await expect(page.getByText('Task added.')).toBeVisible({ timeout: 15_000 })
    const id = await findProjectTaskId(admin, project.id, title)
    const row = page.getByTestId(`project-task-${id}`)
    await expect(row).toContainText(title)
    await expect(row).toContainText('No due date')
    await expect(row).toContainText(`Assigned to ${admin.name}`)

    // A title is required: an empty one is refused on the field and nothing is saved.
    await page.getByTestId('project-tasks-add').click()
    await page.getByTestId('task-form-submit').click()
    await expect(page.getByRole('dialog', { name: 'Add task' })).toBeVisible()
    await expect(page.getByTestId('task-form-subject')).toContainText(/required/i)
    await page.getByTestId('task-form-cancel').click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect((await listProjectTasksViaApi(admin, project.id)).total).toBe(1)

    // Edit + reassign to a team member, with a due date.
    await page.getByTestId(`project-task-${id}-edit`).click()
    const edit = page.getByRole('dialog', { name: 'Edit task' })
    await edit.getByLabel('Title').fill(`${title} v2`)
    await edit.getByLabel('Due date').fill('2031-03-01')
    await edit.getByLabel('Assignee').selectOption({ label: member.name })
    await page.getByTestId('task-form-submit').click()
    await expect(page.getByText('Task saved.')).toBeVisible({ timeout: 15_000 })
    await expect(row).toContainText(`${title} v2`)
    await expect(row).toContainText('Due 01.03.2031')
    await expect(row).toContainText(`Assigned to ${member.name}`)

    // The manager may mark it done although it is not theirs; it moves to Done and back.
    await page.getByTestId(`project-task-${id}-toggle`).click()
    await expect(page.getByText('Task marked done.')).toBeVisible({ timeout: 15_000 })
    await expect(row).toHaveCount(0)
    await card.getByRole('tab', { name: 'Done' }).click()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row).toContainText(`Done by ${admin.name}`)
    await page.getByTestId(`project-task-${id}-toggle`).click()
    await expect(page.getByText('Task marked not done.')).toBeVisible({ timeout: 15_000 })
    await expect(row).toHaveCount(0)
    await card.getByRole('tab', { name: 'Open' }).click()
    await expect(row).toBeVisible({ timeout: 15_000 })

    // Delete asks first, names the task, and removes it.
    await page.getByTestId(`project-task-${id}-delete`).click()
    // ConfirmDialog is an alertdialog (a destructive confirmation), not a plain dialog.
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText(`${title} v2`)
    await page.getByTestId('project-task-delete-confirm').click()
    await expect(page.getByText('Task deleted.')).toBeVisible({ timeout: 15_000 })
    await expect(row).toHaveCount(0)
    await expect(card.getByText('No open tasks')).toBeVisible()
    expect((await listProjectTasksViaApi(admin, project.id)).total).toBe(0)
    await ctx.close()
  })

  test('open tasks are ordered earliest due first, no due date last, overdue marked; a participant is shown; a reader sees them all without any action (AC-3.4, AC-3.5, AC-5.2)', async ({
    browser,
  }) => {
    const project = await freshProject('order', [member.userId])
    const mk = (suffix: string, extra: { dueDate?: string; participantIds?: string[] }) =>
      createTaskViaApi(admin, { subject: `${suffix} ${runId}`, projectId: project.id, ...extra })
    // Created out of order on purpose: the server's order is what the page must show.
    const nodue = await mk('No due date task', {})
    const later = await mk('Later task', { dueDate: '2031-06-01' })
    const soon = await mk('Soon task', { dueDate: '2031-05-01', participantIds: [member.userId] })
    const late = await mk('Late task', { dueDate: '2020-01-01' })
    const finished = await mk('Finished task', {})
    expect((await completeTaskViaApi(admin, finished.id)).status).toBe(200)

    // A reader who is not on the team and manages nothing (AC-3.5).
    const ctx = await personContext(browser, viewer)
    const page = await ctx.newPage()
    const card = await openTasks(page, project.id)
    await expect(page.getByTestId('project-tasks-add')).toHaveCount(0)
    for (const task of [late, soon, later, nodue])
      await expect(page.getByTestId(`project-task-${task.id}`)).toBeVisible()
    const ys: number[] = []
    for (const task of [late, soon, later, nodue]) {
      const box = await page.getByTestId(`project-task-${task.id}`).boundingBox()
      ys.push(box!.y)
    }
    expect(ys, 'rows in order: overdue, 2031-05-01, 2031-06-01, no due date').toEqual([...ys].sort((a, b) => a - b))
    await expect(page.getByTestId(`project-task-${late.id}`)).toContainText('Overdue')
    await expect(page.getByTestId(`project-task-${soon.id}`)).toContainText(`With ${member.name}`)
    await expect(page.getByTestId(`project-task-${nodue.id}`)).toContainText('No due date')
    // Nothing is theirs and they manage nothing: no button on any row.
    for (const task of [late, soon, later, nodue]) {
      await expect(page.getByTestId(`project-task-${task.id}`).getByRole('button')).toHaveCount(0)
    }
    // The finished one is not in Open; the Done view lists it.
    await expect(page.getByTestId(`project-task-${finished.id}`)).toHaveCount(0)
    await card.getByRole('tab', { name: 'Done' }).click()
    await expect(page.getByTestId(`project-task-${finished.id}`)).toBeVisible({ timeout: 15_000 })
    await ctx.close()
  })

  test('the assignee marks a task done without manage-projects, but cannot add, edit, reassign or delete (AC-3.2, AC-3.3)', async ({
    browser,
  }) => {
    const project = await freshProject('assignee', [member.userId])
    const mine = await createTaskViaApi(admin, {
      subject: `Mine ${runId}`,
      projectId: project.id,
      assigneeUserId: member.userId,
    })
    const theirs = await createTaskViaApi(admin, { subject: `Theirs ${runId}`, projectId: project.id })

    const ctx = await personContext(browser, member)
    const page = await ctx.newPage()
    await openTasks(page, project.id)
    await expect(page.getByTestId('project-tasks-add')).toHaveCount(0)
    const mineRow = page.getByTestId(`project-task-${mine.id}`)
    await expect(mineRow).toBeVisible()
    await expect(page.getByTestId(`project-task-${mine.id}-toggle`)).toBeVisible()
    await expect(page.getByTestId(`project-task-${mine.id}-edit`)).toHaveCount(0)
    await expect(page.getByTestId(`project-task-${mine.id}-delete`)).toHaveCount(0)
    // Another person's task is readable but has no action at all.
    await expect(page.getByTestId(`project-task-${theirs.id}`)).toBeVisible()
    await expect(page.getByTestId(`project-task-${theirs.id}`).getByRole('button')).toHaveCount(0)

    await page.getByTestId(`project-task-${mine.id}-toggle`).click()
    await expect(page.getByText('Task marked done.')).toBeVisible({ timeout: 15_000 })
    await expect(mineRow).toHaveCount(0)
    const done = await getTaskViaApi(admin, mine.id, { projectId: project.id })
    expect(done?.task.completedAt).toBeTruthy()

    // The server is the gate, not the hidden buttons: the same member is refused every other change.
    const edit = await apiCall(ACTIVITIES_API_URL, member, 'PATCH', `/activities/${theirs.id}`, { subject: 'hijacked' })
    expect(edit.status).toBe(403)
    const reassign = await apiCall(ACTIVITIES_API_URL, member, 'PATCH', `/activities/${mine.id}`, {
      assigneeUserId: admin.userId, // a valid assignee: the refusal is about who asks
    })
    expect(reassign.status).toBe(403)
    const remove = await apiCall(ACTIVITIES_API_URL, member, 'DELETE', `/activities/${theirs.id}`)
    expect(remove.status).toBe(403)
    const create = await tryCreateTask(member, { subject: `Sneaky ${runId}`, projectId: project.id })
    expect(create.status).toBe(403)
    const complete = await completeTaskViaApi(member, theirs.id)
    expect(complete.status).toBe(403)
    // Nothing changed.
    const after = await listProjectTasksViaApi(admin, project.id)
    expect(after.items.map((task) => task.subject)).toEqual([`Theirs ${runId}`])
    expect((await getTaskViaApi(admin, mine.id, { projectId: project.id }))?.subject).toBe(`Mine ${runId}`)
    await ctx.close()
  })

  test('a blocked task shows Blocked and what it waits on, cannot be marked done, and is freed when its blocker is done (AC-4.1, AC-4.2)', async ({
    browser,
  }) => {
    const project = await freshProject('blockers')
    const first = await createTaskViaApi(admin, { subject: `Design the schema ${runId}`, projectId: project.id })
    const secondTitle = `Build the API ${runId}`

    const ctx = await personContext(browser, admin)
    const page = await ctx.newPage()
    const card = await openTasks(page, project.id)
    await page.getByTestId('project-tasks-add').click()
    const dialog = page.getByRole('dialog', { name: 'Add task' })
    await dialog.getByLabel('Title').fill(secondTitle)
    await dialog.getByRole('checkbox', { name: first.subject }).check({ timeout: 15_000 })
    await page.getByTestId('task-form-submit').click()
    await expect(page.getByText('Task added.')).toBeVisible({ timeout: 15_000 })
    const secondId = await findProjectTaskId(admin, project.id, secondTitle)
    const secondRow = page.getByTestId(`project-task-${secondId}`)
    await expect(secondRow).toContainText('Blocked')
    await expect(page.getByTestId(`project-task-${secondId}-waiting`)).toContainText(
      `Waiting on ${first.subject}. Finish those first.`,
    )
    const toggle = page.getByTestId(`project-task-${secondId}-toggle`)
    await expect(toggle).toHaveAttribute('aria-disabled', 'true')
    // aria-disabled: Playwright would wait forever for it to become enabled, so force the (ignored) click
    await toggle.click({ force: true })
    await expect(secondRow).toContainText('Blocked')
    // The server refuses it too: 409 task_blocked, and the task stays open.
    const refused = await completeTaskViaApi(admin, secondId)
    expect(refused.status).toBe(409)
    expect((refused.body as { code?: string }).code).toBe('task_blocked')

    // A task cannot block itself and tasks cannot wait on each other (AC-4.1).
    const self = await apiCall(ACTIVITIES_API_URL, admin, 'PATCH', `/activities/${first.id}`, {
      blockedByIds: [first.id],
    })
    expect(self.status).toBe(422)
    expect((self.body as { code?: string }).code).toBe('blocker_is_self')
    const cycle = await apiCall(ACTIVITIES_API_URL, admin, 'PATCH', `/activities/${first.id}`, {
      blockedByIds: [secondId],
    })
    expect(cycle.status).toBe(422)
    expect((cycle.body as { code?: string }).code).toBe('blocker_cycle')

    // Completing the blocker frees it: no Blocked, no waiting line, the button works.
    await page.getByTestId(`project-task-${first.id}-toggle`).click()
    await expect(page.getByText('Task marked done.')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId(`project-task-${secondId}-waiting`)).toHaveCount(0)
    await expect(secondRow).not.toContainText('Blocked')
    await expect(toggle).not.toHaveAttribute('aria-disabled', 'true')
    await toggle.click()
    await expect(secondRow).toHaveCount(0, { timeout: 15_000 })
    await card.getByRole('tab', { name: 'Done' }).click()
    await expect(secondRow).toBeVisible({ timeout: 15_000 })
    await ctx.close()
  })

  test('a closed project keeps its tasks readable and completable but takes no add, edit or delete (AC-3.8)', async ({
    browser,
  }) => {
    const project = await freshProject('closed')
    const task = await createTaskViaApi(admin, { subject: `Hand over the keys ${runId}`, projectId: project.id })
    await closeProjectViaApi(admin, project)

    const ctx = await personContext(browser, admin)
    const page = await ctx.newPage()
    const card = await openTasks(page, project.id)
    await expect(page.getByTestId('project-tasks-add')).toHaveCount(0)
    await expect(card.getByText(/This project is closed or cancelled/)).toBeVisible()
    const row = page.getByTestId(`project-task-${task.id}`)
    await expect(row).toBeVisible()
    await expect(page.getByTestId(`project-task-${task.id}-edit`)).toHaveCount(0)
    await expect(page.getByTestId(`project-task-${task.id}-delete`)).toHaveCount(0)

    // Marking it done still works (even for a manager of a closed project).
    await page.getByTestId(`project-task-${task.id}-toggle`).click()
    await expect(page.getByText('Task marked done.')).toBeVisible({ timeout: 15_000 })
    await expect(row).toHaveCount(0)

    // The server refuses everything else with 409 host_read_only, and nothing changes.
    const code = (r: { body: unknown }) => (r.body as { code?: string }).code
    const create = await tryCreateTask(admin, { subject: `Too late ${runId}`, projectId: project.id })
    expect([create.status, code(create)]).toEqual([409, 'host_read_only'])
    const edit = await apiCall(ACTIVITIES_API_URL, admin, 'PATCH', `/activities/${task.id}`, { subject: 'changed' })
    expect([edit.status, code(edit)]).toEqual([409, 'host_read_only'])
    const remove = await apiCall(ACTIVITIES_API_URL, admin, 'DELETE', `/activities/${task.id}`)
    expect([remove.status, code(remove)]).toEqual([409, 'host_read_only'])
    const done = await listProjectTasksViaApi(admin, project.id, 'done')
    expect(done.items.map((t) => t.subject)).toEqual([`Hand over the keys ${runId}`])
    expect((await listProjectTasksViaApi(admin, project.id, 'open')).total).toBe(0)
    await ctx.close()
  })

  test('the API keeps project tasks to tasks of the project’s own people (AC-3.1, AC-3.6)', async () => {
    const project = await freshProject('contract', [member.userId])
    // No assignee given: the author. An assignee chosen explicitly must be the PM or on the team.
    const defaulted = await createTaskViaApi(admin, { subject: `Default assignee ${runId}`, projectId: project.id })
    expect(defaulted.task.assignee?.id).toBe(admin.userId)
    const offTeam = await tryCreateTask(admin, {
      subject: `Off team ${runId}`,
      projectId: project.id,
      assigneeUserId: outsider.userId,
    })
    expect(offTeam.status).toBe(422)
    expect((offTeam.body as { code?: string }).code).toBe('assignee_not_on_project')
    // A project only takes tasks: a note on it is refused.
    const note = await apiCall(ACTIVITIES_API_URL, admin, 'POST', '/activities', {
      type: 'note',
      subject: `A note ${runId}`,
      projectId: project.id,
    })
    expect(note.status).toBe(422)
    expect((note.body as { code?: string }).code).toBe('type_not_allowed')
    // Nothing but the defaulted task exists.
    expect((await listProjectTasksViaApi(admin, project.id)).total).toBe(1)
  })
})
