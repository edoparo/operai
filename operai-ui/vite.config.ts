import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/postcss'

// Used by Storybook (react-vite builder) only. The library is never built on
// its own: apps compile its source (ADR-0050). Tests use vitest.config.ts.
//
// Tailwind runs through PostCSS, exactly as in the shell and the apps: that
// pipeline hoists tokens.css's Google Fonts `@import url()` to the top of the
// sheet. The @tailwindcss/vite plugin left it mid-sheet, where Vite warns and
// the browser ignores it.
export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
})
