# Upgrading Bazilion

## Released 0.23.0: clean rebootstrap, not in-place upgrade

**Released0.23.0 uses the clean-install alpha schema contract.** Its complete
canonical schema is `apps/daemon/src/core/db/migrations/0001_init.sql`; this release does not add
ALTER migrations, legacy importers or compatibility adapters. A prior release number is not proof
that its home can be opened by the candidate.

## Runtime prerequisite before opening a home

Use **Node 24.22.0+ within 24.x or 26.4.0+ within 26.x** (`^24.22.0 || ^26.4.0`).
The CLI and daemon refuse earlier/other release lines before linking their application payloads or
opening a home/ownership record. Upgrade the runtime when this refusal occurs—do not reset the DB,
replace auth.json, clear ownership or bypass the guard. The upstream cleanup-hook API fix is listed
in the official24.22.0/26.4.0 notes; [recorded publisher evidence](testing/0.23.0-upstream-compatibility-metadata-20261020.md)
is not itself a qualification pass. Rebuild native dependencies if changing their Node ABI.

## Schema boundary

Legacy MCP SSE has been retired. The canonical MCP transport constraint admits only `stdio` and
Streamable `http`. All eight locally inspected sources in the release matrix—including **v0.22.0**,
the five 0.21 betas, v0.20.0 and v0.19.0—admit legacy `sse` in their schema. Such homes are
incompatible **even if no SSE server rows exist**. Older incremental ledgers also fail the current
canonical chain/prefix checks. Startup must refuse rather than silently alter/import that state.

[Read-only source inspection](testing/0.23.0-prior-schema-inspection-20261019.json) records local
commits, migration paths/digests and transport declarations. This establishes matrix expectations,
**not** an executed prior-home/installed-artifact pass or verification of public registry/tag state.
The [actual installed backup/refusal matrix](testing/0.23.0-installed-backup-closeout-20261021.md)
and [final package/platform/public installation closeout](testing/0.23.0-release-status.md) now pass.
All eight genuine prior schemas were refused with unchanged recorded ledgers/state/sentinels;
current-format encrypted backup/restore and three invalid-archive refusals passed in disposable
fixtures. These are not personal-home upgrades or a promise that old backups import into0.23.0.

## Preserve state before an operator-authorized reset

1. Keep using the matching old binary/schema to inspect or export old state. Do not assume the
   candidate's backup/restore command can load an incompatible home/archive.
2. Before any reset, the operator must preserve the **entire old home as a filesystem backup**,
   including `bazilion.db` and `auth.json` **together**. They are an identity/encryption pair, not
   independently replaceable files. Preserve external symlinked Team targets/work separately too.
3. An incompatible-schema refusal is not permission to overwrite a database or bypass ownership.
   Review the reset tier and preserve wanted Team files, Agent documents, conversations, Results
   and other state first. No automatic transfer/import into the fresh home is promised.
4. Only after explicit operator authorization and safe shutdown/ownership, follow the reported
   `bazilion uninstall --yes` reset guidance, then start Bazilion to bootstrap a new DB/auth pair.
   `--all` additionally removes retained logs and skills; it is not required for rebootstrap.
   A browser owner/lock conflict must remain blocked: never manually delete profiles/owner markers
   or force-clear ownership. Supported status/stop controls are not guaranteed recovery.
5. Old backups require a matching prior binary/schema. A current binary must refuse an incompatible
   backup rather than install it or invent provenance. Downgrades remain unsupported.

These are operator procedures, not commands authorized by preparing release documentation. No
personal home, account, Result, Team root, original daemon or backup was touched by reconciliation.

## What remains enforced

- The migration ledger and numeric `PRAGMA user_version` describe the database, but names/version
  counts alone are insufficient. Startup compares actual schema objects with canonical replay.
- Same-version schema drift, unknown/historical ledgers and incompatible shapes fail closed with
  actionable guidance. A numerically newer database is refused by an older binary.
- An exactly matching current home can reopen idempotently. That is not an in-place upgrade claim
  for any of the incompatible published sources above.
- Pre-migration snapshots/transactional forward application remain implementation mechanisms for
  a genuinely supported pending chain. They do not make this alpha boundary append-only or turn
  an incompatible home into an upgrade source. No automatic snapshot is promised before refusal;
  preserve a full backup before an operator reset.

## Release matrix and evidence limits

`scripts/migration-upgrade-matrix.mjs` retains its genuine prior-release fixture approach: check out
an actual local tag, install its dependencies, seed a disposable home with that release's daemon,
then attempt current startup. The default 0.23 expectations are **refuse for all eight listed tags**.
Nothing was executed merely by changing those expectations; no refusal has been relabelled a pass.

The current harness checks an actionable refusal message, retained Team sentinel and ledger, and
absence of a pre-migration snapshot. Those checks are narrower than byte-for-byte preservation of
every home file or installed populated-home qualification. It also creates worktrees, invokes
installs/daemons and performs teardown. Its environment/cleanup and claimed exit/home-preservation
assertions must be reviewed before an authorized run; do not run it against personal state or use
an unrelated daemon to establish safety. New source expectations do not waive that prerequisite.

## Historical contract

BAZ-047 introduced an append-only/stable-schema upgrade procedure for earlier release trains.
Historical 0.22 evidence reports successful source-worktree sentinel upgrades from 0.20/0.21 and
0.19 refusal. Those observations are retained in their dated records; they do **not** qualify the
changed 0.23 canonical schema. The current clean-install boundary explicitly supersedes any
unconditional promise here that every older home upgrades in place.

See the [current release checklist](testing/0.23.0-release-status.md) and
[MCP retirement contract](mcp.md#legacy-sse-is-retired-2026-10-02). Publication and any destructive
operator migration/reset remain separate explicit decisions.
