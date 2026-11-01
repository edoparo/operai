import { useEffect, useRef } from 'react'

/**
 * Moves focus to the element on mount (INC-30): the heading of a page or a
 * state that replaces the page (not found, permission denied, a page reached
 * after an action), so a screen-reader user hears where they are. The element
 * must be programmatically focusable (`tabIndex={-1}`); `PageHeader`
 * (`focusableHeading`), `StatePanel` (`focusOnMount`) and `ToolLayout`
 * (`focusableTitle`) already are.
 *
 *   const headingRef = useFocusOnMount<HTMLHeadingElement>()
 *   <PageHeader title={…} headingRef={headingRef} focusableHeading />
 */
export function useFocusOnMount<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (enabled) ref.current?.focus()
  }, [enabled])
  return ref
}
