/**
 * flash — a one-shot confirmation handed from the screen where an action
 * happened to the screen it navigates to (INC-19: "after an action that
 * navigates away, the destination says it"). Creating a role opens its
 * editor, deleting a user returns to the list: the destination reads the
 * message for its own key and shows it in a SuccessBanner.
 *
 * In-memory and module-scoped (one pending message at a time), never web
 * storage. The destination PEEKS in its state initializer and CLEARS in an
 * effect, so React StrictMode's double-invoked initializer still sees it.
 */

import { useEffect, useState } from 'react'

let pending: { key: string; message: string } | null = null

/** Leaves `message` for the screen identified by `key` (e.g. `role:<id>`, `users`). */
export function setFlash(key: string, message: string): void {
  pending = { key, message }
}

/** The pending message for `key`, without consuming it. */
export function peekFlash(key: string): string | null {
  return pending?.key === key ? pending.message : null
}

/** Consumes the pending message for `key` (no-op for any other key). */
export function clearFlash(key: string): void {
  if (pending?.key === key) pending = null
}

/**
 * The flash message left for `key`, as page state: `[message, setMessage]`
 * (call `setMessage(null)` to dismiss, or set a new confirmation in place).
 */
export function useFlash(key: string): [string | null, (message: string | null) => void] {
  const [message, setMessage] = useState<string | null>(() => peekFlash(key))
  useEffect(() => {
    clearFlash(key)
  }, [key])
  return [message, setMessage]
}
