/**
 * strings — every user-facing string of letterheads-ui, in English and Italian
 * (AC-8.8). One file per namespace under `./strings/`, aggregated here;
 * components import `strings` and never inline copy
 * (`lib/noHardcodedStrings.test.ts` scans all of `src/`). The Italian catalog is typed as the
 * English, so a missing key does not compile, and `strings.test.ts` checks the parity again.
 *
 * `common`, `nav`, `entity` and `page` are the frame's; `form`, `help` and `problem` are the configurator form's
 * (T21); `asset` and `upload` are the file fields' (T23); `preview` is the live preview's (T22); `bar`, `save`,
 * `conflict`, `leave` and `where` are the save bar's, the refused values' and the leave guard's (T24); `view`,
 * `history`, `version` and `restore` are the history's, the version view's and the restore's (T25). A later task
 * adds its own namespace file and wires it in below (design § Copy keys).
 */
import { selectStrings } from '@operai/ui'
import { asset } from './strings/asset'
import { bar } from './strings/bar'
import { common } from './strings/common'
import { conflict } from './strings/conflict'
import { entity } from './strings/entity'
import { form } from './strings/form'
import { help } from './strings/help'
import { history } from './strings/history'
import { leave } from './strings/leave'
import { nav } from './strings/nav'
import { page } from './strings/page'
import { preview } from './strings/preview'
import { problem } from './strings/problem'
import { restore } from './strings/restore'
import { save } from './strings/save'
import { upload } from './strings/upload'
import { version } from './strings/version'
import { view } from './strings/view'
import { where } from './strings/where'

/** The English catalog: the reference every other language is checked against. */
export const en = {
  asset: asset.en,
  bar: bar.en,
  common: common.en,
  conflict: conflict.en,
  entity: entity.en,
  form: form.en,
  help: help.en,
  history: history.en,
  leave: leave.en,
  nav: nav.en,
  page: page.en,
  preview: preview.en,
  problem: problem.en,
  restore: restore.en,
  save: save.en,
  upload: upload.en,
  version: version.en,
  view: view.en,
  where: where.en,
}

/** The Italian catalog: typed as the English, so a missing key does not compile. */
export const it: typeof en = {
  asset: asset.it,
  bar: bar.it,
  common: common.it,
  conflict: conflict.it,
  entity: entity.it,
  form: form.it,
  help: help.it,
  history: history.it,
  leave: leave.it,
  nav: nav.it,
  page: page.it,
  preview: preview.it,
  problem: problem.it,
  restore: restore.it,
  save: save.it,
  upload: upload.it,
  version: version.it,
  view: view.it,
  where: where.it,
}

/** The catalog for the person's language, resolved once by @operai/ui (`resolveLocale`). */
export const strings = selectStrings({ en, it })
