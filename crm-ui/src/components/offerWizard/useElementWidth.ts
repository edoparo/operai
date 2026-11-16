import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The width of an element, kept up to date as it changes (a window resize, the preview pane opening beside the
 * form). `null` until it is first measured and where the browser cannot observe sizes: the caller picks the wider
 * layout then. Attach `ref` to the element.
 */
export function useElementWidth<T extends HTMLElement>(): { ref: (element: T | null) => void; width: number | null } {
  const [width, setWidth] = useState<number | null>(null)
  const observer = useRef<ResizeObserver | null>(null)

  useEffect(() => () => observer.current?.disconnect(), [])

  const ref = useCallback((element: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (element === null) return
    setWidth(element.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.current.observe(element)
  }, [])

  return { ref, width }
}
