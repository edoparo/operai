/**
 * Runs around every test file (vitest.config.ts `setupFiles`): the pages' in-memory answers
 * (useResource's `cacheKey`) and the outcome of importing `shell/extensions` (lib/extensionSeam) live at module scope,
 * so one test's data, or its mock of the seam, must not open the next.
 */
import { afterEach } from 'vitest'
import { clearResourceCache } from '../hooks/useResource'
import { resetExtensionSeam } from '../lib/extensionSeam'

afterEach(() => {
  clearResourceCache()
  resetExtensionSeam()
})
