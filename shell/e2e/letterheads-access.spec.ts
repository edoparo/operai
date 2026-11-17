/**
 * specs/20261116-letterhead-service T26 — who may open the Letterheads tool and who may change a letterhead, through the
 * REAL shell, letterheads-ui, `auth` and letterhead-api (see fixtures/letterheads.ts: grants are written through `auth`'s
 * admin API, as an administrator writes them).
 *
 *   AC-8.1  the tool is in the suite, at /letterheads, for the people who hold `letterheads:access`; a signed-in person who
 *           does not hold it does not see it and is refused at the route (the remote is never even mounted)
 *   AC-8.2  a holder of access only sees both entities' active letterhead, history and preview and cannot save or restore: the
 *           screen offers nothing to change, and the service itself refuses the attempt with 403 whatever the screen shows;
 *           the change permission is entity-scoped (a CH manager changes wellD CH, and a change to wellD IT is refused with
 *           403 `out_of_scope` and changes nothing); an administrator changes both
 *   AC-8.9  the seed gives both permissions to the `admin` role only (no other system role holds either)
 *
 * The prerequisites are letterheads.spec.ts's. The configurator's own journeys are letterheads.spec.ts; the history and the
 * restore are letterheads-versions.spec.ts.
 */
import { expect, test } from '@playwright/test'
import {
  ENTITY_NAME,
  LETTERHEADS_API_URL,
  activeVersion,
  authCall,
  contextFor,
  ensureLetterheads,
  history,
  lhCall,
  marginInput,
  openConfigurator,
  pageImages,
  recordPreviewCalls,
  saveButton,
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

const toolLink = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'Tool navigation' }).getByRole('link', { name: 'Letterheads', exact: true })

test.describe('specs/20261116-letterhead-service T26: access to the Letterheads tool (AC-8.1, AC-8.9)', () => {
  test('a person without the access permission does not see the tool and is refused at the route (AC-8.1)', async ({ browser }) => {
    const context = await contextFor(browser, people.nobody)
    const page = await context.newPage()
    const toService: string[] = []
    page.on('request', (request) => {
      if (request.url().startsWith(LETTERHEADS_API_URL)) toService.push(request.url())
    })

    // The suite is there (other tools, for whom this person has grants or not), and Letterheads is not among them.
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'Tool navigation' })).toBeVisible({ timeout: 30_000 })
    await expect(toolLink(page)).toHaveCount(0)

    // The route: not the tool. A deep link below it is refused the same way.
    for (const path of ['/letterheads', '/letterheads?entity=welld_ch', '/letterheads/anything/below?view=history']) {
      await page.goto(path)
      await expect(page.getByRole('navigation', { name: 'Tool navigation' })).toBeVisible({ timeout: 30_000 })
      await expect.poll(() => new URL(page.url()).pathname, { message: `${path} is left` }).not.toMatch(/^\/letterheads/)
      await expect(page.getByRole('heading', { name: 'Letterheads', level: 1 })).toHaveCount(0)
      await expect(page.getByTestId('letterheads-form')).toHaveCount(0)
    }
    // The remote never ran: not one request reached the service.
    expect(toService).toEqual([])

    // And the service itself says no, whatever the shell does: the token is real, the permission is not.
    const read = await lhCall<{ code?: string }>(people.nobody, 'GET', '/v1/letterheads')
    expect(read.status).toBe(403)
    expect(read.body.code).toBe('forbidden')
    expect((await lhCall(people.nobody, 'POST', '/v1/letterheads/welld_ch/preview', { config: {}, language: 'en' })).status).toBe(403)
    await context.close()
  })

  test('a holder of access sees the tool in the suite and reaches /letterheads from it (AC-8.1)', async ({ browser }) => {
    const context = await contextFor(browser, people.viewer)
    const page = await context.newPage()
    await page.goto('/')
    await expect(toolLink(page)).toBeVisible({ timeout: 30_000 })
    await expect(toolLink(page)).toHaveAttribute('href', '/letterheads')
    await toolLink(page).click()
    await expect(page).toHaveURL(/\/letterheads/)
    await expect(page.getByRole('heading', { name: 'Letterheads', level: 1 })).toBeVisible()
    await expect(page.getByTestId('letterheads-form')).toBeVisible({ timeout: 30_000 })
    // Both entities are listed for a holder of access, whatever they may change.
    await expect(page.getByRole('tab', { name: ENTITY_NAME.welld_it })).toBeVisible()
    await expect(page.getByRole('tab', { name: ENTITY_NAME.welld_ch })).toBeVisible()
    await context.close()
  })

  test('the seed gives both permissions to `admin` only: no other system role holds either (AC-8.9)', async () => {
    const roles = (await authCall<Array<{ id: string; name: string; isSystem: boolean }>>(people.admin, 'GET', '/admin/roles')).body
    expect(roles.length).toBeGreaterThan(1)
    const holders: Record<string, string[]> = {}
    for (const role of roles) {
      const detail = (await authCall<{ rules: Array<{ resource: string; action: string; conditions: unknown }> }>(
        people.admin,
        'GET',
        `/admin/roles/${role.id}`,
      )).body
      const held = detail.rules
        .filter((r) => (r.resource === 'letterheads' && r.action === 'access') || (r.resource === 'letterhead' && r.action === 'manage'))
        .map((r) => `${r.resource}:${r.action}${r.conditions === null || r.conditions === undefined ? '' : ' (conditioned)'}`)
      if (held.length > 0) holders[role.name] = held
    }
    // The roles this spec made for itself hold them on purpose; the system roles are the seed's.
    const system = new Set(roles.filter((r) => r.isSystem).map((r) => r.name))
    const bySeed = Object.fromEntries(Object.entries(holders).filter(([name]) => system.has(name)))
    expect(Object.keys(bySeed)).toEqual(['admin'])
    // Both, and the change permission unconditioned (every entity).
    expect(bySeed['admin']).toEqual(expect.arrayContaining(['letterheads:access', 'letterhead:manage']))
    expect(bySeed['admin']).not.toContain('letterhead:manage (conditioned)')
  })
})

test.describe('specs/20261116-letterhead-service T26: who may change a letterhead (AC-8.2)', () => {
  test('a holder of access only: both entities read-only, nothing offered to change, and the service refuses a save and a restore (AC-8.2)', async ({
    browser,
  }) => {
    const before = {
      welld_it: (await activeVersion(people.admin, 'welld_it'))!,
      welld_ch: (await activeVersion(people.admin, 'welld_ch'))!,
    }
    const context = await contextFor(browser, people.viewer)
    const page = await context.newPage()
    const calls = recordPreviewCalls(page)

    for (const entity of ['welld_ch', 'welld_it'] as const) {
      await openConfigurator(page, entity)
      await expect(page.getByRole('heading', { name: ENTITY_NAME[entity], level: 2 })).toBeVisible()
      // The reason, said once at the top; every value shown and none of them editable; no Save at all.
      await expect(page.getByTestId('letterheads-readonly-banner')).toContainText(
        'You can see this letterhead, its history and its preview, but you cannot change it. Ask an administrator for the permission to change letterheads.',
      )
      await expect(marginInput(page, 'Top')).toBeDisabled()
      await expect(marginInput(page, 'Top')).not.toHaveValue('')
      await expect(saveButton(page)).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Remove logo' })).toHaveCount(0)
      await expect(page.getByRole('checkbox', { name: 'Use a different first page' })).toBeDisabled()
      // What a holder of access can do: the preview (drawn, in either language) and the history.
      await expect(pageImages(page).first()).toBeVisible()
      await page.getByRole('radio', { name: 'Italian' }).check()
      await expect.poll(() => calls.some((c) => c.language === 'it')).toBe(true)
      await page.getByRole('tab', { name: 'History' }).click()
      const table = page.getByRole('table', { name: `Versions of ${ENTITY_NAME[entity]}` })
      await expect(table).toBeVisible()
      await expect(table.getByRole('button', { name: /^Open version \d+ in the preview$/ }).first()).toBeVisible()
      await expect(table.getByRole('button', { name: /^Restore version \d+$/ })).toHaveCount(0)
    }

    // An old version opens read-only, with no Restore for this person.
    const rows = await history(people.admin, 'welld_ch')
    if (rows.length >= 2) {
      await page.goto(`/letterheads?entity=welld_ch&version=${rows[1]!.version}`)
      await expect(page.getByTestId('letterheads-version-banner')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('letterheads-version-restore')).toHaveCount(0)
      await expect(page.getByTestId('letterheads-version-back')).toBeVisible()
    }

    // The screen offers nothing, and the service does not trust the screen: every write is a 403 `forbidden` with no effect.
    const config = await versionConfig(people.admin, 'welld_ch', before.welld_ch)
    const edited = withConfig(config, (draft) => {
      draft.margins.top = Number(draft.margins.top) === 31 ? 32 : 31
    })
    const save = await lhCall<{ code?: string }>(people.viewer, 'POST', '/v1/letterheads/welld_ch/versions', {
      baseVersion: before.welld_ch,
      config: edited,
    })
    expect(save.status).toBe(403)
    expect(save.body.code).toBe('forbidden')
    const restore = await lhCall<{ code?: string }>(people.viewer, 'POST', `/v1/letterheads/welld_ch/versions/1/restore`, {
      baseVersion: before.welld_ch,
    })
    expect(restore.status).toBe(403)
    expect(restore.body.code).toBe('forbidden')
    const upload = await fetch(`${LETTERHEADS_API_URL}/v1/letterheads/welld_ch/assets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${people.viewer.token}` },
      body: (() => {
        const form = new FormData()
        form.set('kind', 'logo')
        form.set('file', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'logo.png')
        return form
      })(),
    })
    expect(upload.status).toBe(403)

    expect(await activeVersion(people.admin, 'welld_ch')).toBe(before.welld_ch)
    expect(await activeVersion(people.admin, 'welld_it')).toBe(before.welld_it)
    await context.close()
  })

  test('a manager of wellD CH changes wellD CH and sees wellD IT read-only; the service refuses a change to wellD IT with 403 out_of_scope (AC-8.2)', async ({
    browser,
  }) => {
    const itBefore = (await activeVersion(people.admin, 'welld_it'))!
    const itHistoryBefore = (await history(people.admin, 'welld_it')).length
    const context = await contextFor(browser, people.chManager)
    const page = await context.newPage()

    // Both entities are in the list for them; their own is editable...
    await openConfigurator(page, 'welld_ch')
    await expect(page.getByRole('tab', { name: ENTITY_NAME.welld_it })).toBeVisible()
    await expect(page.getByTestId('letterheads-readonly-banner')).toHaveCount(0)
    await expect(marginInput(page, 'Top')).toBeEnabled()
    await expect(saveButton(page)).toBeVisible()

    // ...the other one is the read-only form, with the words that say why (they name their own entity).
    await page.getByRole('tab', { name: ENTITY_NAME.welld_it }).click()
    await expect(page.getByRole('heading', { name: ENTITY_NAME.welld_it, level: 2 })).toBeVisible()
    await expect(page.getByTestId('letterheads-readonly-banner')).toContainText(
      'You can change only the letterhead of wellD CH. This one is read-only for you.',
    )
    await expect(marginInput(page, 'Top')).toBeDisabled()
    await expect(saveButton(page)).toHaveCount(0)
    await expect(pageImages(page).first()).toBeVisible()
    await page.getByRole('tab', { name: 'History' }).click()
    const table = page.getByRole('table', { name: `Versions of ${ENTITY_NAME.welld_it}` })
    await expect(table.getByRole('button', { name: /^Open version \d+ in the preview$/ }).first()).toBeVisible()
    await expect(table.getByRole('button', { name: /^Restore version \d+$/ })).toHaveCount(0)

    // The service, asked directly for the other entity: out of scope, nothing written (and a valid body: it is the scope,
    // not the content, that refuses). The same person's own entity is accepted.
    const config = await versionConfig(people.admin, 'welld_it', itBefore)
    const edited = withConfig(config, (draft) => {
      draft.margins.top = Number(draft.margins.top) === 31 ? 32 : 31
    })
    const refused = await lhCall<{ code?: string }>(people.chManager, 'POST', '/v1/letterheads/welld_it/versions', {
      baseVersion: itBefore,
      config: edited,
    })
    expect(refused.status).toBe(403)
    expect(refused.body.code).toBe('out_of_scope')
    const restoreRefused = await lhCall<{ code?: string }>(people.chManager, 'POST', '/v1/letterheads/welld_it/versions/1/restore', {
      baseVersion: itBefore,
    })
    expect(restoreRefused.status).toBe(403)
    expect(restoreRefused.body.code).toBe('out_of_scope')
    expect(await activeVersion(people.admin, 'welld_it')).toBe(itBefore)
    expect((await history(people.admin, 'welld_it')).length).toBe(itHistoryBefore)

    const chBefore = (await activeVersion(people.admin, 'welld_ch'))!
    const chConfig = await versionConfig(people.admin, 'welld_ch', chBefore)
    const accepted = await lhCall<{ version: number }>(people.chManager, 'POST', '/v1/letterheads/welld_ch/versions', {
      baseVersion: chBefore,
      config: withConfig(chConfig, (draft) => {
        draft.margins.top = Number(draft.margins.top) === 31 ? 32 : 31
      }),
    })
    expect(accepted.status).toBe(201)
    expect(accepted.body.version).toBe(chBefore + 1)
    await context.close()
  })

  test('an administrator, unconditioned, changes both entities (AC-8.2)', async ({ browser }) => {
    const context = await contextFor(browser, people.admin)
    const page = await context.newPage()
    for (const entity of ['welld_ch', 'welld_it'] as const) {
      await openConfigurator(page, entity)
      await expect(page.getByTestId('letterheads-readonly-banner')).toHaveCount(0)
      await expect(marginInput(page, 'Top')).toBeEnabled()
      await expect(saveButton(page)).toBeVisible()
    }
    // The service's own answer for the list says the same, for each person (the browser's idea is never the authority).
    const rows = async (who: keyof People) =>
      (await lhCall<Record<string, { canManage: boolean }>>(people[who], 'GET', '/v1/letterheads')).body
    expect(await rows('admin')).toMatchObject({ welld_it: { canManage: true }, welld_ch: { canManage: true } })
    expect(await rows('chManager')).toMatchObject({ welld_it: { canManage: false }, welld_ch: { canManage: true } })
    expect(await rows('viewer')).toMatchObject({ welld_it: { canManage: false }, welld_ch: { canManage: false } })
    await context.close()
  })
})
