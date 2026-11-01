import { useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from 'react'
import { cx } from '../lib/cx'

export type MenuProps = {
  /** The trigger's content: a logo, an avatar, an icon. */
  trigger: ReactNode
  /** The trigger's accessible name, when its content has none. */
  triggerLabel?: string
  /** Tooltip on the trigger (e.g. the full user name behind an avatar). */
  triggerTitle?: string
  /** `round` for an avatar trigger. */
  triggerShape?: 'square' | 'round'
  /** Which edge of the trigger the menu lines up with. */
  align?: 'start' | 'end'
  /** Context above the items (who is signed in); not focusable. */
  header?: ReactNode
  /**
   * The items: `MenuItem` for an action, or a link with `role="menuitem"` and
   * `className="menu-item"` (a router `<Link>`). Selecting any item closes the menu.
   */
  children: ReactNode
  /** data-testids: `${prefix}-trigger`, `${prefix}` on the menu. */
  testIdPrefix?: string
}

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])'

/**
 * Menu — a button that opens a short list of actions or links (the header's
 * logo and user menus). The menu follows the WAI-ARIA menu button pattern:
 * opening moves focus to the first item; ↑/↓ move between items (wrapping),
 * Home/End jump to the ends; Escape closes and returns focus to the trigger;
 * Tab, a click outside or choosing an item closes it.
 */
export function Menu({
  trigger,
  triggerLabel,
  triggerTitle,
  triggerShape = 'square',
  align = 'start',
  header,
  children,
  testIdPrefix = 'menu',
}: MenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])

  useEffect(() => {
    if (!open) return
    items()[0]?.focus()
    function onDocMouseDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onDocKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onDocKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onDocKeyDown)
    }
  }, [open])

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items()
    if (list.length === 0) return
    const current = list.indexOf(document.activeElement as HTMLElement)
    const move = (index: number) => {
      event.preventDefault()
      list[(index + list.length) % list.length].focus()
    }
    switch (event.key) {
      case 'ArrowDown':
        return move(current + 1)
      case 'ArrowUp':
        return move(current - 1)
      case 'Home':
        return move(0)
      case 'End':
        return move(list.length - 1)
      case 'Tab':
        setOpen(false)
    }
  }

  return (
    <div className="menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={cx('menu-trigger', triggerShape === 'round' && 'menu-trigger-round')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        title={triggerTitle}
        onClick={() => setOpen((o) => !o)}
        data-testid={`${testIdPrefix}-trigger`}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          className={cx('menu-list', align === 'end' && 'menu-list-end')}
          onKeyDown={onMenuKeyDown}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('[role="menuitem"]')) setOpen(false)
          }}
          data-testid={testIdPrefix}
        >
          {header && <div className="menu-header">{header}</div>}
          {children}
        </div>
      )}
    </div>
  )
}

export type MenuItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role' | 'type'>

/** MenuItem — an action in a Menu. A link item is a `<Link role="menuitem" className="menu-item">`. */
export function MenuItem({ className, ...rest }: MenuItemProps) {
  return <button type="button" role="menuitem" className={cx('menu-item', className)} {...rest} />
}
