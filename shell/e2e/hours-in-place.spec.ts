/**
 * T13 — Record hours in place, from the project, the deal and the task, and the Week view of My hours
 * (specs/20261116-record-hours-in-place: AC-1.1, AC-1.2, AC-2.1, AC-2.2, AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-3.5, AC-4.1,
 * AC-4.3, AC-4.5, AC-5.1, AC-5.2, AC-5.12, AC-5.14, AC-5.16, AC-5.17, AC-5.19, AC-5.20).
 *
 * Nothing is stubbed: the project and deal pages are projects-ui and crm-ui, the button is hours-ui's `./RecordHours`
 * loaded through the shell's `hours.recordHours` extension, the entry is written by hours-api, which asks projects-api,
 * crm-api and activities-api as the caller. The records (a company, a deal owned by a chosen person, projects with a
 * team, tasks assigned to chosen people) are made through the owners' REST APIs by an admin, exactly as
 * hours-owners.spec.ts does (helpers/hoursOwnersFixtures.ts, helpers/activitiesFixtures.ts).
 *
 *  A. A team member records 2 h 30 with a work type and a note from the project page; the message and its link open
 *     My hours, which lists the entry with the same values; a salesperson who can read the project sees no button
 *     (AC-1.1, 1.2, 4.1, 4.3), and nothing else on the page is read again (AC-4.3).
 *  B. The deal's owner records from the header; a person who is on the deal only through one of its tasks sees none
 *     there and one on their task's row, whose entry points at the task (AC-2.1, 2.2, 3.1, 3.3).
 *  C. A project task's assignee records from the Tasks card row; the entry points at the task (AC-3.1, 3.2).
 *  D. A CRM company task with no deal records other work with a category, and the entry carries no task (AC-3.4, 3.5).
 *  E. With hours-ui's `remoteEntry.js` aborted, the project page, the deal page and My tasks load and show the My
 *     hours link (AC-4.5, the remote-failure.spec.ts pattern).
 *  F. The Week: entries on two projects over three days with the right cells and totals, an empty past cell
 *     records, a cell's Edit changes an entry, Delete asks first, and the figures follow without a reload
 *     (AC-5.1, 5.2, 5.12, 5.14, 5.16, 5.17, 5.19, 5.20).
 *
 * Needs the stack up (`mise run dev`) with the specs/20261112-time-tracking and specs/20261110-activities wiring (see the
 * headers of hours-owners.spec.ts and activities-crm.spec.ts). Against the dev stack Playwright reuses the servers when
 * each remote's port is pointed at it:
 *   E2E_ESTIMAI_REMOTE_PORT=5174 E2E_REFUND_REMOTE_PORT=5175 E2E_NOTIFY_REMOTE_PORT=5176 \
 *   E2E_ADMIN_REMOTE_PORT=5177 E2E_INVENTORY_REMOTE_PORT=5178 E2E_CRM_REMOTE_PORT=5179 \
 *   E2E_MEETINGS_REMOTE_PORT=5180 E2E_PROJECTS_REMOTE_PORT=5181 E2E_HOURS_REMOTE_PORT=5184 \
 *   pnpm e2e hours-in-place.spec.ts
 *
 * The people are per-run (`hip-*@operai.test`, an admin included) and every entry they record is deleted afterwards;
 * companies, deals, projects and tasks cannot be deleted from here (their owners keep them, like the other specs).
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  cleanupPeople,
  createEntryViaApi,
  deleteOwnEntriesQuietly,
  hoursAdmin,
  newRunId,
  ownEntriesViaApi,
  personContext,
  pickCategories,
  seedHoursPerson,
  timeListsViaApi,
  todayZurich,
  type CategoryRow,
  type EntryRow,
  type HoursPerson,
} from './helpers/hoursFixtures'
import {
  createCompanyViaApi,
  createDealOwnedBy,
  createProjectViaApi,
  createTaskViaApi,
  setTeamViaApi,
  type CompanyRow,
  type DealRow,
  type ProjectRow,
} from './helpers/hoursOwnersFixtures'
import {
  apiCall,
  findCompanyActivityId,
  findProjectTaskId,
  ACTIVITIES_API_URL,
  PROJECTS_API_URL,
} from './helpers/activitiesFixtures'
import type { SeededSession } from './helpers/adminSession'

const runId = newRunId()
const today = todayZurich()
const PREFIX = 'hip' as const
const SALES = ['employee', 'sales']
const HOURS_REMOTE_ORIGIN = `http://localhost:${process.env['E2E_HOURS_REMOTE_PORT'] ?? '5185'}`

// ─── Days ───────────────────────────────────────────────────────────────────

const dayOf = (iso: string): Date => new Date(`${iso}T00:00:00Z`)
const addDays = (iso: string, days: number): string => {
  const date = dayOf(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
/** The Monday of the week holding `iso` (weeks run Monday to Sunday, WA1). */
const mondayOf = (iso: string): string => addDays(iso, -((dayOf(iso).getUTCDay() + 6) % 7))
/** `dd.mm.yyyy`, as the suite writes a date. */
const dmy = (iso: string): string => iso.split('-').reverse().join('.')
const weekLabel = (monday: string): string => `Week ${dmy(monday)} – ${dmy(addDays(monday, 6))}`

const currentMonday = mondayOf(today)
const lastMonday = addDays(currentMonday, -7)
/** The day the cleanup reads from: earlier than anything a journey records. */
const cleanupFrom = addDays(today, -45)

// ─── Small helpers ──────────────────────────────────────────────────────────

/** The text of a locator with its whitespace collapsed (a figure, a sentence). */
const textOf = async (locator: Locator): Promise<string> => (await locator.innerText()).replace(/\s+/g, ' ').trim()

/** Opens a project's page as `page`'s person and waits for its header. */
async function openProject(page: Page, project: ProjectRow): Promise<void> {
  await page.goto(`/projects/${project.id}`)
  await expect(page.getByTestId('project-detail-page')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('project-tasks')).toBeVisible({ timeout: 30_000 })
}

/** Opens a deal's page and waits for its header and its activity card. */
async function openDeal(page: Page, deal: DealRow): Promise<void> {
  await page.goto(`/crm/deals/${deal.id}`)
  await expect(page.getByTestId('crm-deal-page')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: deal.title, exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('crm-activity-card')).toBeVisible({ timeout: 30_000 })
}

/**
 * Waits until a "this person is offered no Record hours" assertion (A and B) can mean something. Not
 * `waitForLoadState('networkidle')`: the shell's notification stream (the SSE from notify-api) keeps a request open for
 * the whole session, so the network never goes idle (estimai-import.spec.ts and its siblings say the same). Two things
 * must hold, and neither is the network:
 *  - the session has answered. A host offers the button only to a person it can name (`mayRecordOnProject`,
 *    `mayRecordOnDeal` and `mayRecordOnTask` are all false while `useSession()` holds no id), so until then a count of 0
 *    would be true for anybody. The shell's header draws the person's menu from that same session store, and only
 *    once it holds the person: the menu is the proof.
 *  - the seam has had its chance. The button is hours-ui's widget, reached through `shell/extensions` and a federated
 *    remote after the page has drawn, so one that wrongly appeared would come some time after the page did. A negative
 *    cannot wait for the thing it expects never to happen, so a fixed grace bounds that.
 */
async function recordHoursSettled(page: Page): Promise<void> {
  await expect(page.getByTestId('user-menu-trigger')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(1_500)
}

/** The header's Record hours (a task row's button is named "Record hours on <task>", so the exact name is the page's). */
const pageRecordHours = (page: Page): Locator => page.getByRole('button', { name: 'Record hours', exact: true })

/** The entry dialog the widget opened. */
const hoursDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Record hours' })

/** The entries a person holds on one day, from hours-api (out-of-band verification). */
async function entriesOn(person: HoursPerson, day: string): Promise<EntryRow[]> {
  return (await ownEntriesViaApi(person, day, day)).filter((entry) => entry.day === day)
}

/** The members of an entry the API holds that the specs reads: its activity pointer and work type. */
interface EntryDetail extends EntryRow {
  activity: { id: string | null; subject: string | null } | null
  workType: { id: string; name: string } | null
}
const detailOf = (entry: EntryRow): EntryDetail => entry as EntryDetail

test.describe('specs/20261116-record-hours-in-place T13: record hours in place, and the Week', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)

  let admin: SeededSession
  let member: HoursPerson // on the project's team, assignee of the project task
  let reader: HoursPerson // can read the project, the deal and every task, is on none of them
  let owner: HoursPerson // owns the deal
  let assignee: HoursPerson // assignee of the deal's task and of the company's task: neither owner nor technical contact
  let weeker: HoursPerson // the Week's person
  let training: CategoryRow
  let administration: CategoryRow

  let company: CompanyRow
  let project: ProjectRow
  let deal: DealRow
  let projectTaskSubject: string
  let projectTaskId: string
  let dealTaskSubject: string
  let dealTaskId: string
  let companyTaskSubject: string
  let companyTaskId: string

  const everyone = (): HoursPerson[] => [member, reader, owner, assignee, weeker].filter(Boolean)

  test.beforeAll(async () => {
    admin = await hoursAdmin(runId, PREFIX)
    member = await seedHoursPerson('member', SALES, runId, PREFIX)
    reader = await seedHoursPerson('reader', SALES, runId, PREFIX)
    owner = await seedHoursPerson('owner', SALES, runId, PREFIX)
    assignee = await seedHoursPerson('assignee', SALES, runId, PREFIX)
    weeker = await seedHoursPerson('weeker', SALES, runId, PREFIX)
    ;[training, administration] = await pickCategories(admin)

    // The real records, in their real owners.
    company = await createCompanyViaApi(admin, `Hip company ${runId}`)
    project = await setTeamViaApi(admin, await createProjectViaApi(admin, `Hip project ${runId}`), [member.userId])
    deal = await createDealOwnedBy(admin, company.id, `Hip deal ${runId}`, owner.userId)

    projectTaskSubject = `Hip project task ${runId}`
    dealTaskSubject = `Hip deal task ${runId}`
    companyTaskSubject = `Hip company task ${runId}`
    await createTaskViaApi(admin, { subject: projectTaskSubject, projectId: project.id, assigneeUserId: member.userId })
    await createTaskViaApi(admin, {
      subject: dealTaskSubject,
      companyId: company.id,
      dealId: deal.id,
      assigneeUserId: assignee.userId,
    })
    await createTaskViaApi(admin, {
      subject: companyTaskSubject,
      companyId: company.id,
      assigneeUserId: assignee.userId,
    })
    projectTaskId = await findProjectTaskId(admin, project.id, projectTaskSubject)
    dealTaskId = await findCompanyActivityId(admin, company.id, dealTaskSubject)
    companyTaskId = await findCompanyActivityId(admin, company.id, companyTaskSubject)
  })

  test.afterAll(async () => {
    for (const person of everyone()) await deleteOwnEntriesQuietly(person, cleanupFrom)
    // The tasks the journeys made go too (their admin may delete them); the company, the deal and the projects cannot be
    // deleted from here, as in the other specs.
    for (const id of [projectTaskId, dealTaskId, companyTaskId]) {
      if (admin && id)
        await apiCall(ACTIVITIES_API_URL, admin, 'DELETE', `/activities/${encodeURIComponent(id)}`).catch(
          () => undefined,
        )
    }
    await cleanupPeople(runId)
  })

  // ─── A ────────────────────────────────────────────────────────────────────

  test('A: a team member records 2 h 30 with a work type and a note from the project page; a reader sees no button (AC-1.1, 1.2, 4.1, 4.3)', async ({
    browser,
  }) => {
    const lists = await timeListsViaApi(admin)
    const workType = lists.workTypes.project.find((candidate) => !(candidate as { retired: boolean }).retired) as
      { id: string; name: string } | undefined
    expect(workType, 'a project work type to pick').toBeDefined()
    const note = `Hip A note ${runId}`

    const memberCtx = await personContext(browser, member)
    const page = await memberCtx.newPage()
    await openProject(page, project)

    // AC-1.1: the project's team member is offered Record hours, first in the header.
    const button = pageRecordHours(page)
    await expect(button).toBeVisible({ timeout: 30_000 })
    await expect(button).toHaveAttribute('aria-haspopup', 'dialog')

    // The page as it is before the save: what AC-4.3 says must not change.
    const factsBefore = await textOf(page.getByTestId('project-facts'))
    const tasksBefore = await textOf(page.getByTestId('project-tasks'))

    await button.click()
    const dialog = hoursDialog(page)
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    // AC-1.3 as the person meets it: the project is text (no radio, no picker), the day is today, the keyboard is on Duration.
    await expect(dialog).toContainText(`Recording hours on the project ${project.name}.`)
    await expect(dialog.getByTestId('hours-entry-on-project')).toHaveCount(0)
    await expect(dialog.getByTestId('hours-entry-project-input')).toHaveCount(0)
    await expect(dialog.getByTestId('hours-entry-day')).toHaveValue(today)
    await expect(dialog.getByTestId('hours-entry-duration')).toBeFocused()

    await dialog.getByTestId('hours-entry-duration').fill('2.5')
    await dialog.getByTestId('hours-entry-work-type').selectOption(workType!.id)
    await dialog.getByTestId('hours-entry-note').fill(note)

    // AC-4.3: after the save the page asks nothing of the projects it showed (a request the page makes now would be a re-read).
    const hostReads: string[] = []
    page.on('request', (request) => {
      const url = request.url()
      if (url.startsWith(PROJECTS_API_URL) || url.startsWith(ACTIVITIES_API_URL))
        hostReads.push(`${request.method()} ${url}`)
    })
    // The instrument is proved before it is trusted: a request to the host's origin is seen by the listener.
    await page.evaluate((url) => fetch(`${url}/health`).catch(() => undefined), PROJECTS_API_URL)
    await expect.poll(() => hostReads.length).toBe(1)
    hostReads.length = 0
    await dialog.getByTestId('hours-entry-dialog-submit').click()
    await dialog.waitFor({ state: 'detached', timeout: 30_000 })

    const message = page.getByTestId('hours-record-hours-message')
    await expect(message).toBeVisible()
    await expect(message).toHaveAttribute('role', 'status')
    await expect(page.getByTestId('hours-record-hours-recorded')).toHaveText(`2 h 30 recorded on ${project.name}.`)
    // Focus returns to the button the person pressed (the library gives it back).
    await expect(button).toBeFocused()
    // No timer (G1): still there after the time the old message would have lasted.
    await page.waitForTimeout(4_000)
    await expect(message).toBeVisible()

    expect(await textOf(page.getByTestId('project-facts'))).toBe(factsBefore)
    expect(await textOf(page.getByTestId('project-tasks'))).toBe(tasksBefore)
    expect(hostReads, 'no host read after the widget saved').toEqual([])

    // AC-4.1: the entry is the one hours-api holds, with the values the dialog was given.
    const saved = (await entriesOn(member, today)).map(detailOf)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.minutes).toBe(150)
    expect(saved[0]!.on).toMatchObject({ type: 'project', id: project.id })
    expect(saved[0]!.workType?.id).toBe(workType!.id)
    expect(saved[0]!.note).toBe(note)
    expect(saved[0]!.activity).toBeNull()

    // AC-4.3: the link opens My hours (a shell transition: the page is not reloaded), which lists the entry.
    await page.evaluate(() => {
      ;(window as unknown as { __hipSameDocument: boolean }).__hipSameDocument = true
    })
    await page.getByTestId('hours-record-hours-link').click()
    await expect(page).toHaveURL(/\/hours$/)
    await expect(page.getByTestId('hours-my-page')).toBeVisible({ timeout: 30_000 })
    expect(await page.evaluate(() => (window as unknown as { __hipSameDocument?: boolean }).__hipSameDocument)).toBe(
      true,
    )
    const row = page.getByTestId(`hours-entry-${saved[0]!.id}`)
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText(project.name)
    await expect(row).toContainText(workType!.name)
    await expect(row).toContainText(note)
    await expect(row).toContainText('2 h 30')
    await memberCtx.close()

    // AC-1.2: a salesperson who can read the project (and is not on its team) is offered nothing.
    const readerCtx = await personContext(browser, reader)
    const readerPage = await readerCtx.newPage()
    await openProject(readerPage, project)
    // The task row is on the page before the grace starts, so a button that wrongly came in it has as long as one in the header.
    await expect(readerPage.getByTestId(`project-task-${projectTaskId}`)).toBeVisible({ timeout: 30_000 })
    await recordHoursSettled(readerPage) // the seam loads after the page: a missing button must stay missing
    await expect(pageRecordHours(readerPage)).toHaveCount(0)
    await expect(readerPage.getByTestId('record-hours-fallback')).toHaveCount(0)
    // …and no task row of the Tasks card offers it to them either (the task is the member's).
    await expect(readerPage.getByTestId(`project-task-${projectTaskId}`).getByTestId('hours-record-hours')).toHaveCount(
      0,
    )
    await readerCtx.close()
  })

  // ─── B ────────────────────────────────────────────────────────────────────

  test("B: the deal's owner records from the header; the assignee of its task sees none there and one on the task's row (AC-2.1, 2.2, 3.1, 3.3)", async ({
    browser,
  }) => {
    const ownerCtx = await personContext(browser, owner)
    const ownerPage = await ownerCtx.newPage()
    await openDeal(ownerPage, deal)

    // AC-2.1: the owner is offered it in the header.
    const button = pageRecordHours(ownerPage)
    await expect(button).toBeVisible({ timeout: 30_000 })
    // The owner is not assigned to the deal's task, so its row offers them nothing (AC-3.1).
    await expect(ownerPage.getByTestId(`crm-activity-${dealTaskId}`)).toBeVisible()
    await expect(ownerPage.getByTestId(`crm-activity-${dealTaskId}`).getByTestId('hours-record-hours')).toHaveCount(0)

    await button.click()
    const dialog = hoursDialog(ownerPage)
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    await expect(dialog).toContainText(`Recording hours on the deal ${deal.title}.`)
    await expect(dialog.getByTestId('hours-entry-on-deal')).toHaveCount(0)
    await expect(dialog.getByTestId('hours-entry-day')).toHaveValue(today)
    await expect(dialog.getByTestId('hours-entry-duration')).toBeFocused()
    await dialog.getByTestId('hours-entry-duration').fill('1')
    await dialog.getByTestId('hours-entry-dialog-submit').click()
    await dialog.waitFor({ state: 'detached', timeout: 30_000 })
    await expect(ownerPage.getByTestId('hours-record-hours-recorded')).toHaveText(`1 h recorded on ${deal.title}.`)
    const ownerEntries = await entriesOn(owner, today)
    expect(ownerEntries).toHaveLength(1)
    expect(ownerEntries[0]!.on).toMatchObject({ type: 'deal', id: deal.id })
    expect(detailOf(ownerEntries[0]!).activity).toBeNull()
    await ownerCtx.close()

    // AC-2.2: on the deal only through one of its tasks, the assignee gets nothing in the header…
    const assigneeCtx = await personContext(browser, assignee)
    const page = await assigneeCtx.newPage()
    await openDeal(page, deal)
    const row = page.getByTestId(`crm-activity-${dealTaskId}`)
    await expect(row).toBeVisible({ timeout: 30_000 })
    // …and one on the task's row (AC-3.1), the positive control for the absence below.
    const rowButton = row.getByRole('button', { name: `Record hours on ${dealTaskSubject}` })
    await expect(rowButton).toBeVisible({ timeout: 30_000 })
    await expect(pageRecordHours(page)).toHaveCount(0)
    await expect(page.getByTestId('crm-record-hours-fallback')).toHaveCount(0)

    // AC-3.3: from the row the deal and the task are chosen and not changeable.
    await rowButton.click()
    const rowDialog = hoursDialog(page)
    await expect(rowDialog).toBeVisible({ timeout: 30_000 })
    await expect(rowDialog).toContainText(`Recording hours on the deal ${deal.title}.`)
    await expect(rowDialog).toContainText(dealTaskSubject)
    await expect(rowDialog).toContainText('Hours are recorded on this task.')
    await expect(rowDialog.getByTestId('hours-activity-select')).toHaveCount(0)
    await expect(rowDialog.getByTestId('hours-entry-on-deal')).toHaveCount(0)
    await expect(rowDialog.getByTestId('hours-entry-duration')).toBeFocused()
    await rowDialog.getByTestId('hours-entry-duration').fill('0.5')
    await rowDialog.getByTestId('hours-entry-dialog-submit').click()
    await rowDialog.waitFor({ state: 'detached', timeout: 30_000 })
    // The message is in the row, on its own line, after the buttons (design S3).
    const message = row.getByTestId('hours-record-hours-message')
    await expect(message).toBeVisible()
    await expect(message).toContainText(`30 min recorded on ${deal.title}.`)
    const assigneeEntries = (await entriesOn(assignee, today)).map(detailOf)
    expect(assigneeEntries).toHaveLength(1)
    expect(assigneeEntries[0]!.minutes).toBe(30)
    expect(assigneeEntries[0]!.on).toMatchObject({ type: 'deal', id: deal.id })
    expect(assigneeEntries[0]!.activity?.id).toBe(dealTaskId)
    await assigneeCtx.close()

    // AC-2.2 / AC-3.1: a reader who is neither the owner nor on any task is offered nothing, header or row.
    const readerCtx = await personContext(browser, reader)
    const readerPage = await readerCtx.newPage()
    await openDeal(readerPage, deal)
    await expect(readerPage.getByTestId(`crm-activity-${dealTaskId}`)).toBeVisible({ timeout: 30_000 })
    await recordHoursSettled(readerPage)
    await expect(pageRecordHours(readerPage)).toHaveCount(0)
    await expect(readerPage.getByTestId('hours-record-hours')).toHaveCount(0)
    await readerCtx.close()
  })

  // ─── C ────────────────────────────────────────────────────────────────────

  test("C: a project task's assignee records from the Tasks card row and the entry points at the task (AC-3.1, 3.2)", async ({
    browser,
  }) => {
    const ctx = await personContext(browser, member)
    const page = await ctx.newPage()
    await openProject(page, project)
    const row = page.getByTestId(`project-task-${projectTaskId}`)
    await expect(row).toBeVisible({ timeout: 30_000 })
    const button = row.getByRole('button', { name: `Record hours on ${projectTaskSubject}` })
    await expect(button).toBeVisible({ timeout: 30_000 })

    const started = Date.now()
    await button.click()
    const dialog = hoursDialog(page)
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    console.log(`[T13] C: Record hours on a task row opened its dialog in ${Date.now() - started} ms`)
    // AC-3.2: the project and the task are chosen and not changeable.
    await expect(dialog).toContainText(`Recording hours on the project ${project.name}.`)
    await expect(dialog).toContainText(projectTaskSubject)
    await expect(dialog).toContainText("Hours are recorded on this task. It can't be changed here.")
    await expect(dialog.getByTestId('hours-activity-select')).toHaveCount(0)
    await expect(dialog.getByTestId('hours-entry-on-project')).toHaveCount(0)
    await expect(dialog.getByTestId('hours-entry-duration')).toBeFocused()
    await dialog.getByTestId('hours-entry-duration').fill('1')
    await dialog.getByTestId('hours-entry-dialog-submit').click()
    await dialog.waitFor({ state: 'detached', timeout: 30_000 })

    const message = row.getByTestId('hours-record-hours-message')
    await expect(message).toContainText(`1 h recorded on ${project.name}.`)
    await expect(button).toBeFocused()
    // × dismisses and gives the focus back to the row's button (design S3).
    await row.getByTestId('hours-record-hours-dismiss').click()
    await expect(message).toHaveCount(0)
    await expect(button).toBeFocused()

    const taskEntries = (await entriesOn(member, today))
      .map(detailOf)
      .filter((entry) => entry.activity?.id === projectTaskId)
    expect(taskEntries).toHaveLength(1)
    expect(taskEntries[0]!.minutes).toBe(60)
    expect(taskEntries[0]!.on).toMatchObject({ type: 'project', id: project.id })
    await ctx.close()
  })

  // ─── D ────────────────────────────────────────────────────────────────────

  test('D: a CRM company task with no deal records other work with a category and no task (AC-3.4, 3.5)', async ({
    browser,
  }) => {
    const ctx = await personContext(browser, assignee)
    const page = await ctx.newPage()
    await page.goto(`/crm/companies/${company.id}`)
    const row = page.getByTestId(`crm-activity-${companyTaskId}`)
    await expect(row).toBeVisible({ timeout: 30_000 })
    const button = row.getByRole('button', { name: `Record hours on ${companyTaskSubject}` })
    await expect(button).toBeVisible({ timeout: 30_000 })

    await button.click()
    const dialog = hoursDialog(page)
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    // AC-3.4: other work, no category chosen (A3), no way to change what it is on, no task.
    await expect(dialog).toContainText(
      'This task is about a company, not a deal, so its hours are recorded as other work.',
    )
    await expect(dialog.getByTestId('hours-entry-on-none')).toHaveCount(0)
    await expect(dialog.getByTestId('hours-activity-select')).toHaveCount(0)
    await expect(dialog.getByTestId('hours-entry-category')).toHaveValue('')
    await expect(dialog.getByTestId('hours-entry-duration')).toBeFocused()

    // Saving with no category is refused on the field, and nothing is saved.
    await dialog.getByTestId('hours-entry-duration').fill('1.5')
    await dialog.getByTestId('hours-entry-dialog-submit').click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Choose a category.')
    // (the assignee holds journey B's deal entry today: only other work is looked at here)
    const otherWork = async () => (await entriesOn(assignee, today)).filter((entry) => entry.on.type === 'none')
    expect(await otherWork()).toHaveLength(0)

    await dialog.getByTestId('hours-entry-category').selectOption(administration.id)
    await dialog.getByTestId('hours-entry-dialog-submit').click()
    await dialog.waitFor({ state: 'detached', timeout: 30_000 })
    await expect(row.getByTestId('hours-record-hours-recorded')).toHaveText(
      `1 h 30 recorded on other work: ${administration.name}.`,
    )

    // AC-3.5: other work with the category the person picked, and no link to the company or the task.
    const saved = (await otherWork()).map(detailOf)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.minutes).toBe(90)
    expect(saved[0]!.on).toMatchObject({ type: 'none', category: { id: administration.id } })
    expect(saved[0]!.activity).toBeNull()
    expect(JSON.stringify(saved[0])).not.toContain(company.id)
    expect(JSON.stringify(saved[0])).not.toContain(companyTaskId)
    await ctx.close()
  })

  // ─── E ────────────────────────────────────────────────────────────────────

  test("E: with hours-ui's remoteEntry.js aborted, the project page, the deal page and My tasks load and show the My hours link (AC-4.5)", async ({
    browser,
  }) => {
    // The remote-failure.spec.ts pattern: every request to the hours remote's origin fails at the network.
    const aborted: string[] = []
    const failOnHours = async (page: Page): Promise<void> => {
      await page.route(`${HOURS_REMOTE_ORIGIN}/**`, (route) => {
        aborted.push(route.request().url())
        return route.abort('failed')
      })
    }

    // The project page, as a team member.
    const memberCtx = await personContext(browser, member)
    const projectPage = await memberCtx.newPage()
    await failOnHours(projectPage)
    await openProject(projectPage, project)
    const projectLink = projectPage.getByTestId('record-hours-fallback').first()
    await expect(projectLink).toBeVisible({ timeout: 30_000 })
    await expect(projectLink).toHaveAttribute('href', '/hours')
    await expect(projectLink).toHaveText('Record hours in My hours')
    await expect(pageRecordHours(projectPage)).toHaveCount(0)
    // The page works as before: the facts, the Tasks card with its row, and the row's own link.
    await expect(projectPage.getByTestId('project-facts')).toBeVisible()
    const taskRow = projectPage.getByTestId(`project-task-${projectTaskId}`)
    await expect(taskRow).toContainText(projectTaskSubject)
    await expect(taskRow.getByTestId('record-hours-fallback')).toBeVisible()
    expect(aborted.length, 'the failure was injected at the hours remote').toBeGreaterThan(0)

    // My tasks: the assignee's row carries the link; the list works.
    const tasksPage = await memberCtx.newPage()
    await failOnHours(tasksPage)
    await tasksPage.goto('/projects/tasks')
    await expect(tasksPage.getByTestId('my-tasks-page')).toBeVisible({ timeout: 30_000 })
    const myRow = tasksPage.getByTestId(`my-task-${projectTaskId}`)
    await expect(myRow).toBeVisible({ timeout: 30_000 })
    await expect(myRow.getByTestId('record-hours-fallback')).toBeVisible({ timeout: 30_000 })
    await expect(myRow.getByTestId('record-hours-fallback')).toHaveAttribute('href', '/hours')
    await memberCtx.close()

    // The deal page, as the deal's owner.
    const ownerCtx = await personContext(browser, owner)
    const dealPage = await ownerCtx.newPage()
    await failOnHours(dealPage)
    await openDeal(dealPage, deal)
    const dealLink = dealPage.getByTestId('crm-record-hours-fallback')
    await expect(dealLink).toBeVisible({ timeout: 30_000 })
    await expect(dealLink).toHaveAttribute('href', '/hours')
    await expect(dealPage.getByTestId('crm-deal-facts')).toBeVisible()
    await expect(pageRecordHours(dealPage)).toHaveCount(0)
    await ownerCtx.close()
  })

  // ─── F ────────────────────────────────────────────────────────────────────

  test('F: the Week shows two projects over three days; an empty past cell records, Edit changes, Delete asks first, and the figures follow without a reload (AC-5.1, 5.2, 5.12, 5.14, 5.16, 5.17, 5.19, 5.20)', async ({
    browser,
  }) => {
    // Three projects, the person on each team; named so that alpha, beta, gamma sort in that order.
    const made = async (label: string): Promise<ProjectRow> =>
      setTeamViaApi(admin, await createProjectViaApi(admin, `Hip F ${label} ${runId}`), [weeker.userId])
    const alpha = await made('alpha')
    const beta = await made('beta')
    const gamma = await made('gamma')
    const days = Array.from({ length: 7 }, (_, index) => addDays(lastMonday, index))
    const [mon, tue, wed, thu, fri] = days as [string, string, string, string, string, string, string]

    // The week is last week, so all seven days are in the past whatever day today is. Two projects over three days…
    await createEntryViaApi(weeker, { day: mon, minutes: 120, on: { type: 'project', id: alpha.id } })
    // …two of them on alpha's Monday, so that one cell holds two entries (its figure is their sum, AC-5.9, AC-5.15).
    await createEntryViaApi(weeker, {
      day: mon,
      minutes: 60,
      on: { type: 'project', id: alpha.id },
      note: `Hip F second ${runId}`,
    })
    const alphaWed = await createEntryViaApi(weeker, {
      day: wed,
      minutes: 180,
      on: { type: 'project', id: alpha.id },
    })
    const betaTue = await createEntryViaApi(weeker, {
      day: tue,
      minutes: 90,
      on: { type: 'project', id: beta.id },
    })
    await createEntryViaApi(weeker, { day: wed, minutes: 120, on: { type: 'project', id: beta.id } })
    // …and one other-work entry, to see the order of the kinds (projects first).
    await createEntryViaApi(weeker, { day: fri, minutes: 60, on: { type: 'none', categoryId: training.id } })
    // …and this week's own: one entry today on alpha, so the current week has a row to read the future days against.
    await createEntryViaApi(weeker, { day: today, minutes: 30, on: { type: 'project', id: alpha.id } })

    const ctx = await personContext(browser, weeker)
    const page = await ctx.newPage()
    const cell = (key: string, day: string): Locator => page.locator(`[data-cell="${key}:${day}"]`)
    const rowOf = (key: string): Locator => page.getByTestId(`hours-table-row-${key}`)
    const lastCell = (row: Locator): Locator => row.getByRole('cell').last()
    const dayTotals = (): Locator => page.getByTestId('hours-table-row-total')
    const alphaKey = `project:${alpha.id}`
    const betaKey = `project:${beta.id}`
    const gammaKey = `project:${gamma.id}`
    const otherKey = `category:${training.id}`

    // AC-5.1: My hours opens on the List, with a List | Week switch.
    await page.goto('/hours')
    await expect(page.getByTestId('hours-my-page')).toBeVisible({ timeout: 30_000 })
    const switcher = page.getByTestId('hours-view-switch')
    await expect(switcher.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('hours-table')).toHaveCount(0)

    // AC-5.2 and AC-5.4: the Week opens, on this week, from its own address.
    await page.goto('/hours?view=week')
    await expect(page.getByTestId('hours-table')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('hours-table-heading')).toHaveText(weekLabel(currentMonday))
    await expect(page.getByTestId('hours-period-current')).toHaveAttribute('aria-disabled', 'true')
    // Seven days, Monday to Sunday (AC-5.3), today marked.
    await expect(page.getByTestId('hours-table-table').locator('thead th')).toHaveCount(9)
    await expect(page.getByTestId('hours-table-table').locator('thead')).toContainText('Today')
    // AC-5.14: a day after today offers no recording (when the week has one: it has not on a Sunday).
    if (today < addDays(currentMonday, 6)) {
      await expect(cell(alphaKey, addDays(today, 1))).toHaveCount(0)
      await expect(cell(alphaKey, addDays(currentMonday, 6))).toHaveCount(0)
    }
    await expect(cell(alphaKey, today)).toHaveText('30 min')

    // The List's switch and the Week's address agree: from the List, the Week tab asks for the same view.
    await page.goto('/hours')
    await expect(page.getByTestId('hours-my-page')).toBeVisible({ timeout: 30_000 })
    await switcher.getByRole('tab', { name: 'Week' }).click()
    await expect(page).toHaveURL(/view=week/)
    await expect(page.getByTestId('hours-table-heading')).toHaveText(weekLabel(currentMonday), { timeout: 30_000 })

    // Last week: the figures. Rows in order (projects by name, then other work), a total row last.
    await page.getByTestId('hours-period-previous').click()
    await expect(page).toHaveURL(new RegExp(`week=${lastMonday}`))
    await expect(page.getByTestId('hours-table-heading')).toHaveText(weekLabel(lastMonday), { timeout: 30_000 })
    await expect(page.getByTestId('hours-period-current')).not.toHaveAttribute('aria-disabled', 'true')
    await expect(cell(alphaKey, mon)).toHaveText('3 h', { timeout: 30_000 })
    await expect(cell(alphaKey, wed)).toHaveText('3 h')
    await expect(cell(betaKey, tue)).toHaveText('1 h 30')
    await expect(cell(betaKey, wed)).toHaveText('2 h')
    await expect(cell(otherKey, fri)).toHaveText('1 h')
    const bodyRows = page.getByTestId('hours-table-table').locator('tbody tr')
    await expect(bodyRows).toHaveCount(4)
    await expect(bodyRows.nth(0)).toContainText(alpha.name)
    await expect(bodyRows.nth(1)).toContainText(beta.name)
    await expect(bodyRows.nth(2)).toContainText(training.name)
    await expect(bodyRows.nth(3)).toContainText('Total')
    await expect(lastCell(rowOf(alphaKey))).toHaveText('6 h')
    await expect(lastCell(rowOf(betaKey))).toHaveText('3 h 30')
    await expect(lastCell(rowOf(otherKey))).toHaveText('1 h')
    await expect(lastCell(dayTotals())).toHaveText('10 h 30')
    // Day totals (the cells after the row header): Mon 3 h, Tue 1 h 30, Wed 5 h, Thu —, Fri 1 h, Sat —, Sun —, then the week.
    const totals = (await dayTotals().getByRole('cell').allInnerTexts()).map((text) => text.trim())
    expect(totals).toEqual(['3 h', '1 h 30', '5 h', '—', '1 h', '—', '—', '10 h 30'])

    // AC-5.12 / AC-5.13 / AC-5.20: an empty past cell records, and the figures follow without a reload.
    await page.evaluate(() => {
      ;(window as unknown as { __hipSameDocument: boolean }).__hipSameDocument = true
    })
    await expect(cell(alphaKey, thu)).toHaveAccessibleName(/^Record hours on .*Thursday/)
    await cell(alphaKey, thu).click()
    const record = hoursDialog(page)
    await expect(record).toBeVisible({ timeout: 30_000 })
    await expect(record.getByTestId('hours-entry-day')).toHaveValue(thu)
    await expect(record.getByTestId('hours-entry-day')).toBeEnabled()
    // The row's project is chosen, and still a choice (My hours' own dialog, not a fixed one).
    await expect(record.getByTestId('hours-entry-on-project')).toBeChecked()
    await expect(record.getByTestId('hours-entry-project-input')).toHaveValue(alpha.name)
    await expect(record.getByTestId('hours-entry-duration')).toBeFocused()
    await record.getByTestId('hours-entry-duration').fill('1')
    await record.getByTestId('hours-entry-dialog-submit').click()
    await record.waitFor({ state: 'detached', timeout: 30_000 })
    await expect(cell(alphaKey, thu)).toHaveText('1 h', { timeout: 30_000 })
    await expect(lastCell(rowOf(alphaKey))).toHaveText('7 h')
    await expect(lastCell(dayTotals())).toHaveText('11 h 30')
    expect((await dayTotals().getByRole('cell').allInnerTexts())[3]!.trim()).toBe('1 h')
    expect(await page.evaluate(() => (window as unknown as { __hipSameDocument?: boolean }).__hipSameDocument)).toBe(
      true,
    )
    await expect(cell(alphaKey, thu)).toBeFocused() // focus lands on the cell it came from
    expect((await entriesOn(weeker, thu)).filter((entry) => entry.on.id === alpha.id)).toHaveLength(1)

    // AC-5.15: a cell of two entries lists both, as the List does; its figure is their sum.
    await cell(alphaKey, mon).click()
    const monDialog = page.getByRole('dialog', { name: `Project: ${alpha.name}` })
    await expect(monDialog).toBeVisible()
    await expect(monDialog).toContainText('Monday')
    await expect(monDialog).toContainText('2 entries, 3 h')
    await expect(monDialog).toContainText(`Hip F second ${runId}`)
    await expect(monDialog.getByRole('button', { name: /^Edit/ })).toHaveCount(2)
    await monDialog.getByTestId('hours-table-cell-done').click()
    await expect(monDialog).toHaveCount(0)
    await expect(cell(alphaKey, mon)).toBeFocused() // Escape or Close: back on the cell that opened it

    // AC-5.16: a cell's Edit changes one entry (PATCH), and the cell dialog stays on it.
    await cell(alphaKey, wed).click()
    const cellDialog = page.getByRole('dialog', { name: `Project: ${alpha.name}` })
    await expect(cellDialog).toBeVisible()
    await expect(cellDialog).toContainText('3 h')
    await cellDialog.getByTestId(`hours-entry-${alphaWed.id}-edit`).click()
    await expect(page.getByTestId('hours-entry-duration')).toBeVisible()
    await page.getByTestId('hours-entry-duration').fill('3.5')
    await page.getByTestId('hours-entry-dialog-submit').click()
    await expect(page.getByTestId('hours-entry-duration')).toHaveCount(0, { timeout: 30_000 })
    await expect(cellDialog).toBeVisible()
    await expect(cellDialog).toContainText('3 h 30')
    await expect(cellDialog.getByTestId(`hours-entry-${alphaWed.id}-edit`)).toBeFocused()
    await cellDialog.getByTestId('hours-table-cell-done').click()
    await expect(cellDialog).toHaveCount(0)
    await expect(cell(alphaKey, wed)).toHaveText('3 h 30', { timeout: 30_000 })
    await expect(lastCell(rowOf(alphaKey))).toHaveText('7 h 30')
    await expect(lastCell(dayTotals())).toHaveText('12 h')
    expect((await ownEntriesViaApi(weeker, wed, wed)).find((entry) => entry.id === alphaWed.id)?.minutes).toBe(210)

    // AC-5.17: Delete asks first. Cancel sends nothing; Confirm deletes, the cell empties and the dialog closes.
    await cell(betaKey, tue).click()
    const betaDialog = page.getByRole('dialog', { name: `Project: ${beta.name}` })
    await expect(betaDialog).toBeVisible()
    await betaDialog.getByTestId(`hours-entry-${betaTue.id}-delete`).click()
    const confirm = page.getByTestId('hours-entry-delete-dialog-confirm')
    await expect(confirm).toBeVisible()
    await page.getByTestId('hours-entry-delete-dialog-cancel').click()
    await expect(confirm).toHaveCount(0)
    expect((await ownEntriesViaApi(weeker, tue, tue)).some((entry) => entry.id === betaTue.id)).toBe(true)
    await betaDialog.getByTestId(`hours-entry-${betaTue.id}-delete`).click()
    await confirm.click()
    await expect(betaDialog).toHaveCount(0, { timeout: 30_000 })
    await expect(cell(betaKey, tue)).toHaveAccessibleName(/^Record hours on .*Tuesday/, { timeout: 30_000 })
    await expect(cell(betaKey, tue)).toBeFocused() // the now-empty cell
    await expect(lastCell(rowOf(betaKey))).toHaveText('2 h')
    await expect(lastCell(dayTotals())).toHaveText('10 h 30')
    expect((await ownEntriesViaApi(weeker, tue, tue)).some((entry) => entry.id === betaTue.id)).toBe(false)

    // AC-5.19: recording on something with no hours that week, with the page's Record hours, adds its row.
    await expect(rowOf(gammaKey)).toHaveCount(0)
    await page.getByTestId('hours-record').click()
    const header = hoursDialog(page)
    await expect(header).toBeVisible({ timeout: 30_000 })
    await header.getByTestId('hours-entry-day').fill(fri)
    await header.getByTestId('hours-entry-duration').fill('1')
    await header.getByTestId('hours-entry-on-project').check()
    await header.getByTestId('hours-entry-project-input').fill(gamma.name)
    await page.getByTestId(`hours-entry-project-input-option-${gamma.id}`).click()
    await header.getByTestId('hours-entry-dialog-submit').click()
    await header.waitFor({ state: 'detached', timeout: 30_000 })
    await expect(rowOf(gammaKey)).toBeVisible({ timeout: 30_000 })
    await expect(cell(gammaKey, fri)).toHaveText('1 h')
    await expect(page.getByTestId('hours-table-table').locator('tbody tr').nth(2)).toContainText(gamma.name) // after beta, before other work
    await expect(lastCell(dayTotals())).toHaveText('11 h 30')
    expect(await page.evaluate(() => (window as unknown as { __hipSameDocument?: boolean }).__hipSameDocument)).toBe(
      true,
    )

    // A save on a day outside the week shown says so (design S7), and the week itself is not changed by it.
    await page.getByTestId('hours-record').click()
    const outside = hoursDialog(page)
    await expect(outside).toBeVisible({ timeout: 30_000 })
    await outside.getByTestId('hours-entry-duration').fill('0.5')
    await outside.getByTestId('hours-entry-on-project').check()
    await outside.getByTestId('hours-entry-project-input').fill(gamma.name)
    await page.getByTestId(`hours-entry-project-input-option-${gamma.id}`).click()
    await outside.getByTestId('hours-entry-dialog-submit').click()
    await outside.waitFor({ state: 'detached', timeout: 30_000 })
    await expect(page.getByTestId('hours-entry-saved')).toContainText(
      `${dmy(today)} is outside the week you are viewing.`,
    )
    await expect(lastCell(dayTotals())).toHaveText('11 h 30')

    await expect(page.getByTestId('hours-table-heading')).toHaveText(weekLabel(lastMonday))
    await ctx.close()

    // Out-of-band: the person's own hours of last week are exactly what the grid said.
    const mine = await ownEntriesViaApi(weeker, lastMonday, addDays(lastMonday, 6))
    expect(mine.reduce((sum, entry) => sum + entry.minutes, 0)).toBe(690)
  })
})
