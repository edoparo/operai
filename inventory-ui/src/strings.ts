/**
 * strings — every user-facing string of inventory-ui, in English and Italian
 * (INC-24/25; specs/015 design.md Resolutions G12/Q1 shipped English first). Components import `strings` and
 * never inline copy; `lib/noHardcodedStrings.test.ts` enforces that over all of
 * `src/`.
 *
 * One file per namespace under `./strings/`, aggregated here (T24) so later
 * tasks add keys to their own file and never edit this one. Mapping from
 * design.md § Strings and numbers: `pages.assets|register|assetDetail|rules|
 * years|yearDetail|myDevices` are `assets`, `register`, `assetDetail`,
 * `rules`, `years`, `yearDetail`, `myDevices`; `badges.assetStatus` lives in
 * `badges`; `dialogs.*` and `empty.*` have their own namespaces (a dialog owned
 * by one task may instead keep its copy in that task's own file);
 * `errors.<code>`, `history.<action>`, `categories`, `disposalReasons`, `nav`,
 * `actions` are as named. `common` holds shared labels and `invoice`/`ledger`
 * the asset detail regions; `notFound` the router fallback.
 */
import { selectStrings } from '@operai/ui'
import { actions } from './strings/actions'
import { assetDetail } from './strings/assetDetail'
import { assets } from './strings/assets'
import { badges } from './strings/badges'
import { categories } from './strings/categories'
import { common } from './strings/common'
import { dialogs } from './strings/dialogs'
import { disposalReasons } from './strings/disposalReasons'
import { empty } from './strings/empty'
import { errors } from './strings/errors'
import { history } from './strings/history'
import { invoice } from './strings/invoice'
import { ledger } from './strings/ledger'
import { myDevices } from './strings/myDevices'
import { nav } from './strings/nav'
import { notFound } from './strings/notFound'
import { register } from './strings/register'
import { rules } from './strings/rules'
import { years } from './strings/years'
import { yearDetail } from './strings/yearDetail'

/** The English catalog: the reference every other language is checked against. */
export const en = {
  actions: actions.en,
  assetDetail: assetDetail.en,
  assets: assets.en,
  badges: badges.en,
  categories: categories.en,
  common: common.en,
  dialogs: dialogs.en,
  disposalReasons: disposalReasons.en,
  empty: empty.en,
  errors: errors.en,
  history: history.en,
  invoice: invoice.en,
  ledger: ledger.en,
  myDevices: myDevices.en,
  nav: nav.en,
  notFound: notFound.en,
  register: register.en,
  rules: rules.en,
  yearDetail: yearDetail.en,
  years: years.en,
}

/** The Italian catalog (INC-25): typed as the English, so a missing key does not compile. */
export const it: typeof en = {
  actions: actions.it,
  assetDetail: assetDetail.it,
  assets: assets.it,
  badges: badges.it,
  categories: categories.it,
  common: common.it,
  dialogs: dialogs.it,
  disposalReasons: disposalReasons.it,
  empty: empty.it,
  errors: errors.it,
  history: history.it,
  invoice: invoice.it,
  ledger: ledger.it,
  myDevices: myDevices.it,
  nav: nav.it,
  notFound: notFound.it,
  register: register.it,
  rules: rules.it,
  yearDetail: yearDetail.it,
  years: years.it,
}

/** The catalog for the person's language, resolved once by @operai/ui (`resolveLocale`). */
export const strings = selectStrings({ en, it })

export type Strings = typeof en
