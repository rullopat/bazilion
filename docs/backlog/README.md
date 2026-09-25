# Bazilion — Product Backlog

Backlog items live in this directory, one file per item, organised by state.

```
docs/backlog/
├── draft/        ← needs more definition / open questions / explicitly deferred
├── todo/         ← refined, ready to pull into a sprint
├── in_progress/  ← actively being worked on right now
└── done/         ← shipped, kept as a historical record
```

## Conventions

- **Naming:** `BAZ-NNN-short-slug.md` (sequential at creation time so codes don't shift when priority changes).
- **Frontmatter** (every file): `id`, `title`, `status`, `size`, `created`, optional `refined` / `shipped` / `priority` / `deferred` / `deferred_reason` / `note`.
- **Body shape:** User stories (As a / I want / So that) → Goal → Why → Scope → Out of scope → Tests. Open items add Open Questions; shipped items add an As-built block.
- **Sizes** (solo-dev pace): XS ≈ afternoon, S ≈ 1–2 days, M ≈ ~1 week, L ≈ 1–2 weeks, XL > 2 weeks → split into multiple BAZs.
- **State transitions:** to move an item, `git mv` it between dirs and update the `status:` field in frontmatter.

## State definitions

- **Draft** — captured but not committed-to. Has open questions, missing acceptance criteria, or no forcing function. Don't start work without resolving the open questions.
- **Todo** — refined and ready. User stories + scope are clear; pulling it into a sprint is a yes/no decision, not a "let's first figure out what this means" decision.
- **In Progress** — actively being worked on right now. Move here from `todo/` when implementation starts, so it's clear what's in flight. There's no enforced limit — solo-dev pace usually keeps this folder at 0–1 items, but a refactor with multiple side BAZs in parallel is fine. Move to `done/` when shipped.
- **Done** — shipped. The file becomes part of the project's release history; the `As-built` block records what actually happened (vs. what was planned).

---

## Draft (8)

| ID | Title | Size | Notes |
|----|-------|------|-------|
| [BAZ-048](draft/BAZ-048-storage-refinements-post-1.0.md) | Storage refinements from the OpenClaw/Hermes comparison (post-1.0) | L (likely split) | Menu, not commitment: FTS over conversations, cold `jsonl.zst` archives, per-agent data-plane split, bounded-memory injection, upgrade preflight. Graduates only on a concrete trigger. [Findings](design/storage-comparison-openclaw-hermes.md) |
| [BAZ-054](draft/BAZ-054-native-ios-android-apps.md) | Native iOS and Android apps (post-1.0) | XL — split before refinement | Deferred to post-1.0 (operator decision). Successor to the removed Expo app over the existing gateway/device-credential model. Push-notification architecture is the gating open question; held as a design-constraint holder meanwhile. |
| [BAZ-057](draft/BAZ-057-portable-safe-reads.md) | Portable safe reads — repository context off-Linux | L (likely split) | Split out of BAZ-049 refinement. The coding sequence is Linux-only by design (`safe_reads_unavailable`); `install.ps1` exists, so Windows operators hit this wall. Holder with the security constraints written down; graduates on a real trigger. |
| [BAZ-058](draft/BAZ-058-content-proposals-and-editorial-review.md) | Content proposals with revision-bound editorial review | L | Durable variants, human rework, preview and manual export; not communication approval or code review. |
| [BAZ-060](draft/BAZ-060-approved-social-delivery.md) | Deterministic delivery of approved social posts | L | Exact revision/account/schedule, credential isolation, per-target receipts and uncertainty; no Agent publishing tool. |
| [BAZ-061](draft/BAZ-061-meta-page-and-instagram-publishing.md) | Facebook Page and Instagram photo connectors | L | Official APIs, actual grants and approved-asset staging without exposing Bazilion; split if refinement exceeds L. |
| [BAZ-062](draft/BAZ-062-linkedin-publishing.md) | LinkedIn text and image connector | M | Granted member/org authors, official Posts API, write/read capability distinction. |
| [BAZ-063](draft/BAZ-063-content-team-real-world-acceptance.md) | Scheduled content Team — parent acceptance checklist | S | Consolidation/review only; broader-beta core evidence from BAZ-064/065/066. Topic is an input. [Protocol and ownership](../testing/beta-readiness/content-team-acceptance.md). |
| [BAZ-066](draft/BAZ-066-content-team-live-and-human-acceptance.md) | Content Team live and independent-user acceptance | S | 0.23.0 (moved from a withdrawn 0.22 gate) | Authorized live core and independent human evidence on BAZ-064/065; two selected topics. Estimate excludes access/recruitment waits and product fixes. |
| [BAZ-069](draft/BAZ-069-browser-backed-default-web-search.md) | Browser-backed web search by default for ordinary turns | M | 0.23.0 (first implementation story of the next release) | Operator decision 2026-09-21: defaults must just work; search rides the existing browser pool (real Chromium, the OpenClaw approach). SearXNG/Brave stay opt-ins; BAZ-067 repositioned as the opt-in protected-turn backend. Next implementation story. |
| [BAZ-068](draft/BAZ-068-workspace-recovery-surface.md) | Operator recovery for workspace rows after failed turns | S | Harness finding: failed turns leave a Team `recovery`-blocked with no supported surface. Security-adjacent; refine with review. [Evidence](BAZ-064-acceptance.md). |


BAZ-058–067 capture the content capabilities, split acceptance work and discovered prerequisites. See the
[capability audit, platform research and implementation sequence](design/social-content-team.md).
BAZ-059 is the scoped **0.22.0** image-generation story below. BAZ-064 has started with an
experimental recipe and management/policy checks; BAZ-067 (done) unblocked its protected
discovery cells. The other items remain drafts. BAZ-063 consolidates BAZ-064/065/066 rather than implementing the whole
journey. Their generic-topic core acceptance is required for broader beta maturity, with manual
handoff and a reusable Team recipe; it is not added feature scope for frozen 0.22. Native
social connectors and direct publication remain conditional later scope, not prerequisites for the
manual journey or this limited image release. The [first-platform decision](design/content-platform-first-test.md)
selects Mastodon for manual handoff; its future direct adapter would need separate refinement, not
BAZ-061/062 evidence. No composed acceptance or beta.5 support is claimed.

The original coding stories were drafted on 2026-09-07 from the OpenClaw 2.0 / Hermes desktop
review. BAZ-034 through BAZ-038 shipped in v0.15.0 through PRs #44 and #45; their decisions and
acceptance evidence remain in [the milestone progress log](BAZ-035-038-progress.md). Desktop
packaging and Team conversation views remain later ideas rather than part of this coding sequence.

Coding stories BAZ-039 through BAZ-044 were reviewed on 2026-09-09 after the Agent-led
BAZ-039/040 remake. The remake shipped in v0.16.0 through PR #46 and version PR #47. See
[acceptance](BAZ-039-040-agent-led-acceptance.md) and the
[successor-story review](design/coding-successors-review.md).

BAZ-041 and BAZ-042 shipped in **v0.17.0** on 2026-09-16. They were paired in one release because they
share the receipt and snapshot evidence model: 042 attaches source identity to the receipts 041 makes
observable, and a two-release split would need two clean-install schema revisions for one feature area.

BAZ-045 and BAZ-046 shipped in **v0.20.0** on 2026-09-16. BAZ-046 adds the publication step the rest of the
sequence was building towards — an operator decision, with no model in the path at all — and BAZ-045 closes
the boundary claims that were asserted but never observed in the configuration where they are claimed. The
same release fixed a pre-existing BAZ-043 defect found by building on top of it: a recorded conclusion left
the packet `open` while the report's own facts said it was reviewed.

BAZ-043 shipped in **v0.19.0** on 2026-09-16, completing the coding sequence. The v0.19.0 work also closed
three gaps in BAZ-044: a container check now runs with the posture its receipt claims, declared output paths
are *checked* rather than trusted, and a coding Agent can ask for verification at all — which is what makes
the result delivery reachable in production. BAZ-044 added
finite, snapshot-bound tester capability; BAZ-043 adds read-only reviewer capability and handoff
evidence. Neither adds basic delegation, which BAZ-040 already provides. There is no mandatory
tester-to-reviewer-to-deployer pipeline.

Managed parallel checkouts and controlled deployment were removed from this backlog sequence.
Writer coordination already exists; checkout lifecycle and deployment integration can be proposed
later from a concrete use case. Automatic Git publication, managed services/previews and ambient Pi
extension loading remain separate, uncommitted scope.

## Todo (0)

Nothing is waiting in Todo. BAZ-067 (previously the only Todo item) is done; its merge still
coordinates with the BAZ-059 release because it touches the frozen fingerprint.

The 0.21 hardening ladder is complete; the operator requested an image-capable **0.22.0**
feature checkpoint before considering 1.0. **Retargeted 2026-09-21:** 0.22.0 ships **as-is** —
no beta tag, **alpha maturity**, current frozen scope only. The earlier 0.22.0-beta.1 plan was
dropped as premature, and the same-day "release on defaults" gate was withdrawn: the
browser-backed default search ([BAZ-069](draft/BAZ-069-browser-backed-default-web-search.md)) and
the live/human content-Team acceptance (BAZ-066) target the **next release (0.23.0)**. The
[beta readiness campaign](../testing/beta-readiness/README.md) continues as the pre-1.0
qualification campaign rather than a release gate.
Neither this plan nor a target version is completed acceptance or authorization to publish now;
a 1.0.0-beta.1 release remains an explicit operator decision.

## Todo (0.23.0 slate)

| ID | Title | Size | Notes |
|----|-------|------|-------|
| [BAZ-069](todo/BAZ-069-browser-backed-default-web-search.md) | Browser-backed web search by default for ordinary turns | M | Refined 2026-09-23/24 with a live detection matrix + an OpenClaw transcript cross-check: Bing + Brave Search HTML pass headless (no marker tampering); Google is IP-reputation-dependent (works on the operator's unflagged macOS network, walls the flagged Linux IP even headed + human pass). All backends move daemon-side (env asymmetry resolved). Tests 1–6 in the story. |

### 0.23.0 plan (operator decision 2026-09-23)

0.22.0 published 2026-09-23; work moves to the `0.23.0` branch with this ordered slate. Live
spend (BAZ-059 samples, BAZ-066 access) still requires explicit authorization and limits at the
time each lane runs.

1. **BAZ-059 — live image qualification** (top story): an authorized, spending-bounded real
   call per advertised route/model, with recorded provider/model, output, usage and human
   inspection (test 9). No mock-only claim of live support.
2. **BAZ-069 — browser-backed default web search** (M): `web_search` via the existing daemon
   browser pool; SearXNG/Brave API become explicit opt-ins; protected turns unchanged.
   **Refined 2026-09-23 → Todo** with the detection probe recorded (plain headless passes
   Bing + Brave Search HTML; Google/DDG wall; no marker tampering).
3. **BAZ-066 — live and independent-user content-Team acceptance** (S): after BAZ-069, on the
   defaults. Needs Mastodon access and spend limits. Supplies BAZ-063 evidence and closes out
   BAZ-064's remaining composed-journey evidence.
4. **BAZ-068 — workspace recovery surface** (S): supported operator path out of
   `workspace_recovery_required`; observably-dead workers confirmable, live ones stay blocked.
   Refine with review before Todo.
5. **BAZ-065 — remaining lanes**: approval-hold across real cron cycles, restricted-tool
   negative at the scheduled level, DST on controlled clocks.

Deliberately out: BAZ-058/060 (L stories, 0.24.0 candidates), BAZ-061/062 (depend on BAZ-060),
post-1.0 holders (BAZ-048/054/057). Open question carried from the release review: the 14
pre-existing lint errors get cleaned up or formally waived during this cycle.

## In Progress (4)

| ID | Title | Size | Target | Notes |
|----|-------|------|--------|-------|
| [BAZ-059](in_progress/BAZ-059-pi-image-generation.md) | Image generation with explicit OpenAI, ChatGPT and OpenRouter routes | L | 0.22.0 shipped; live qualification is the 0.23.0 top story | Published in 0.22.0 (2026-09-23). Remaining lane: authorized live sample per advertised route/model (test 9). [Evidence](../testing/0.22.0-freeze.md) · [Usage](../image-generation.md). |
| [BAZ-064](in_progress/BAZ-064-content-team-recipe-and-manual-handoff.md) | Topic-neutral content Team recipe and manual handoff | M | Close-out rides BAZ-066 (0.23.0) | Canned-model plumbing done (delegation, protected wake, approval sequencing, image-once oracle, handoff, two-topic reuse, restart retention). Remaining composed-journey evidence comes from BAZ-066's live run. [Evidence](BAZ-064-acceptance.md) · [Recipe](../../examples/content-team/README.md). |
| [BAZ-065](in_progress/BAZ-065-content-team-scheduling-and-recovery.md) | Content Team scheduling and recovery acceptance | M | 0.23.0 (remaining lanes) | Real cron cycles, busy/deferred exactly-once, restart/missed-minute semantics, lifecycle, bounded retries, UTC contract, scheduled container posture. Remaining: approval-hold across real cycles, restricted-tool negative, DST clocks. |
| [BAZ-067](done/BAZ-067-protected-web-discovery.md) | Bounded public-web discovery for protected Agent turns | M | 0.22.0 (alpha) | Done (2026-09-21): SearXNG via daemon-owned IPC host; worker sees only bounded results; restricted workers denied. Accepted and repositioned as the opt-in protected-turn backend; the default search story is BAZ-069. |

## Done (49)

| ID | Title | Size | Shipped | Release | Notes |
|----|-------|------|---------|---------|-------|
| [BAZ-050](done/BAZ-050-post-coding-sequence-ui-consistency-sweep.md) | UI/UX consistency sweep of the post-hardening coding surfaces | L | 2026-09-18 | v0.21.0-beta.5 | Router-level default error+pending components (every route degrades well); surface-named error components on 18 coding routes; cancel-verification confirmed; apps/web typecheck added to CI (it was excluded — a type error sat in main); browser-acceptance walk with a real daemon-kill error-state pass (85 evidence files). |
| [BAZ-052](done/BAZ-052-beta-supportability-gates-and-growth.md) | Beta supportability — security gate in CI, growth documentation | S | 2026-09-18 | v0.21.0-beta.4 | 153-case adversarial security gate now runs on every PR (fails closed on a deleted case). New growth-and-retention operator doc: bounded coding evidence (7-day TTLs, 256 MB budget), unbounded messages/sessions (the record), pre-migration snapshot hygiene, `logs/` documented as intentionally empty. Log rotation dropped — stale premise (the daemon writes no log files). |
| [BAZ-051](done/BAZ-051-failure-mode-visibility-audit.md) | Failure-mode visibility audit — every recovery is seen or surfaced | M | 2026-09-18 | v0.21.0-beta.3 | Two silent failures fixed: the post-crash queue stall (new `queue_interrupted` attention kind) and opaque OAuth refresh errors. Six failure modes pinned by deterministic injection tests asserting the observed surface. Build race (web ∥ CLI vite on one dist) fixed en route. |
| [BAZ-049](done/BAZ-049-cross-platform-ci-and-installer-e2e.md) | Cross-platform CI matrix and fresh-machine installer E2E | M (ran longer) | 2026-09-18 | — | 3-OS test matrix + hermetic installer E2E, all green at merge (PR #61). Caught six real product defects incl. Windows breaking every conversation write (dir-fsync) and `pnpm pack` shipping an empty tarball from Windows (build filters matched nothing). Workspace-claim identity portable; turns stay Linux-only until BAZ-057 (content-read portability); off-Linux refusal is a structured 422 naming `safe_reads_unavailable`. |
| [BAZ-056](done/BAZ-056-remove-cli-chat-repl.md) | Remove the interactive chat REPL from the CLI; one-shot chat stays | S | 2026-09-17 | [v0.21.0-beta.1](https://github.com/rullopat/bazilion/releases/tag/v0.21.0-beta.1) | Operator decision: the bare readline REPL in `agent chat` was not worth completing; 1.0 keeps one-shot chat + dedicated commands + web. Piped stdin scripting kept (fail-closed `auto_deny`). PR #56. |
| [BAZ-055](done/BAZ-055-scoped-device-credentials-and-pairing.md) | Scoped device credentials and one-paste pairing (OpenClaw's authz model, adapted) | L (M + S + S) | 2026-09-17 | [v0.21.0-beta.1](https://github.com/rullopat/bazilion/releases/tag/v0.21.0-beta.1) | Per-device scopes (`read/write/approvals/admin`) with fixture-generated route tests; `0002` scopes migration (first live exercise of the BAZ-047 contract); backup validator moved onto the canonical chain; `bazilion-pair://` single-use setup codes; Hermes-style auth-posture probe. PRs #57, #58. |
| [BAZ-053](done/BAZ-053-remove-expo-mobile-app.md) | Remove the Expo mobile app; mobile story becomes responsive web | S | 2026-09-17 | [v0.21.0-beta.1](https://github.com/rullopat/bazilion/releases/tag/v0.21.0-beta.1) | The thin Expo app (v0.0.0, 4 screens) removed; mobile = responsive web over the private gateway + device credentials — the auth path BAZ-054's native apps will use. PR #55. |
| [BAZ-047](done/BAZ-047-stable-schema-contract.md) | Stable schema contract and in-place upgrades for beta | L (1-2 weeks) | 2026-09-17 | [v0.21.0-beta.1](https://github.com/rullopat/bazilion/releases/tag/v0.21.0-beta.1) | Forward-only prefix migrations with receipts, `PRAGMA user_version` refuse-newer, `VACUUM INTO` pre-upgrade snapshots, CI release-upgrade matrix verified against real prior releases (v0.20.0 upgrades, v0.19.0 refused). PR #54. |
| [BAZ-046](done/BAZ-046-publish-accepted-change.md) | Publish an accepted change to a code host | L | 2026-09-16 | [v0.20.0](https://github.com/rullopat/bazilion/releases/tag/v0.20.0) | An operator decision with no model in the path: the daemon commits the reviewed revision and opens a pull request. Refusals send nothing; never a force push; unsigned and said so. [Acceptance record](BAZ-046-acceptance.md) |
| [BAZ-045](done/BAZ-045-boundary-claims-observed.md) | Boundary claims observed where they are claimed | M | 2026-09-16 | [v0.20.0](https://github.com/rullopat/bazilion/releases/tag/v0.20.0) | Three guards existed and were asserted; none was observed where the claim is made. Also found the operator-conclusion defect. [Acceptance record](BAZ-045-acceptance.md) |
| [BAZ-043](done/BAZ-043-coding-review-handoff.md) | Revision-bound coding review and handoff | L | 2026-09-16 | [v0.19.0](https://github.com/rullopat/bazilion/releases/tag/v0.19.0) | One captured revision per packet; a reviewer restricted to four read-only tools; operator-reported completion facts; exports as durable publications. [Acceptance record](BAZ-043-acceptance.md) |
| [BAZ-044](done/BAZ-044-specialist-verification-handoff.md) | Specialist verification of a captured code change | L | 2026-09-16 | [v0.18.0](https://github.com/rullopat/bazilion/releases/tag/v0.18.0) | Snapshot-bound finite checks handed to a selected same-Team specialist, with the capability closed to two tools; adds four tables. [Acceptance record](BAZ-044-acceptance.md) · [Review](BAZ-044-review.md) |
| [BAZ-041](done/BAZ-041-coding-command-verification.md) | Live coding progress and retained diagnostics in chat | M | 2026-09-16 | [v0.17.0](https://github.com/rullopat/bazilion/releases/tag/v0.17.0) | Bounded live command progress plus retained diagnostics with explicit disclosure states; adds the `coding_command_logs` table. [Acceptance record](BAZ-041-acceptance.md) |
| [BAZ-042](done/BAZ-042-git-change-review.md) | Git changes and review beside coding conversations | M | 2026-09-16 | [v0.17.0](https://github.com/rullopat/bazilion/releases/tag/v0.17.0) | Baseline-pinned change review, bounded diffs, source snapshots and snapshot-bound applicability; adds the `source_snapshots` table. [Acceptance record](BAZ-042-acceptance.md) |
| [BAZ-039](done/BAZ-039-repository-coding-context.md) | Agents discover repository context while working | M | 2026-09-14 | [v0.16.0](https://github.com/rullopat/bazilion/releases/tag/v0.16.0) | Agent-led repository discovery, scoped AGENTS.md context and passive command suggestions; implemented in PR #46 |
| [BAZ-040](done/BAZ-040-coding-environment-readiness.md) | Agents prepare and check their environment during a task | L | 2026-09-14 | [v0.16.0](https://github.com/rullopat/bazilion/releases/tag/v0.16.0) | Admitted runtime inspection, scoped coding commands and workspace coordination; changes the alpha schema. Implemented in PR #46 |
| [BAZ-034](done/BAZ-034-durable-agent-deliverables.md) | Durable agent deliverables and a Team results library | M | 2026-09-08 | [v0.15.0](https://github.com/rullopat/bazilion/releases/tag/v0.15.0) | Implemented in PR #44; guided acceptance and release verified |
| [BAZ-035](done/BAZ-035-conversation-library.md) | Conversation library and safe new conversations | L | 2026-09-08 | [v0.15.0](https://github.com/rullopat/bazilion/releases/tag/v0.15.0) | Implemented in PR #44; guided acceptance and release verified |
| [BAZ-036](done/BAZ-036-visible-follow-up-queue.md) | Visible, durable follow-up queue | L (1-2 weeks) | 2026-09-08 | [v0.15.0](https://github.com/rullopat/bazilion/releases/tag/v0.15.0) | Implemented in PR #44; guided acceptance and release verified |
| [BAZ-037](done/BAZ-037-structured-agent-questions.md) | Structured agent questions across web, CLI, and Telegram | L | 2026-09-08 | [v0.15.0](https://github.com/rullopat/bazilion/releases/tag/v0.15.0) | Implemented in PR #44; guided acceptance and release verified |
| [BAZ-038](done/BAZ-038-telegram-attention-notifications.md) | Opt-in Telegram delivery of existing Attention items | M | 2026-09-08 | [v0.15.0](https://github.com/rullopat/bazilion/releases/tag/v0.15.0) | Implemented in PR #44; guided acceptance and release verified |
| [BAZ-033](done/BAZ-033-product-experience-hardening.md) | Product experience hardening across web and mobile | L | 2026-08-29 | [v0.14.0](https://github.com/rullopat/bazilion/releases/tag/v0.14.0) | First-run, chat, navigation, configuration, responsive, accessibility, and destructive-action UX hardening |
| [BAZ-031](done/BAZ-031-protected-runtime-provider-expansion.md) | Provider-neutral protected runtime | L | 2026-08-27 | [v0.13.0](https://github.com/rullopat/bazilion/releases/tag/v0.13.0) | Exhaustive credential-minimal protected execution for every provider in the pinned Pi catalog |
| [BAZ-032](done/BAZ-032-personal-server-security-acceptance.md) | Personal-server adversarial security acceptance gate | M | 2026-08-26 | [v0.13.0](https://github.com/rullopat/bazilion/releases/tag/v0.13.0) | 60-case deterministic cross-boundary release gate for BAZ-027 through BAZ-031, with live posture evidence kept separate |
| [BAZ-028](done/BAZ-028-secure-personal-web-mobile-gateway.md) | Secure personal web and mobile gateway | L | 2026-08-26 | [v0.13.0](https://github.com/rullopat/bazilion/releases/tag/v0.13.0) | Expiring device credentials, hashed browser sessions, hardened private HTTPS gateway, and loopback-only Tailscale Serve preflight |
| [BAZ-030](done/BAZ-030-encrypted-backups-credential-recovery.md) | Encrypted backups and single-operator credential recovery | L | 2026-08-26 | [v0.13.0](https://github.com/rullopat/bazilion/releases/tag/v0.13.0) | Standard age recipient encryption, authenticated staged restore, secret-safe inventory, local token rotation, and external recovery guidance |
| [BAZ-029](done/BAZ-029-single-owner-telegram-pairing.md) | Single-owner Telegram pairing and visibility hardening | M | 2026-08-26 | [v0.13.0](https://github.com/rullopat/bazilion/releases/tag/v0.13.0) | One-time owner pairing, fail-closed ingress identity, private-supergroup warnings, and secret-safe diagnostics |
| [BAZ-027](done/BAZ-027-credential-minimal-protected-agent-execution.md) | Credential-minimal protected Agent execution | L | 2026-08-23 | [v0.13.0](https://github.com/rullopat/bazilion/releases/tag/v0.13.0) | Minimal OpenAI Codex credentials, mandatory protected Docker, exact unattended-turn identity, no browser/MCP, and operator readiness visibility |
| [BAZ-026](done/BAZ-026-operator-attention-center.md) | Operator Attention Center — one queue for actionable runtime signals | M | 2026-08-05 | [v0.12.0](https://github.com/rullopat/bazilion/releases/tag/v0.12.0) | Unified source-owned queue, informational acknowledgement state, CLI parity, responsive web UI, and navigation badge |
| [BAZ-003](done/BAZ-003-hermes-self-learning.md) | Reviewed learning loop — transcript digest to durable lessons | M | 2026-08-03 | [v0.12.0](https://github.com/rullopat/bazilion/releases/tag/v0.12.0) | Opt-in restricted review worker, evidence-backed human approval, private prompt lessons, and shared Team-memory lessons |
| [BAZ-002](done/BAZ-002-profile-groups.md) | Profile Groups — preconfigured team templates (historical) | M | 2026-05-25 | [v0.2.0](https://github.com/rullopat/bazilion/releases/tag/v0.2.0) | Superseded by the canonical Team Template model in BAZ-018 |
| [BAZ-005](done/BAZ-005-agent-templates-refresh.md) | Agent templates refresh — two-sided bootstrap, USER.md seed, workspace doc | M | 2026-05-29 | v0.5.0 | Two-phase bootstrap, USER.md seed + backfill, creature/avatar, default-on AGENTS/TOOLS (HEARTBEAT opt-in) — see As-built for deltas |
| [BAZ-006](done/BAZ-006-skill-execution-security.md) | Skill execution security - sandbox and command approval | L | 2026-08-02 | [v0.11.0](https://github.com/rullopat/bazilion/releases/tag/v0.11.0) | Independent default-off Docker shell isolation and one-shot dangerous-command approval; non-interactive turns fail closed |
| [BAZ-007](done/BAZ-007-simple-installer-and-dashboard.md) | Simple installer and dashboard launch for non-technical users | M | 2026-06-22 | v0.6.0 | Bundled web UI, `bazilion dashboard`, and one-line website installers |
| [BAZ-008](done/BAZ-008-skill-content-scan.md) | Skill content scan — prompt-injection and exfiltration warnings | S | 2026-07-02 | [v0.8.0](https://github.com/rullopat/bazilion/releases/tag/v0.8.0) | Static scan on import/list/attach; confirmation required for risky imports and attaches |
| [BAZ-009](done/BAZ-009-configurable-agent-harness.md) | Configurable agent harness prototype (historical) | L | 2026-07-10 | Superseded before release | Local-only prototype removed after its interaction model graduated to Team Policy in v0.9.0 |
| [BAZ-010](done/BAZ-010-harness-persistence-api.md) | Production harness persistence foundation (historical) | L | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Canonical storage retained; transitional migration/adapters removed by BAZ-018 |
| [BAZ-015](done/BAZ-015-harness-policy-lifecycle-api.md) | Revisioned Team Template, Team Policy, and Agent lifecycle APIs | L | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Canonical APIs, stable-slot workflows, explicit placement, and atomic lifecycle |
| [BAZ-011](done/BAZ-011-harness-runtime-enforcement.md) | Team Policy authorizer, denial audit, and gated Agent messaging | L | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Shared authorizer, immutable denial audit, diagnostic evaluation, and gated messaging |
| [BAZ-012](done/BAZ-012-production-harness-web.md) | Production Templates and Teams web information architecture | L | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Canonical navigation, projections, lifecycle shells, and degraded recovery |
| [BAZ-016](done/BAZ-016-harness-runtime-boundaries.md) | Team Policy ingress, egress, scheduler, and turn-boundary enforcement | L | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | All runtime boundaries and activation-safe lifecycle linearization |
| [BAZ-017](done/BAZ-017-harness-web-editor-migration.md) | Production Team Policy editors, activity, and web QA | L | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Server-backed editors, conflicts/import/activity, accessibility, and viewport matrix |
| [BAZ-013](done/BAZ-013-harness-cli-policy-tools.md) | Team Policy CLI management and block history | M | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Revision-safe typed CLI management, portable JSON, diagnostics, and block filters |
| [BAZ-014](done/BAZ-014-harness-communication-approvals.md) | Human approval gates for Team Policy communication | L | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Durable approval-required edges, at-most-once dispatch, authenticated queue, CLI/tools, and responsive web workflow |
| [BAZ-018](done/BAZ-018-canonical-teams-cleanup.md) | Canonical Teams cleanup and clean-install schema | L | 2026-07-12 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Removed Group/Harness/Profile Group compatibility and made Teams the only product vocabulary |
| [BAZ-019](done/BAZ-019-scheduled-trigger-reliability.md) | Scheduled triggers without heartbeat files | L | 2026-08-01 | [v0.10.0](https://github.com/rullopat/bazilion/releases/tag/v0.10.0) + [v0.11.0](https://github.com/rullopat/bazilion/releases/tag/v0.11.0) | Removed HEARTBEAT.md; durable coalesced dispatch adds leases, bounded retry, approvals, and diagnostics |
| [BAZ-023](done/BAZ-023-worker-oauth-refresh.md) | Worker-side OpenAI Codex OAuth refresh | S | 2026-08-02 | [v0.11.0](https://github.com/rullopat/bazilion/releases/tag/v0.11.0) | Turn-bound daemon IPC refresh, token redaction, cancellation cleanup, and concurrent-refresh single-flight |
| [BAZ-024](done/BAZ-024-consistent-backup-restore.md) | SQLite-consistent backup and validated restore | M | 2026-08-02 | [v0.11.0](https://github.com/rullopat/bazilion/releases/tag/v0.11.0) | Verified online DB snapshot, safe archive validation, staged atomic restore, and rollback |
| [BAZ-025](done/BAZ-025-agent-loop-circuit-breaker.md) | Durable agent-message loop circuit breaker | M | 2026-08-03 | [v0.12.0](https://github.com/rullopat/bazilion/releases/tag/v0.12.0) | Daemon-enforced causal hop budget with payload-free diagnostics across API, CLI, and web |
