import { useEffect, useState } from 'react'

/** The preview sits beside the form from this width (`xl`), in a drawer below it. */
const WIDE = '(min-width: 1280px)'

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE) : null
}

/** Whether the viewport is wide enough for the pane beside the form; false where the browser cannot say. */
export function useWideViewport(): boolean {
  const [wide, setWide] = useState(() => query()?.matches ?? false)
  useEffect(() => {
    const list = query()
    if (!list) return
    const sync = () => setWide(list.matches)
    sync()
    list.addEventListener('change', sync)
    return () => list.removeEventListener('change', sync)
  }, [])
  return wide
}
