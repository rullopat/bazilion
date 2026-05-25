import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'tsup'

// Three separate ESM bundles, all written to dist/:
//   - cli.js     → the `bazilion` bin (shebang via banner)
//   - daemon.js  → spawned by `bazilion serve`
//   - worker.js  → spawned per chat turn by the daemon
// tsup auto-externalizes everything in package.json `dependencies`
// (so native modules like better-sqlite3 stay external); workspace
// packages are in devDependencies and therefore bundled inline, which
// we double-declare via noExternal for clarity.
export default defineConfig({
  entry: {
    cli: 'src/index.ts',
    daemon: '../daemon/src/index.ts',
    worker: '../daemon/src/runtime/worker/entry.ts',
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

    // Copy SQL migrations next to the bundled daemon. `migrate.ts`
    // resolves them relative to `import.meta.url`, which lands at
    // `dist/daemon.js` in the published package; tsup itself only
    // emits JS, so the .sql files need to be staged here manually.
    const migrationsSrc = join(process.cwd(), '../daemon/src/core/db/migrations')
    const migrationsDst = join(distDir, 'migrations')
    mkdirSync(migrationsDst, { recursive: true })
    for (const file of readdirSync(migrationsSrc)) {
      if (!file.endsWith('.sql')) continue
      copyFileSync(join(migrationsSrc, file), join(migrationsDst, file))
    }
  },
})
