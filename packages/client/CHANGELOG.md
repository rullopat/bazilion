# @bazilion/client

## 0.22.0-beta.1

### Patch Changes

- Updated dependencies [[`f365601`](https://github.com/rullopat/bazilion/commit/f36560173e2eadc50e30a55b0421f796880f71f7)]:
  - @bazilion/api-types@0.22.0-beta.1

## 0.21.0-beta.5

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.21.0-beta.5

## 0.21.0-beta.4

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.21.0-beta.4

## 0.21.0-beta.3

### Patch Changes

- [`ddafd9f`](https://github.com/rullopat/bazilion/commit/ddafd9f6d282c6b66bf882e76efb0ae0f0307c8c) Thanks [@rullopat](https://github.com/rullopat)! - BAZ-051: failure-mode visibility audit — no recoverable failure may stay silent. New Attention kind `queue_interrupted`: after a daemon restart interrupts queue processing, the affected Agent's paused queue now appears in the Attention Center (action required, naming the uncertain count) instead of silently buffering messages until someone noticed. A failed OpenAI ChatGPT OAuth refresh now surfaces an actionable re-login error instead of the raw upstream failure. The remaining failure modes (provider outage mid-turn, bounded trigger retries, Telegram delivery failures, loop breaches, failed backups) are pinned by deterministic fault-injection tests asserting the operator-visible surface.

- Updated dependencies [[`ddafd9f`](https://github.com/rullopat/bazilion/commit/ddafd9f6d282c6b66bf882e76efb0ae0f0307c8c)]:
  - @bazilion/api-types@0.21.0-beta.3

## 0.21.0-beta.2

### Patch Changes

- [`9c2dae4`](https://github.com/rullopat/bazilion/commit/9c2dae41e9dcac0198ed2d2e8518986321ef21bb) Thanks [@rullopat](https://github.com/rullopat)! - BAZ-049: cross-platform hardening from the new macOS/Windows CI matrix and the fresh-machine installer E2E. Fixes that Windows/macOS users hit: directory fsync on Windows failed every conversation write (chat was broken); fsync on a read-only handle failed bootstrap rotation; symlinked session files were followed on Windows despite the no-follow boundary (now rejected explicitly); the root build's `'./packages/*'` pnpm filters matched nothing on Windows, so `pnpm pack` silently produced an empty tarball; symlinked `BAZILION_HOME` roots broke uninstall's keep-the-root semantics. The workspace-claim identity is now portable off-Linux (same dev/ino semantics without the fd-pinned ancestry window), and the off-Linux turn refusal names its boundary (`safe_reads_unavailable`) as a structured 422 instead of a plain-text 500. Agent turns still require Linux — content-read portability is BAZ-057.

- Updated dependencies [[`9c2dae4`](https://github.com/rullopat/bazilion/commit/9c2dae41e9dcac0198ed2d2e8518986321ef21bb)]:
  - @bazilion/api-types@0.21.0-beta.2

## 0.21.0-beta.1

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.21.0-beta.1

## 0.20.0

### Minor Changes

- [`ad3b780`](https://github.com/rullopat/bazilion/commit/ad3b780db700c6ed7a180a6cbdd9215cde0e1705) Thanks [@rullopat](https://github.com/rullopat)! - Publish a reviewed revision to a code host, and observe the boundary claims where they are claimed.

  **Publication to a code host.** An operator publishes a **reviewed** packet's revision: the daemon commits it
  to a new branch and opens a pull request. It is a decision, not a workflow — nothing an Agent does causes a
  publication, and there is no publication tool, worker or capability, because publishing is deterministic and
  no model needs to be in the path at all.

  - **Content is the reviewed revision, or nothing.** A snapshot stores digests, never bytes, so every path is
    read from the working tree and checked against the digest the capture recorded. A mismatch refuses and says
    which path; current bytes are never committed under a reviewed packet's name.
  - **A refusal sends nothing.** `refused` means no commit, no push, no pull request, and it is the only state
    the schema allows to carry a reason. No host configured, no credential, a protected head branch, a branch
    name that is not a valid ref, an incomplete or unreproducible revision: each is a reason, not an error.
  - **Never a force push.** A head branch that already exists on the remote is refused before the commit is
    built, and protected branches are never the head branch.
  - **Signed is stated, not assumed.** Commits are unsigned, the record says `signed: false`, and the schema
    refuses to store anything else.
  - **The credential is never an argument or a URL** — it travels in the environment as a Git `http.extraheader`
    — and **the remote comes from configuration**, never from the Team repository's own `origin`.
  - **The outcome is what the host said.** A pull request is recorded only when the host returned one. A push
    that succeeded without one is a published branch with a note. An interrupted attempt becomes `uncertain`
    and is never replayed, because a push may already have landed.
  - Nothing is merged or deployed, and the record never claims otherwise.

  Surfaces: `/api/teams/:id/publications`, `bazilion team publish create|list|show`, and a **Publications**
  panel on the Team Review page. Configure with `PUBLICATION_HOST` (`github`, or `local` for a bare repository
  path), `PUBLICATION_REPOSITORY`, `PUBLICATION_BASE_BRANCH` and the `GITHUB_TOKEN` secret. See
  `docs/publication.md`.

  **Boundary claims observed where they are claimed.** Three guards existed and were asserted; none was observed
  where the product claims it.

  - A check's working directory was scoped only in the executor, so a `cwd` outside the workspace was accepted,
    had rows written, and surfaced later as a check that mysteriously did not execute. It is refused at capture
    now, naming the value, before any row exists.
  - The rule that an unverified finding cannot be resolved held for Agents and not for the operator: the
    operator route stored every finding as `open`, so a finding about a revision nobody could read was
    resolvable. Both entry points now ask one shared question.
  - The web verification panel stated none of the limits the result message states, so "all inside the declared
    paths" read as confinement and a completed request as an approval. One shared definition now renders on both
    surfaces, always rather than only after a check has run.
  - A review turn is observed to run nothing with isolation switched on, with a control proving the "no
    container" measurement is not simply always true.
  - Every declaration-refusal branch is covered on both producers, with zero rows written.

  **Also fixed:** recording a conclusion now settles an `open` packet to `reviewed`, whichever entry point
  recorded it. Before, an operator could conclude a packet and it stayed `open` while the same report's
  `facts.reviewed` said otherwise — one report, two answers, found by building the feature that first consumes
  the state.

  **Schema change: 0.19.x homes cannot be upgraded in place.** This release adds the `publications` table and
  three indexes; the alpha contract remains clean-install only. Take a `bazilion backup` if you need the state.

### Patch Changes

- Updated dependencies [[`ad3b780`](https://github.com/rullopat/bazilion/commit/ad3b780db700c6ed7a180a6cbdd9215cde0e1705)]:
  - @bazilion/api-types@0.20.0

## 0.19.1

### Patch Changes

- [`70df0da`](https://github.com/rullopat/bazilion/commit/70df0da244405a8e6509cabfba14a509011dfa15) Thanks [@rullopat](https://github.com/rullopat)! - Fix the endpoint used for a model newer than the bundled catalogue.

  Two defects, both introduced with the Fireworks endpoint in 0.19.0:

  - An uncatalogued model id is built for the OpenAI-compatible adapter, and the OpenAI SDK appends only
    `/chat/completions` to the base URL it is given. The pinned endpoint was the provider's catalogue base
    (`…/inference`, correct for its `anthropic-messages` entries), so the fallback called
    `…/inference/chat/completions` and got a **404** instead of `…/inference/v1/chat/completions`. The
    translation is now applied only to the fallback, explicitly per provider, and catalogued models keep
    their own endpoint and API type.
  - The provider registry carried only the API key, so `bazilion provider test` and any other registry
    consumer failed closed with "configure an endpoint for a custom one" for exactly the models that
    endpoint was meant to admit. The default endpoint now travels in the provider config from the same
    single source, and an explicit `FIREWORKS_BASE_URL` still wins.

  Verified against your own model (`accounts/fireworks/models/deepseek-v4p1-flash`, newer than this build's
  catalogue): `provider test` answers, a real turn produces a visible reply, and both live loops — specialist
  verification and specialist review — complete on it, with the reviewer stating in its own words that it has
  no shell and cannot run anything.

  No schema change: a 0.19.0 home upgrades in place. Both live-run harnesses additionally assert that a turn
  actually put an assistant message in the transcript, so a turn that does nothing can no longer read as one
  that succeeded.

- Updated dependencies [[`70df0da`](https://github.com/rullopat/bazilion/commit/70df0da244405a8e6509cabfba14a509011dfa15)]:
  - @bazilion/api-types@0.19.1

## 0.19.0

### Minor Changes

- [`478f6b9`](https://github.com/rullopat/bazilion/commit/478f6b9eee21ce8345839041c30255efb16c1030) Thanks [@rullopat](https://github.com/rullopat)! - Revision-bound coding review and handoff (BAZ-043).

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

### Patch Changes

- Updated dependencies [[`478f6b9`](https://github.com/rullopat/bazilion/commit/478f6b9eee21ce8345839041c30255efb16c1030)]:
  - @bazilion/api-types@0.19.0

## 0.18.0

### Minor Changes

- [`ada3154`](https://github.com/rullopat/bazilion/commit/ada31548592b4aede043fcffb865046827848508) Thanks [@rullopat](https://github.com/rullopat)! - Specialist verification of a captured code change (BAZ-044).

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

### Patch Changes

- Updated dependencies [[`ada3154`](https://github.com/rullopat/bazilion/commit/ada31548592b4aede043fcffb865046827848508)]:
  - @bazilion/api-types@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.17.0

## 0.16.0

### Minor Changes

- [#46](https://github.com/rullopat/bazilion/pull/46) [`81aaa31`](https://github.com/rullopat/bazilion/commit/81aaa31d115b777c948473de35aac5564a596c78) Thanks [@rullopat](https://github.com/rullopat)! - Let Agents inspect their admitted runtime, prepare local prerequisites and run scoped coding commands
  during ordinary tasks. Bounded command results appear in chat, and policy-authorized teammates can
  share receipts through existing messages. Team runtime defaults are optional; there is no operator
  check dashboard.

  Coordinate overlapping Agent workspaces through cancellation and restart recovery. Restored active work
  is interrupted, and copied resource identities cannot terminate the original home's workers. This
  changes the canonical alpha database schema and requires the existing clean-install/reset workflow for
  older homes.

- [#46](https://github.com/rullopat/bazilion/pull/46) [`0832ce9`](https://github.com/rullopat/bazilion/commit/0832ce9b2ddd78d9c30d9ad9195775d6ec0971a3) Thanks [@rullopat](https://github.com/rullopat)! - Add Team repository inspection, scoped AGENTS.md context for coding Agents, and passive command
  suggestions with source provenance. Inspect and refresh through the Team page,
  `bazilion team context`, or the authenticated client/API. Repository discovery remains
  daemon-owned, bounded, and separate from execution permission.

### Patch Changes

- Updated dependencies [[`81aaa31`](https://github.com/rullopat/bazilion/commit/81aaa31d115b777c948473de35aac5564a596c78), [`0832ce9`](https://github.com/rullopat/bazilion/commit/0832ce9b2ddd78d9c30d9ad9195775d6ec0971a3)]:
  - @bazilion/api-types@0.16.0

## 0.15.0

### Minor Changes

- [#44](https://github.com/rullopat/bazilion/pull/44) [`624b731`](https://github.com/rullopat/bazilion/commit/624b7318babf8bba4fc68a132983f1c831dfd0b1) Thanks [@rullopat](https://github.com/rullopat)! - Save explicitly delivered Agent files as immutable Team-owned results. Chat cards survive completion,
  reload and restart; the Team Results view and `bazilion result` commands provide authenticated lookup,
  safe previews, downloads and explicit deletion. Native chat preserves the browser handoff, and Telegram
  sends the captured bytes through existing communication authorization and approvals.

  Results retain source provenance and verified hashes in backup/restore. Released bytes remain until
  explicit deletion, within a 25 MiB per-file and 1 GiB retained-byte limit. This changes the canonical alpha
  database schema and requires the existing clean-install/reset workflow for older homes.

- [#44](https://github.com/rullopat/bazilion/pull/44) [`fa126ac`](https://github.com/rullopat/bazilion/commit/fa126acbdd315ccb6208da0bee7b69be1bd6ab3b) Thanks [@rullopat](https://github.com/rullopat)! - Queue follow-up instructions while an Agent works, with durable input and original attachment
  bytes shared across web, CLI and Telegram. Inspect, edit or remove pending input; pause, resume,
  or stop without losing the remaining queue. Stable request identities reconcile lost acknowledgements.
  Interrupted and restored work remains visibly uncertain until reviewed, with no automatic replay.
  The canonical alpha schema changes require the documented clean-install workflow for older homes.

- [#44](https://github.com/rullopat/bazilion/pull/44) [`0af1061`](https://github.com/rullopat/bazilion/commit/0af106176d01ecb958162e5bd81aec879ebaca13) Thanks [@rullopat](https://github.com/rullopat)! - Retain Agent conversations with list, read, rename and New conversation controls in web and CLI.
  Daemon-owned selection and explicit foreground/background targets prevent stale clients or file
  activity from redirecting work. Saved results keep their original conversation links. Missing history
  has an explicit recovery path; ordinary destructive chat reset is removed. The canonical alpha
  schema changes and older homes require the documented clean-install workflow.

- [#44](https://github.com/rullopat/bazilion/pull/44) [`6e37e77`](https://github.com/rullopat/bazilion/commit/6e37e77f4a9340253ef911b2803a9e33277e52f7) Thanks [@rullopat](https://github.com/rullopat)! - Let eligible interactive Agents ask a bounded question with choices, Other and Skip across web,
  terminal and paired-owner Telegram. Recover live cards after reload, reconcile exact answer retries,
  and distinguish accepted answers from verified consumption in the original conversation. Existing
  communication approvals remain authoritative; expired, interrupted and restored questions never
  restart a turn. Native mobile shows an explicit web handoff. The canonical alpha schema changes
  require the documented clean-install workflow for older homes.

- [#44](https://github.com/rullopat/bazilion/pull/44) [`4f34efc`](https://github.com/rullopat/bazilion/commit/4f34efce254b3daa6744aae6b54209c5b683367d) Thanks [@rullopat](https://github.com/rullopat)! - Add opt-in Telegram notifications for existing Attention items, with explicit service-topic
  selection, quiet hours, old-item previews and shared web/CLI controls. Durable receipts distinguish
  confirmed, failed and uncertain sends; explicit retries acknowledge possible duplication. Current
  source, pairing and egress policy remain authoritative, and restored backups pause notifications
  for reconciliation. The canonical alpha schema changes require the documented clean-install workflow.

### Patch Changes

- Updated dependencies [[`624b731`](https://github.com/rullopat/bazilion/commit/624b7318babf8bba4fc68a132983f1c831dfd0b1), [`fa126ac`](https://github.com/rullopat/bazilion/commit/fa126acbdd315ccb6208da0bee7b69be1bd6ab3b), [`0af1061`](https://github.com/rullopat/bazilion/commit/0af106176d01ecb958162e5bd81aec879ebaca13), [`6e37e77`](https://github.com/rullopat/bazilion/commit/6e37e77f4a9340253ef911b2803a9e33277e52f7), [`4f34efc`](https://github.com/rullopat/bazilion/commit/4f34efce254b3daa6744aae6b54209c5b683367d)]:
  - @bazilion/api-types@0.15.0

## 0.14.2

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.14.2

## 0.14.1

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.14.1

## 0.14.0

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.14.0

## 0.13.0

### Minor Changes

- Add client contracts for the private gateway, expiring device credentials, bounded browser
  sessions, protected identity, detailed health, and backup/restore parity.

### Patch Changes

- Updated dependencies:
  - @bazilion/api-types@0.13.0

## 0.12.2

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.12.2

## 0.12.1

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.12.1

## 0.12.0

### Minor Changes

- [`f0395a7`](https://github.com/rullopat/bazilion/commit/f0395a7df7388ef8ca19ebda51053c0fc90e11ad) Thanks [@rullopat](https://github.com/rullopat)! - Add a durable agent-message loop circuit breaker. Messages now retain causal
  chain and hop metadata, inbox wake turns propagate that ancestry even when an
  Agent omits `reply_to`, and the daemon rejects over-budget sends before they can
  wake another LLM turn. Configure the ceiling with
  `BAZILION_AGENT_LOOP_MAX_HOPS`; inspect payload-free stop events through the
  Agent API, `bazilion inbox loop-breaks`, or the web inbox.

### Patch Changes

- Updated dependencies [[`6991fde`](https://github.com/rullopat/bazilion/commit/6991fdebd44cca2b7bd82079dd418fa75c20d2aa), [`f0395a7`](https://github.com/rullopat/bazilion/commit/f0395a7df7388ef8ca19ebda51053c0fc90e11ad)]:
  - @bazilion/api-types@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [[`e63f48a`](https://github.com/rullopat/bazilion/commit/e63f48a9c15e12f3dc7e5f204fc060abb0f2aa7e), [`675200b`](https://github.com/rullopat/bazilion/commit/675200b019957f3406820aa47976f6b3633c3777)]:
  - @bazilion/api-types@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.10.0

## 0.9.0

### Breaking Changes

- Align client methods and paths with the canonical Team, Team Template, and Team Policy API;
  removed Group/Profile Group/Harness compatibility methods are no longer exported.

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.6.0

## 0.5.1

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.4.0

## 0.3.0

### Minor Changes

- **Telegram integration.** Agents can now live in a Telegram forum supergroup — one topic per agent, two-way chat, and a ⚙ bazilion control-plane topic.

  - **Connect** a bot + forum supergroup via the web (`/config/integrations/telegram`) or CLI (`bazilion telegram config set`), with a preflight health check (bot identity, supergroup reachable, forum topics enabled, Manage Topics permission, Privacy Mode off).
  - **Spawn and bind** agents from Telegram (`/spawn`, `/spawn_team`, `/talk`), the web agent page, or `bazilion telegram bind`. Each agent gets its own named topic with a profile-derived icon; per-team templates control topic naming and rename propagation.
  - **Two-way chat:** type in an agent's topic to run a turn; replies mirror back with a typing indicator and a 👀 reaction. Messages sent while the agent is busy are queued and answered together. Inbound photos/documents/voice are downloaded (≤20 MB) and referenced for the agent.
  - **Access control** with trust-on-first-use: the first user to message the bot becomes owner; owners manage members with `/allow` / `/deny` (also the web Access control card and `bazilion telegram allow`).
  - **Resilience:** per-agent inbound/outbound rate budgets, an outbound send queue, a polling stall-watchdog auto-restart, supergroup-migration reconnect, and lazy reconciliation when a topic is deleted in Telegram.

  New Telegram wire types in `@bazilion/api-types`; `@bazilion/client` and `bazilion` bump in lockstep (fixed team).

### Patch Changes

- Updated dependencies []:
  - @bazilion/api-types@0.3.0

## 0.2.1

### Patch Changes

- [#5](https://github.com/rullopat/bazilion/pull/5) [`9707acc`](https://github.com/rullopat/bazilion/commit/9707acceb58983b6fc83be2accba1312d5ac00f3) Thanks [@rullopat](https://github.com/rullopat)! - **Fix `bazilion@0.2.0` crash on `serve`** — the npm package was broken; `npx bazilion serve` exited with `ERR_MODULE_NOT_FOUND: Cannot find package 'sqlite'` before the daemon could bind a port.

  Two build-pipeline bugs in `apps/cli/tsup.config.ts`:

  - esbuild's hardcoded known-builtins list predates `node:sqlite` (Node 22+). It auto-externalizes `node:` imports before plugin `onResolve` hooks can intercept them, then strips the `node:` prefix at print time — so `from 'node:sqlite'` shipped as `from "sqlite"` in the bundle, which Node tried to resolve from `node_modules` and failed. There's no esbuild flag to force-keep the prefix; the fix is a post-build string replace in tsup's `onSuccess` hook.
  - SQL migration files weren't being staged into `dist/`. `migrate.ts` reads them relative to `import.meta.url` (i.e. `dist/migrations/`), but tsup only emits JS. The published 0.2.0 has this bug too — the sqlite crash just masked it. The same `onSuccess` hook now copies `apps/daemon/src/core/db/migrations/*.sql` into `dist/migrations/`.

  Verified with a clean `BAZILION_HOME`: `node dist/cli.js serve` boots, auto-bootstraps `~/.bazilion`, writes `auth.json`, listens on the port, and `/api/health` returns 200.

  No source changes; no API or wire-shape changes. The `@bazilion/client` and `@bazilion/api-types` bumps are lockstep-fixed by `.changeset/config.json`.

- Updated dependencies [[`9707acc`](https://github.com/rullopat/bazilion/commit/9707acceb58983b6fc83be2accba1312d5ac00f3)]:
  - @bazilion/api-types@0.2.1

## 0.2.0

### Minor Changes

- [#1](https://github.com/rullopat/bazilion/pull/1) [`27a0456`](https://github.com/rullopat/bazilion/commit/27a0456d244361fbab9c79a61491b00c23727cfb) Thanks [@rullopat](https://github.com/rullopat)! - **Profile Teams (BAZ-002)** — preconfigured team templates that spawn N agents into a target team in one atomic call.

  - New `profile_groups` + `profile_group_members` schema; CRUD via `GET|POST|PATCH|DELETE /api/profile-teams` and `PUT /api/profile-teams/:id/members`.
  - `POST /api/profile-teams/:id/spawn` resolves member name collisions with `-2`, `-3`, … suffixes, auto-creates the target team when its slug doesn't exist, and rolls back the whole batch on any failure (with retry-with-backoff cleanup of orphan agent dirs).
  - CLI: `bazilion profile-team create/list/show/update/edit/delete/spawn`.
  - Web UI: `/profile-teams` list + detail pages under a new "templates" tab that shares space with profiles; the sidebar `+ new ▾` menu has two sections (spawn agent from template / spawn team from template); empty teams show a "spawn team from template" CTA.
  - Wire types: `ProfileGroup`, `ProfileGroupMember`, `ProfileTeamDetail`, `ProfileGroupWithCount`, plus `Create|Update|PutMembers|SpawnProfileGroupRequest` and `SpawnProfileGroupResponse` in `@bazilion/api-types`.

  **Other fixes shipped with this release**

  - Friendly error when deleting a profile that's still referenced by a profile team (was a raw SQLite FK error).
  - Web UI now surfaces daemon errors on profile delete (was silently swallowed).
  - New shared `<Button variant="primary|ghost|danger">` component + `.danger-btn` CSS class — prevents the "bare `<button type='button'>` lost all styling" class of bug.
  - Theme flash on navigation fixed (root layout now uses `data-layout` instead of `className` so the pre-paint `.dark` class survives reconciliation).

### Patch Changes

- Updated dependencies [[`27a0456`](https://github.com/rullopat/bazilion/commit/27a0456d244361fbab9c79a61491b00c23727cfb)]:
  - @bazilion/api-types@0.2.0

## 0.1.1

### Patch Changes

- Release v0.1.1.

  - **Shared USER.md editing for agents.** New `user_md_get` / `user_md_write` tools let any agent in a team update the shared USER.md with optimistic-etag concurrency control. Previously agents could only read it. USER.md is capped at 12 KB (it's inlined into every system prompt).
  - **Provider expansion.** Switched the underlying pi-ai package from `@mariozechner/pi-ai` to `@earendil-works/pi-ai`. New providers wired through `loadProviderConfigFromEnv`: DeepSeek, Fireworks, Together, Moonshot AI, Kimi Coding, MiniMax, Xiaomi MiMo, OpenCode, GitHub Copilot, Cloudflare AI Gateway, Cloudflare Workers AI, llama.cpp.
  - **Web fetch tool hardened.** Readability extraction + markdown output, SSRF guard with DNS-rebinding re-validation, 15-min LRU per `${mode}|${url}`. UA spoofs desktop Safari.
  - **Worker IPC protocol extended.** `UserMdHost` joins `MessagingHost` as a daemon-side RPC surface; the worker no longer needs a SQLite handle to touch shared state.
  - **Web UI polish.** Services config page, root chat layout, theme tokens, FieldRow component.
  - **Backlog system grows.** BAZ-002 (Profile Teams — preconfigured team templates) and BAZ-003 (Hermes-style self-learning loop) added as drafts under `docs/backlog/draft/`.

- Updated dependencies []:
  - @bazilion/api-types@0.1.1
