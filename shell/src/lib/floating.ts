/**
 * The floating-slot registry (specs/021-meetings A13, ADR-0078).
 *
 * A remote that has something the person must keep seeing while they move around Operai (meetings-ui while it
 * records) calls `openFloating(name, props)` through `shell/session`; the shell's `FloatingHost` (mounted once by
 * `ShellLayout`, outside the routed page) then shows that remote's widget above every page, in a `FloatingPanel`
 * the person can move around the window's edge, until `closeFloating(name)`. The shell owns the frame and the
 * fallback; the remote owns the content, loaded through the `HostExtension` loader (timeout, error boundary,
 * ADR-0060). Props are plain strings.
 *
 * Why its own module and not inline in session.ts: the same reason as `navigationBlocker.ts` — session.ts is
 * mocked wholesale by most router tests, and ShellLayout would otherwise force every mock to learn new exports.
 * session.ts re-exports `openFloating` / `closeFloating`, so the federated seam is one module.
 *
 * Module-scope memory only (ADR-0001's posture): nothing is persisted. Never throws to the caller: a bad name or
 * a broken listener must not break the remote that asked.
 */

/** The widgets this shell can show, with their props. A name missing here is ignored. */
export interface FloatingProps {
  'meetings.recorderDock': { meetingId: string; title: string }
}

export type FloatingName = keyof FloatingProps

export type FloatingEntry = { [K in FloatingName]: { name: K; props: FloatingProps[K] } }[FloatingName]

const KNOWN: ReadonlySet<string> = new Set<FloatingName>(['meetings.recorderDock'])

let open: readonly FloatingEntry[] = []
const listeners = new Set<() => void>()

const notify = () => {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // a listener's failure is its own
    }
  }
}

/** Plain strings only, nothing longer than a sentence: a remote cannot push anything else into the shell. */
const plainProps = (props: unknown): Record<string, string> | null => {
  if (typeof props !== 'object' || props === null || Array.isArray(props)) return null
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (typeof value !== 'string' || value.length > 500) return null
    out[key] = value
  }
  return out
}

/** Shows (or updates) the named widget. Newest last. */
export function openFloating<K extends FloatingName>(name: K, props: FloatingProps[K]): void {
  if (!KNOWN.has(name)) return
  const clean = plainProps(props)
  if (clean === null) return
  const entry = { name, props: clean } as unknown as FloatingEntry
  open = [...open.filter((current) => current.name !== name), entry]
  notify()
}

/** Hides the named widget; a no-op when it is not shown. */
export function closeFloating(name: FloatingName): void {
  if (!open.some((current) => current.name === name)) return
  open = open.filter((current) => current.name !== name)
  notify()
}

/** What is shown now (a stable array between changes, for `useSyncExternalStore`). */
export const getOpenFloating = (): readonly FloatingEntry[] => open

export function subscribeFloating(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Tests only. */
export function resetFloatingForTests(): void {
  open = []
  listeners.clear()
}
