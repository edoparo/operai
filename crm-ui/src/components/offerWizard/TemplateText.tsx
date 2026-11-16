import type { ReactNode } from 'react'
import { resolveLocale } from '@operai/ui'
import type { OfferLanguage } from '../../lib/offerEngine/answers'

/**
 * Text that comes from the template (labels, hints, option texts, headings, the preview): marked with its own
 * language when that is not the interface's, so a screen reader pronounces it right (WCAG 3.1.2). The
 * wizard's own chrome stays in the interface language and is never wrapped.
 */
export default function TemplateText({ language, children }: { language: OfferLanguage; children: ReactNode }) {
  return language === resolveLocale() ? <>{children}</> : <span lang={language}>{children}</span>
}
