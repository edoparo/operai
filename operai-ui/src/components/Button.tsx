import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react'
import { cx } from '../lib/cx'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'md' | 'sm'

export type ButtonClassOptions = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** 28px square, icon-only. The element must carry an `aria-label`. */
  iconOnly?: boolean
  className?: string
}

/**
 * The `.btn` class string for an element that is not a <button> — a router
 * <Link> that is an action entry point ("Register asset"). Inline navigation
 * stays a text link (`.link`), never a button.
 */
export const buttonClassName = ({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  className,
}: ButtonClassOptions = {}) => cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', iconOnly && 'btn-icon', className)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonClassOptions & {
    /** The action is running: sets `aria-busy`, shows a spinner and ignores clicks. Keep the label readable ("Saving…"). */
    busy?: boolean
    ref?: Ref<HTMLButtonElement>
  }

/**
 * Button — the suite's one button (design-system.md § Buttons). One `primary`
 * per view; choose the variant by meaning (`danger` for anything
 * irreversible), never restyle colour, border or radius.
 */
// A control the person types into: pressing a button must not blur it (below).
const TYPING_FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), select, textarea'

/**
 * While the person is typing in a field, a mouse press on a button keeps the
 * focus in the field until the click lands. Otherwise the field blurs on
 * mousedown, its blur validation shows an error, the error pushes the button
 * down, and the mouseup lands elsewhere: the click on Save or Cancel is lost.
 * The click's own handler still runs (and a submit still validates and focuses
 * the first invalid field); keyboard activation is unaffected.
 */
const keepFieldFocus = (event: MouseEvent<HTMLButtonElement>) => {
  if (event.button === 0 && document.activeElement?.matches(TYPING_FIELD)) event.preventDefault()
}

export function Button({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  busy = false,
  className,
  type = 'button',
  children,
  onClick,
  onMouseDown,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, iconOnly, className })}
      aria-busy={busy || undefined}
      onClick={busy ? undefined : onClick}
      onMouseDown={(event) => {
        onMouseDown?.(event)
        if (!event.defaultPrevented) keepFieldFocus(event)
      }}
      {...rest}
    >
      {busy && !iconOnly && <Spinner />}
      {children}
    </button>
  )
}
