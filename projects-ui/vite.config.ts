import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { federation } from '@module-federation/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// specs/20261103-projects: projects-ui — the Projects tool's federated REMOTE (ADR 20260709-suite-frontend-module-federation),
// modelled on crm-ui/vite.config.ts. Two exposed modules: `./App` (the
// access-gated tool, mounted at the shell's `/projects/*`) and `./version`
// (ADR 20260803-suite-version-generated-file-federated-export, the About modal). `requiredVersion` for every shared singleton is
// read from this package's own dependency ranges so the graph cannot drift.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// Build-time dev default only, overridable via env var (the shell's runtime
// remote resolution is separate, ADR 20260709-suite-frontend-module-federation): the shell dev server's pinned port.
const shellRemoteUrl = process.env['SHELL_REMOTE_URL'] ?? 'http://localhost:5173/remoteEntry.js'

// @operai/ui (operai-ui/, ADR 20261031-shared-ui-library-consumed-as-source) is compiled from SOURCE by this build; `dedupe`
// keeps the library's own `react` imports on this project's copy (Module Federation
// singleton), since operai-ui/node_modules does not exist on Vercel.
const operaiUiEntry = fileURLToPath(new URL('../operai-ui/src/index.ts', import.meta.url))
// The library's rich-text entry, which needs TipTap: installed HERE and deduped, so the library's
// `@tiptap/*` imports resolve to this project's copy (operai-ui/README.md § Rich text).
const operaiUiRichText = fileURLToPath(new URL('../operai-ui/src/richText.ts', import.meta.url))
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
    // Exact matches, the longer first: a plain `@operai/ui` prefix alias would also rewrite `@operai/ui/rich-text`.
    alias: [
      { find: /^@operai\/ui\/rich-text$/, replacement: operaiUiRichText },
      { find: /^@operai\/ui$/, replacement: operaiUiEntry },
    ],
    dedupe: ['react', 'react-dom', ...TIPTAP_PACKAGES],
  },
  plugins: [
    react(),
    federation({
      name: 'projects',
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
    // Pinned local-dev port for projects-ui as a remote (5181); the shell
    // (:5173) consumes its remoteEntry.js from here. cors lets the shell's
    // different dev origin fetch it; strictPort fails fast on a collision.
    port: 5181,
    strictPort: true,
    cors: true,
  },
  preview: {
    port: 5181,
    strictPort: true,
    cors: true,
  },
})
