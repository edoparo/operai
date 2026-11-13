import type { ReactNode, Ref } from 'react'

export type ToolLayoutProps = {
  /** The tool's name — the page's one h1. */
  title: ReactNode
  /** The tool's TabNav, when it has sections. */
  nav?: ReactNode
  /** The routed page (`<Outlet />`). */
  children: ReactNode
  /**
   * Column width (INC-12): `narrow` 40rem for a single form or profile, `default`
   * 80rem for lists and detail pages, `wide` the full width (gutter only) for
   * data-dense workspaces.
   */
  width?: 'narrow' | 'default' | 'wide'
  /** Id for the h1, so a surrounding <section aria-labelledby> can point at it. */
  titleId?: string
  /** For a single-screen tool that moves focus to its h1 (pass with `focusableTitle`). */
  titleRef?: Ref<HTMLHeadingElement>
  /** Makes the h1 programmatically focusable (`tabIndex={-1}`), never a tab stop. */
  focusableTitle?: boolean
  titleTestId?: string
  testId?: string
}

/**
 * ToolLayout — a tool remote's own frame inside the shell chrome: title, tabs,
 * then the page in an 80rem column (by default). The shell owns everything around it
 * (header, sidebar, session); a remote never draws chrome of its own.
 */
export function ToolLayout({
  title,
  nav,
  children,
  width = 'default',
  titleId,
  titleRef,
  focusableTitle = false,
  titleTestId,
  testId,
}: ToolLayoutProps) {
  return (
    <div className={width === 'default' ? undefined : `tool-width-${width}`} data-testid={testId}>
      <header className="tool-header">
        <div className="tool-container">
          <h1
            ref={titleRef}
            id={titleId}
            tabIndex={focusableTitle ? -1 : undefined}
            className="tool-title"
            data-testid={titleTestId}
          >
            {title}
          </h1>
        </div>
        {nav && <div className="tool-container">{nav}</div>}
      </header>
      {/* Not a <main>: the shell's ShellLayout owns the page's one main landmark. */}
      <div className="tool-container tool-main">{children}</div>
    </div>
  )
}
