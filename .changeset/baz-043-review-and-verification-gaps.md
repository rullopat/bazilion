---
'bazilion': minor
'@bazilion/client': minor
'@bazilion/api-types': minor
---

Revision-bound coding review and handoff (BAZ-043).

A coder can ask an existing same-Team member to read one captured change and say what they think of
it, and get the findings back — with the reviewer unable to run, change or publish anything.

- One packet binds one captured change. Editing the repository afterwards does not rewrite it; it
  makes the packet **stale** for the current code, which is shown as a fact rather than smoothed over.
- A coder asks from inside its turn with `request_review`, naming a teammate by name or id. The daemon
  captures the revision at that moment and binds the requester from the turn.
- The reviewer's whole capability is four read-only tools — read the packet, read a changed path's
  patch, record a finding, record a conclusion. There is no shell, editor, browser, network or
  publication verb, and the daemon refuses each of them rather than trusting a prompt.
- A patch is offered only while the tree still matches the capture, because a snapshot stores paths and
  digests, never bytes. Once it has moved, the reviewer is told the content is not reproducible and a
  finding recorded then is `unverified` and cannot be resolved.
- Findings are append-only and about `(packet, path, revision)`. Resolution requires an explicit
  decision or a named later revision — a moved line proves nothing.
- Completion is a set of separate facts. Committed, pushed, pull request, merged, deployed and
  production accepted are **operator-reported and never verified**: there is no code-host integration.
- Exports are publications, not downloads: the bytes are held in the durable results store until the
  shipped egress authorizer releases them, so an export cannot bypass an approval-held delivery.
- File links name the daemon host, offer a copyable location, distinguish the reviewed revision from the
  live file, and run a configured editor as argv without a shell.

Also closes three gaps in the previous release's specialist verification: a container check now runs
with the posture its receipt claims (read-only Team memory, recovery-registered container); declared
output paths are **checked** rather than trusted; and — the substantive one — a coding Agent can ask
for verification at all, which is what makes the result delivery reachable in production.

This release changes the alpha schema: four review tables, and result provenance widened so an artifact
can come from a review packet as well as a turn's tool call. A 0.18.x home cannot be upgraded in place.
