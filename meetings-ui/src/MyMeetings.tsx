import 'shell/tokens.css'
import { RouterProvider } from '@tanstack/react-router'
import MyMeetingsShell from './components/MyMeetingsShell'
import { createMyMeetingsRouter } from './router'

/**
 * MyMeetings — the remote's second exposed entry, `./MyMeetings` (vite.config.ts `exposes`),
 * mounted by the shell at the UNGATED, shell-owned `/my-meetings/*` (ADR 20261006-ungated-second-federated-entry-of-a-gated-remote, ADR 20261104-meetings-tool-shape-visibility-by-participation). Every
 * signed-in user reaches it whether or not they hold `meetings:access`: it shows the meetings
 * they created or take part in, and is also where notifications, the CRM activity and the host
 * panel deep-link (`/my-meetings/m/<id>`). As with `App`, it must not import this package's own
 * `index.css`.
 */
const router = createMyMeetingsRouter('/my-meetings', MyMeetingsShell)

export default function MyMeetings() {
  return <RouterProvider router={router} />
}
