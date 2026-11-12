import { useState } from 'react'

/**
 * The value to show for a polled resource the person also writes: what a write returned wins until the
 * next read arrives (a new `read` object), then the read wins. No effect, no extra render.
 */
export function useWritable<T>(read: T | null): [T | null, (value: T) => void] {
  const [written, setWritten] = useState<{ value: T; over: T | null } | null>(null)
  const shown = written !== null && written.over === read ? written.value : read
  return [shown, (value: T) => setWritten({ value, over: read })]
}
