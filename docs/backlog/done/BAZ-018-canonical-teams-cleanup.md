---
id: BAZ-018
title: Canonical Teams cleanup and clean-install schema
status: done
size: L (1-2 weeks)
created: 2026-07-12
shipped: 2026-07-12
priority: high
note: Breaking alpha cleanup; existing local data must be wiped and bootstrapped again.
---

# BAZ-018 - Canonical Teams cleanup and clean-install schema

**Status:** Done. Unreleased.

## User stories

- **As the sole alpha operator**, I want one product vocabulary and one API model, so I do
  not have to distinguish Groups, Profile Groups, Harnesses, and Teams.
- **As a maintainer**, I want one clean-install schema instead of migration and compatibility
  layers for unpublished data, so the production model stays understandable.
- **As an operator reconnecting integrations**, I want stale Telegram bindings removed before
  the reset, so a fresh install cannot accidentally inherit old routing state.

## Goal

Make Team, Team Template, and Team Policy the only production concepts. Flatten the complete
database schema into `0001_init.sql`, remove legacy APIs/URLs/filesystem names and the local
prototype, reset the operator data safely, and prove the canonical product end to end.

## Acceptance criteria

- Product copy, CLI commands, HTTP routes, web URLs, wire types, daemon modules, and on-disk
  paths use Team terminology; there are no compatibility redirects or aliases.
- There is exactly one canonical Team Template roster and exactly one effective live Team
  Policy per Team.
- The schema is fully represented by `0001_init.sql`; a fresh bootstrap records only that
  migration and creates no legacy tables.
- The browser-local harness prototype and its `/harnesses` routes are removed; the proven
  Flow/Matrix interaction model remains in the production Team Policy editors.
- Telegram channels are unbound before the old Bazilion home is deleted. A newly bootstrapped
  home has no Agents, messages, approvals, or Telegram bindings.
- Focused and full tests, root/web typechecks, lint, production build, and responsive light/dark
  browser QA pass without sending a real Agent message.

## Out of scope

- Preserving existing alpha database rows, old APIs, old URLs, or old filesystem layouts.
- Adding another roster, detached live-policy identity, workflow engine, or approval system.
- Sending real Agent/model messages during validation.

## As-built (2026-07-12)

- Renamed production Group surfaces to Team across the daemon, CLI, web, wire contracts,
  filesystem helpers, Telegram commands, tests, and docs. Removed Profile Group resources,
  compatibility adapters/redirects, and the local `/harnesses` prototype.
- Consolidated the canonical schema into `0001_init.sql` and deleted migrations `0002` through
  `0013`. The alpha contract is now explicitly clean-install only.
- Preserved the production stable-slot Team Template roster, revisioned Team-owned policy,
  runtime authorization, block audit, and communication approvals. Confirmed there is one
  canonical Team Template roster and one effective live Team Policy per Team.
- Unbound Telegram routing, removed the previous Bazilion home, and bootstrapped a fresh one.
  The fresh database records only `0001_init` and contains no Agents, messages, approvals, or
  Telegram bindings; integration credentials can be re-entered through Config later.
- Fixed defects found during browser QA: draft slot ownership, Open Team preset inference,
  mobile Team table overflow, stale readiness state, and adoption wording.
- Verification passed 88 test files / 671 tests, root and web typechecks, Biome lint, the web
  production build, and `git diff --check`. In-app Playwright covered 1440x900, 1024x768, and
  390x844 in light and dark without sending a real Agent message.
