import { isLoopbackHost } from '@bazilion/api-types'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const webHost = process.env.WEB_HOST ?? '127.0.0.1'
if (process.env.BAZILION_PUBLIC_ORIGIN && !isLoopbackHost(webHost)) {
  throw new Error('BAZILION_PUBLIC_ORIGIN requires the web dev server to bind loopback only')
}

export default defineConfig({
  // The daemon owns 4321; the web app binds 4322 unless WEB_HOST/WEB_PORT say otherwise.
  server: { host: webHost, port: Number(process.env.WEB_PORT ?? 4322) },
  resolve: {
    // Start's internals and application routes must share one React/router
    // context even when another workspace package resolves a different version.
    dedupe: ['react', 'react-dom', '@tanstack/react-router'],
  },
  // Order matters: viteReact must follow tanstackStart.
  plugins: [
    tailwindcss(),
    // src/start.ts checks Origin and CSRF for server functions itself.
    tanstackStart({ serverFns: { disableCsrfMiddlewareWarning: true } }),
    viteReact(),
  ],
})
