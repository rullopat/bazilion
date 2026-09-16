# BAZ-043 — verification of the acceptance criteria

Written against the branch `feat/baz-043-review-handoff` (targeting **v0.19.0**). Each criterion is marked
**Observed** (watched happening, including with a real model), **Proven locally** (tests and the release
gate), or **Not claimed**, and the caveats at the end are the honest remainder rather than a summary of
successes.

The story's premise is that a review must describe *one captured revision*, that a reviewer must be
read-only by construction, and that no surface may imply a state some other system owns (a commit, a merge,
a deployment). The evidence below is organised around those three.

## 1. A packet opens the exact captured base/change and its check evidence; later edits do not rewrite it, and make its current-code status stale

**Observed.** A packet names one BAZ-042 snapshot and stores **no copy of the tree**, so the captured
contract cannot be rewritten by editing the repository. `readReviewPacketReport` recomputes, on every read,
a three-valued applicability and a `stale` flag; the capture path refuses a snapshot outside its window, an
incomplete capture, a reviewer who is not a live member of this Team, and a self-review — and a refusal
writes **zero rows** (`apps/daemon/test/lib/review-capture.test.ts`).

**Observed for checks.** `facts.checksCurrent` is a real fact rather than a constant: it is true only when a
BAZ-041 verification of *this same revision* actually executed **and** the tree still matches it. A
verification of another revision does not make it true, and moving the tree away from what was checked makes
it false again — pinned in `apps/daemon/test/routes/reviews.test.ts`.

**Not claimed.** "After refresh/restart" is established by the report being recomputed from the database,
and by restart recovery settling an interrupted reviewer attempt as `uncertain`; it was not observed through
a browser reload.

## 2. A reviewer inspects only the authorized captured scope, cannot modify the checkout, and cannot reach a hidden capability; policy still governs; the inbox path cannot execute the review

**Observed, end to end and by attempting the breach.** The reviewer's entire capability is four tools
(`review_packet`, `review_path`, `review_finding`, `review_conclusion`) with closed schemas and **no verb for
execution, editing, browsing or publication**. The end-to-end test drives a real repository with a real dirty
change through claim → restricted worker → IPC → capability → settle, and the fixture worker *attempts*
eight capabilities a reviewer must not have — `coding`, `verificationRead`, `verificationRun`,
`verificationCapture`, `publishResult`, `browserInvoke`, `mcpInvoke`, `sendMessage` — turning the dispatch
into a **failure** if any is answered. The review left the tree byte-identical to before it ran, and a
finding must name a path the capture recorded: a path that merely exists in today's tree belongs to a
different change and is refused (`apps/daemon/test/lib/review-e2e.test.ts`).

**Observed with a real model.** `scripts/review-live-run.mjs` boots a disposable daemon and repository and
drives the whole loop: a coder agent **chose `request_review` unprompted**, the restricted reviewer read the
packet and the patch, recorded a finding that explicitly says it **cannot run anything** ("I cannot run that
here"), concluded `recommended`, and the result reached the coder's inbox. The finding and the conclusion
both name the captured revision.

**Content honesty.** A manifest stores paths and digests, never bytes, so a patch exists only while the tree
still matches the capture. Once it has moved, the reviewer is told the content is not reproducible and a
finding it records is stored as **`unverified`** rather than presented as a normal one.

**Policy.** With enforcement on, the requester→reviewer edge is re-evaluated on every dispatch. An
`approval_required` edge captures a **durable grant** through the canonical approver (its own `request_review`
operation, its own delivery-plan kind, its own `packetId === attemptId` identity) and the packet waits in
`awaiting_approval`. A release revalidates membership, the reviewer and the evidence window, and a
cancellation that raced the approval wins (`apps/daemon/test/lib/review-capture.test.ts`).

**The inbox trap, addressed structurally.** The ordinary inbox wake starts a *writable coding turn*, so a
packet never rides a peer message: review dispatch belongs to the packet state machine, and a reviewer is
given **no messaging capability at all**. That is a deliberate deviation from the story's refinement note
(which listed messaging among the reviewer's surfaces): the result is delivered by the daemon through the
canonical messenger, which is one owner instead of two, and a restricted turn with messaging would be a wider
surface for no gain.

## 3. Findings link to the reviewed snapshot; stale, unavailable and uncorrelated evidence is explicit; a completed review is not a pass or an acceptance

**Proven locally.** Every finding stores the revision it was made against and carries a three-valued
applicability; an `unverified` finding **cannot be resolved** (that would attach a decision to evidence nobody
established) and resolution requires an explicit decision or a named later revision. The result message and
the export both state that a conclusion is a reviewer's statement, not operator acceptance, not a passing
test, and not permission to publish.

## 4. Exports preserve the same reviewed change and truthful verification, with authenticated access and egress holds

**Proven locally, with one gap.** The export names the revision it describes, records that revision on the
packet, and offers **no patch** once the tree has moved — a manifest-only snapshot cannot honestly produce a
diff of different code, and the export says why instead of showing one. Unresolved and unverified findings are
named in the export itself, and a handoff with open findings says it is not a statement that the change is
ready. Access is authenticated HTTP; a packet past its window is refused rather than exported empty.

**Not claimed: the Agent-delivery path.** The story asks exports to use BAZ-034's durable publication so an
export cannot bypass an approval-held Agent delivery. That wiring does **not** exist: the export is
operator-facing HTTP only. Criterion 4 is therefore **partly met**, and the gap is stated rather than implied.

## 5. Editor/file links identify host, mapping and live-versus-snapshot; hostile paths cannot become commands

**Proven locally.** A link names the daemon host, always offers a repository-relative copyable location, and
only offers an open action when an editor is configured *on that host*; it reports `live`, `stale` or
`unknown` and says plainly when it is pointing at the current file rather than the reviewed revision. No
editor is configured by default. The configured command is split into **argv and run without a shell**, with
`{path}`/`{line}` substituted inside one argv element — the injection test uses a file literally named
`app; touch pwned.txt` and asserts that no such file appeared. A mapping that does not match refuses rather
than handing the editor a path it cannot reach, and a path outside the reviewed revision is never offered.

**Not claimed.** The copy button and the open action were not observed in a browser. Whether the viewer's
browser is on the daemon host is **stated in the link's notes rather than detected**, because the daemon
cannot know where a browser is running.

## 6. API/CLI and web share review status and exports; no automatic commit, push, PR, merge, deploy or permission change

**Observed.** Status, findings, conclusions, resolution, reported states, exports and file links are exposed
through the same shapes on the API, the CLI (`bazilion team review packet …`) and the web panel.

**Proven locally.** No publication path exists to be triggered: the review modules contain no git write
operation, the reviewer's capability has no such verb, and recording a conclusion does not change any
publication state — the export is the only artifact, and it is a file the operator takes.

**Not claimed.** The web panel is typechecked and built, not browser-observed. The agent-facing requester
path is observed with a real model through the real daemon.

## Defect review

Three findings against my own work, all fixed on the branch:

- **A missing implementation, found by checking the story rather than the tests.** The story requires a coding
  Agent to create a packet through turn-bound IPC; only the operator route existed. That is the same class as
  BAZ-044's missing requester — the reviewer capability would have shipped unreachable from the path the task
  experience describes. `request_review` now exists, resolving the reviewer **by name or id** inside the
  caller's Team, with a refusal that lists who can be asked (the same rule BAZ-044 needed after a real model
  went looking for a peer's UUID with bash).
- **Code that reads as a guarantee but is unreachable.** `cancelReviewDispatch` existed with no caller, so
  "cancellation is observable" was false. Cancellation is now a route, owned by one function that decides
  between aborting a running attempt and cancelling a waiting packet, and a settled review refuses to be
  rewritten.
- **A fact that could never be true.** `facts.checksCurrent` was hardcoded `false`. It is now derived from
  BAZ-041 evidence for the same revision, which is what makes it a fact rather than a placeholder.

## Validation

`pnpm vitest run` → **1774 passed / 11 skipped** and the adversarial gate covers **129 required cases** (18
added for this story), typecheck, lint, format and the web build clean. The live runs are recorded as
artifacts: `/tmp/baz043-review-live.txt` (scripted) and the real-model run above.
