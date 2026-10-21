# BAZ-068 — independent review and scoped verification (2026-10-17)

Scope: [limited recovery](done/BAZ-068-workspace-recovery-surface.md), explicitly accepted by
the operator. Guaranteed abnormal host-command recovery remains deferred. No C, new runtime
boundary, live Agent/provider/Docker trial, original-home access, commit or publication.

## Round 1 — BLOCK

- Native fresh-context read-only `reviewer` run: `61fef3ac-12da-4766-9bc1-54451bc8fbd5`.
- Original report: `/home/patri/.pi/agent/sessions/--home-patri-coding-bazilion--/subagent-artifacts/outputs/61fef3ac-12da-4766-9bc1-54451bc8fbd5/baz068-independent-review.md`.
- Reviewed dirty working tree, not merely HEAD. HEAD:
  `ee2a896dd7306fc534f4192786b2697bfb60a2d0`; 28-file SHA-256 inventory:
  `/tmp/baz068-review-source-qmqo886l.json`.
- Verdict: **BLOCK**. One P1, no P0/P2 findings. Review confirmed scope, Team/root/resource
  binding, ownership refusals, worker-signalling restriction, admin/body/no-store enforcement,
  shared presentation wording and existing recorded container checks.

### P1 — final validation yielded before releasing ownership

Final inventory/confirmation/selection checks ran inside the async teardown callback, but the
coordinator awaited that callback before deleting the writer. A nested microtask could reset a
resource confirmation or replace its identity after validation and before DELETE. The old DELETE
matched the writer, not the resource record, so it could cascade unconfirmed/changed records.

Initial central source digests (SHA-256):

| File | Before correction |
|---|---|
| `recovery.ts` | `02c9903b30d3abe9236b6931b7de67e27cee2565bd1f34346761397188be925a` |
| `workspace.ts` | `25889d904f50ae30820dc97d11117e32c4bdc43bdf04126cf1eff46add58c6a2` |
| `resources.ts` | `582b0ade89637ff17f8bb4db91407ef938ebd9f119a9453a0f5f612de00542de` |
| core recovery test | `6756e99b49961185b2cf2b69185fe802cbf876d3929997fbcf1b787b0c04b501` |

Parent disposition: **valid, in scope**. Added a synchronous final-release guard to
`WorkspaceCoordinator.recover`; management supplies the existing inventory, confirmation,
Team/root/selection and mutation checks. The guard and conditional DELETE run within one
synchronous SQLite transaction, after teardown, without an intervening await. Default automatic
recovery retains its existing teardown authority; no schema or recovery capability was added.

Three modeled-record regressions schedule nested microtasks that mutate confirmation, identity or
current registration in the former finalization gap. Each must refuse release and retain the
writer/resource admission blocker. These are not real container executions.

## Fresh parent verification after correction

Isolated same-UID temporary home, private network/PID/proc, read-only source/system mounts,
scheduler/browser/images off, DEVNULL stdin; no connected accounts or original-home mutation.

- **94 tests / seven focused files passed**, zero failures/skips in that selected run.
- All **21 current BAZ-068 security-manifest cases** matched passed assertions, including the
  three new finalization regressions.
- Root and web typechecks, web production build, scoped Biome and diff whitespace checks passed.
  Biome retains two pre-existing unused-import warnings in the shared Teams route.
- Logs and commands: `/tmp/baz068-reviewed-5MNQpr/{check.sh,tests.json,status.log,security-match.json,types.log,web-types.log,web-build.log,lint.log}`.
- No whole-tree/security release gate, Node 24/platform/package qualification, actual Docker
  teardown, live Agent/provider failure, or interactive operator/browser walkthrough is claimed.

## Round 2 — ACCEPT

- Fresh native read-only reviewer run: `30329d53-b614-4b6c-8e8f-63e1c2d5891c`.
- [Verbatim retained re-review](BAZ-068-finalization-rereview-20261017.md).
- Original P1 resolved; **no remaining P0/P1/P2 findings** in the correction's specified blast
  radius. Together with the first source review, this accepts the explicitly limited scope.
- Reviewer inspected the synchronous guard/DELETE transaction, fail-closed default guard,
  existing automatic-caller compatibility, all three regressions and fresh parent-run evidence.
- Verdict: **Limited-scope ACCEPT; Merge verdict OK**. No additional parent verification needed
  for the correction provided reviewed source remains unchanged. The reviewer did not execute
  tests or independently recompute the supplied SHA-256 values; those limits remain explicit.
- Before closing, parent recomputed every entry of the 29-file review inventory and confirmed
  no source drift. Only acceptance documentation/backlog bookkeeping changed afterward.

Accepted central source digests (SHA-256):

| File | After correction |
|---|---|
| `recovery.ts` | `57855992db32e3dc8d2f1cb848ffc38f700580caec6e06f837746e91dc91cb8d` |
| `workspace.ts` | `2868760bb90580cc4a4a7a2cb4d117b0d774851ee3312599cf46c5d215cc5ff6` |
| core recovery test | `28fb0ebb5399257755db8a8427c61d5d99ed9b4c076587506f80395ed7d3e6b5` |
| security manifest | `37e22eb4dcb03c6df76122e5d60ca0b11169d3f17e1cc54d918c51527d45e299` |

## Closeout

BAZ-068 is **Done for its accepted limited scope**, targeting an unreleased 0.23.0 candidate.
Guaranteed abnormal host-command recovery stays deferred and unknown ownership stays blocking.
No whole-release approval, broader-beta acceptance, packaging/platform qualification, commit,
installation, account change, publication or release is implied. Earlier BLOCK was not waived:
its concrete P1 was corrected, verified and independently re-reviewed before closure.
