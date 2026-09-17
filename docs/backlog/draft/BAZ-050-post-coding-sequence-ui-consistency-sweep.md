---
id: BAZ-050
title: UI/UX consistency sweep of the post-hardening coding surfaces
status: draft
size: L (1-2 weeks)
created: 2026-09-17
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
disclosure, Attention routing, accessibility, and responsive behaviour.

## Why

BAZ-033 hardened first-run, chat, navigation, configuration, responsive, accessibility,
and destructive-action UX — and then the coding sequence shipped roughly ten new
surfaces built feature-by-feature: `teams/$id/verifications`, `review`, `activity`,
`results`, `templates/*` deep pages, snapshot/publication views. Error boundaries were
verified only in a handful of routes (`approvals`, `activity`, `policy`). The sweep is
justified by timing, not suspicion: these surfaces simply predate no hardening pass.

## Scope

- **State triplets:** every route from BAZ-039–046 handles empty, loading, and error
  (daemon unreachable, 4xx, partial data) with the app's shared components.
- **Destructive actions:** every discard/delete/reset in the new surfaces goes through
  `ConfirmDialog` with consequence text.
- **Attention routing:** failures in new coding features surface in the Attention
  Center (BAZ-026) per its one-queue rule — no orphaned toasts.
- **Accessibility:** labels, focus order, contrast, keyboard operation on all new routes.
- **Viewport matrix:** repeat BAZ-033's responsive checks for the new surfaces,
  including the existing puppeteer evidence pattern from `scripts/check-*-ui.mjs`
  (mobile.png/chat-mobile.png screenshots with overflow assertions).

## Out of scope

- New features or information-architecture changes.
- The Expo app (removed by BAZ-053); mobile = responsive web.

## Tests

1. Agent-led audit (BAZ-045 methodology: observed, not asserted) walks every new route
   in all three states with evidence screenshots; zero missing triplets.
2. Every destructive action in new surfaces requires confirmation; scripted attempt
   without confirmation fails.
3. Injected failures in new features land in Attention, not console-only.
4. Accessibility checks pass on new routes at parity with the BAZ-033 bar.
