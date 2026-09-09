# BAZ-039 implementation goal

> Scope revised 2026-09-09: [Agent-led coding design](design/agent-led-coding.md).
> Prior completion and acceptance entries below describe the previous scope. Revised Agent-led
> acceptance is pending; this refinement does not reopen or create a durable implementation goal.


Started: 2026-09-08. Status: implementation accepted locally; unreleased.

Story: [BAZ-039](in_progress/BAZ-039-repository-coding-context.md).
Durable goal thread: `01a08060-5816-7022-9c28-934c27bbaf70`.
Starting HEAD: `5b884e765de6514312c22c5b7524dc1c6d88dd36`.

## Objective and stopping condition

Implement the complete refined BAZ-039 contract, with criterion-by-criterion evidence and a
reviewable local change. Completion requires daemon resolution, normal/protected runtime integration,
authenticated API, CLI and responsive web parity, documentation, and passing required validation.
Do not mark complete because only the resolver or a subset of surfaces is working.

Preserve the existing uncommitted BAZ-039/040 refinement and dependent backlog-link edits.
BAZ-040 remains todo. No release, deployment, merge or push is included; BAZ-039 stays unshipped.
Use disposable homes/repos and fake providers/Telegram, never personal runtime state for acceptance.

## Design boundaries

- The daemon discovers, bounds and validates repository instructions and passive Git/command context.
- Prefer Pi's supported resource-loader/context and custom-tool interfaces for supplying validated
  snapshots and tool results. Keep automatic context, extension and skill discovery disabled.
- Preserve private Agent instruction ownership, Team Policy, egress, protected filesystem boundaries,
  and Pi's authoritative transcript. Restricted learning review receives no new discovery capabilities.
- Context fingerprints identify captured source inputs, not an atomic code snapshot or test evidence.
- Do not add BAZ-040 probes/environments, worktrees, Git writes, cloning, or automatic publication.

## Checkpoints

- [x] Create durable goal, move story to in_progress, preserve prior refinements and initialize ledger.
- [x] Inspect integration boundaries and add bounded resolver/wire contracts with adversarial fixtures.
- [x] Integrate admission snapshots and turn-bound targeted refresh into normal/protected Pi sessions.
- [x] Deliver authenticated API, CLI readable/JSON output and responsive Team context inspection.
- [x] Complete docs/release note and criterion-by-criterion acceptance evidence below.
- [x] Run required checks, inspect final diff, record limitations and close the implementation goal.

## Acceptance evidence

| Criterion | Required evidence | Status |
|---|---|---|
| Linked repository orientation | API/CLI integration compares reports and refresh; resolver tests verify dirty counts, no writes and disabled helpers; browser uses the same authenticated API | Passed |
| Instruction scope and precedence | Root/nested/sibling, generated-folder instructions, source hashes; actual Pi prompt distinguishes private Agent and repository guidance | Passed |
| Normal/protected parity | Loader snapshot parity; fake-provider protected refresh; real configured worker/provider round trip; typed IPC rejects forged identity and missing reports | Passed |
| Bounded degraded outcomes | Plain/detached/unborn/conflicted repos; missing Git/time/output errors; byte/depth/source/report/metadata bounds; unsupported configuration | Passed |
| Refresh and root identity | Concurrent instruction/command edits, root retargeting, scope replacement and blocked-context clearing; next provider request receives refreshed guidance | Passed |
| Security | Descriptor-pinned traversal/link/special-file defenses; inactive helpers/extensions/skills; authenticated inspection; existing HTTP approval tuple and private public replay; restricted-review exclusion | Passed |
| Real repository compatibility | Root AGENTS.md complete (38,503 bytes at capture), 18 candidates, Git main/HEAD/dirty state available; 43,780-byte report in 141 ms | Passed on Linux |
| Operator experience | Authenticated root/nested inspection, refresh, exact inert source text, unavailable state and desktop/mobile layout; screenshots inspected | Passed |

## Validation ledger

Final validation on 2026-09-08 used Node 26.7.0 and disposable fixtures. Earlier progress entries
below remain historical; the final acceptance entry supersedes their pending work.
Required final gates: meaningful targeted tests; full `pnpm test`; root and web typechecks;
`pnpm lint`; `pnpm security:acceptance`; `git diff --check`; web interaction inspection.
Use the workspace-compatible Node runtime, and distinguish fixture acceptance from live deployment.

## Progress log

- 2026-09-08: Created the active durable goal without a token budget. Moved BAZ-039 to in_progress
  and repaired backlog links. Inspected existing Pi loader, shell policy, worker IPC and CLI Team
  entry points. No application code has been changed yet; all acceptance criteria remain pending.

- 2026-09-08 implementation increment: added hermetic reports, descriptor-pinned resolver,
  disposable neutral Git metadata inspection, command-source extraction, API/client/CLI and Team
  context card. Added admission snapshots and turn-bound IPC refresh; Pi reads supplied context
  through getAgentsFiles and rebuilds active instructions after a targeted replacement. Existing
  automatic discovery remains disabled. Added user/developer documentation and an unreleased changeset.
- Validation: resolver fixtures passed 21 tests. Affected resolver/prompt/worker suite passed 57
  tests. New API/CLI integration and existing turn-preparation tests passed; the initial targeted
  refresh test found an invalid-target/root-identity distinction, which was fixed, and the four
  Pi-context integration tests then passed.
- Full-suite baseline for this increment: 183 files passed / 1 skipped; 1,423 tests passed / 3
  skipped, 51.17 seconds. Output: `/tmp/baz039-full-tests.log`. Root and web typechecks passed;
  lint exited successfully with 55 warnings / 3 informational diagnostics. Full-suite results
  precede subsequent native-TypeScript compatibility cleanup and documentation additions.
- Security acceptance passed all 60 required adversarial cases. Output:
  `/tmp/baz039-security.log`; machine report: `/tmp/bazilion-security-acceptance-4166119.json`.
  These existing cases do not replace BAZ-039-specific worker/egress acceptance.
- Read-only real-checkout acceptance: root AGENTS.md complete, main/HEAD and dirty counts available,
  18 command candidates, 42,835 serialized bytes, about 270 ms. No project command executed.
- Browser acceptance passed against disposable authenticated daemon/web servers: root/nested context,
  refresh replacement, inert HTML, unsafe-target handling and desktop/mobile layout with no page
  errors or horizontal overflow. Visually inspected screenshots in `/tmp/baz039-ui-TR7VNN/`;
  reproducible script: `scripts/check-repository-context-ui.mjs`.

## Final acceptance (2026-09-08)

- Completed all implementation checkpoints, including actual provider/worker round trips, closed
  wire validation, approval-gated live context output and private transcript projections. Pi's
  canonical transcript retains the original tool result; no second publication or session store exists.
- Safe Git inspection carries only allowlisted non-executable interpretation settings and contained
  local excludes. Includes, filters and unsupported metadata yield unavailable Git rather than
  guessed counts. Instruction completeness remains independent of Git and command availability.
- `pnpm test`: **185 files passed / 1 skipped; 1,444 tests passed / 3 skipped** (48.44 seconds),
  `/tmp/baz039-final-tests.log`. The final Git-orientation prompt line and malicious `.pi` discovery
  assertions were subsequently verified with both affected Pi test files: **7 tests passed**, in
  `/tmp/baz039-last-targeted.log`.
- Root and web typechecks passed: `/tmp/baz039-final-typecheck.log` and
  `/tmp/baz039-final-web-typecheck.log`. Lint passed with 55 warnings / 3 informational diagnostics,
  `/tmp/baz039-final-lint.log`; these are not an error-free lint claim.
- `pnpm security:acceptance`: **all 60 required adversarial cases passed**,
  `/tmp/baz039-final-security.log`. BAZ-039-specific resolver, runtime, IPC and egress fixtures pass
  in the full suite as additional coverage.
- Final authenticated browser acceptance passed with no page errors or horizontal overflow:
  `/tmp/baz039-ui-GOd81E/result.json`, `desktop.png`, `mobile.png`, and `incomplete.png`.
  Desktop/mobile screenshots were visually inspected. Reproduce with
  `pnpm tsx scripts/check-repository-context-ui.mjs` after a web build.
- Real-checkout inspection: `/tmp/baz039-final-checkout.json`. Capture figures above precede the
  final documentation-only status edits; the report is explicitly dated, not a workspace lock.
- `git diff --check` passed. Documentation, source contracts, release note and retained BAZ-040
  refinement are reviewable locally. No commit, push, merge, release or deployment was performed.

## Explicit limitations and delivery state

- Safe reads currently require **Linux with `/proc` directory descriptors**. Other platforms return
  `safe_reads_unavailable`, which prevents normal/protected coding-turn preparation; this is a
  material platform limitation, not cross-platform acceptance. It is documented in the user guide.
  No path-based fallback weakens the containment contract. Portable safe reads remain future work.
- Large Git object stores (over 64 MiB), linked worktree metadata and configurations requiring
  filters/includes report unavailable Git; bounded repository instructions still work.
- Context captures are dated. Targeted refresh guides the Agent to resolve the applicable scope;
  it does not mechanically police arbitrary Bash edits or confer execution authority.
- The implementation goal is complete locally. BAZ-039 remains `in_progress` and **unshipped**
  pending the separate release workflow. BAZ-040 remains `todo`; no environment/probe work was added.

## Guided inspection and UI follow-up (2026-09-08)

The operator manually confirmed root/Git/command orientation, root+nested instruction scope,
BLUE-to-GREEN refresh with changed fingerprint and dirty counts, traversal rejection, and recovery
in a disposable repository. This walkthrough covered inspection, not real-model instruction following.

The walkthrough exposed an oversized card, repeated unavailable-context messages, and a rejected
request misleadingly labelled as the root. The follow-up compacts the form, headings, Git summary,
instruction disclosures and command rows; full hashes/commit/provenance remain in one collapsed
source-details disclosure. The UI stores the submitted target with each successful report response,
so rejected paths and older captures retain their actual request even while the input is edited.
Identical issue messages for the same path appear once, near the top.

Web typecheck and production build passed. The updated browser acceptance checks desktop/mobile
layout, inert content, hidden-by-default fingerprints, one error for a rejected target, request-label
stability during input edits, and recovery; all passed with no page errors or horizontal overflow.
Evidence: `/tmp/baz039-ui-3QK0iV/` and `/tmp/baz039-ui-polish-check.log`. Screenshots were visually
inspected. `git diff --check` passed. The disposable walkthrough web server was refreshed for the
operator; this was not a release or production deployment.

## PR preparation (2026-09-08)

The operator approved the compact UI after the guided walkthrough and requested a PR containing
BAZ-039 and the related coding-story work. PR scope includes the completed implementation, the
BAZ-040 refinement and dependency-link corrections in BAZ-041 through BAZ-044; subsequent stories
remain unimplemented. Upstream `main` matched the starting HEAD before branching. Commit/push/PR creation
are now authorized; merge, release and deployment remain separate.

## Agent-led remake — 2026-09-09

The operator-probe scope above is superseded. The replacement is implemented and validated locally: [Agent-led acceptance](BAZ-039-040-agent-led-acceptance.md). No new goal, merge or release is claimed.
