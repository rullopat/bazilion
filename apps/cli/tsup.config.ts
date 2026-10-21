import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'tsup'

// Five ESM bundles, plus guarded cli.js/daemon.js launchers written below.
// The public launchers check the runtime before dynamically linking application
// dependencies; a banner alone cannot run before static external ESM imports.
// Payloads and resources remain siblings in dist/, preserving relative paths.
// tsup auto-externalizes package.json dependencies (including native modules);
// workspace client/wire packages stay bundled inline.
export default defineConfig({
  entry: {
    'cli-main': 'src/main.ts',
    'daemon-main': '../daemon/src/main.ts',
    'runtime-version': 'src/runtime-version.ts',
    worker: '../daemon/src/runtime/worker/entry.ts',
    'web-server': 'src/web-server.ts',
  },
  format: ['esm'],
  target: 'node24',
  banner: { js: '#!/usr/bin/env node' },
  noExternal: ['@bazilion/api-types', '@bazilion/client'],
  splitting: false,
  sourcemap: true,
  clean: true,
  // esbuild's hardcoded known-builtins list predates `node:sqlite`
  // (Node 22+), and its `node:` auto-externalize pass bypasses plugin
  // onResolve hooks before the prefix-stripping pass at print time —
  // so the only reliable place to put the `node:` back is after the
  // bundle is written. The published package crashes without this:
  // `ERR_MODULE_NOT_FOUND: Cannot find package 'sqlite'`.
  async onSuccess() {
    const distDir = join(process.cwd(), 'dist')

    // Restore the `node:` prefix esbuild stripped from `node:sqlite`.
    for (const file of readdirSync(distDir)) {
      if (!file.endsWith('.js')) continue
      const path = join(distDir, file)
      const src = readFileSync(path, 'utf8')
      const fixed = src.replace(/from "sqlite"/g, 'from "node:sqlite"')
      if (fixed !== src) writeFileSync(path, fixed)
    }

    for (const name of ['cli', 'daemon']) {
      writeFileSync(
        join(distDir, `${name}.js`),
        `#!/usr/bin/env node\nimport './runtime-version.js'\n\nawait import('./${name}-main.js')\n`,
        { mode: 0o755 },
      )
    }

    // Copy SQL migrations next to the bundled daemon payload. `migrate.ts`
    // resolves them relative to `import.meta.url`, which lands at
    // `dist/daemon-main.js`; tsup only emits JS, so stage SQL here manually.
    const migrationsSrc = join(process.cwd(), '../daemon/src/core/db/migrations')
    const migrationsDst = join(distDir, 'migrations')
    mkdirSync(migrationsDst, { recursive: true })
    for (const file of readdirSync(migrationsSrc)) {
      if (!file.endsWith('.sql')) continue
      copyFileSync(join(migrationsSrc, file), join(migrationsDst, file))
    }

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
