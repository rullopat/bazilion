---
id: BAZ-018
title: One Team vocabulary and a clean-install schema
status: done
created: 2026-07-12
shipped: 2026-07-12
release: v0.9.0
---

# BAZ-018 — One Team vocabulary and a clean-install schema

## Outcome

Bazilion has one model: Teams, Team templates and Team Policy. Groups, Profile Groups and the
browser-local "harness" prototype are gone, and the database is one schema file with no
migration or compatibility layers for alpha data.

## Scope

- Product copy, CLI commands, HTTP routes, web URLs, wire types, daemon modules and on-disk paths
  say Team; there are no redirects or aliases for the old names.
- The schema is one file that a fresh home gets whole. A home whose schema differs is refused at
  startup; moving to such a release means a backup, a reset and a fresh bootstrap.
- Telegram bindings are removed together with the home they belong to.

## As built

- Schema: `apps/daemon/src/core/db/schema.sql` (it began as a flattened `0001_init.sql`), applied
  by `core/db/schema.ts`; there is no migration runner.
- Reset: `bazilion uninstall --yes`, then `bazilion serve`. See [upgrades](../../upgrades.md).

## Not built

- Preserving alpha data across schema changes: no `ALTER` migrations, importers or adapters.
