import { focusFirstInvalid } from '@operai/ui'
import { useEffect, useRef, useState } from 'react'

/**
 * A submit that fails validation moves focus to the first invalid field
 * (design-system.md § Forms, INC-16). Put `ref` on an element that contains the
 * fields (a `display: contents` wrapper keeps the dialog's layout) and call
 * `focusFirstInvalid()` after setting the errors: once they have rendered,
 * @operai/ui's `focusFirstInvalid` focuses the first `aria-invalid` control (a
 * radio group's checked radio, else its first one). This hook only waits for
 * that render.
 */
export function useFocusFirstInvalid<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null)
  const [request, setRequest] = useState(0)

  useEffect(() => {
    if (request > 0) focusFirstInvalid(ref.current)
  }, [request])

  return { ref, focusFirstInvalid: () => setRequest((n) => n + 1) }
}
