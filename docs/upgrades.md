# Upgrading Bazilion

```sh
npm install -g bazilion@latest     # or run npx bazilion@latest dashboard
```

Bazilion needs Node.js 26.12.1 or a later 26.x release; the CLI refuses any other Node before it
starts. A refusal caused by the Node version means upgrading Node, never resetting the home.

The database has no migrations. A release opens a home only when its schema matches the one that
release ships (`apps/daemon/src/core/db/schema.sql`); otherwise the daemon refuses to start and
leaves the home untouched. To move to such a release:

1. Stop the daemon and copy the whole home (`~/.bazilion` or `$BAZILION_HOME`) somewhere safe,
   with any directory a linked Team points to. A `bazilion backup create` archive works too, but
   only the release that wrote it can restore it ([backup](backup.md)).
2. Run `bazilion uninstall --yes` (from a source checkout:
   `pnpm tsx apps/cli/src/index.ts uninstall --yes`). It keeps installed skills; `--all` removes
   them too.
3. Start Bazilion again; it bootstraps a fresh home.

Nothing is imported from the old home. Keep the copy, and the release that wrote it, for as long
as you need the old data.
