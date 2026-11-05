/**
 * strings — every user-visible string of estimai-ui, in English and Italian
 * (INC-24, INC-25). One file per area under `./strings/`, each exporting its
 * English catalog and the Italian typed as it; this module assembles the two
 * catalogs and picks one ONCE through the library's `selectStrings` (the
 * language is resolved by `resolveLocale`, never detected here).
 *
 * Not in here, on purpose:
 * - the copy inside exported files (PDF/XLSX) — client documents, English
 *   only: `./strings/exportCopy.ts`;
 * - template data (`lib/templates.ts`: template, epic and activity names) and
 *   the specialist profile list (`types.ts` PROFILES) — data written into the
 *   estimate document, not UI copy.
 *
 * Functions are sentences with a value in them: word order differs by
 * language. `strings.test.ts` checks the Italian is complete
 * (`catalogGaps(en, it)`); `lib/noHardcodedStrings.test.ts` checks no copy is
 * inlined in a component.
 */
import { selectStrings } from '@operai/ui'
import * as activities from './strings/activities'
import * as conflict from './strings/conflict'
import * as editor from './strings/editor'
import * as estimates from './strings/estimates'
import * as health from './strings/health'
import * as lifecycle from './strings/lifecycle'
import * as parameters from './strings/parameters'
import * as reference from './strings/reference'
import * as sharing from './strings/sharing'
import * as summary from './strings/summary'

export const en = {
  /** The tool's name — ToolLayout's h1. A product name: the same in every language. */
  toolTitle: 'EstimAI',
  sharing: sharing.en,
  conflict: conflict.en,
  estimatesList: estimates.enList,
  confirmDelete: estimates.enConfirmDelete,
  importOffer: estimates.enImportOffer,
  editor: editor.en,
  activities: activities.en,
  summary: summary.enSummary,
  metrics: summary.enMetrics,
  parameters: parameters.en,
  help: reference.enHelp,
  shortcuts: reference.enShortcuts,
  health: health.en,
  lifecycle: lifecycle.en,
}

/** The shape of `en` — every locale is typed against it. */
export type Strings = typeof en

export const it: Strings = {
  toolTitle: 'EstimAI',
  sharing: sharing.it,
  conflict: conflict.it,
  estimatesList: estimates.itList,
  confirmDelete: estimates.itConfirmDelete,
  importOffer: estimates.itImportOffer,
  editor: editor.it,
  activities: activities.it,
  summary: summary.itSummary,
  metrics: summary.itMetrics,
  parameters: parameters.it,
  help: reference.itHelp,
  shortcuts: reference.itShortcuts,
  health: health.it,
  lifecycle: lifecycle.it,
}

/** The catalog for the person's language (`<html lang>`, then the browser), English by default. */
export const strings: Strings = selectStrings({ en, it })
