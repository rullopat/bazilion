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

A browser tab left open across an upgrade still runs the page it loaded. Every answer of the web
server says which build it comes from, so the tab notices the new release (at the latest when its
live updates come back after the restart) and says **Bazilion was updated** with **Reload**; what
you had typed and not sent is kept across the reload. When the tab needs a part of the web UI it
had not loaded yet (the Connections map, a dialog), that part is gone from the new release, so it
reloads itself once. **Retry**, on a page that could not load while Bazilion restarted, reloads
the whole page, so it shows the release that answers.

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

0.66.0 removed reviewed learning. Upgrading a home from before it adds each Agent's approved
private lessons to its `SOUL.md`, under **Lessons the human approved**, once the database
upgrade has succeeded, so the Agent keeps following them; shared lessons stay notes in the Team's
memory. Proposals still waiting, rejected or revoked lessons and the history of reviews are
dropped; the copy in `upgrades/` keeps them.

0.67.0 removed `AGENTS.md` and `TOOLS.md` from Agent homes and templates. When the daemon starts
and finds one, it moves what the file says into `SOUL.md`, which is in the Agent's instructions on
every turn: the role at the top of an `AGENTS.md` goes to the top, its approved lessons to the end,
and text the built-in default did not have under **How you work** (from `AGENTS.md`) or **Tools**
(from `TOOLS.md`). A `SOUL.md` that is still a built-in default becomes today's. The files as they
were, `SOUL.md` included, are kept in `upgrades/agent-files-<time>/`; then the two are removed. A
home it cannot move, because one of those files is a link, is left as it is with a line in the
daemon log, and what its old files say is not in the Agent's instructions until you replace the
link with the file it points to and restart Bazilion.

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
memory, Team workspaces) are not touched. Going back before 0.67.0, the Agents keep working with
their `SOUL.md` alone; to have their old `AGENTS.md` and `TOOLS.md` again, copy them back from
`upgrades/agent-files-<time>/`, with the `SOUL.md` kept there.
