# Candidate scenario catalogue

**Rewritten 2026-09-20 for `0.22.0`: 110 families, not 110 passing tests.**
Expand each family into concrete configurations and results using the [plan](README.md).
The [evidence inventory](evidence-audit.md) records existing observations; no row below implies
that every named layer or state has been executed.

- **R:** proposed feature-beta release set, also part of broader qualification.
- **B:** broader beta-maturity set. A critical finding here still blocks any release.
- **P0:** safety, identity, core task or data integrity. **P1:** supported completion/usability.
- Layers: **B** browser, **C** CLI, **A** API/integration, **P** real process/filesystem/container,
  **H** human/assistive technology, **L** separately authorized live external service.

The Gate column and the B browser layer are different concepts. Agree required configurations
before execution. Track individual subcases as Passed/Failed/Blocked/Not run/Not applicable;
do not roll a fake-provider pass and an unrun live case into one green family. A deliberate refusal
also needs a permitted positive control so that denying everything cannot satisfy the contract.

## Installation, identity and recovery — 10 families

| ID | Gate | Priority/layers | Exercise and required oracle |
| --- | --- | --- | --- |
| INS-01 | R | P0 B/C/P | Install the exact candidate artifact on clean Linux and complete browser setup from the docs. Check version/hash, bundled web, first Agent/answer and reload; no source-checkout dependency or pre-seeded-provider shortcut. |
| INS-02 | B | P1 C/P | Actual public Linux/macOS/Windows installers with explicit version, missing/old Node, PATH/new terminal and spaces/Unicode. Verify native failures fail installation; report turn limits before false expectations. Stage an unpublished artifact only in a declared controlled fixture. |
| INS-03 | R | P0 A/C/P | Fresh DB/auth pair, either half absent, mismatched credentials and competing startup. Mint only a genuinely fresh identity; preserve surviving state on refusal. |
| INS-04 | B | P1 C/P | Repeated serve/dashboard, occupied ports and shutdown. Verify one owner, meaningful error and no test-owned orphan process. |
| INS-05 | R | P0 A/C/P | Populated homes from v0.20.0 and every 0.21 beta into candidate, then second boot. Compare identity, encrypted secrets, transcripts, results/tombstones and policy/queue state. Source-sentinel passes alone do not close this case. |
| INS-06 | R | P0 A/C/P | v0.19 refusal, newer/unknown/corrupt schema, snapshot failure and interrupted migration. Preserve original identity/data and expose recovery guidance rather than replacing the home. |
| INS-07 | R | P0 A/B/C/P | Back up and restore a small populated candidate into a distinct offline home. Verify result hashes, source conversations, credentials and uncertainty; never enable egress implicitly. |
| INS-08 | B | P0 A/B/P | Backup during queue/command/approval/publication activity; restore while original exists. Restored state cannot kill original resources or replay uncertain external work. |
| INS-09 | B | P0 A/C/P | Wrong key, truncated/oversized archive, blob tampering, traversal, symlink/hardlink and existing destination. Refuse before damaging good state or writing outside the fixture. |
| INS-10 | B | P0 C/P | Reset/full uninstall, symlinked home and linked Team, dismissal and interruption. Remove only disclosed owned state and preserve external targets/ownership safety. |

## Authentication, gateway and setup — 8 families

| ID | Gate | Priority/layers | Exercise and required oracle |
| --- | --- | --- | --- |
| AUTH-01 | R | P0 A/B | Fresh browser authentication/provider/model setup and first Linux Agent turn. Default resources appear once; image-only configuration cannot satisfy text setup. No bootstrap bearer becomes a browser session cookie. |
| AUTH-02 | B | P0 A/B | Post-setup bootstrap refusal, invalid/expired/revoked device and bootstrap-row revocation. Admit only supported credentials and preserve local recovery identity without reflecting secrets. |
| AUTH-03 | R | P0 A/B/C | Scope subsets through API, proxy, server functions and UI, including image settings/Results. Permitted actions work; forbidden actions have no mutation or private-byte disclosure. |
| AUTH-04 | B | P0 A/B/C | Pairing-code expiry, replay, concurrent consumption and wrong origin. At most one valid exchange with exact scopes/expiry and no URL/log credential leak. |
| AUTH-05 | B | P0 A/B | Revoke/expire a session while editing, streaming, deciding or downloading. Future privileged actions stop; useful unsent input survives where promised without crossing session identity. |
| AUTH-06 | R | P0 A/B | CSRF/Origin/Host/CORS and injected markup/header cases. Deny at the intended boundary, while exact-origin authorized requests still work. |
| AUTH-07 | B | P0 B/P/L | Dedicated tailnet HTTPS gateway, preflight, real phone, off-tailnet/direct-port and unsupported exposure. Observe loopback listeners, bounded cookies and correct redirects/downloads. |
| AUTH-08 | B | P1 B/H | Missing/wrong credential, enabled provider without model and unavailable provider. Operator distinguishes saved/configured/usable and can recover without a silent model or billing fallback. |

## Conversations, streaming and attachments — 10 families

| ID | Gate | Priority/layers | Exercise and required oracle |
| --- | --- | --- | --- |
| CHAT-01 | R | P0 A/B/C | Text/tool/delta/final flow, reload and restart. One canonical input/answer; no doubled final text; exact conversation and JSONL source. |
| CHAT-02 | R | P0 A/B/P | Disconnect before response, mid-stream, during tool execution and after commit. Distinguish failure/uncertainty and avoid duplicate tools or fabricated completion. |
| CHAT-03 | R | P0 B/C/P | Cancel turn/command/question waiter versus pause queue. Affect only intended work; confirm cleanup or show a recovery block, not just a closed socket. |
| CHAT-04 | R | P1 A/B/C | 401/429/500, malformed stream, timeout and unknown model/provider. Respect each operation's retry contract; image requests never retry or switch credentials automatically. |
| CHAT-05 | B | P0 A/B | Picker/paste/drop attachments and lost submission ACK. Preserve exact bytes/name/identity once; distinguish vision input from stored-file notes. |
| CHAT-06 | B | P1 A/B | Limit boundaries, empty files, MIME mismatch, hostile names/markup and audio/video. Safe bounded handling; no unsupported native-media claim or active preview. |
| CHAT-07 | R | P0 A/B/C | Two tabs viewing/selecting/new/renamed conversations and stale send. Viewing history does not retarget input; exact creation retry cannot duplicate or reselect it. |
| CHAT-08 | B | P0 A/B/P | Missing/corrupt/symlinked/oversized/changing JSONL. Show unavailable history, not an invented empty conversation or silently chosen newer session. |
| CHAT-09 | B | P1 A/B | Context inspection/compaction/edit while busy or selection changes. Enforce the lease and captured selection; unavailable evidence cannot become success. |
| CHAT-10 | B | P1 C | One-shot message, pipe, cancel, non-interactive approval and exit/error behavior. No removed REPL or hanging interactive prompt; stderr remains credential-safe. |

## Queue, scheduler, questions and policy — 10 families

| ID | Gate | Priority/layers | Exercise and required oracle |
| --- | --- | --- | --- |
| FLOW-01 | B | P0 A/B/C | Queue edit/remove/attachment replacement and stale revisions. Preserve FIFO, exact bytes and attempted correction; claimed input is not editable. |
| FLOW-02 | R | P0 A/B/P | Commit admission then lose ACK, reload and exact retry. One receipt/counter increment/canonical input; changed body conflicts and fresh intent is distinguishable. |
| FLOW-03 | B | P0 A/B/C/P | Real loss with running queue head; restart, Attention, reconcile and resume. Uncertainty blocks followers; acknowledgment alone cannot imply the queue is draining. |
| FLOW-04 | B | P1 A/B/C | Agent/home queue caps and terminal expiry. Visible backpressure, no unresolved-input eviction or dedup loss that permits replay. |
| FLOW-05 | B | P0 A/B/C | Choice/Other/Skip, competing answers, lost ACK, expiry and worker loss. First accepted answer wins; recorded/consumed/unconfirmed remain distinct. |
| FLOW-06 | B | P0 A/B | Hold question delivery/answer for policy approval, then change policy/binding. Preserve deadline and recipient; information is not a shell or communication permission grant. |
| FLOW-07 | B | P0 A/B/C/P | Interval/cron occurrence with busy Agent, duplicate tick, restart and bounded failure retries. One durable dispatch owner/target and truthful terminal history. |
| FLOW-08 | B | P1 A/B | Clock skew, DST, timezone and quiet-hour boundaries. Document and verify occurrence semantics; clock simulation is separate from real-time soak. |
| FLOW-09 | R | P0 A/B/C | Allow/deny/held delivery and competing/stale approval after policy/member change. One revalidated dispatch; held image/file/log bytes stay private on every transport. |
| FLOW-10 | B | P1 A/B/H | Attention and notification sources, filters, acknowledgments and stale links. Open the exact actionable resource; reading a notice does not perform the guarded action. |

## Agents, Teams and management — 9 families

| ID | Gate | Priority/layers | Exercise and required oracle |
| --- | --- | --- | --- |
| MGMT-01 | B | P1 A/B/C | Agent lifecycle/model/reasoning changes and ambiguous names. Canonical identity and meaningful destructive consequences agree across surfaces. |
| MGMT-02 | B | P0 A/B/C/P | Team create/link/transfer/delete and path aliases. One membership/roster authority, preserved external files and original Result provenance. |
| MGMT-03 | B | P1 A/B/C | Profile document/model/skill changes and spawn before/after save. Intended defaults only; no accidental retroactive edit or lost dirty draft. |
| MGMT-04 | B | P0 A/B/C | Team-template stable slots/policy, instantiate and conflicting live edits. One effective revision with meaningful conflict handling, no detached roster. |
| MGMT-05 | B | P1 A/B/C/P | Skill install/remove and relative assets in host/Docker. Prompt-only contract, no ambient extension discovery, correct read-only skill mounts. |
| MGMT-06 | B | P0 A/B/C | Team memory read/write/search/delete, Agent transfer and stale edits. Shared ownership without cross-Team disclosure or discarded corrections. |
| MGMT-07 | B | P1 B/P | Missing/corrupt qmd index, path/encoding and unsupported platform. Preserve source notes; backend failure is not a healthy empty list. |
| MGMT-08 | B | P0 A/B/C | Reviewed-learning opt-in, approve/reject/revoke and stale proposal. No automatic application; correct private/shared ownership and current permissions. |
| MGMT-09 | R | P1 A/B/C | Provider/service/MCP save/test/remove, blank secret and failed response. Saved is not tested/entitled; preserve drafts, never echo secrets and never treat blank as implicit deletion. |

## Repository context and coding — 10 families

| ID | Gate | Priority/layers | Exercise and required oracle |
| --- | --- | --- | --- |
| CODE-01 | B | P0 A/B/C/P | Nested instructions, bounded reads and hostile paths/symlinks. Separate Agent/repository guidance; refuse unsafe/incomplete context without weaker fallback. |
| CODE-02 | B | P0 A/B/P | Hostile Git config/helpers/hooks and changing metadata. Hardened frozen inspection neither mutates the repository nor executes its helpers. |
| CODE-03 | R | P1 A/B/P | Basic coding, offline preparation and missing tools alongside image-enabled turns. Bounded actual commands; truthful prerequisite failures, no posture/network fallback. |
| CODE-04 | B | P0 A/B/P | Real Docker workspace/memory/input/skill mounts, environment, root/tmp and network. Independently observe containment; do not infer it from a receipt alone. |
| CODE-05 | B | P0 A/P | Missing image/engine, bad context, declared volumes and late container creation. Fail closed and retain cleanup ownership before another writer starts. |
| CODE-06 | B | P0 A/B/C/P | Interactive dangerous-command decision versus unattended/protected/restricted turn. Exact shell approval or denial; communication approval cannot grant shell authority. |
| CODE-07 | B | P0 A/B/P | Shared/aliased/overlapping roots, two Agents and peer handoff. One writer; sender yields; uncertain cleanup stays blocked rather than deadlocking or racing. |
| CODE-08 | B | P0 A/B/P | Nonzero/zero exit, timeout/cancel, worker loss, refusal and output flood. Bounded diagnostics and executor facts, never fabricated success. |
| CODE-09 | B | P0 A/B/C | Split/rotated secrets, held logs and authorized peer reads. Live redaction and source-owned egress; private output reads as not shared, not empty. |
| CODE-10 | B | P1 A/B/C | Log TTL/eviction/truncation/pagination and expired evidence. Stored truncation flag is authoritative; missing evidence does not become current verification. |

## Review, verification and code-host publication — 10 families

| ID | Gate | Priority/layers | Exercise and required oracle |
| --- | --- | --- | --- |
| REV-01 | B | P1 A/B/C/P | Added/deleted/renamed/binary/large/untracked paths. Correct baseline, selection and explicit scope refusals without credential-shaped content capture. |
| REV-02 | B | P0 A/B | Complete/incomplete snapshots, recapture, drift and expiry. Identity includes completeness; identical/changed/unknown and not checked are not pass badges. |
| REV-03 | B | P0 A/B/C | Packet/reviewer/findings/conclusion/resolution. File-level captured identity and stale-content refusal; unverified findings cannot be falsely resolved. |
| REV-04 | R | P0 A/P | Restricted review/packet-review/verification attempts image, shell, browser, MCP, messaging or result expansion. Closed spawn and daemon capabilities; legitimate specialist work still succeeds. |
| REV-05 | B | P0 A/B/C/P | Captured specialist commands/environment, membership/self-verification and source drift. Immutable contract, no refused rows and no silent recapture/substitution. |
| REV-06 | B | P0 A/B/P | Real container verification, nonzero/blocked/skipped/mutating checks and rerun. Per-attempt receipt facts; completed is not passed and rerun preserves history. |
| REV-07 | B | P0 A/B/C | Pending/held/running cancellation, dismiss/confirm/double click/lost ACK. Zero pre-confirm mutation, one accepted cancellation and accurate cleanup/history. |
| REV-08 | B | P1 A/B/C | Evidence export/preview/source links after conversation changes/deletion. Exact old source or unavailable state; no newer-content substitution. |
| REV-09 | B | P0 A/B/C/P | Operator publication to local bare repo, configured remote and branch conflict. Exact captured bytes, unsigned commit, no force push/model publishing/merge/deploy. |
| REV-10 | B | P0 A/P/L | Push/PR accepted then lost ACK and approved real-host sample. Independent remote evidence, uncertain state with no automatic replay or credential exposure. |

## Results and existing integrations — 10 families

| ID | Gate | Priority/layers | Exercise and required oracle |
| --- | --- | --- | --- |
| INT-01 | R | P0 A/B/C | Captured file then source mutation/deletion, hold/release, reload/restart. Released bytes/hash stay immutable; private results are not readable before authorization. |
| INT-02 | R | P0 A/B/C/P | Result caps, transfer/deletion, tombstones and restore. Count private holds, retain original provenance and prevent resurrection; no outside-target deletion. |
| INT-03 | R | P0 A/B | Image signature/MIME, HTML/SVG/script, names and content disposition. Inert bounded previews, exact downloads and safe private/deleted/missing/tampered refusal. |
| INT-04 | B | P0 A/B/L | Telegram owner/topic identity, duplicate update, rebind and failed attachment. No cross-Agent routing, partial accepted input or turn replay. |
| INT-05 | B | P0 A/B/L | Telegram 429/rejection/ambiguous send and notification changes mid-flight. Honest delivery receipt, no automatic uncertain resend or recursive notification loop. |
| INT-06 | B | P1 A/B/L | Telegram questions/stale callbacks and mirrored captured files. Correct conversation/topic/expiry, one answer and authorized exact bytes. |
| INT-07 | B | P0 A/P | Browser/web_fetch redirects, rebinding/private IP and active pages. Enforce actual transport boundaries; protected fetch remains uncredentialed. |
| INT-08 | B | P1 A/P | Browser tab/context caps, screenshots, worker end and idle reap. Intended persistence only; no cross-Agent state or unbounded child processes. |
| INT-09 | B | P0 A/P/L | MCP transports, schema/namespacing, auth rotation and connection failure. Correct server identity; failures not disguised as zero tools; no restricted fallback. |
| INT-10 | B | P1 A/B/L | Approved chat-provider API/OAuth/local text/tool/attachment/question/review samples. Actual tool facts and credential isolation; report every attempt, not just demos. Image selections are qualified separately below. |

## Image generation — 14 families

| ID | Gate | Priority/layers | Exercise and required oracle |
| --- | --- | --- | --- |
| IMG-01 | R | P0 A/B/C | Default off, effective environment override, on/off between turns and image-only setup. No request while effectively disabled; text-provider enablement alone does not opt in. UI/CLI explain effective settings. |
| IMG-02 | R | P0 A/B/C | Automatic with keys only, neither/one/both text providers enabled, OpenAI/Codex/other Agents and disabled own provider. Resolve exactly by the documented matrix, not by available credentials or guessed billing preference. |
| IMG-03 | R | P0 A/B/C | Four explicit overrides, missing/expired credentials, quota/error and config change during refresh/in flight. Correct fixed credential destination; no fallback/replay. Persist concrete route, not auto; label selection without backend attestation. |
| IMG-04 | R | P0 A/C | Prompt/name boundaries, Windows-reserved names and injected path/model/endpoint/count parameters. Closed source-matched input; reject unsupported values before any provider side effect. |
| IMG-05 | R | P0 A/P | Forged session/tool/Agent/Team/turn identity, stale ownership and restricted host/input injection. Only admitted normal/protected tool calls can reach the bound daemon host; canonical transcript arguments agree. |
| IMG-06 | R | P0 A/P | One in-flight/home, four admissions/turn, cancellation/deadline and ignored/late refresh. Bound local dispatch; persist intent before sending; cancellation does not imply refund or remote non-execution. Uncertainty blocks fresh IDs for that turn. |
| IMG-07 | R | P0 A/P | Raw response/image count/file limits, invalid base64/signatures, returned URLs, partial/malformed/duplicate Codex SSE and final refusal. No URL fetch, oversize capture, secret echo or false completion; valid terminal responses still work. |
| IMG-08 | R | P1 A/B/C/P | Caption + generation → preview/download → requested rework → reload/restart. Retain distinct authorized Results and original hashes; exact downloads and no CLI overwrite. Rework is new generation, not an edit/consistency guarantee. |
| IMG-09 | R | P0 A/B/C | Allowed/denied/held image disclosure, approval changes, peer/HTTP/Telegram/background boundaries. Private bytes never escape via inline tool/history content or alternate download; successful authorized delivery uses the shared authorizer. |
| IMG-10 | R | P0 A/P | Actual daemon kill before provider ACK and after capture before worker ACK, then reboot. No resend; uncertain admission refuses retry. Explicitly observe the current private-byte tombstone/loss window, separately from released-image survival. Test passing does not waive that limitation. |
| IMG-11 | R | P0 A/B/C/P | Atomic capture failure, storage quota, backup/restore, source transfer/deletion and tombstoned outputs. No partial successful capture or regenerated/deleted output; preserved authorized bytes/route/provenance where retained. |
| IMG-12 | R | P0 A/P | Real configured-operator Docker and separately a real protected origin, with image generation and a container probe. Actual container/credential/resource facts, correct IPC binding and egress. Record the two postures separately; one cannot pass for the other. |
| IMG-13 | R | P0 A/B/L | Authorized live sample of each of the four selections, plus live browser rework/restart journey. Record account class, requested route/model, actual protocol result, usage/cost uncertainty, latency and file hashes. No automatic retries/fallback; unknown entitlement is not Ready proof. |
| IMG-14 | R | P1 B/C/H | Missing login/key, ambiguous Automatic, provider refusal, held output, cancellation and lost private capture. User can find the next safe action and explain possible charges, new-generation cost and limits without being promised a refund or recoverable image. |

## UX, accessibility and truthful state — 10 families

| ID | Gate | Priority/layers | Exercise and required oracle |
| --- | --- | --- | --- |
| UX-01 | R | P0 A/B | Loader error → daemon restored → offered Retry, named/generic routes. A new request recovers exact URL/resource/content; resetting a boundary alone is not proof. |
| UX-02 | R | P0 A/B | Mutation fails before send, after commit/lost ACK and on refresh. Visible truthful outcome and preserved input; no unhandled-only error, false unchanged claim or blind duplicate write. |
| UX-03 | B | P1 A/B | Empty/pending/populated/partial/stale/4xx/5xx/unavailable across routes and child panels. Correct state and next action; busy settles and outage is not empty success. |
| UX-04 | R | P0 A/B/H | Destructive dialogs via pointer/keyboard, dismiss/Escape/confirm/error and disappearing row. Exact consequences, zero mutation on dismissal, one confirmed effect and sensible focus. |
| UX-05 | B | P1 B/H | Dirty editor tabs/routes/back/reload and failed save. Explicit save/discard/cancel and conflict handling; no silent loss or stale guard after success. |
| UX-06 | R | P1 B/H | Image/core controls at wide/narrow sizes, zoom, software keyboard and themes; expand to engines/real devices for B. Reachable actions and readable labels without page-wide overflow; state the devices actually tested. |
| UX-07 | R | P1 B/H | Keyboard and accessible names/status for image/core tasks; scanner, dialogs and assistive-technology runs as declared subcases. No focus trap, missing action label or token-by-token announcement flood; do not infer full accessibility. |
| UX-08 | B | P1 B/H | Contrast, reduced motion, target size, 200% text, 400% zoom and focus obscuring. Applicable WCAG 2.2 A/AA checks with explicit exceptions, not a scanner certificate. |
| UX-09 | B | P1 H | Independent users perform realistic tasks and explain held/uncertain/completed/published states. Record unaided versus assisted outcomes and safety misunderstandings. |
| UX-10 | R | P1 B/C/H | Follow candidate guide/help literally, including Linux turns, image credentials/cost, persistence and recovery limits. No unshipped social/native/REPL promise or unsupported release-version claim. |

## Performance, packaging and harness reliability — 9 families

| ID | Gate | Priority/layers | Exercise and required oracle |
| --- | --- | --- | --- |
| OPS-01 | B | P1 A/B/P | Warm/cold F1/F2 and exploratory F3 history/context/review/result loading. Declared hardware and percentile samples; bounded behavior rather than assumed capacity. |
| OPS-02 | B | P1 B/P | Long streams/output floods during typing/scrolling. Preserve user scroll intent and exact text; measure responsiveness and long tasks. |
| OPS-03 | B | P0 A/P | Real isolated-volume ENOSPC for DB/JSONL/upload/backup/migration, permission failure separately. Honest failed/uncertain admission, no corrupted replacement or false durable-success claim. |
| OPS-04 | B | P0 A/P | Independent-Agent concurrency and shared-workspace trigger/queue/approval contention. Single valid owners, bounded backpressure and no duplicate external effects or deadlock. |
| OPS-05 | B | P1 A/P | Two-hour smoke then 24/72-hour mixed soak with restart/checkpoint/read activity. Resource time series, settled claims, integrity and explained growth; not before/after RSS alone. |
| OPS-06 | B | P0 A/P | TTL/quiet-hour/expiry/dedup capacity boundaries under controlled clocks. No unauthorized release/replay; logical reclaim and physical WAL/free pages measured separately. |
| OPS-07 | R | P1 C/P | Final versioned tarballs/assets/shim on supported CI platforms, optional binaries missing. Exact target versions/hash and actionable optional dependency errors; no reliance on checkout packages. |
| OPS-08 | R | P0 A/B/P | Negative controls for removed guard, wrong route, duplicate side effect and required skipped case. Harness must fail; manifest removal is reviewed and absent dependencies cannot appear green. |
| OPS-09 | R | P1 A/B/P | Repeat/shuffle/parallel runs and failed-fixture cleanup. Preserve first failure, reproducible seed and only test-owned cleanup; do not rerun indefinitely for a green report. |

## Composed content-Team journey (B)

[BAZ-063's acceptance protocol](content-team-acceptance.md) is the required composition of the
existing families, not another batch of independent family counts. Its 18 CT subcases cover the
first-request brief, two independently selected topics, real multi-Agent research, cron-driven
preparation, text/images, two feedback rounds and approved manual handoff. BAZ-064 owns the recipe/D
cells, BAZ-065 the scheduler/recovery D/S cells and BAZ-066 all required L/H cells; BAZ-063 consolidates
acceptance. The first test is Mastodon manual handoff only; other platform formats are deferred.
Six PUB subcases remain conditional on BAZ-060 and a supported, authorized adapter; a Mastodon
adapter needs separate refinement, while BAZ-061/062 concern Meta/LinkedIn. All remain unrun as
composed cases; the protocol assigns every required core case/lane.

Reuse FLOW-07/08/09 for scheduler and policy; MGMT-04/06 for canonical Team context; IMG-01–14 and
INT-01/02/03 for generation and saved bytes; INT-07/09 for research boundaries; UX-06/07/09/10 for
human operation. Require two actual scheduler occurrences, not manually prompted equivalents. Missing
protected research, per-trigger timezone or publisher capability is not silently supplied by the test.
The full protocol does not add those features to the frozen R candidate.

## Surface coverage

For affected R surfaces and all B surfaces, enumerate current routes and child panels from source;
do not rely on an old route count. Assert final URL, resource identity and meaningful state for both
SPA navigation and direct reload. Exercise empty/pending/populated/error/stale states where applicable.

| Surface group | Required interactions |
| --- | --- |
| Root/login/welcome/config | Authentication, text setup, image opt-in/Automatic/manual choice, OAuth readiness, credential clearing and effective environment overrides |
| Chat/conversation/queue/questions | Composer, history selection, streaming, exact retry, cancel, questions, shell approval and persisted image/file cards |
| Agents/inbox/learning/triggers | Lifecycle, model/skills/Team, messages, reviewed learning, schedule/history and interruption sources |
| Teams/context/members/policy/memory/activity | Link/ownership, USER.md, context, roster/policy conflicts, dirty memory and source history |
| Review/verifications/publication | Capture, findings, conclusions, attempt facts, dismissal/cancellation, exact publication target and uncertainty |
| Results/library/detail | Original provenance/route, preview/download, private/unavailable/deleted states, cap and deletion consequences |
| Profiles/Team templates/skills | Template versus live-resource changes, stable slots, instantiation, install/remove and dirty navigation |
| Approvals/Attention/integrations/tokens | Exact held recipient/payload, stale decisions, recovery links, device scopes/revocation and safe external setup |

Use long/duplicate names, Unicode/RTL content, hostile markup, unusual paths, many items and missing
resources. These are fixtures, not requests to add localization or new product features.

## Barrier-based protocols

### 1. Installed-artifact onboarding

Start F0 without DB/auth or seeded provider. Install the exact candidate artifact; follow the guide
through browser authentication and text setup, then send one unique marker. Assert default resources,
selected conversation, one canonical input/answer and persistence after reload/restart. Repeat rejected
credential/no-model setup. Report public installer/provisioning separately if not actually executed.

### 2. Lost queue acknowledgement

Use an independent tool-side counter. Capture request ID, selection, digest and attachment hash;
commit admission then drop only the ACK at a controlled proxy. Reload and exact-retry that request.
Require one receipt/execution/input and original bytes. Changed-body retry conflicts; new intent is
not confused with retry. Repeat around claimed/finished transitions without manufacturing new IDs.

### 3. Confirmation and failed refresh

Create a valid cancellable resource. Observe endpoint/state, open the dialog and dismiss by button
and Escape: zero calls. Reopen by keyboard, confirm/double-activate: one mutation. Repeat stale target,
pre-send rejection and commit followed by failed refresh. Compare copy with state and actual cleanup;
“nothing changed” is forbidden when a mutation committed. Check focus after the row disappears.

### 4. Populated offline restore

Populate real conversations, secrets/config, approved and held Results, tombstones, linked Team files
and controlled active work. Back up; isolate original egress; restore to a different home/endpoint with
outbound destinations blocked. Verify data/hash/source links and no original-resource kill or external
counter increment. Inspect uncertain work before any separately requested new execution.

### 5. Loader recovery

Open a known populated route, withhold then fail the web-to-daemon loader boundary during navigation.
Restore it; keyboard-activate Retry. Observe a new request plus correct URL/resource/content, not just
a heading. Repeat generic/named boundaries, auth expiry and child-panel failure. Browser interception
alone does not control SSR fetches; inject the actual boundary in a test-owned fixture.

### 6. Docker ownership after daemon loss

Start a real fixture command; register exact container/workspace identity before the test barrier.
SIGKILL before start ACK, after start and after exit before settlement as separate cases. Observe
actual resources and reboot the same home. A second writer remains blocked until cleanup is confirmed,
including late materialization. Repeat host process-group cleanup separately. Never kill by a broad
name filter or infer termination solely from daemon restart.

### 7. Image dispatch and capture uncertainty

Use the existing crash fixture's independent provider counter and actual worker/daemon. First withhold
the provider response after it receives the request, kill the daemon, reboot and check uncertain intent,
zero resend and refused exact readmission. Separately withhold the worker reply after atomic capture:
verify committed private bytes before boot, then the current cleanup tombstone and denied read after
boot. This observes potential paid-output loss, not recoverable delivery. Check already-authorized
images separately. Live-provider interruption is a separately authorized experiment, never inferred.

### 8. Authorized live image journey

Record account/route, attempt and spend/usage authorization and pause/isolate unrelated background
work. Configure a supported text Agent and one explicit image selection; capture local readiness but
do not treat it as entitlement. Request one bounded image. Check transport result, requested selection,
usage/cost uncertainty and authorized saved bytes; record every refusal/failure without fallback.
Repeat for the other three selections. In the browser, request an approved rework, inspect both saved
versions, restart and download both by their original IDs/hashes. Compare labels/history and disclosure.
Verify Automatic selection independently without using provider errors to trigger a route switch.

## Live model evaluation

Record provider/requested model, actual origin/posture, prompt/tool arguments, receipts and all attempts.
Judge useful behavior against executor facts, not exact prose: appropriate tools, finite actions,
recognized missing prerequisites, honest uncertainty and denied disclosure, no invented success,
refund, backend attestation or publication. Record quality/latency separately from protocol correctness.
A safety failure cannot be averaged away by otherwise good images or answers.
