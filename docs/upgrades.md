# Upgrading Bazilion

Installed with the one-line installer, run it again: it updates Bazilion and, on a Mac,
restarts it ([installing](install.md)).

```sh
curl -fsSL https://bazilion.com/install.sh | bash
```

Installed with npm:

```sh
npm install -g bazilion@latest     # or run npx bazilion@latest dashboard
bazilion app install               # macOS, when you use the Bazilion app: restarts it
```

Bazilion needs Node.js 26.12.1 or a later 26.x release; the CLI refuses any other Node before it
starts. A refusal caused by the Node version means upgrading Node, never resetting the home.

A browser tab left open across an upgrade still runs the page it loaded. When it next needs a part
of the web UI it had not loaded yet (the Connections map, a dialog), that part is gone from the
new release, so the tab reloads itself once to get the new version; if that cannot help, the page
says so and offers **Reload**. Reloading open tabs after an upgrade avoids the hiccup.

## The database

An upgrade keeps your home. The daemon brings its database up to the new release when it starts:

1. It copies the database to `upgrades/bazilion-schema-<version>-<time>.db` in the home, readable
   by you only.
2. It applies the release's migrations in one transaction and checks the result against the
   schema the release ships. Only then does it commit, and it logs
   `bazilion upgraded the database from schema 1 to 2; the database as it was is kept at …`.

When a migration fails, nothing it did is kept: the daemon refuses to start, says why, leaves
the home as it was and removes the copy it made. Report the message; do not reset the home. In
the rare case the message says part of the upgrade may have been kept, put back the copy it names
(below).

Homes from 0.26.0 to 0.62.0 have no schema version. A later release takes such a home as
version 1 when its schema is exactly the one those releases shipped, and upgrades it from there.

Copies in `upgrades/` stay until you delete them. Backups leave them out, and
`bazilion uninstall` deletes them with the rest of the home.

### Going back to an earlier release

A release refuses a home that a later release has already upgraded, and says so. Releases up to
0.62.0 call that home incompatible and suggest a reset: do not reset it. To go back:

1. Stop the daemon.
2. Copy the file from `upgrades/` that the upgrade made over `bazilion.db`, and delete
   `bazilion.db-wal` and `bazilion.db-shm`.
3. Install the earlier release and start it.

What changed in the database since that upgrade is lost; files in the home (conversations,
memory, Team workspaces) are not touched.

### Homes older than 0.26.0

There are no migrations from schemas before 0.26.0. The daemon refuses such a home untouched. To
start over, copy the whole home somewhere safe, run `bazilion uninstall --yes` (from a source
checkout: `pnpm tsx apps/cli/src/index.ts uninstall --yes`) and start Bazilion again.
