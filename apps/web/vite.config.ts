import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Plugin order matters: tailwindcss → tanstackStart → viteReact. The Start
// plugin auto-includes the router file-based codegen, so no separate
// `@tanstack/react-router/plugin/vite` import.
export default defineConfig({
  server: {
    // The daemon owns 4321; web2 binds 4322 by default. WEB_HOST/WEB_PORT
    // override at boot — kept symmetric with apps/web's config.
    host: process.env.WEB_HOST ?? '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 4322),
  },
  resolve: {
    // Start's internals and application routes must share one React/router
    // context even when another workspace package resolves a different version.
    dedupe: ['react', 'react-dom', '@tanstack/react-router'],
    alias: {
      // Mirrors the tsconfig `@/*` paths so shadcn-style `@/components/...`
      // imports resolve identically in TS-check, dev, and build.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})
