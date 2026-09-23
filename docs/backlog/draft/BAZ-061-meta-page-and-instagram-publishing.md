---
id: BAZ-061
title: Approved Facebook Page and Instagram photo publication
status: draft
size: L
created: 2026-09-19
---

# BAZ-061 — Facebook Page and Instagram photo connectors

## User stories

- As an operator with authorized Meta accounts, I want approved variants posted to my Facebook Page
  and Instagram professional account through official APIs.
- As an operator without required access, I want clear setup/limitation guidance and manual export.

## Goal

Implement the first Meta text/photo vertical slices over BAZ-060, with correct account/login scopes
and narrowly staged Instagram media. Split into separate connector/staging stories if refinement
exceeds L; do not hide an XL project in one implementation PR.

## Why

Meta permits defined API publication but not arbitrary personal-profile automation. Instagram
requires fetchable media; Bazilion's supported daemon and gateway must remain private.

## Scope

- Facebook Page text/photo posts; Instagram professional single-photo caption/alt-text flow.
- Explicit selected login/grant model, account discovery/identity, consent callback/state validation,
  token lifecycle/revocation, capability checks and useful app-review/access diagnostics.
- Pre-review media conversion/validation for selected API version; no post-approval content edits.
- Operator-configured external media staging for exact approved images only; opaque expiring URLs,
  no listing, cleanup and clear disclosure. Never expose daemon/Results or enable Funnel.
- Media/container status versus post publication evidence; handle expiry and quota/backpressure.
- BAZ-060 scheduling stays single-owner; no competing local and platform-native schedules.
- Manual export/blocked fallback when account, app access or media staging is unavailable.

## Out of scope

Personal Facebook profiles, Reels/video/Stories/carousels initially, ads, engagement automation,
platform-rule bypass, public Bazilion hosting and all-platform scheduling libraries.

## Tests

- Fake API contract tests for login/grants, account substitution, upload/container lifecycle and remote IDs.
- No image staging before approval; expired URLs and cleanup work without exposing other results.
- Revoked grants, format/size rejection, quota, container expiry and timeout preserve truthful status.
- Lost publish acknowledgement is not a second post; partial Facebook/Instagram success stays separate.
- Dedicated operator-approved real accounts: inspect actual final post and account independently;
  capture selected app/API version and actual granted scopes. No claim from mocks alone.

### Composed acceptance ownership

Own the Facebook/Instagram configurations of **PUB-01–06** in the
[content-Team protocol](../../testing/beta-readiness/content-team-acceptance.md), including platform
contract faults and separately authorized live/human evidence. Reuse BAZ-060's shared fake-host checks;
report each platform independently to BAZ-063. This is conditional publishing qualification, not work
inside the BAZ-064/065/066 manual core. No live execution is authorized by this assignment.

## Open Questions

- Available Facebook Page/Instagram professional accounts and Meta developer-app access.
- Instagram Login versus Facebook Login path and supported account capabilities.
- Staging vendor and budget, upload expiry sufficient for Meta fetch, privacy/cleanup policy.

See [primary references and constraints](../design/social-content-team.md). Depends on BAZ-060.
No live post or external storage setup is authorized by this draft.
