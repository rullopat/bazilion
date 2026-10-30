# Upgrading Bazilion

## Runtime requirement

The **0.25.0 alpha** CLI and daemon support **Node 26 only: 26.12.1+ within 26.x** (`^26.12.1`).
Node 24 and other release lines refuse before application bootstrap; Node 24 compatibility and
routine qualification are retired. The exact development/CI/qualification toolchain is
**Node 26.12.1 + pnpm 12.15.0**. This baseline contains the upstream native cleanup-hook and SQLite
backup-completion fixes; earlier Node 26.4.0 observations are not current acceptance.
Historical published release requirements and failures below are unchanged.
For a runtime refusal, upgrade Node; do not reset the DB, replace `auth.json` or clear ownership.
Rebuild native dependencies when changing their Node ABI.

## 0.25.0 alpha: clean rebootstrap

Native verification changes the canonical alpha schema: an `unknown` outcome may retain its own
interrupted command receipt without claiming an exit code or confirmed cleanup. This edits
`0001_init.sql` under the existing clean-install contract; there is no ALTER migration or importer.
Published 0.23.0 and 0.24.0 schema objects therefore do not match this candidate and must refuse
unchanged. Preserve the entire old home and use the authorized-reset guidance below; do not reset
merely because Node changed, or assume that old backups can be imported into the new schema.

The candidate matrix requires ten genuine prior releases to refuse without changing state. A
separate fresh-current fixture retains its sentinel and paired auth across two further healthy
starts. That is current-schema idempotence, not an in-place upgrade from an incompatible release.
The published 0.24.0 continuity observation below remains historical and is not relabelled.

## Published 0.24.0: existing 0.23 homes

Published 0.24.0 keeps the canonical 0.23 schema unchanged. A valid 0.23.0 home is expected to
reopen in place; do not reset it just to upgrade. Stop the old daemon safely and preserve the
entire home, including `bazilion.db` and `auth.json` together, before updating.

The 0.24.0 release matrix seeded a genuine `v0.23.0` home and checked retained Team sentinel
data, unchanged paired `auth.json` bytes and two healthy starts under that candidate. This is
bounded startup/state-continuity coverage, not a general transcript, backup or platform guarantee.
[Final six-job CI](https://github.com/rullopat/bazilion/actions/runs/39941560898) passed this
continuity check, unchanged-state refusals for all eight older fixtures, installed Linux/macOS
CLI trials and offline imports/browser-only consumer types for both library tarballs.
All three packages are now npm 0.24.0/latest; actual public archives and fresh guarded consumers
were checked separately. See [releases](releases.md). Incompatible older homes still follow the
unchanged refusal/rebootstrap boundary below.

Doctor now exits on structural installation health only. Protected automation must separately
inspect `protectedWorkBaselineReady` in authenticated health details; diagnostics do not run a chat.

## 0.23 schema boundary

Bazilion remains alpha. **0.23.0 requires clean rebootstrap for incompatible prior homes,
including 0.22.0.** Legacy MCP SSE is retired; old SSE-capable schemas are incompatible even
without SSE server rows. Older ledgers and changed schema objects cannot be imported or
silently altered into the current shape. Downgrades are unsupported.

Startup validates the bundled migration chain, actual schema objects and numeric
`PRAGMA user_version`. Exact current homes reopen idempotently. Unknown, drifted or newer
schemas fail closed with guidance. The loader's snapshot/forward-application mechanism for a
supported pending prefix is not a general cross-release upgrade guarantee. In particular,
**no automatic snapshot is promised before an incompatible-schema refusal**.

## Preserve state before an authorized reset

1. Use the matching old binary to inspect/export old state. Do not assume the new binary's
   backup/restore can read an incompatible home or archive.
2. Stop the old daemon safely. Preserve the **entire old home** as a filesystem backup,
   including `bazilion.db` and `auth.json` together. They are one identity/encryption pair.
   Preserve external symlinked Team targets/work separately.
3. Review wanted Team files, Agent documents, conversations, Results and other state before
   resetting. A schema refusal does not authorize destructive cleanup or promise automatic import.
4. Only after an explicit operator decision and safe shutdown/ownership, follow the supported
   `bazilion uninstall --yes` reset guidance, then start Bazilion to create a new DB/auth pair.
   `--all` also removes retained logs and skills; it is not required for rebootstrap.
5. Old backups need a matching binary/schema. Keep that binary and preserved home available
   until the replacement is satisfactory. Never mix one old identity half with a new one.

A browser owner/lock conflict must remain blocked. Use supported status/stop/reset operations;
never manually delete profile locks, owner markers or recovery records to force progress.
A clean bootstrap does not restore old data automatically.

See [architecture](architecture.md), [MCP](mcp.md), [retention](growth-and-retention.md) and
[credential/backup recovery](../README.md#cli-commands).
