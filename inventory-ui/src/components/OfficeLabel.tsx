import { Icon } from '@operai/ui'
import { strings } from '../strings'
import type { OfficeRef } from '../lib/types'

/**
 * OfficeLabel — where an asset's holder is shown and an office holds it: a small
 * office icon and the office name. The icon is decoration; a visually hidden
 * "Office:" prefix says what the name is, so the cue is never the icon alone.
 */
export default function OfficeLabel({ office }: { office: OfficeRef }) {
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="office-holder">
      <Icon name="home" />
      <span className="sr-only">{strings.assets.officeLabel}: </span>
      {office.name}
    </span>
  )
}
