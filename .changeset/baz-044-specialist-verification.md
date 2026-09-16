---
'bazilion': minor
'@bazilion/client': minor
'@bazilion/api-types': minor
---

Specialist verification of a captured code change (BAZ-044).

A coder can hand one captured change — a BAZ-042 snapshot of a dirty tree — to an existing
same-Team specialist with up to eight exact, task-selected commands, and get back executor-owned
evidence identifying the code, commands, environment and outcomes it was verified against.

- One typed request per verification, bound to an immutable captured contract. The specialist's
  capability is two tools: read the request, and run one declared check once. No command, cwd,
  timeout or environment argument exists to pass.
- Admission revalidates membership, the evidence window and directed policy on every attempt,
  reserves the workspace exclusively, and refuses drift with a fresh capture as the remedy.
- Checks run through the same shell posture, redaction and BAZ-041 receipt path as a coding turn,
  never with the daemon's ambient environment. A check needing an approval an unattended turn
  cannot obtain is blocked, not auto-approved.
- A non-zero exit is a result about the commands that ran, reported per check; settling reports
  evidence availability rather than a verdict, and an interrupted attempt is `uncertain` and never
  replayed.
- The result returns to the requester through the canonical messenger, carrying receipt references
  that grant exactly that peer read access.
- Surfaces: `/api/teams/:id/verifications[/:requestId[/cancel]]`, `bazilion team verify
  create|list|show|cancel`, and a Team **Verifications** section.

This release changes the alpha schema: four new tables. A 0.17.x home cannot be upgraded in place.
