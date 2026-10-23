# Upgrading Bazilion

## Runtime requirement

The CLI and daemon require **Node 24.22.0+ within 24.x or 26.4.0+ within 26.x**
(`^24.22.0 || ^26.4.0`). Earlier and other release lines refuse before application bootstrap.
For a runtime refusal, upgrade Node; do not reset the DB, replace `auth.json` or clear ownership.
Rebuild native dependencies when changing their Node ABI.

## Unreleased 0.24: existing 0.23 homes

The 0.24 branch keeps the canonical 0.23 schema unchanged. A valid 0.23.0 home is expected to
reopen in place; do not reset it just to upgrade. Stop the old daemon safely and preserve the
entire home, including `bazilion.db` and `auth.json` together, before updating.

The default release matrix now seeds a genuine `v0.23.0` home and checks retained Team sentinel
data, unchanged paired `auth.json` bytes and two healthy starts under the candidate. This is
bounded startup/state-continuity coverage, not a general transcript, backup or platform guarantee.
Versioned 0.24.0 artifact checks remain required before publication. Incompatible older homes
still follow the unchanged refusal/rebootstrap boundary below.

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
