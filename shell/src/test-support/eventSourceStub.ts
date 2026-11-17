/**
 * Vitest setup: a do-nothing `EventSource` for test environments that have none (node, jsdom).
 *
 * Since the SSE ticket mint retries and single-flights (e58dc6e9), `useUnreadCount()`'s stream can reach
 * `new EventSource(...)` after a test has finished, which threw "EventSource is not defined" as an
 * unhandled error in every router test that mounts the shell. Browsers always have `EventSource`; this
 * only fills the gap in tests. A test that exercises the stream stubs its own (`vi.stubGlobal`), which
 * replaces this one.
 */
if (typeof globalThis.EventSource === 'undefined') {
  class InertEventSource {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSED = 2
    readonly url: string
    readonly withCredentials = false
    readyState = InertEventSource.CONNECTING
    onopen: ((ev: Event) => unknown) | null = null
    onmessage: ((ev: MessageEvent) => unknown) | null = null
    onerror: ((ev: Event) => unknown) | null = null
    constructor(url: string | URL) {
      this.url = String(url)
    }
    addEventListener(): void {}
    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return true
    }
    close(): void {
      this.readyState = InertEventSource.CLOSED
    }
  }
  ;(globalThis as { EventSource?: unknown }).EventSource = InertEventSource
}
