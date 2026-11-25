/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google Maps key (public, referrer-restricted): the From and To suggestions of a mileage trip. Unset: plain text fields. */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
}

// Injected at build time by Vite `define` (see vite.config.ts) — this
// remote's own version, exposed via Module Federation as `./version` (see
// src/version.ts). Absent under vitest, where src/version.ts falls back to
// a placeholder.
declare const __REMOTE_VERSION__: string
