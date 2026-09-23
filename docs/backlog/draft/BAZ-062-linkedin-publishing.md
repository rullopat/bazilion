---
id: BAZ-062
title: Approved LinkedIn text and image publication
status: draft
size: M
created: 2026-09-19
---

# BAZ-062 — LinkedIn publication

## User stories

- As an operator with granted LinkedIn access, I want an approved post published to an explicitly
  selected member or organization author, never an inferred/default account.
- As an operator, I want uncertainty reported honestly when my grant permits writing but not
  reading the remote evidence needed for reconciliation.

## Goal

One official text/single-image connector over BAZ-060 for the author types actually authorized.

## Why

LinkedIn Posts API exists, but member/org permissions and vetted Community Management access
are not interchangeable. Write access does not establish read/reconciliation access.

## Scope

- OAuth consent/state and safe callback flow, author identity and granted-capability discovery,
  encrypted token lifecycle/revocation, selected version headers and actionable access guidance.
- Exact approved text plus uploaded image URN, image-processing readiness and host post ID evidence.
- Member/org author support only where granted; explicit blocked/manual-export path otherwise.
- Reuse BAZ-060 decisions, scheduling and uncertainty; no separate publishing worker or queue.
- Configuration/status/receipts in web and CLI; adapter contract tests against versioned fixtures.

## Out of scope

Ads, document/video/multi-image publication initially, comments/engagement automation, analytics,
closed read permissions by workaround and assumed access to every organization a user can name.

## Tests

- Correct author/role/scope/version checks; changed or revoked grant blocks before upload/publication.
- Image upload acceptance does not imply post publication; exact revision and destination preserved.
- 401/403/429, expired upload, timeout after acceptance and absent read permission are distinct.
- Partial batches and restart/restore do not replay successful/uncertain posts.
- Live acceptance on a dedicated approved member/org target verifies actual payload and remote ID;
  unsupported author types are not advertised from mocked tests.

### Composed acceptance ownership

Own the LinkedIn configurations of **PUB-01–06** in the
[content-Team protocol](../../testing/beta-readiness/content-team-acceptance.md), including platform
contract faults and separately authorized live/human evidence. Reuse BAZ-060's shared fake-host checks;
report each claimed author type independently to BAZ-063. This is conditional publishing qualification,
not work inside the BAZ-064/065/066 manual core. No live execution is authorized by this assignment.

## Open Questions

- First target: personal member, organization, or both? Existing app/product/tier approvals?
- Available read capabilities and explicit manual-reconciliation UX when they are unavailable.
- Selected current API version and maintenance/deprecation policy.

Depends on BAZ-060. See [research and design](../design/social-content-team.md).
