/**
 * ExtensionContain — contains a render-time throw under another tool's widget to the host's fallback. The seam promises
 * never to throw (ADR 20260803-suite-version-generated-file-federated-export), but it runs across a deploy boundary.
 * It is reset only when `resetKey` changes after a failure: a widget that works is never remounted, so what it holds (an
 * open dialog, a message) survives a host re-render that changes a name, and a throw for one target does not blank the next.
 */
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type ContainProps = {
  /** What takes the widget's place once it has thrown. */
  fallback: ReactNode
  /** Named in the console warning only (never shown): which widget failed. */
  widget: string
  /** Who the widget is about (never its display names): a new one after a failure tries the widget again. */
  resetKey: string
  children: ReactNode
}

type ContainState = { failed: boolean; failedFor: string | null }

export default class ExtensionContain extends Component<ContainProps, ContainState> {
  override state: ContainState = { failed: false, failedFor: null }

  static getDerivedStateFromError(): Partial<ContainState> {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: ContainProps, state: ContainState): Partial<ContainState> | null {
    if (!state.failed) return null
    if (state.failedFor === null) return { failedFor: props.resetKey }
    return props.resetKey === state.failedFor ? null : { failed: false, failedFor: null }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn(`crm-ui: ${this.props.widget} failed to render`, error, info.componentStack)
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
