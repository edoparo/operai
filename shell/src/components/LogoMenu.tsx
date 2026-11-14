/**
 * LogoMenu — the suite logo as a dropdown trigger in the shell header.
 *
 * Relocated from estimai-ui/src/components/LogoMenu.tsx (T6, specs/20260709-suite-shell,
 * AC-1.4). Clicking the logo opens a small menu; its "About" item calls onAbout (the
 * parent owns the About modal). `APP_NAME` resolves to "Operai" (the suite) via
 * ../lib/appInfo. The menu itself — opening, keyboard, closing — is the library
 * `Menu` (decisions D-60), shared with UserMenu.
 */

import { Menu, MenuItem } from '@operai/ui'
import { APP_NAME } from '../lib/appInfo'
import { strings } from '../strings'

interface Props {
  onAbout: () => void
}

export default function LogoMenu({ onAbout }: Props) {
  return (
    <Menu
      triggerLabel={strings.logoMenu.trigger(APP_NAME)}
      trigger={<img src="/operai.svg" alt={APP_NAME} className="h-8 w-8 rounded-md" />}
      testIdPrefix="logo-menu"
    >
      <MenuItem onClick={onAbout}>{strings.logoMenu.about(APP_NAME)}</MenuItem>
    </Menu>
  )
}
