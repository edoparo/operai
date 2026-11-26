import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { federation } from '@module-federation/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// specs/20261101-crm: crm-ui — the CRM tool's federated REMOTE (ADR 20260709-suite-frontend-module-federation),
// modelled on inventory-ui/vite.config.ts. Two exposed modules: `./App` (the
// access-gated tool, mounted at the shell's `/crm/*`) and `./version`
// (ADR 20260803-suite-version-generated-file-federated-export, the About modal). `requiredVersion` for every shared singleton is
// read from this package's own dependency ranges so the graph cannot drift.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// Build-time dev default only, overridable via env var (the shell's runtime
// remote resolution is separate, ADR 20260709-suite-frontend-module-federation): the shell dev server's pinned port.
const shellRemoteUrl = process.env['SHELL_REMOTE_URL'] ?? 'http://localhost:5173/remoteEntry.js'

// @operai/ui (operai-ui/, ADR 20261031-shared-ui-library-consumed-as-source) is NOT bundled by this remote: it is a Module
// Federation shared singleton the shell provides (ADR 20261114-operai-ui-shared-singleton-provided-by-the-shell), declared below with
// `import: false`. The `link:../operai-ui` devDependency exists only so the plugin can read the
// library's named exports at build time; a Vite alias would bypass the sharing. tsconfig `paths`
// still give the types.
// The library's rich-text entry, which needs TipTap: installed HERE and deduped, so the library's
// `@tiptap/*` imports resolve to this project's copy (operai-ui/README.md § Rich text).
const operaiUiRichText = fileURLToPath(new URL('../operai-ui/src/richText.ts', import.meta.url))
// The library's board entry, which needs @dnd-kit/core: installed HERE (pinned exactly to the library's version) and
// deduped, like the rich text (operai-ui/README.md § Board).
const operaiUiBoard = fileURLToPath(new URL('../operai-ui/src/board.ts', import.meta.url))
const TIPTAP_PACKAGES = [
  '@tiptap/core',
  '@tiptap/extension-list',
  '@tiptap/extensions',
  '@tiptap/pm',
  '@tiptap/react',
  '@tiptap/starter-kit',
]

export default defineConfig({
  resolve: {
    // Exact match: only the rich-text and board entries are compiled into this remote (it needs TipTap, which the
    // shell does not install); the main entry is shared, so it must not be aliased.
    alias: [
      { find: /^@operai\/ui\/rich-text$/, replacement: operaiUiRichText },
      { find: /^@operai\/ui\/board$/, replacement: operaiUiBoard },
    ],
    dedupe: ['react', 'react-dom', '@dnd-kit/core', ...TIPTAP_PACKAGES],
  },
  plugins: [
    react(),
    federation({
      name: 'crm',
      filename: 'remoteEntry.js',
      // dts off: this remote's own build must work without a live shell dev
      // server; the shell's ambient shapes live in src/federation/remotes.d.ts.
      dts: false,
      exposes: {
        './App': './src/App.tsx',
        './version': './src/version.ts',
      },
      remotes: {
        shell: {
          type: 'module',
          name: 'shell',
          entry: shellRemoteUrl,
          entryGlobalName: 'shell',
          shareScope: 'default',
        },
      },
      shared: {
        react: { singleton: true, requiredVersion: pkg.dependencies.react },
        'react-dom': { singleton: true, requiredVersion: pkg.dependencies['react-dom'] },
        '@tanstack/react-router': {
          singleton: true,
          requiredVersion: pkg.dependencies['@tanstack/react-router'],
        },
        'better-auth': { singleton: true, requiredVersion: pkg.dependencies['better-auth'] },
        // ADR 20261114-operai-ui-shared-singleton-provided-by-the-shell: consumed from the shell, never bundled here (no fallback).
        '@operai/ui': { singleton: true, import: false, requiredVersion: false },
      },
    }),
  ],
  define: {
    // Consumed by src/version.ts's REMOTE_VERSION — this remote's own
    // version, exposed federated as `./version` (ADR 20260803-suite-version-generated-file-federated-export).
    __REMOTE_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // Required by @module-federation/vite: federated chunks use top-level
    // await to resolve shared modules asynchronously at runtime.
    target: 'esnext',
    modulePreload: false,
  },
  server: {
    // Pinned local-dev port for crm-ui as a remote (5179); the shell
    // (:5173) consumes its remoteEntry.js from here. cors lets the shell's
    // different dev origin fetch it; strictPort fails fast on a collision.
    port: 5179,
    strictPort: true,
    cors: true,
  },
  preview: {
    port: 5179,
    strictPort: true,
    cors: true,
  },
})
