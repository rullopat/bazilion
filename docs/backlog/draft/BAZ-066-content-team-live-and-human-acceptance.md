---
id: BAZ-066
title: Content Team live and independent-user acceptance
status: draft
size: S
created: 2026-09-20
refined: 2026-09-20
note: BAZ-063 child; qualification only after BAZ-064/065. Target 0.23.0 (a withdrawn 0.22.0 gate moved it). Needs BAZ-069 first for the defaults journey. Size excludes access/recruitment waits and product fixes.
---

# BAZ-066 — Live and human content-Team acceptance

> **Target (operator decision 2026-09-21):** the next release (**0.23.0**). A same-day plan that
> made this story the 0.22.0 release gate (run on Bazilion's defaults, requiring
> [BAZ-069](BAZ-069-browser-backed-default-web-search.md) first) was withdrawn — 0.22.0 ships with
> the frozen image-generation scope; this live/human acceptance follows once BAZ-069 exists.

## User stories

- As an operator, I want the Team to research my chosen topic and produce useful, editable content,
  rather than merely repeat a hardcoded demonstration.
- As an independent evaluator, I want to complete the actual scheduled workflow through normal
  interfaces and documentation, so that readiness reflects observable behavior and understandable states.

## Goal

Qualify the reviewed [BAZ-064 recipe](../in_progress/BAZ-064-content-team-recipe-and-manual-handoff.md) and
[BAZ-065 scheduled path](BAZ-065-content-team-scheduling-and-recovery.md) using bounded live services
and an independent participant. Supply final evidence to
[BAZ-063](BAZ-063-content-team-real-world-acceptance.md), not a new implementation programme.

## Why

Fake-provider correctness does not establish real discovery, source quality, usable images, coherent
specialist work or human understanding of approval, time, costs and manual delivery.

## Scope

- Operator-selected topic A, purpose, audience, cadence and limits on Mastodon; topic B has different
  subject, facts and preferences on the same initial platform. Confirm concrete briefs before execution. No prescribed industry,
  vendor, launch or promotional purpose; informational/educational content is equally valid.
- Actual web discovery and source checking, one already-qualified image selection, real specialist
  collaboration, two cron-prepared cycles and distinct platform variants using the existing recipe.
- Follow BAZ-064's confirmed interaction: template and one coordinator, one adapted post per selected
  platform, text/concept rework and approval before image generation, then image rework and final
  text/image approval. Cover Mastodon manual text/image handoff, reviewed alt text and chosen-server
  instructions; explain requests for deferred platforms without substitution. Observe zero premature
  image calls and exact manual downloads/instructions after restart.
  Test the composed browser journey, not a collage of separate CLI screenshots.
- Independent human walkthrough with keyboard/narrow-screen observation, missed/late approval and
  unavailable direct-integration explanation. Record assistance and state/cost/schedule comprehension.
- A second-topic reuse check; it does not require a second participant study or every provider unless
  the agreed configuration matrix explicitly says so. Do not change code or recipe logic for the topic.
- Redacted evidence index, source/receipt/hash references, all attempts, actual usage/unknown cost,
  defects and retests. Return to earlier children when their recipe/harness needs correction.

## Out of scope

Harness development, new capabilities, all-model image qualification (IMG-13), the product-wide human
study/soak, live crash experiments without separate permission, or direct publication/staging. Conditional
PUB cases require BAZ-060 plus a separately refined platform adapter; no Mastodon adapter is claimed.
BAZ-061/062 concern deferred Meta/LinkedIn. Manual handoff must not be described as a remote post.

## Tests and acceptance

Own **every required L/H cell of CT-01–18** in the
[shared protocol](../../testing/beta-readiness/content-team-acceptance.md), including **CT-18 H**.
Do not invent L/H configurations for rows that only require D/S; those belong to BAZ-064/065.

- Independently verify source URLs/dates/claims, actual tool and specialist actions, exact text/image
  versions and intended schedule. Model prose or attractive images alone do not establish correctness.
- Observe the live/human cron boundary and late-approval behavior; record any unrun configuration
  explicitly instead of inheriting its result from a fake provider or operator-triggered turn.
- An independent person completes the agreed walkthrough; developer hints make that attempt assisted.
  No agent-simulated user or expert walkthrough may be reported as the independent human lane.
- Confirm no unsupported claim, unapproved disclosure/publication, stale approval, fabricated success
  or unsafe retry. Preserve failures and requalify affected lanes after fixes.
- Report all required observations, limitations and cleanup against the pinned candidate/recipe.
  Missing access or participants stays Blocked; it cannot be changed to Passed to finish the story.

Done requires reviewed live/human evidence and disposition of findings, ready for the parent's decision.
Size S is approximately 1–2 execution/reporting days after fixtures, access and participants are ready;
waiting and substantive fixes/retests are separate. Re-estimate rather than compress required observations.

## Dependencies and open prerequisites

BAZ-064/065 complete for the candidate path; qualified selected provider and protected origin. Assign
tester/reviewer and an independent participant, obtain recording consent, and authorize concrete topics,
source access, accounts, maximum attempts, spend/usage and stop conditions. Text setup also uses budget.
Pause unrelated test-home recurrence and keep social publishing credentials absent.

Remain in Draft until those prerequisites are resolved. Splitting the story authorizes none of the
live execution, paid calls, public demonstrations or release operations.
