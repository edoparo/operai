/**
 * Runs around every test file (vitest.config.ts `setupFiles`): the pages' in-memory answers
 * (useResource's `cacheKey`) live at module scope, so one test's data must not open the next.
 */
import { afterEach } from 'vitest'
import { clearResourceCache } from '../hooks/useResource'

afterEach(() => clearResourceCache())
