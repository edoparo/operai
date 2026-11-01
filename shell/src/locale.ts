/**
 * Side-effect module: sets `<html lang>` (lib/documentLanguage.ts). main.tsx
 * imports it FIRST, before the router, because every strings module selects
 * its language when it is evaluated — an ES module's imports evaluate in
 * order, so this must run before any of them.
 */
import { applyDocumentLanguage } from './lib/documentLanguage'

applyDocumentLanguage()
