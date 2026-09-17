---
id: BAZ-053
title: Remove the Expo mobile app; mobile story becomes responsive web
status: todo
size: S (afternoon)
created: 2026-09-17
priority: medium
note: Operator decision 2026-09-17 — the Expo app ships neither in beta nor 1.0. Successor vision in BAZ-054 (post-1.0 native apps). Removal must preserve the private gateway (BAZ-028), which serves mobile browsers and future native clients.
---

# BAZ-053 - Remove the Expo mobile app; mobile story becomes responsive web

## User stories

- **As a maintainer**, I want the half-finished Expo app (version 0.0.0, four screens)
  out of the monorepo, so beta surfaces and CI describe everything that actually ships.
- **As an operator on a phone**, I keep using the responsive web UI over the private
  gateway (BAZ-028), so removing the app removes nothing I could do before.

## Goal

Delete `apps/mobile` cleanly, keeping every piece of infrastructure the future native
apps (BAZ-054) and mobile browsers depend on: the hardened private gateway, device
credentials, and the Telegram pairing flow's web path.

## Why

Operator decision (2026-09-17): the Expo app is not the mobile strategy — native iOS
and Android apps are (BAZ-054) — and shipping a thin half-verified wrapper in beta
would cost more (support, platform matrix, review) than it returns. Verified on
2026-09-17: the daemon has no mobile-specific routes ("mobile" appears only in comments
about generic HTTP bearer clients), no CI or workspace references target `apps/mobile`,
and the app is ~1,600 self-contained lines.

## Scope

- Delete `apps/mobile/` and any workspace/dev references.
- Verify and document (in the removal's as-built) that the mobile story is: phone
  browser → private gateway HTTPS origin → named device credential (BAZ-028),
  identical to desktop browsers.
- Verify Telegram pairing works fully from the web UI
  (`routes/config/integrations/telegram.tsx`) without the app's `pair.tsx` screen.
- Preserve for BAZ-054: the gateway design note that "native clients always require a
  device credential" — the auth path future native apps will use already exists.

## Out of scope

- Building the native apps (BAZ-054, post-1.0).
- Any gateway/auth changes — none are needed for the removal.

## Tests

1. `grep -r apps/mobile` across the monorepo returns nothing after removal.
2. Full suite green; no workflow references a mobile artifact.
3. Telegram pairing verified end-to-end from the web UI on a fresh home.
4. Responsive web UI reaches every operator action from a phone browser over the
   gateway (evidence screenshots, per the BAZ-033 viewport pattern).

## As-built

**Done, on `feat/beta-schema-contract` (PR #54), 2026-09-17.**

- `apps/mobile/` deleted (Expo app was ~1,600 lines, 4 screens, version 0.0.0);
  `pnpm-lock.yaml` regenerated (−4,204 lines); `.changeset/config.json` no longer
  ignores `@bazilion/mobile`.
- Verified zero remaining references: `apps/mobile` / `@bazilion/mobile` appear nowhere
  in source, workflows, scripts, or config (backlog history excepted).
- **Gateway untouched, as scoped:** the BAZ-028 private gateway, named device
  credentials, and the "native clients always require a device credential" auth path
  remain — mobile browsers today, BAZ-054's native apps later.
- **Pairing unaffected:** pairing is daemon-side logic (covered by
  `telegram-pairing.test.ts`, `telegram-routing`, `telegram-queue-binding` tests) with
  the web route `routes/config/integrations/telegram.tsx` as the operator surface; the
  app's `pair.tsx` screen was an alternative native entry point that nothing depended
  on.
- Mobile story is now: phone browser → gateway HTTPS origin → named device credential,
  identical to desktop. Responsive-web evidence remains covered by the
  `check-*-ui.mjs` mobile-viewport screenshot scripts in CI.
- Verification: full suite 1,786 passed / 0 failed (the mobile test files' cases gone);
  typecheck clean; lint clean on touched files (76 pre-existing warnings unchanged,
  tracked on main).
- Remaining from the Tests section: a one-time manual pass of Telegram pairing and the
  phone-browser gateway flow on a real device, folded into the beta acceptance run
  (BAZ-050's audit covers the responsive-web assertions systematically).
