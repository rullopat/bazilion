import { copyFileSync, cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'tsup'

// ESM payloads. Payloads and resources remain siblings in dist/, preserving relative paths.
// tsup externalizes package.json dependencies; everything else, including the workspace
// packages, is bundled.
export default defineConfig({
  entry: {
    cli: 'src/index.ts',
    daemon: '../daemon/src/index.ts',
    worker: '../daemon/src/runtime/worker/entry.ts',
    'web-server': 'src/web-server.ts',
  },
  format: ['esm'],
  target: 'node26',
  banner: { js: '#!/usr/bin/env node' },
  splitting: false,
  sourcemap: true,
  clean: true,
  // Keep `node:` on builtin imports: `node:sqlite` only exists under that prefix.
  removeNodeProtocol: false,
  async onSuccess() {
    const distDir = join(process.cwd(), 'dist')

    // Copy the database schema next to the bundled payloads. `schema.ts`
    // resolves it relative to `import.meta.url`, which lands in `dist/`;
    // tsup only emits JS, so stage the SQL here manually.
    copyFileSync(
      join(process.cwd(), '../daemon/src/core/db/schema.sql'),
      join(distDir, 'schema.sql'),
    )
    // The published package ships the repository's licence text.
    copyFileSync(join(process.cwd(), '../../LICENSE'), join(distDir, 'LICENSE'))

    // Copy the production TanStack Start build into the published CLI package.
    // `bazilion dashboard` spawns dist/web-server.js with BAZILION_WEB_DIST
    // pointing here, so normal npm installs can open the web UI without a
    // source checkout.
    const webSrc = join(process.cwd(), '../web/dist')
    const webDst = join(distDir, 'web')
    rmSync(webDst, { recursive: true, force: true })
    cpSync(webSrc, webDst, { recursive: true })
  },
})
