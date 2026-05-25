---
'bazilion': patch
'@bazilion/client': patch
'@bazilion/api-types': patch
---

**Fix `bazilion@0.2.0` crash on `serve`** — the npm package was broken; `npx bazilion serve` exited with `ERR_MODULE_NOT_FOUND: Cannot find package 'sqlite'` before the daemon could bind a port.

Two build-pipeline bugs in `apps/cli/tsup.config.ts`:

- esbuild's hardcoded known-builtins list predates `node:sqlite` (Node 22+). It auto-externalizes `node:` imports before plugin `onResolve` hooks can intercept them, then strips the `node:` prefix at print time — so `from 'node:sqlite'` shipped as `from "sqlite"` in the bundle, which Node tried to resolve from `node_modules` and failed. There's no esbuild flag to force-keep the prefix; the fix is a post-build string replace in tsup's `onSuccess` hook.
- SQL migration files weren't being staged into `dist/`. `migrate.ts` reads them relative to `import.meta.url` (i.e. `dist/migrations/`), but tsup only emits JS. The published 0.2.0 has this bug too — the sqlite crash just masked it. The same `onSuccess` hook now copies `apps/daemon/src/core/db/migrations/*.sql` into `dist/migrations/`.

Verified with a clean `BAZILION_HOME`: `node dist/cli.js serve` boots, auto-bootstraps `~/.bazilion`, writes `auth.json`, listens on the port, and `/api/health` returns 200.

No source changes; no API or wire-shape changes. The `@bazilion/client` and `@bazilion/api-types` bumps are lockstep-fixed by `.changeset/config.json`.
