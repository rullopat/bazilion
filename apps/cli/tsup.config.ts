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
})
