/**
 * specs/20261116-letterhead-service T26 — the history of a letterhead, an old version opened in the preview, and its
 * restore, through the REAL shell, letterheads-ui, `auth` and letterhead-api (see fixtures/letterheads.ts).
 *
 *   AC-8.7  the history lists every version with its number, who saved it, when, and the names of what changed; a version can
 *           be opened in the preview, and restored (AC-4.2) after a confirmation: a NEW version with the same settings, made
 *           the active one, the older ones left as they are
 *
 * The prerequisites are letterheads.spec.ts's. Versions are made through the service's own save route (as the person who
 * would make them), so the history has known rows to read whatever the database held before; each test then reads the
 * numbers it starts from.
 */
import { expect, test, type Page } from '@playwright/test'
import {
  ENTITY_NAME,
  activeVersion,
  contextFor,
  ensureLetterheads,
  history,
  marginInput,
  openConfigurator,
  pageImages,
  saveButton,
  saveVersion,
  setUpPeople,
  versionConfig,
  withConfig,
  type People,
} from './fixtures/letterheads'

test.describe.configure({ mode: 'serial' })

let people: People

test.beforeAll(async () => {
  test.setTimeout(180_000)
  people = await setUpPeople()
  await ensureLetterheads(people.admin)
})

const ENTITY = 'welld_ch' as const

/**
 * Three versions made by the administrator on top of whatever is there: A (top margin a), B (top margin b, and a different
 * body font), C (top margin c). Returns their numbers and the values, all different from each other.
 */
async function makeVersions(): Promise<{ a: number; b: number; c: number; tops: [number, number, number] }> {
  const base = await versionConfig(people.admin, ENTITY, (await activeVersion(people.admin, ENTITY))!)
  const tops: [number, number, number] = [41, 42, 43]
  const a = await saveVersion(people.admin, ENTITY, withConfig(base, (d) => { d.margins.top = tops[0] }))
  const aConfig = await versionConfig(people.admin, ENTITY, a)
  const b = await saveVersion(
    people.admin,
    ENTITY,
    withConfig(aConfig, (d) => {
      d.margins.top = tops[1]
      d.fonts.body = d.fonts.body === 'Ubuntu' ? 'Noto Serif' : 'Ubuntu'
    }),
  )
  const bConfig = await versionConfig(people.admin, ENTITY, b)
  const c = await saveVersion(people.admin, ENTITY, withConfig(bConfig, (d) => { d.margins.top = tops[2] }))
  return { a, b, c, tops }
}

const historyTable = (page: Page) => page.getByRole('table', { name: `Versions of ${ENTITY_NAME[ENTITY]}` })
const rowOf = (page: Page, version: number) =>
  historyTable(page).getByRole('row').filter({ has: page.getByRole('button', { name: `Open version ${version} in the preview` }) })

async function openHistory(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'History' }).click()
  await expect(historyTable(page)).toBeVisible({ timeout: 30_000 })
}

test.describe('specs/20261116-letterhead-service T26: the history and the restore (AC-8.7)', () => {
  let v: Awaited<ReturnType<typeof makeVersions>>

  test.beforeAll(async () => {
    v = await makeVersions()
  })

  test('the history lists every version: number, who saved it, when, what changed; the newest is the active one (AC-8.7)', async ({
    browser,
  }) => {
    const rows = await history(people.admin, ENTITY)
    const context = await contextFor(browser, people.admin)
    const page = await context.newPage()
    await openConfigurator(page, ENTITY)
    await openHistory(page)

    // Every version the service holds is a row, newest first, and nothing else is.
    const table = historyTable(page)
    await expect(table.getByRole('row')).toHaveCount(rows.length + 1) // + the header row
    const dataRows = table.getByRole('row').filter({ has: page.getByRole('button', { name: /^Open version \d+ in the preview$/ }) })
    await expect(dataRows).toHaveCount(rows.length)
    await expect(dataRows.first()).toContainText(String(v.c))
    for (const header of ['Version', 'Saved by', 'Saved on', 'What changed', 'Actions']) {
      await expect(table.getByRole('columnheader', { name: header })).toBeVisible()
    }

    // The newest row is the active one and the only one; it cannot be restored (it is the active version).
    await expect(table.getByText('Active', { exact: true })).toHaveCount(1)
    await expect(rowOf(page, v.c)).toContainText('Active')
    await expect(rowOf(page, v.c).getByRole('button', { name: `Restore version ${v.c}` })).toHaveCount(0)

    // Version B changed the margins and the fonts: said in words, not codes, with who saved it and a date.
    const b = rowOf(page, v.b)
    await expect(b).toContainText('Letterheads E2E Admin')
    await expect(b).toContainText('Margins')
    await expect(b).toContainText('Fonts')
    const stored = rows.find((r) => r.version === v.b)!
    expect(stored.changedSettings).toEqual(expect.arrayContaining(['margins', 'fonts']))
    // The date is shown in the suite's format (a real date, with the year of the version's own timestamp).
    await expect(b).toContainText(String(new Date(stored.createdAt).getFullYear()))
    await expect(b).not.toContainText('Invalid')
    // C changed only the margins.
    await expect(rowOf(page, v.c)).toContainText('Margins')
    await expect(rowOf(page, v.c)).not.toContainText('Fonts')
    // The older ones can be restored (this person may change the letterhead) and opened.
    await expect(rowOf(page, v.a).getByRole('button', { name: `Restore version ${v.a}` })).toBeVisible()
    await context.close()
  })

  test('an old version opens in the preview, read-only, with its own values; back to the active one (AC-8.7)', async ({ browser }) => {
    const context = await contextFor(browser, people.admin)
    const page = await context.newPage()
    await openConfigurator(page, ENTITY)
    await openHistory(page)

    await rowOf(page, v.a).getByRole('button', { name: `Open version ${v.a} in the preview` }).click()

    // The banner names the version, who saved it and when, and says it is not the active one; the focus is on its heading.
    const banner = page.getByTestId('letterheads-version-banner')
    await expect(banner).toBeVisible()
    await expect(page.getByTestId('letterheads-version-heading')).toHaveText(`Viewing version ${v.a}`)
    await expect(page.getByTestId('letterheads-version-heading')).toBeFocused()
    await expect(banner).toContainText('Saved by Letterheads E2E Admin on')
    await expect(banner).toContainText('This is not the active version.')
    await expect(page).toHaveURL(new RegExp(`version=${v.a}`))

    // The form shows THAT version's values and cannot be changed (whatever the person may do to the active one); the
    // preview is drawn from them; nothing offers to save.
    await expect(marginInput(page, 'Top')).toHaveValue(String(v.tops[0]))
    await expect(marginInput(page, 'Top')).toBeDisabled()
    await expect(saveButton(page)).toHaveCount(0)
    await expect(pageImages(page).first()).toBeVisible()
    expect(await pageImages(page).count()).toBeGreaterThanOrEqual(3)

    // Back to the active version: its values, editable again, the focus on the page heading.
    await page.getByTestId('letterheads-version-back').click()
    await expect(banner).toHaveCount(0)
    await expect(marginInput(page, 'Top')).toHaveValue(String(v.tops[2]))
    await expect(marginInput(page, 'Top')).toBeEnabled()
    await expect(page.getByText(`Active version ${v.c}`)).toBeVisible()
    await context.close()
  })

  test('restore asks first; cancelled it changes nothing; confirmed it makes a NEW active version with the old settings (AC-8.7, AC-4.2)', async ({
    browser,
  }) => {
    const activeBefore = (await activeVersion(people.admin, ENTITY))!
    expect(activeBefore).toBe(v.c)
    const rowsBefore = await history(people.admin, ENTITY)

    const context = await contextFor(browser, people.admin)
    const page = await context.newPage()
    await openConfigurator(page, ENTITY)
    await openHistory(page)

    // The row's Restore opens a confirmation that says what will happen, in numbers.
    const restoreB = rowOf(page, v.b).getByRole('button', { name: `Restore version ${v.b}` })
    await restoreB.click()
    const dialog = page.getByRole('alertdialog', { name: `Restore version ${v.b}?` })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(
      `This creates version ${v.c + 1} with the same settings and logos as version ${v.b} and makes it the active one. Version ${v.c} and the rest of the history stay as they are.`,
    )

    // Cancelled (Escape): the dialog goes, the focus returns to the button that opened it, and nothing was written.
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(restoreB).toBeFocused()
    expect(await activeVersion(people.admin, ENTITY)).toBe(activeBefore)
    expect((await history(people.admin, ENTITY)).length).toBe(rowsBefore.length)

    // Confirmed: version C+1, a copy of B's settings; the older versions stay as they were.
    await restoreB.click()
    await page.getByRole('alertdialog', { name: `Restore version ${v.b}?` }).getByRole('button', { name: `Restore version ${v.b}` }).click()
    const next = v.c + 1
    await expect(page.getByTestId('letterheads-restored')).toContainText(`Version ${next} created from version ${v.b}`)
    await expect(page.getByRole('alertdialog', { name: `Restore version ${v.b}?` })).toHaveCount(0)

    // The page is on the new active version, in the Settings view, editable, with B's values, focus on the page heading.
    await expect(page.getByText(`Active version ${next}`)).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
    await expect(marginInput(page, 'Top')).toHaveValue(String(v.tops[1]))
    await expect(marginInput(page, 'Top')).toBeEnabled()
    await expect(page.getByText('No unsaved changes')).toBeVisible()
    await expect(page.getByRole('heading', { name: ENTITY_NAME[ENTITY], level: 2 })).toBeFocused()

    // What the service holds: a NEW version that says it was restored from B and holds exactly B's configuration; B, C and
    // the rest are untouched (no version is ever changed or deleted: AC-4.3).
    expect(await activeVersion(people.admin, ENTITY)).toBe(next)
    const rowsAfter = await history(people.admin, ENTITY)
    expect(rowsAfter.length).toBe(rowsBefore.length + 1)
    expect(rowsAfter[0]).toMatchObject({ version: next, restoredFrom: v.b })
    expect(rowsAfter[0]!.createdBy.name).toBe('Letterheads E2E Admin')
    expect(await versionConfig(people.admin, ENTITY, next)).toEqual(await versionConfig(people.admin, ENTITY, v.b))
    expect(rowsAfter.slice(1)).toEqual(rowsBefore)
    expect((await versionConfig(people.admin, ENTITY, v.c) as { margins: { top: number } }).margins.top).toBe(v.tops[2])

    // The history says it: the new row is active, says where it came from, and the old active one is no longer.
    await openHistory(page)
    await expect(rowOf(page, next)).toContainText('Active')
    await expect(rowOf(page, next)).toContainText(`Restored from version ${v.b}`)
    await expect(rowOf(page, next)).toContainText(`Same settings as version ${v.b}`)
    await expect(historyTable(page).getByText('Active', { exact: true })).toHaveCount(1)
    await context.close()
  })

  test('an old version restored from its own banner, by keyboard (AC-8.7)', async ({ browser }) => {
    const activeBefore = (await activeVersion(people.admin, ENTITY))!
    const context = await contextFor(browser, people.admin)
    const page = await context.newPage()
    await openConfigurator(page, ENTITY, `&version=${v.a}`)
    await expect(page.getByTestId('letterheads-version-heading')).toHaveText(`Viewing version ${v.a}`)

    const restore = page.getByTestId('letterheads-version-restore')
    await expect(restore).toHaveText('Restore this version')
    await restore.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('alertdialog', { name: `Restore version ${v.a}?` })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: `Restore version ${v.a}` }).focus()
    await page.keyboard.press('Enter')

    const next = activeBefore + 1
    await expect(page.getByTestId('letterheads-restored')).toContainText(`Version ${next} created from version ${v.a}`)
    await expect(page.getByTestId('letterheads-version-banner')).toHaveCount(0)
    await expect(marginInput(page, 'Top')).toHaveValue(String(v.tops[0]))
    expect((await history(people.admin, ENTITY))[0]).toMatchObject({ version: next, restoredFrom: v.a })
    expect(await versionConfig(people.admin, ENTITY, next)).toEqual(await versionConfig(people.admin, ENTITY, v.a))
    await context.close()
  })

  test('a restore from a stale history is refused as a conflict and writes nothing (AC-8.7, AC-4.8)', async ({ browser }) => {
    const context = await contextFor(browser, people.admin)
    const page = await context.newPage()
    await openConfigurator(page, ENTITY)
    await openHistory(page)
    const seen = (await activeVersion(people.admin, ENTITY))!

    // Someone else saves while the page is open: the page still thinks `seen` is the active version.
    const base = await versionConfig(people.admin, ENTITY, seen)
    const theirs = await saveVersion(people.admin, ENTITY, withConfig(base, (d) => { d.margins.top = Number(d.margins.top) === 44 ? 45 : 44 }))
    const rowsBefore = await history(people.admin, ENTITY)

    await rowOf(page, v.a).getByRole('button', { name: `Restore version ${v.a}` }).click()
    const dialog = page.getByRole('alertdialog', { name: `Restore version ${v.a}?` })
    await dialog.getByRole('button', { name: `Restore version ${v.a}` }).click()

    await expect(dialog).toContainText('A newer version was saved meanwhile. Reload the history and try again.')
    expect(await activeVersion(people.admin, ENTITY)).toBe(theirs)
    expect(await history(people.admin, ENTITY)).toEqual(rowsBefore)
    await context.close()
  })
})
