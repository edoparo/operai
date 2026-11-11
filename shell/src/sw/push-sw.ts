/**
 * Entry of the push service worker (specs/029, ADR-0085). Built by vite.config.ts as a CLASSIC
 * script at the stable path `/push-sw.js` (Firefox does not reliably run module workers), so this
 * file must stay a thin binding with no imports other than the handler module that gets inlined.
 */
import { registerPushHandlers, type PushScope } from './pushHandlers.ts'

registerPushHandlers(self as unknown as PushScope)
