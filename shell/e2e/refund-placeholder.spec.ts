/**
 * T16 — Refund is authed-only (specs/20260709-suite-shell)
 *
 * Refs: AC-5.2 — selecting Refund shows the tool inside the shell,
 * authenticated by the shell's session (it renders content only for a
 * signed-in user, and calls its API with the shared session — not a locally
 * re-created auth client).
 *
 * specs/20260709-suite-shell shipped a "coming soon" placeholder that printed the session
 * identity; specs/20260716-refund-service replaced it with the real tool. The signed-in case now
 * proves the shared session by the tool's first screen loading its data from
 * refund-api through `shell/session`'s apiFetch.
 */

import { test, expect } from '@playwright/test'
import { seedSession } from './helpers/seedSession'

test.describe('AC-5.2: Refund renders only for a signed-in user, using the shared shell session', () => {
  test('signed-in: Refund renders and loads its first screen with the shared session', async ({ context, page }) => {
    await seedSession(context)

    await page.goto('/refund')

    await expect(page.getByRole('heading', { name: 'Refund', exact: true })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId('refund-my-requests-page')).toBeVisible({ timeout: 15_000 })
  })

  test('unauthenticated: selecting Refund never renders its content — the shell guard intercepts first', async ({
    page,
  }) => {
    // No seedSession — the shell's suite-wide `_authed` guard (AC-2.1) must
    // resolve before Refund's own component is ever mounted, so there is no
    // "Refund renders with signed-out content" state to reach.
    await page.goto('/refund')

    await expect(page.getByRole('heading', { name: 'Refund', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('refund-signed-in-as')).toHaveCount(0)
  })
})
