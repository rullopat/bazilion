# BAZ-064 — initial recipe and preflight evidence

**2026-09-20. In progress; composed acceptance remains open/blocked, not Passed.**
[Story](in_progress/BAZ-064-content-team-recipe-and-manual-handoff.md) ·
[Recipe/setup](../../examples/content-team/README.md) ·
[Canonical CT protocol](../testing/beta-readiness/content-team-acceptance.md)

This slice follows the operator's request to start the Mastodon-only manual-handoff recipe. It adds
examples, a CLI integration test and documentation, not runtime capabilities, new persistent entities,
version changes or publishing support. BAZ-059's frozen implementation is not expanded. No model,
paid API, live social account, upload or post was used. These observations do not qualify live usage.

## Identity and execution

- Product base: `f453930c54df46a22cefdcc9f8cf859af7cb047d`, with the existing uncommitted BAZ-059
  candidate. Packages still target the existing beta.5 labels; this is not a versioned release artifact.
- Local Linux, Node 26.7.0, pnpm 11.14.0. Tests use disposable fixture homes, the real daemon process,
  migrated DB, CLI and HTTP management interfaces. Scheduler and image generation are explicitly off.
- The local provider sentinel returns 503 to any request; its independent counter stayed **zero**.
  That proves no call to either enabled fixture-provider endpoint in these checks, not an observed
  security sandbox for arbitrary host networking or a worker-spawn/coding/container qualification.
- Recipe identity for this slice is the content of `examples/content-team/` together with
  `apps/cli/test/content-team-recipe.test.ts`; hashes for all 11 files are recorded in
  `/tmp/baz064-recipe-manifest.json`. Archive them with future composed evidence; this record is not
  an immutable release or reviewed recipe revision.
- Verified all **526** frozen source/configuration inputs still match the recorded manifest, with
  none added/removed in that scope. Fingerprint remains
  `c99af281efe5acc1a0c04cbdedf75d776388136af3684cc24539dab7cd6edbd6` — **superseded 2026-09-21** by the
  deliberate worker-exit defect fix below; current fingerprint is
  `bc99aa1cdd8b7cd34a0f5cb7eb20c062565ea20b563b5e390e362265326cc66a` (same 526 inputs, one changed
  file). It is not full build/dependency identity.
- Implementation/test operator: coding assistant under the user's start request. Independent review
  is not assigned/completed; no independent-user evidence is claimed.

## Implemented artifacts

Four Profile role prompts, shared selected `content-preparation` skill, private operating/tool
instructions, portable version-1 Team Template, generic brief worksheet and normal CLI/web/HTTP setup.
No automatic install, model choice, trigger, example-specific topic branch or social account is supplied.

The graph contains eight directed allow edges: user ↔ coordinator; coordinator ↔ each of researcher,
writer and designer. Missing routes deny when enforcement is active. Final editorial approval is a
recipe convention, not another name for the Team Policy communication decision.

The designer proposes a visual concept/prompt; the coordinator generates and delivers images after
current text/concept approval. This preserves source-owned Result/user-egress identity without adding
specialist → user edges or assuming a coordinator can release another Agent's private bytes. Actual
image tools are not restricted per role by these prompts; behavior must still be tested.

The coordinator stores confirmed project briefs/cycle notes in Team memory. Pi conversations and
actual messages/Results retain the evidence; memory must not become a transcript or approval database.
Stable user preferences remain separate. Missing actual reference IDs must not be invented.

## Executed checks (narrow scope)

`pnpm vitest run apps/cli/test/content-team-recipe.test.ts`: **4 passed**.

| Check | Observed boundary | Not established |
| --- | --- | --- |
| Portable template and role installation | Real CLI skill/profile/import; dry-run and spawn preview do not create their resource; actual spawn copies exact documents, attaches only the selected clean-scan skill and records canonical membership/bindings | Model follows prompts or performs specialist work |
| Directed policy matrix | 36 evaluated paths: 8 allowed coordinator spokes, 28 denied specialist/user, specialist/peer, outside-Team and cross-Team Agent routes | Actual permitted peer message delivery, held/private Results or protected worker execution |
| Reusable instantiation | Two disjoint four-Agent Teams and source instantiations, same unfilled brief context and no preset usage grant | Two topic-specific composed runs, memory isolation or absence of later fact/approval leakage |
| Real specialist ingress denial | HTTP chat to all three specialists returns 403 `communication_denied` before a fixture-provider request | Positive coordinator chat, image sequencing, research, rework or handoff |

The cross-Team matrix tests Agent-to-Agent boundaries. Bazilion has one global operator; a user
endpoint's `teamId` is not a separate human identity that should be denied access to another Team's
coordinator. The fixture does not manufacture a multi-owner contract.

Related regression command:

```sh
pnpm vitest run apps/cli/test/content-team-recipe.test.ts \
  apps/cli/test/team-policy.test.ts apps/cli/test/team-interchange.test.ts \
  apps/cli/test/skill.test.ts apps/daemon/test/runtime/worker-runtime.test.ts
```

**50 passed, 5 files.** This includes the existing protected-tool projection test explicitly excluding
`web_search`. `pnpm typecheck` also passed (root and web). Scoped Biome checks, `git diff --check` and
local link/whitespace/fence validation across 21 documents passed; 18 CT + 6 PUB cases are retained.
No complete product-suite, security release
gate, browser, installed-home migration, Docker or live acceptance rerun is claimed by this slice.

## Composed slice 2 — real delegation turn (2026-09-20)

`pnpm vitest run apps/cli/test/content-team-collaboration.test.ts`: **3 passed, first run.**
A real daemon turn used a canned LMStudio-shaped model: the coordinator called `send_message` to the
actual researcher UUID; the daemon authorizer allowed the coordinator→researcher edge; the researcher
inbox held the unread message. With `BAZILION_SCHEDULER=off`, delivery started no researcher turn
(exactly 2 LLM responses consumed, both the coordinator's). The operator HTTP message route could not
launder a researcher→writer send (403 deny, empty writer inbox). No image/search/publish path was
configured or touched.

| Observed | Not established |
| --- | --- |
| CT-02 plumbing: one real delegation hop, policy-checked delivery, operator route cannot bypass the graph | Model judgment (a canned model emitted the tool call); multi-hop collaboration; whether a real model finds correct UUIDs without a roster tool |
| Delivery ≠ execution: scheduler off kept the specialist quiet | Inbox-wake execution in the protected posture (BAZ-065/CT-16) |
| No image/search/publication request anywhere in the suite | The composed CT-03/05–07 journey |

New shared fixture: `apps/cli/test/fixtures/mock-lmstudio.ts` (extracted SSE mock; `chat.test.ts`
keeps its local copy — extracted reuse is a later cleanup). Related regression set grew to
**7 files / 71 tests**, all passing, including the unchanged `chat.test.ts`.

## Capability findings and blockers

1. **Protected discovery is absent.** `apps/daemon/src/runtime/pi/tools.ts` includes `webTools({env})`
   in ordinary tools but only `protectedWebFetchTool()` in the protected projection. The existing
   `worker-runtime.test.ts` asserts search absence. `lib/turn-invocation.ts` maps scheduled/inbox turns
   to protected execution. Configured Brave/SearXNG secrets do not make search available there.
   [BAZ-067](in_progress/BAZ-067-protected-web-discovery.md) captures separate capability work, refined on
2026-09-20 (SearXNG first; daemon-owned IPC host; merge re-verifies the BAZ-059 fingerprint). CT-03 and
   CT-16's required discovery remain Blocked; supplied URLs, fake responses or host fallback cannot
   pass it. This is not evidence that a real protected source-fetch journey ran today.
2. **Recipient discovery needs an explicit handoff.** The inspected prompt/messaging path has no
   roster injection/`list_agents` tool. Setup documents operator-supplied canonical UUIDs before
   delegation. They are routing hints, not a new authoritative roster; actual membership/policy remains
   daemon-owned. Missing/stale identities must stop work. Dynamic role discovery and usable end-to-end
   setup are not qualified. Revisit this documented friction during BAZ-066, without inventing IDs.
3. **No new approval/spend security gate.** Zero image calls before current text/concept approval is
   still an unexecuted composed oracle. Prompt instructions and eight allow edges do not enforce it.
   Private captured-image loss, uncertainty/no-retry and possible charges retain BAZ-059's limitations.
4. **The broad journey remains unimplemented.** Concrete independently selected briefs/source pages,
   real workers and specialist messages, fake search/image counters, both feedback rounds, rejection/
   stale approval, usage/policy/private-output negatives, exact Results/hash/download/restart and final
   Mastodon handoff all remain required. No worksheet or management test substitutes for those cells.
   BAZ-065 owns real cron/recovery; BAZ-066 owns authorized live/human observations.

## Composed slice 3 — protected researcher wake (2026-09-20)

`apps/cli/test/content-team-research.test.ts`; `pnpm vitest run` **1 passed** (locked posture) and
with `BAZILION_TEST_DOCKER=1` **3 passed**, including real Docker protected turns.
A shared `MockLlm` fixture now routes by inbox-wake marker so coordinator and specialist turns can
share one provider without cross-consumption (`apps/cli/test/fixtures/mock-lmstudio.ts`).

| Check (posture) | Observed boundary | Not established |
| --- | --- | --- |
| Dead Docker socket, scheduler on (no Docker) | Delegated message stays unread across fast ticks; wake refuses at protected preflight **before any provider use** (mirrors `inbox-autodeliver`) for a template-spawned specialist | Real protected execution |
| Real Docker wake | Researcher's inbox-wake runs protected: `web_fetch` of a loopback fixture page is **SSRF-refused** (`Blocked: private IP literal`), so the injection-bearing fixture page is never fetched; an in-turn `send_message` researcher→writer is **denied** (`no_allow_edge`) and the writer inbox stays empty | Live/public retrieval quality, injection judgment, CT-03/04 |
| Real Docker wake, coding probe | The wake turn's `coding_command` container env dump contains **no daemon auth token and no provider/search credentials** (`OPENAI/OPENROUTER/BRAVE/SEARXNG/FIRECRAWL`); credential-minimal container posture observed where it is claimed | Every provider variant; this is one admitted selection, not exhaustive proof |

## Composed slice 4 — approval sequencing, image-once oracle, handoff assembly (2026-09-21)

`apps/cli/test/content-team-approval.test.ts`: **3 passed.** The coordinator (operator chat turns,
scheduler off, BAZ-059's fake image provider via the preload fixture and an independent call counter)
executed the recipe's sequencing deterministically:

| Turn | Observed boundary |
| --- | --- |
| 1 — draft text/concept | **Zero image-provider calls**; enabling image generation causes no ambient generation |
| 2 — explicit approval message | Exactly **one** `image_generate` call via the `google/gemini-3.1-flash-image` route with the expected prompt; one retained Result with `imageModel`, PNG type, byte length and sha256 |
| 3 — text-only correction | **No** new image call (count stays 1) — no regeneration for text edits |
| 4 — explicit rework approval | Second call with the rework prompt; **two distinct retained Results** (`orchid-v1.png`, `orchid-v2.png`), both image/png with provenance |
| handoff write + `deliver_file` | Exact bytes survive capture/download (`handoff-cycle-1.md` with copy-ready text, image reference, alt-text caveat, sources, intended-time note and stop-before-posting composer steps); no image call in the handoff flow |

Honest limits: the canned model executes the approved sequence, so this is plumbing evidence — that a
real model withholds image calls until human approval is the L-lane observation (BAZ-066). The
fixture returns identical image bytes for both generations, so equal hashes are expected; the oracle
is separate capture/retention, not byte difference. The handoff text is recipe convention, not an
implemented approval gate or a publication receipt.

## Composed slice 5 — two-topic reuse and restart retention (2026-09-21)

`apps/cli/test/content-team-reuse.test.ts`: **2 passed.** Two Teams instantiate the same template
and run independently selected topics (community-garden open day vs library seed exchange — generic
stand-ins; live topics stay operator-selected):

- Each team's delivered handoff Result is isolated: `?teamId=content-a` returns exactly topic A's
  file, `content-b` exactly topic B's; no shared/cross-listed Results.
- Cross-Team delivery through the operator message route is denied both directions
  (`source_outside_output_denied`, observed in the daemon's denial audit).
- After a daemon restart (`stop({keepHome})` → `restartTestServer` with the same env), both handoff
  Results survive with identical ids/hashes — composed recipe restart retention.

## Composed slice 6 — route failures and policy-held delivery (2026-09-21)

`content-team-approval.test.ts` gains **CT-14**: switching the image selection to a route without
credentials fails honestly before any provider call, with **no billing-route fallback** to the enabled
OpenRouter route (independent counter unchanged); restoring the selection makes the next approved
generation work again. Complements BAZ-059's route-attestation limits: config is a request, not a
backend guarantee.

`content-team-boundaries.test.ts` covers **CT-15's** deterministic core, plus two product-behavior
findings:

- **Revoked egress denies delivery:** removing the coordinator→user allow edge through supported
  policy import makes `deliver_file` fail closed (turn fails with `no_allow_edge`); no Result is
  released. Restoring the edge (verbatim re-import) releases the **same bytes** — verified by exact
  download on a fresh Team from the same template (the blocked workspace cannot host turns).
- **Finding 1 — the user channel is bidirectional:** with egress revoked, even the operator's
  *incoming* chat to the coordinator is denied (`no_allow_edge`, channel user) — chat requires both
  directions and fails closed at ingress. Surprising but defensible; recorded, not changed.
- **Finding 2 — failed turns block the workspace with no recovery surface:** a turn that ends in a
  denial (or any non-normal exit) leaves the team's `workspace_writers` row in `recovery`; the next
  turn is refused with `workspace_recovery_required`, it persists across daemon restart, and **no
  supported operator recovery command/API exists** (`lifecycle.claim`'s auto-recovery cannot confirm
  the dead worker's cleanup for host-command workers). The team is unusable until an out-of-band
  fix. This matches the documented 'unknown cleanup remains a durable admission blocker' contract but
  leaves no supported path back; filed as a follow-up defect candidate, not worked around. Observed
  both immediately and after restart.

## Cross-story: BAZ-065's scheduling slices

BAZ-065 moved to in_progress with two slices. `content-team-scheduling.test.ts`: a real cron trigger
(two listed due minutes, one minute apart) drove two coordinator cycles through the daemon's own
scheduler, each delegating through policy; with Docker each delegation produced a protected researcher
wake. Disable semantics verified, dispatch history shows both occurrences with distinct `scheduledAt`.
`content-team-scheduling-recovery.test.ts`: a due minute during a busy turn runs exactly once after
release (one succeeded dispatch, attemptCount 1); a pre-due trigger survives a daemon restart and
fires once; a minute that fully passes while the daemon is down does not replay after restart —
the documented no-catch-up limitation, now observed where it is claimed.
`content-team-scheduling-lifecycle.test.ts` (dedicated `TZ=UTC` daemon): disable pauses / re-enable
resumes / delete stops cycles through supported management; an always-failing provider retries with
bounded attempts (3) then goes terminal `failed` with truthful `lastError`; the UTC cron fires at the
UTC instant (dispatch `scheduledAt` exact). DST gap/repeat still needs controlled clocks.
`content-team-scheduling.test.ts` adds CT-16 partial: the scheduled turn itself runs `coding_command`
in the container (`/workspace`, credential-minimal env, no daemon token) and the occurrence goes
terminal `succeeded`. Canned-model plumbing: composed L/H cycles stay open in BAZ-066.

## Reliability defect: late workspace-lease release — ROOT-CAUSED AND FIXED (2026-09-21)

**Symptom:** after a researcher inbox-wake completed its LLM rounds, the team's exclusive
`workspace_writers` row stayed `state='active'` for about **30 seconds**; every interleaved
operator/specialist turn on that team got `workspace_busy`. Reproduced across eight runs.

**Root cause (measured, not inferred):** instrumenting the daemon showed the wake's `release()`
executes in <1 ms whenever it is called, and the agent's status was already `idle` — but the
**worker child process was still alive** for the whole window (`ps --ppid <daemon>` during the wait).
The worker's success path relied on natural event-loop exit after `main()`; some underlying handle
kept the process alive for ~30 seconds after its work was done. Operator HTTP turns hid this because
their frame consumer abandons the generator early (releasing the lease at `done`), while the wake
consumes the generator to exhaustion and waits for the actual process exit.

**Fix:** `apps/daemon/src/runtime/worker/entry.ts` now calls `process.exit(process.exitCode ?? 0)`
after the finally block's cleanup (session disposed, IPC disconnected) — matching the error path's
existing explicit exit. Changeset `.changeset/baz-064-worker-prompt-exit.md` records the patch.

**Re-verification after the fix:** content research suite with Docker **3/3 passed** in ~15s
(previously ~44s, including the measured 30s hold); combined regression **9 files / 63 tests passed**
with `BAZILION_TEST_DOCKER=1`, including the BAZ-059 image-generation and SIGKILL crash suites that
exercise worker exit, restart and release semantics; `pnpm typecheck` passed; security acceptance
**173 required cases** passed. The frozen fingerprint moved deliberately (one file);
[the freeze record](../testing/0.22.0-freeze.md) and BAZ-059 release evidence require
re-verification before the version PR. Startup recovery does not clean same-identity `active` rows
and restart maps them to recovery-required — still true, but no longer reachable in normal operation.

Also observed: the wake's `coding_command` log is retained privately — the operator log endpoint
returns 403 `"Coding log has not been shared"` until explicitly shared. That is the intended BAZ-041
disclosure boundary working as designed; evidence for CT oracles must use Results/files, not private
command logs.

## First failures and local evidence

Preserve these harness-development failures instead of reporting a first-try composed pass:

- `/tmp/baz064-recipe-first.log`: suite import failed because the test passed raw JSON text to
  `parseTeamDocument`, which accepts a parsed object. Corrected the test, not production parsing.
- `/tmp/baz064-recipe-second.log`: three test failures from assuming spawn returned `teamPolicy`
  rather than `team`, and incorrectly treating the global operator as a Team-local identity. Corrected
  the response shape and narrowed cross-Team matrix checks to Agents. Specialist denial already passed.
- `/tmp/baz064-recipe-third.log`: all four recipe checks passed after those fixture corrections.
- `/tmp/baz064-collab-first.log`: collaboration slice passed first run.
- `/tmp/baz064-collab-regressions.log`: 7 files / 71 tests passed.
- `/tmp/baz064-related-tests.log`: 50 related tests passed across five files.
- `/tmp/baz064-typecheck.log`: root/web typechecks passed.
- `/tmp/baz064-lint-initial.log`: one test formatting issue, corrected without runtime edits.
- `/tmp/baz064-lint.log`: final scoped Biome pass.
- `/tmp/baz064-freeze-check.json`: 526 unchanged frozen inputs, no scoped additions/removals.
- `/tmp/baz064-recipe-manifest.json`: hashes for the 11 recipe/test files.

- `/tmp/baz064-research-first.log` through `/tmp/baz064-research-final.log`: harness-development
  history for the researcher slice — the mock's one-shot queue consumed the delegation router after
  one request (rounds 2–4 got 500s and retried), fixed with a persistent fallback + per-agent routing;
  per-test call-count baselines added after an alone-run timeout; `lastServed` array-property typing
  fixed through explicit closure variables. All recorded, not hidden.
- `/tmp/baz064-regressions2.log`: 5 files / 34 tests passed (collaboration, recipe, chat, both inbox
  suites) after the fixture change.
- `/tmp/baz064-research-docker*.log`: Docker-wake runs; the 30s lease finding is reproducible across
  `docker2/5/6/7/14/15/16/17`.
- `/tmp/baz064-reuse-first.log` … `/tmp/baz064-reuse-fifth.log`: reuse-slice history — the first
  restart attempt omitted `stop({keepHome: true})` before `restartTestServer`, hitting the daemon
  ownership refusal (`another Bazilion daemon owns this home`); a temporary daemon-stderr capture in
  `server-fixture.ts` diagnosed it and was reverted. An orphaned test daemon (from the abandoned
  standalone probe) also made one grand run's `chat.test.ts` fail with empty spawn output; it passed
  alone and after killing the orphan — a machine-load artifact, not a product issue.
- `/tmp/baz064-approval-first.log` … `/tmp/baz064-approval-v3.log`: approval/handoff slice history —
  a bad `mkdtempSync` import, the equal-hash assumption on identical fixture bytes, a bash-vs-`auto_deny`
  mismatch (switched to pi's `write` tool), a duplicated helper and a trailing-newline mismatch;
  final run 3/3 plus the grand regression (8 files / 57 tests with Docker) and typecheck.
- `/tmp/baz064-fix-regressions.log`, `/tmp/baz064-grand3.log`: combined post-fix regressions, 63 then
  59 tests. `/tmp/baz064-fix-security.log`: security acceptance, 173 required cases, post-fix.
- `/tmp/baz064-lint3.log`, `/tmp/baz064-tc3.log`: earlier lint/typecheck passes.

Temporary logs are reproducibility aids, not permanent release evidence; archive/redact relevant output
with the reviewed recipe/test hashes before claiming campaign completion. Fixture daemon/home and
provider sentinel are cleaned up after the tests. No recurring work or paid/live service was enabled.
