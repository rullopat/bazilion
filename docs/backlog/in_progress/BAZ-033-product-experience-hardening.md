---
id: BAZ-033
title: Product experience hardening across web and mobile
status: in_progress
size: L (1-2 weeks)
created: 2026-08-29
refined: 2026-08-29
priority: critical
note: v0.14.0 release slice fixing first-run access, mobile chat correctness, data-loss risks, navigation and configuration overload, responsive overflow, accessibility, and destructive-action safety.
---

# BAZ-033 - Product experience hardening across web and mobile

**Status:** In progress for v0.14.0. This item records the complete code and rendered-product
audit so the release remains reviewable as one outcome rather than a collection of cosmetic edits.

## User stories

- **As a new operator**, I want to authenticate and complete setup from a clean install, so I
  never encounter an access deadlock or a raw infrastructure error.
- **As an operator on web or mobile**, I want every conversation to show each message exactly
  once and preserve its full protocol state, so I can trust what was sent and received.
- **As an operator editing durable configuration**, I want unsaved work and destructive effects
  made explicit, so navigation, selection changes, or blank inputs cannot silently lose data.
- **As an operator on a phone, tablet, or desktop**, I want the same information hierarchy and
  accessible controls at every supported viewport, so management work does not require horizontal
  scrolling, icon memorisation, or unusually precise pointer input.

## Goal

Turn Bazilion's strong visual foundation into a coherent, trustworthy product experience. Fix the
release-blocking access and chat defects first, then reduce configuration and navigation overload,
remove silent-loss paths, and bring the web and mobile surfaces to one responsive and accessible
quality bar.

## Scope

- Repair the browser login request contract while retaining strict exact-origin validation,
  bounded browser sessions, session-bound CSRF, and the non-revocable bootstrap credential.
- Provide a secure clean-install bootstrap path that cannot deadlock before the first provider is
  configured: only while setup is incomplete, exchange the valid `auth.json` bootstrap secret
  through an internal expiring/revocable device identity for the normal bounded browser session
  and CSRF cookies. Never retain the bootstrap bearer in browser cookies, reject it after setup,
  and return friendly, actionable errors rather than raw proxy text.
- Make first-run progress truthful and explicit: provider readiness, model selection, completion,
  default resources, and the first-agent action must connect into one guided path.
- Correct native chat state and streaming: retain the optimistic user message, coalesce assistant
  deltas with the final message, consume done/fatal frames, and distinguish accepted approvals from
  streamed turns. Add recipient identity, cancellation/retry/error/offline states, and safe pairing.
- Consume mobile pairing deep links, suppress duplicate QR scans, and document only the supported
  private HTTPS web-gateway/Tailscale path; never direct native clients to an exposed daemon.
- Protect unsaved Team memory, Agent-template, and Team-policy drafts across selection changes,
  creation, tabs, and internal navigation. Reset every template field after successful creation.
- Replace ambiguous or silent destructive mutations with named consequences, explicit
  confirmation, visible progress/failure, and recoverable outcomes. Blank secret inputs must never
  mean deletion; credential removal is a separate explicit action.
- Reorganise the provider catalog around configured/recommended/local/other choices, progressive
  disclosure, search, and concise status. Replace raw environment-variable presentation with human
  labels while retaining advanced identifiers as secondary detail.
- Reduce primary navigation choices and make Approval versus Attention ownership clear. Preserve
  text labels on narrow screens and expose secondary destinations through an accessible menu.
- Separate conversation from Agent administration, reduce duplicate Team overview/context/member
  content, and give empty states a direct useful next action.
- Replace wide management tables with responsive cards or contained alternatives at narrow
  viewports. Eliminate page-level horizontal overflow at 390 CSS pixels.
- Label every icon-only and form control, provide status/live-region semantics, make custom menus
  and dialogs keyboard-operable with focus restoration, honour reduced motion, and repair contrast
  failures and undefined palette tokens.
- Render and inspect representative authenticated, first-run, empty, populated, destructive,
  desktop/mobile, light/dark states before release handoff.

## Out of scope

- New Team Policy semantics, multi-user roles, generic workflow automation, daemon exposure,
  provider-registry expansion, or a visual rebrand.
- Publishing npm packages, tagging, merging, or deploying from this implementation PR.
- Replacing the daemon-owned API/auth architecture or the supported loopback-only gateway model.

## Acceptance criteria

- A clean isolated home can bootstrap, sign in, configure one usable provider, reach the unlocked
  application, spawn the first agent, and start a conversation without CLI-only token creation.
- Login never submits an opaque-origin mutation and every rejected auth/proxy request renders a
  branded, actionable error without leaking secrets.
- Web and native chat each show one user bubble and one assistant answer per successful turn,
  including delta/final, fatal, accepted-approval, retry, and cancellation cases.
- Switching memory files, creating a note, changing Agent-template tabs, starting another template,
  or navigating from a dirty policy draft cannot discard edits without an explicit choice.
- Every permanent delete, disconnect, removal, archive, and credential clear names its target,
  explains consequences, reports API failure, and never relies on an empty replacement input.
- Providers are searchable and collapsed by default; configured choices and setup-ready actions are
  encountered before the long-tail catalog. Services use operator-facing copy with technical keys
  available as supporting detail.
- Primary navigation remains understandable without tooltips at 390 pixels and makes action queues
  distinct from informational monitoring. Agent management is not hidden beneath a second chat.
- Agents, Teams, provider setup, services, approvals, and Agent detail have no document-level
  horizontal overflow at 390x844 and remain usable at 1024x768 and 1440x900.
- Interactive controls have accessible names, keyboard behavior, visible focus, appropriate live
  regions, and WCAG AA normal-text contrast in both themes. Motion-heavy decoration respects the
  user's reduced-motion preference.
- Focused regression tests, repository tests, root/web/mobile typechecks, web build, lint,
  security acceptance, clean-install acceptance, and `git diff --check` pass for the release branch.

## Tests and verification

- Gateway integration tests for referrer/origin login behavior and clean-install session bootstrap.
- Daemon auth/setup tests covering bootstrap exchange, device credentials, setup gates, CSRF, and
  non-revocable bootstrap behavior.
- Pure mobile chat-frame reducer/parser tests plus pairing URL/deep-link/deduplication tests.
- Focused web tests for dirty-state guards, provider grouping/filtering, responsive projections,
  accessible navigation/menu semantics, explicit credential removal, and mutation failures.
- Browser acceptance at 1440x900, 1024x768, and 390x844 in light and dark, using an isolated
  `BAZILION_HOME` and without contacting paid providers or sending real external messages.
- Full release checks required by the repository and Bazilion release workflow.

## Release-candidate evidence

- Root typecheck, web typecheck/build, mobile typecheck, Expo export for every platform, and the
  repository build pass under the repository's pinned Node toolchain.
- Root lint exits successfully with the 39 pre-existing warnings still reported; this slice adds no
  lint error gate failure.
- The complete repository suite passes: 133 files passed, 1 skipped; 1,126 tests passed, 3 skipped.
- The deterministic security release gate passes all 60 required adversarial cases.
- The production gateway integration suite passes bootstrap rejection after setup, clean-install
  bootstrap exchange, exact-origin checks, CSRF, bounded uploads, streamed responses, and security
  headers. Unsafe upstream 401 responses remain 401 through the Node 25 gateway rather than being
  converted into framework 500 responses.
- An isolated clean home was exercised from login through provider configuration, default-resource
  seeding, token creation, first-Agent spawn, and populated management views. Representative light
  and dark states at 1440x900, 1024x768, and 390x844 showed no document-level overflow.
- `git diff --check` passes. Publishing, tagging, merging, deployment, and live-gateway acceptance
  remain deliberately separate from this implementation PR.
