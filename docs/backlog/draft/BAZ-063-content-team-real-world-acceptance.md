---
id: BAZ-063
title: Scheduled content Team — parent acceptance checklist
status: draft
size: S
created: 2026-09-19
refined: 2026-09-20
note: Parent evidence review only; execution split into BAZ-064/065/066. Broader beta gate, not frozen 0.22 feature scope.
---

# BAZ-063 — Content Team parent acceptance

## User stories

- As an operator, I want to give a Team any supported topic, purpose, audience, platforms, delivery
  preference and schedule, then review and revise its work before receiving approved content.
- As a beta evaluator, I want one evidence-backed answer to whether the complete scheduled journey
  works, without hiding several weeks of implementation and qualification in one story.

## Goal

Review completion of **brief → scheduled research → text/images → feedback → revisions → approval →
manual handoff**. The topic is an input, not a prescribed industry or product. Require two distinct
briefs, two actual cron preparation cycles and independent human evidence. The first test uses
[Mastodon manual handoff only](../design/content-platform-first-test.md); other platforms are deferred.

This parent is the broader-beta **B** acceptance checklist. It does not add features to frozen
BAZ-059/**R**, implement a workflow engine or authorize live spend/publication. No composed pass is
claimed. Direct social publication remains a separately reported conditional extension.

## Why

Recipe/integration work, scheduler reliability and live/human qualification need separate reviewable
changes. One parent still owns the final decision, preventing disconnected component passes from
being presented as a successful end-to-end journey.

## Scope and children

| Child | Size | Deliverable |
| --- | --- | --- |
| [BAZ-064](../in_progress/BAZ-064-content-team-recipe-and-manual-handoff.md) | M | Topic-neutral Team recipe, parameterized briefs, deterministic collaboration/research/rework/manual-handoff coverage |
| [BAZ-065](../in_progress/BAZ-065-content-team-scheduling-and-recovery.md) | M | Actual preparation cron, protected handoffs, time semantics, contention, lifecycle/recovery and bounded recurring-test execution |
| [BAZ-066](BAZ-066-content-team-live-and-human-acceptance.md) | S | Authorized live core, second-topic reuse, independent user/accessibility observations and redacted evidence |

Size S is **parent consolidation/review only**, not the total programme. Children are additional work;
the combined core is roughly 2–3 engineering weeks before prerequisite fixes, waiting for access or
participants and substantial retests. Re-estimate after the first integration slice. Product gaps
must get separate implementation work, not inflate this parent or disappear behind a waiver.

## Out of scope

Execution owned by the children; new editorial storage/UI, protected-search expansion, timezone or
scheduler features, social connectors and public media staging. No host fallback, publishing
credentials in Agent tools or extra product run/event store to make a test pass.

## Acceptance checklist and tests

The [shared protocol](../../testing/beta-readiness/content-team-acceptance.md) remains canonical for
CT-01–18 and PUB-01–06, including case/lane ownership. Do not duplicate the full matrix in each child.

- [ ] BAZ-064's reproducible recipe and deterministic case evidence are reviewed.
- [ ] BAZ-065's real scheduler, protected-origin and recovery evidence is reviewed; manual turns do
  not substitute for cron. Unsupported safe research or timing requirements remain explicitly blocked.
- [ ] BAZ-066's live and independent-user evidence covers every required L/H configuration, including
  the actual scheduled journey, two distinct topics and exact approved downloads after restart.
- [ ] Evidence identifies the same candidate/recipe/fixture versions, or affected checks are rerun
  after changes. Preserve first failures and required retests; different snapshots are not one pass.
- [ ] All core cases at their required lanes have an explicit outcome. No unresolved critical/high
  safety or core-task defect; private-image-loss and other limitations have reviewed dispositions.
- [ ] A reviewer can trace the confirmed brief, amendments, schedule, dispatches, specialist messages,
  exact approved text/media and manual instructions through existing conversations/receipts.
- [ ] Per-platform direct-publication status is stated separately: unsupported, blocked or qualified
  with actual evidence. Core Done never implies publication. Conditional PUB execution belongs to
  BAZ-060 (shared contract) and a separately refined platform adapter, not the core children.
  A Mastodon adapter is not implemented/assigned; BAZ-061/062 qualify deferred Meta/LinkedIn only.
- [ ] The redacted index, operator recipe and broader-readiness decision agree; no release or external
  publication is performed as a side effect of closing this checklist.

## Dependencies and open prerequisites

Core depends on BAZ-064 → BAZ-065 → BAZ-066 and the actual admitted image/research capabilities.
BAZ-064's first recipe/management preflight is implemented, not composed acceptance. Protected
source discovery is blocked on [BAZ-067](../in_progress/BAZ-067-protected-web-discovery.md); see the
[preflight evidence](../BAZ-064-acceptance.md).
The children may prepare in parallel, but final live qualification consumes their reviewed outputs.
Native editorial packets and social adapters are not prerequisites for manual handoff; conversational
approval is human evidence, not a machine-enforced publishing grant.

Keep this parent in Draft until execution prerequisites and assignments are resolved. Name the final
reviewer and evidence location before qualification. See [broader beta readiness](../../testing/beta-readiness/README.md)
and [the optional publication design](../design/social-content-team.md).
