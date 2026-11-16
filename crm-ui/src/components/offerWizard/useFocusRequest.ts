import { useEffect, useRef } from 'react'

/**
 * Focus that has to wait for the render that follows an edit (a row added, removed or moved). `request(key, control)`
 * names the row (`data-item-key`; `null` = the whole editor) and the control in it (`data-control`); once the
 * answers have re-rendered, that control takes focus — or, when it is missing or disabled (an item moved to the end
 * has no Down), the row's first field.
 */
export function useFocusRequest<E extends HTMLElement>() {
  const root = useRef<E>(null)
  const pending = useRef<{ key: string | null; control: string } | null>(null)

  useEffect(() => {
    const request = pending.current
    if (!request || !root.current) return
    pending.current = null
    const scope =
      request.key === null ? root.current : root.current.querySelector<HTMLElement>(`[data-item-key="${request.key}"]`)
    const target = scope?.querySelector<HTMLElement>(`[data-control="${request.control}"]`)
    const fallback = scope?.querySelector<HTMLElement>('input, select, textarea')
    ;(target && !(target as HTMLButtonElement).disabled ? target : fallback)?.focus()
  })

  return {
    root,
    request: (key: string | null, control: string) => {
      pending.current = { key, control }
    },
  }
}
