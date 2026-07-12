---
name: refresh-pi-models
description: Update Bazilion to current @earendil-works Pi packages and reconcile its provider catalog, curated model examples, setup copy, tests, lockfile, and release notes. Use when Pi publishes a release, new model families appear, model examples become stale, provider catalogs change, or a Bazilion dependency refresh is requested.
---

# Refresh Pi Models

Refresh the engine and the user-visible model guidance from upstream evidence. Do not guess model
ids or update examples merely because a model was announced elsewhere.

## Workflow

1. Read repository `AGENTS.md` and inspect the worktree. Preserve unrelated changes.
2. Query npm for the latest versions of `@earendil-works/pi-ai`, `pi-agent-core`, and
   `pi-coding-agent`. Treat npm package metadata and the installed Pi catalog as authoritative.
3. Record the current dependency declarations in `apps/daemon/package.json`,
   `apps/cli/package.json`, and `pnpm-lock.yaml`. Keep all three Pi packages on one compatible
   release unless upstream explicitly publishes a supported mixed set.
4. Update both the daemon and published CLI workspace dependencies with pnpm. Never hand-edit the
   lockfile.
5. Inspect upstream release/API changes. Fix Bazilion imports and adapters instead of pinning an
   old release. In particular, verify whether catalog helpers still live at the root or require
   `@earendil-works/pi-ai/compat`/the provider collection API.
6. Run `node .codex/skills/refresh-pi-models/scripts/audit-pi-models.mjs`. Use its exact catalog
   output to update:
   - `apps/web/src/routes/config/index.tsx` examples and its Pi-version comment;
   - first-run examples in `apps/web/src/routes/welcome.tsx`;
   - root and CLI README model examples/provider text;
   - current AGENTS.md model examples when stale.
7. Prefer a current generally useful tool-capable model per provider. Do not rewrite historical
   changelogs or tests whose ids are deliberate fixtures. For OAuth `openai-codex`, confirm the
   model exists in that provider's catalog rather than copying an `openai` API model id.
8. Add or update focused catalog tests so key newly added families and example ids are proven to
   exist. Add a Changeset for the published `bazilion` package when the bundled engine changes.
9. Validate in order:

   ```sh
   node .codex/skills/refresh-pi-models/scripts/audit-pi-models.mjs
   pnpm vitest run apps/daemon/test/runtime/providers.test.ts apps/daemon/test/core/provider-models.test.ts
   pnpm typecheck
   pnpm --filter @bazilion/web typecheck
   pnpm test
   pnpm lint
   pnpm build
   git diff --check
   ```

10. Audit the final diff: dependency versions agree, advertised examples are present in the
    installed catalog (or explicitly identified live/local aliases), and no unrelated files were
    staged or reverted.

If network or subprocess tests fail only because of the sandbox, rerun the same command with the
required approval. Report upstream versions, notable new models, API adaptations, and validation.
