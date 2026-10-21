# BAZ-069 — live-trial defects and delegated Google consent

**R10/R11 fixes implemented and independently reviewed; no remaining blocker found in this
remediation scope.** The reviewer recommended conditional acceptance; all remaining regression
conditions subsequently passed. [Live attempt 2](BAZ-069-t18b-retry-evidence.md) subsequently
selected Reject all autonomously and completed with a valid `done`, but Google blocked the search.
No source was reached. [Attempt 3 / Bing](BAZ-069-t18b-bing-evidence.md) then delivered a valid
1.86 MB completion but exposed **R12, a bounded semantic-capture gap**. R12 was outside this
review's scope; [separate R12 remediation/re-review](BAZ-069-r12-remediation.md) now passes its gates. This is not completed T18(b), operator live-lane acceptance or release approval.

## Authorization and autonomy

After the [first live attempt](BAZ-069-t18b-evidence.md), the operator asked to fix the discovered
bugs and handle Google clicking without supervision. The implementation assistant explicitly
interpreted this as authorization to choose **Reject all optional Google cookies**, not Accept all,
CAPTCHA solving, login, payments or permission grants. Routine search/result/source navigation is
already within the research goal and does not require a new approval for each click.

Browser guide **v2** now distinguishes a prior delegated cookie choice from an unresolved human
choice: execute the exact rejection autonomously when clearly available; stop if ambiguous or
unavailable. This is prompt-level behavior under operator instructions, not a new runtime capability
or a blanket global consent default. Page text cannot authorize it. The next real-Agent profile/goal
must carry the delegated rejection explicitly; a canned fixture or prompt assertion cannot prove
that a real model will choose correctly. A genuine CAPTCHA still blocks unattended qualification.

The guide also calls for checking the effective destination URL, and permits navigation to an exact
observed read-only href after stale-link refusals without weakening any ref freshness checks.

## R10 — bounded protocol drain and UTF-8 decoding

- New `runtime/worker/output.ts` seals writes, waits for a FIFO stdout callback barrier covering
  every preceding frame, and fails on stream error or a **two-second** deadline. Repeated finish
  calls share the same bounded result. The deadline remains referenced; a blocked reader cannot
  leave a worker running indefinitely. Late protocol writes are ignored once sealed.
- `worker/entry.ts` uses that drain before **every explicit exit path**, including startup errors
  and startup cancellation. Explicit exit remains necessary to release a worker/Team lease despite
  native/provider handles. Drain failure produces nonzero exit, not false success. Startup abort
  checks prevent a delayed session-creation result from starting a provider turn while output drains.
- The spawner decodes UTF-8 across pipe chunks with the stream decoder rather than decoding each
  Buffer independently. This prevents replacement characters when a pipe boundary splits a code
  point; the frame-size checks and secret redaction remain unchanged.
- Regression fixtures exercise >2 MiB done/fatal/cancellation output with a deliberately delayed
  reader and a live interval, blocked readers, stream errors and sealed/idempotent completion.
  A daemon → **real worker entry** → canned provider → daemon HTTP test retains a large Unicode
  user message exactly in the completion and then runs another turn, proving lease release too.
- An initial candidate used a TypeScript parameter property in the new class. Real-worker tests
  correctly failed because the worker uses Node's strip-only runtime, not tsx. The class now uses
  erasable field syntax, and the subprocess regression fixtures also use strip-only Node. The
  initial failure is retained in `/tmp/baz069-r10-targeted.log`, not called an environment flake.

## R11 — post-click capture readiness and honest failure

- `SessionObservations.capture` waits only for **body attachment**, capped at two seconds, before
  reading document/generation stats. It does not reload, replay, poll a challenge or wait for
  network idle. Freshness, shadow-root coverage, preflight estimates and retained byte limits remain.
- `actOnRef` now handles failure of the **post-dispatch capture**, which previously escaped its
  action-error handler as a raw tool error. It invalidates the old observation and explicitly says
  the action was dispatched but its effect is unverified; inspect state rather than replaying it.
- Unit tests check bounded settling before freshness reads and one dispatch despite capture failure.
  Actual-browser tests remove the body during a click, either restoring it after 250 ms or leaving
  it absent: the former captures the destination; the latter reports uncertainty. Both prove one
  click, with no automatic replay. A wait does not guarantee application-level rendering is finished.

## Final validation

All listed commands exited 0 on the reviewed source. Logs are
`/tmp/baz069-r10-{worker,browser,full,security,wayland,workflow,final-typecheck,biome}.log`; the serial
final gates also have `.exit` companions.

| Gate | Result |
| --- | --- |
| Focused worker tests, including actual entry/HTTP large completion | **49 passed** |
| `pnpm test --maxWorkers=4` (no exclusions) | **2,128 passed, 41 skipped; 259 files passed, seven skipped** |
| `pnpm security:acceptance` | **217 required cases passed**; web build also passed inside the gate |
| Actual-browser X11 lane | **18 passed** |
| Actual-browser Wayland-only lane | **18 passed** |
| Canned-model CLI browser workflow | **2 passed** |
| Root and web typechecks | Passed |
| Targeted Biome, 14 code/test/manifest files | Exit 0, no fixes; **20 warnings**, no errors |

Skips and style warnings are not passes or whole-repository lint cleanliness. No real provider or
public site was contacted by these regression fixtures. The initial genuine strip-only failure
above remains recorded. No temporary OAuth/profile from the first live attempt remains.

## Independent re-review

Fresh ephemeral read-only Codex AI session, `gpt-6-astra`, high reasoning, user config ignored;
thread `01a0e930-3542-7ca2-b1e0-8f2fa7b0a5ff`, exit 0. Report:
`/tmp/baz069-r10-review-u0PY5A/review.md`, SHA-256
`c2f9a9ec7a757a18dd50ac7f33a58d6a738bdbc2ccda904b694079818eecad8e`.

The reviewer found **no remaining blocker in R10/R11 and delegated-cookie remediation**, with
conditional acceptance pending final regression gates. The remaining gates subsequently passed
as above. All **82 dirty/untracked file hashes matched** before/after review; only documentation
was updated afterward. Manifest SHA-256:
`81eda0bc1847d3a0a803ccbc64b3983084836e1428f217427ebf3b85e1f82d05`.

Independent in-memory checks passed for multi-frame drain/sealing/idempotence/timeout/errors,
forced one-byte UTF-8 decoding and size refusal, readiness-before-stats, and single dispatch with
old-reference rejection after failed capture. The reviewer used stubs/extracted production browser
logic; its subprocess probe was **inconclusive due to sandbox EPERM**, not a pipe-test pass. It
inspected parent test logs rather than independently rerunning actual browsers or the whole suite.
This is an independent AI session, not human witnessing or different-model-family review.

The reviewer explicitly preserved the autonomy boundary: prior exact cookie rejection only;
no broader permission or global default. Prompt assertions do not establish a real model's consent
choice, and body attachment does not establish application rendering completion.

## Remaining gate

The code/review regression gate is met. Attempt 2 demonstrated autonomous delegated cookie rejection
and valid terminal completion, but no source reading because Google presented a verification barrier.
Attempt 3 added live large-frame success but no source reading: it exposed R12, now fixed and
independently reviewed under its own record. A new authorized live trial and complete research journey
with effective-URL verification remains required; separate attempts cannot be spliced into one pass. No guarantee of Google access, CAPTCHA avoidance, paid API
use, macOS qualification or release follows from these fixes.
