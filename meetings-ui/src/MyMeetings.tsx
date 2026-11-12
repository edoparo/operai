import 'shell/tokens.css'
import { RouterProvider } from '@tanstack/react-router'
import { useDisposableRouter } from '@operai/ui'
import MyMeetingsShell from './components/MyMeetingsShell'
import { createMyMeetingsRouter } from './router'

/**
 * MyMeetings — the remote's second exposed entry, `./MyMeetings` (vite.config.ts `exposes`),
 * mounted by the shell at the UNGATED, shell-owned `/my-meetings/*` (ADR-0045, ADR-0058). Every
 * signed-in user reaches it whether or not they hold `meetings:access`: it shows the meetings
 * they created or take part in, and is also where notifications, the CRM activity and the host
 * panel deep-link (`/my-meetings/m/<id>`). As with `App`, it must not import this package's own
 * `index.css`.
 */

// The router is built per mount, not once at module scope: the shell unmounts the
// remote when the user leaves it and mounts it again on return, and a router
// instance that has already been mounted does not reload on a second mount
// (@tanstack/react-router >= 1.170.46), so it would show the route it last had
// instead of the URL the user returned to.
// It is also destroyed on unmount: a router's browser history wraps window.history and adds window
// listeners that only `history.destroy()` removes, so one per mount would pile up (specs/029 security L5).
export default function MyMeetings() {
  const router = useDisposableRouter(() => createMyMeetingsRouter('/my-meetings', MyMeetingsShell))
  return router ? <RouterProvider router={router} /> : null
}
