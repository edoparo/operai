import { defineConfig } from 'vitest/config'

// Plugin-free, like every app's vitest.config.ts: TSX is compiled by Vitest's
// own transform (tsconfig `jsx: react-jsx`), and Vitest 3 pins its own Vite.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
  },
})
