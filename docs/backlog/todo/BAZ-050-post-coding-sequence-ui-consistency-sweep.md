---
id: BAZ-050
title: UI/UX consistency sweep of the post-hardening coding surfaces
status: todo
size: L (ran ~2 days as a focused sweep)
created: 2026-09-17
refined: 2026-09-18
priority: high
note: Beta blocker. BAZ-033 (v0.14) hardened the UI; BAZ-039–046 (v0.16–0.20) added ~10 surfaces after it.
---

# BAZ-050 - UI/UX consistency sweep of the post-hardening coding surfaces

## User stories

- **As an operator opening a coding verification or review screen for the first time**,
  I want the same empty-state, error-state, and loading behaviour the rest of the app
  has, so the new surfaces don't feel like a different product.
- **As an operator about to discard a review packet or delete a verification**, I want
  the same confirmation dialog and consequence disclosure as every other destructive
  action, so nothing irreversible happens on a misclick.

## Goal

Bring every UI surface added since BAZ-033's hardening pass (v0.16–v0.20 coding
sequence) up to the same consistency bar: complete state triplets, destructive-action
disclosure, and browser-acceptance evidence for the new routes.

## Why

BAZ-033 hardened first-run, chat, navigation, configuration, responsive, accessibility,
and destructive-action UX — and then the coding sequence shipped roughly ten new
surfaces built feature-by-feature: `teams/$id/verifications`, `review`, `activity`,
`results`, `templates/*` deep pages, snapshot/publication views. Only six routes carry
`errorComponent` (approvals, attention, activity, policy, teams index, template detail);
the rest fall to TanStack's developer-grade default error screen on a loader failure.
The sweep is justified by timing, not suspicion: these surfaces simply predate no
hardening pass.

## What the audit actually found (2026-09-18)

- **Error states:** 27 of 33 route files lack `errorComponent`. The established
  server-fn pattern swallows `ApiClientError` into an inline "unavailable" message
  (good — 4xx degrades in place), but any *other* failure (daemon unreachable =
  network `TypeError`, server-fn crash) rethrows from the loader and hits TanStack's
  default error screen. This is the dominant gap.
- **Loading states:** loaders have no pending surface; client-side navigation to a
  slow route renders the previous page with no feedback (blank content area on first
  paint).
- **Destructive actions:** audited every route's danger buttons. All confirmed
  through `ConfirmDialog` with consequence text except one: **cancel-verification**
  (`teams/$id/verifications`) fires on a bare danger click. Template editors are
  guarded by `UnsavedChangesGuard` + explicit save (client-side removes are not yet
  destructive); members roster is read-only.
- **Empty states:** present on every audited route (`EmptyState`/`muted` copy) —
  `results/$id` and `ResultCard` handle their own loading/error/empty. No work.
- **Attention routing:** already governed by BAZ-026's one-queue rule; the
  failure-visibility audit (BAZ-051) pinned the server side. No new routing needed.

## Refinement decisions (2026-09-18)

1. **Router-level defaults carry most of the sweep.** `defaultErrorComponent` — a
   calm `role="alert"` fallback naming the failure, with retry and a safe exit link —
   plus `defaultPendingComponent` for loader navigation. One change, every route.
2. **Route-specific `errorComponent` only where a specific title or fallbackHref adds
   real value** (the coding-sequence team tabs, results, templates deep pages, agent
   tabs). Not mechanical churn on every file: the default must be good enough that a
   generic fallback is honest.
3. **One destructive action to fix:** cancel-verification gets `ConfirmDialog` with
   consequence text (pending checks will not run; the request can be re-created).
   Everything else verified confirmed already — the sweep's destructive-action test
   is a verification, not a construction.
4. **Attention routing and empty states: no code changes** — audited as already
   conforming (see audit findings).
5. **Browser acceptance, not screenshots-only:** a new
   `scripts/check-coding-surfaces-ui.mjs` following the `check-git-review-ui.mjs`
   pattern (disposable daemon + web, playwright, evidence screenshots): walks the new
   routes at desktop and narrow viewport with horizontal-overflow assertions, asserts
   the empty states on a fresh home, and walks the **error state for real** — killing
   the daemon and asserting the recovery component (not a blank screen) on each
   audited route.

## Scope

- `apps/web/src/router.tsx`: `defaultErrorComponent` + `defaultPendingComponent`.
- `errorComponent` on the coding-sequence routes (titles name the surface; fallback
  hrefs go to the owning Team/agent or the overview).
- `ConfirmDialog` on cancel-verification.
- `scripts/check-coding-surfaces-ui.mjs`: desktop/narrow render walk, empty-state
  assertions, daemon-kill error-state walk, evidence directory.

## Out of scope

- New features or information-architecture changes.
- The Expo app (removed by BAZ-053); mobile = responsive web.
- Rewriting the server-fn error-swallowing pattern (it is the right degradation for
  4xx; the sweep ensures non-4xx failures also degrade well).

## Tests

1. The new acceptance script: every audited route renders at 1280×1000 and 390×844
   with no horizontal overflow; fresh-home empty states assert; with the daemon
   killed, each route shows the recovery component (`role="alert"`), never a blank
   screen or TanStack's default.
2. Cancel-verification requires confirmation; the dialog states the consequence.
3. Full vitest suite stays green (no behaviour regressions in routed code).
