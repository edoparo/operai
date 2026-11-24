/**
 * Receipt codes journey (specs/20261124-receipt-numbers-from-the-register, T23; AC-4.1, AC-4.3, AC-4.7, AC-4.9). Drives the REAL
 * assembled shell host + refund-ui remote against the REAL refund-api and auth, no mocking, like this suite's other refund journeys.
 *
 * Journeys:
 *   - an accounting user (the `accounting` role holds `receipt-code:manage`, and nothing else of Settings, so the page is the one
 *     Receipt codes view with no tab list) does EVERYTHING BY KEYBOARD: opens Settings from the tool navigation; sets a code and
 *     lands back on the button that opened the dialog; tries a code another employee holds, reads the 409 in the field and closes
 *     the dialog with Escape; changes the code; clears it (the Clear button is gone: focus lands on the row's header); opens the
 *     history, reads the three changes and closes it with Escape, landing back on History (AC-4.1, AC-4.3, AC-4.7);
 *   - browser axe (`main`, or the dialog or drawer itself) at the loaded card, the dialog showing the 409 and the open drawer, and a
 *     dark checkpoint of the loaded card (design § Accessibility "Tests the tasks should carry");
 *   - an employee WITHOUT the capability sees no Settings entry in the tool navigation, and refund-api refuses them the list (403,
 *     AC-4.9).
 *
 * Fixtures and state: the employees are new on every run; the codes are drawn from letters no seeded employee derives and are not
 * held by anyone (helpers/refundFixtures.ts `unusedReceiptCodes`); every code a test set is cleared through the API in `afterEach`
 * (the history rows stay, they are append-only). Each employee has one empty draft request, which is what makes Refund know them.
 *
 * Needs the stack in playwright.config.ts's header (auth with ENABLE_TEST_AUTH=true and its seed, refund-api on :8082). The live run
 * is T32 of the spec.
 */
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { applySessionCookie, seedUserSession, type SeededSession } from './helpers/adminSession'
import { axeViolations } from './helpers/meetingsFixtures'
import { tabTo, typeIntoFocused } from './fixtures/letterheads'
import {
  freshToken,
  grantRefundAccounting,
  grantRefundEmployee,
  makeKnownToRefund,
  putReceiptCode,
  refundCall,
  unusedReceiptCodes,
} from './helpers/refundFixtures'

test.describe.configure({ mode: 'serial' })

interface Person {
  session: SeededSession
  token: string
}

const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let accountant: Person
/** The employee whose code the journey sets, changes and clears. */
let employeeA: Person
/** The employee who holds the code employee A is refused (409). */
let employeeB: Person
let codes: { first: string; second: string; held: string }

async function person(label: string, grant: (email: string) => void): Promise<Person> {
  const email = `e2e-receipt-codes-${label}-${RUN}@operai.test`
  const session = await seedUserSession(email, `E2E Receipt Codes ${label}`)
  grant(email)
  return { session, token: await freshToken(session.cookieHeader) }
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  accountant = await person('accountant', (email) => grantRefundAccounting(email, 'welld_ch'))
  employeeA = await person('employee-a', grantRefundEmployee)
  employeeB = await person('employee-b', grantRefundEmployee)
  await makeKnownToRefund(employeeA.token)
  await makeKnownToRefund(employeeB.token)
  const [first, second, held] = await unusedReceiptCodes(accountant.token, 3)
  codes = { first: first!, second: second!, held: held! }
})

test.afterEach(async () => {
  // Codes set in the shared development database are put back: cleared through the API (a clear of an employee without a code is a no-op).
  for (const employee of [employeeA, employeeB]) {
    if (!employee) continue
    try {
      await putReceiptCode(accountant.token, employee.session.userId, null)
    } catch (error) {
      console.error(`[refund-receipt-codes] a test code was not cleared: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
})

/** A browser context signed in as `session`. */
async function signedIn(browser: Browser, session: SeededSession, colorScheme: 'light' | 'dark' = 'light'): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await applySessionCookie(context, session)
  const page = await context.newPage()
  await page.emulateMedia({ colorScheme })
  return { context, page }
}

/** Zero axe violations under `include`, once transitions have ended (a half-faded control would be measured mid-fade). */
async function expectNoAxeViolations(page: Page, label: string, include = 'main'): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))))
  const violations = await axeViolations(page, include)
  expect(
    violations.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes
          .map((n) => `${n.target.join(' ')} ${n.html.slice(0, 160)}`)
          .join(' | ')}`,
    ),
    `axe violations on ${label}`,
  ).toEqual([])
}

const refundNav = (page: Page) => page.getByRole('navigation', { name: 'Refund navigation' })

/** Opens the receipt codes by keyboard from My requests: focus the Settings link of the tool navigation and press Enter. */
async function openReceiptCodes(page: Page): Promise<void> {
  await page.goto('/refund/requests')
  await expect(page.getByTestId('refund-my-requests-page')).toBeVisible({ timeout: 20_000 })
  const settings = refundNav(page).getByRole('link', { name: 'Settings' })
  await expect(settings).toBeVisible({ timeout: 20_000 })
  await tabTo(page, settings)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('refund-settings-view-receipt-codes')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('receipt-codes-table')).toBeVisible({ timeout: 20_000 })
}

const focusedWithin = (locator: Locator): Promise<boolean> =>
  locator.evaluate((element) => element === document.activeElement || element.contains(document.activeElement))

test.describe('specs/20261124-receipt-numbers-from-the-register T23: receipt codes in Settings', () => {
  test('an accounting user sets, changes (409 shown) and clears a code and reads its history by keyboard (AC-4.1, AC-4.3, AC-4.7)', async ({ browser }) => {
    test.setTimeout(180_000)
    // another employee already holds `held`: the 409 of AC-4.3
    expect((await putReceiptCode(accountant.token, employeeB.session.userId, codes.held)).status).toBe(200)
    const { context, page } = await signedIn(browser, accountant.session)
    try {
      // ─── open: Settings is one view for this user (no tab list), reached by keyboard ───────────────────────────
      await openReceiptCodes(page)
      await expect(page.getByTestId('refund-settings-tabs')).toHaveCount(0)
      const rowA = page.getByTestId(`receipt-code-row-${employeeA.session.userId}`)
      await expect(rowA).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId(`receipt-code-row-${employeeB.session.userId}`)).toContainText(codes.held)
      await expectNoAxeViolations(page, 'the loaded receipt codes card')

      // ─── AC-4.1: set a code, by keyboard, and land back on the button that opened the dialog ───────────────────
      const edit = page.getByTestId(`receipt-code-edit-${employeeA.session.userId}`)
      await tabTo(page, edit)
      await page.keyboard.press('Enter')
      const field = page.getByTestId('receipt-code-field')
      await expect(field).toBeFocused({ timeout: 10_000 })
      await typeIntoFocused(page, codes.first.toLowerCase()) // a-z is upper-cased as typed
      await expect(field).toHaveValue(codes.first)
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('receipt-code-submit')).toHaveCount(0, { timeout: 10_000 })
      await expect(page.getByTestId('receipt-codes-success')).toContainText(codes.first)
      await expect(rowA).toContainText(codes.first)
      await expect(edit).toBeFocused()

      // ─── AC-4.3: a code another employee holds is refused, shown in the field, nothing changes ─────────────────
      await page.keyboard.press('Enter')
      await expect(field).toBeFocused({ timeout: 10_000 })
      await typeIntoFocused(page, codes.held)
      await page.keyboard.press('Enter')
      const fieldError = page.getByTestId('receipt-code-field-error')
      await expect(fieldError).toContainText('already in use', { timeout: 10_000 })
      await expect(field).toBeFocused()
      await expectNoAxeViolations(page, 'the receipt code dialog with a 409', '[role="dialog"]')
      await page.keyboard.press('Escape')
      await expect(field).toHaveCount(0)
      await expect(edit).toBeFocused()
      await expect(rowA).toContainText(codes.first) // unchanged
      await expect(rowA).not.toContainText(codes.held)

      // ─── AC-4.1: change it to another free code ───────────────────────────────────────────────────────────────
      await page.keyboard.press('Enter')
      await expect(field).toBeFocused({ timeout: 10_000 })
      await typeIntoFocused(page, codes.second)
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('receipt-code-submit')).toHaveCount(0, { timeout: 10_000 })
      await expect(rowA).toContainText(codes.second)
      await expect(edit).toBeFocused()

      // ─── AC-4.7: clear it (a row action with its own confirmation); focus lands on the row's header ────────────
      const clear = page.getByTestId(`receipt-code-clear-${employeeA.session.userId}`)
      await tabTo(page, clear)
      await page.keyboard.press('Enter')
      const confirm = page.getByTestId('receipt-code-clear-confirm')
      await expect(confirm).toBeVisible({ timeout: 10_000 })
      await tabTo(page, confirm)
      await page.keyboard.press('Enter')
      await expect(confirm).toHaveCount(0, { timeout: 10_000 })
      await expect(page.getByTestId('receipt-codes-success')).toContainText('cleared')
      await expect(rowA).not.toContainText(codes.second)
      await expect(clear).toHaveCount(0) // a row without a code has no Clear
      await expect.poll(() => focusedWithin(rowA.getByRole('rowheader'))).toBe(true)

      // ─── the history: the three changes, newest first; Escape lands back on History ───────────────────────────
      const history = page.getByTestId(`receipt-code-history-${employeeA.session.userId}`)
      await tabTo(page, history)
      await page.keyboard.press('Enter')
      const table = page.getByTestId('refund-history-table')
      await expect(table).toBeVisible({ timeout: 10_000 })
      await expect(table.getByRole('row')).toHaveCount(4) // header and the three changes: set, change, clear
      await expect(table).toContainText(codes.first)
      await expect(table).toContainText(codes.second)
      await expect(table).toContainText(accountant.session.email)
      await expectNoAxeViolations(page, 'the receipt code history drawer', '[data-testid="refund-history-drawer"]')
      await page.keyboard.press('Escape')
      await expect(table).toHaveCount(0)
      await expect(history).toBeFocused()
    } finally {
      await context.close()
    }
  })

  test('dark checkpoint: the loaded card has no axe violation in dark (design § Accessibility)', async ({ browser }) => {
    const { context, page } = await signedIn(browser, accountant.session, 'dark')
    try {
      await page.goto('/refund/settings')
      await expect(page.getByTestId('receipt-codes-table')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId(`receipt-code-row-${employeeA.session.userId}`)).toBeVisible()
      await expectNoAxeViolations(page, 'the loaded receipt codes card, dark')
    } finally {
      await context.close()
    }
  })

  test('an employee without receipt-code:manage sees no Settings entry, and the list is refused (AC-4.9)', async ({ browser }) => {
    const { context, page } = await signedIn(browser, employeeA.session)
    try {
      await page.goto('/refund/requests')
      await expect(page.getByTestId('refund-my-requests-page')).toBeVisible({ timeout: 20_000 })
      await expect(refundNav(page).getByRole('link', { name: 'My requests' })).toBeVisible()
      await expect(refundNav(page).getByRole('link', { name: 'Settings' })).toHaveCount(0)
    } finally {
      await context.close()
    }
    expect((await refundCall(employeeA.token, 'GET', '/accounting/receipt-codes')).status).toBe(403)
    expect((await putReceiptCode(employeeA.token, employeeB.session.userId, codes.first)).status).toBe(403)
  })
})
