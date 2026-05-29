---
id: BAZ-005
title: Agent templates refresh — two-sided bootstrap, USER.md seed, workspace doc
status: done
size: M (≈1 week)
created: 2026-05-25
shipped: 2026-05-29
release: v0.5.0
pr: 9
note: Closes the OpenClaw-parity gap on default agent templates. Strictly additive — no shape changes to existing endpoints, no breaking changes to existing agents. External-messaging guidance is *content only* (forward-looking text in AGENTS.md); the actual Telegram/WhatsApp integration is a follow-up BAZ.
---

# BAZ-005 — Agent templates refresh — two-sided bootstrap, USER.md seed, workspace doc

**Status:** In progress. Bazilion forked OpenClaw's profile-template model and shipped a deliberately leaner set of defaults: SOUL.md, IDENTITY.md, BOOTSTRAP.md, plus opt-in AGENTS.md / TOOLS.md / HEARTBEAT.md ([apps/daemon/src/core/profile/templates.ts](../../../apps/daemon/src/core/profile/templates.ts)). The current `DEFAULT_BOOTSTRAP` runs a one-sided ritual — it asks the agent to define itself (Name / Vibe / Emoji → `home_write IDENTITY.md` → `bootstrap_done`) but never asks anything about the *user*. There is no `DEFAULT_USER_MD` constant, so `groups.user_md` is born as the empty string and stays that way unless the operator hand-edits it. AGENTS.md / TOOLS.md are eight-line stubs. The `AgentIdentityFile` wire type already supports `creature` and `avatar`, and `parseIdentityMarkdown` ([apps/daemon/src/core/profile/identity.ts:27](../../../apps/daemon/src/core/profile/identity.ts)) already parses them — but the default IDENTITY.md template doesn't ask for either, and `ResolvedAgent` doesn't surface them. This BAZ closes those gaps in one coherent template refresh.

**Dependency:** None. Sits on top of the existing profile/template/group machinery; no new endpoints, no DB shape changes except one additive UPDATE migration for USER.md backfill.

## User stories

- **As an operator spawning my first agent**, I want the bootstrap conversation to ask about *me* as well as itself — my name, what to call me, my timezone — so the very first session populates USER.md and the agent has real context to lean on for every later interaction.
- **As an operator upgrading from 0.2.x**, I want my pre-existing groups (where `user_md = ''`) to receive the new starter USER.md content on first launch after the upgrade, so I don't have to hand-edit one file per group to benefit from the change. Operators who explicitly cleared USER.md to `''` lose that explicit clearing — we accept that trade per the BAZ-002 As-built note ("the column can't reliably distinguish 'never set' from 'cleared'").
- **As an operator browsing the agent list**, I want each agent to show its avatar + creature + vibe alongside the name/emoji, so I can recognise agents at a glance instead of squinting at UUIDs.
- **As an agent reading my own AGENTS.md**, I want a real workspace operating manual — memory discipline, red lines, when to speak vs react in group chats, formatting rules per platform — so I can behave well in environments that haven't been built yet (external messaging) without re-deriving the rules every session. Today's eight-line "Peers" stub is too thin to anchor good behaviour.

## Goal

Ship a coherent refresh of the default agent template bundle that:

- Adds `DEFAULT_USER_MD` and seeds it into every newly-created group's `user_md` column.
- Backfills existing groups with `user_md = ''` via a one-shot migration `0003_seed_user_md.sql`.
- Extends `DEFAULT_BOOTSTRAP` to a two-phase ritual: phase 1 (existing) writes IDENTITY.md, phase 2 (new) asks about the user, calls `user_md_get` → `user_md_write`, then `bootstrap_done`.
- Extends `DEFAULT_IDENTITY` with `Creature` and `Avatar` fields (the parser at `apps/daemon/src/core/profile/identity.ts:42-45` already recognises both).
- Rewrites `DEFAULT_SOUL`, `DEFAULT_AGENTS`, `DEFAULT_TOOLS` with richer content adapted from OpenClaw's reference templates, including a forward-looking "External Channels" section in AGENTS.md (Discord / WhatsApp / Telegram formatting + "know when to speak" + "react like a human") — content only; the actual integration is a follow-up BAZ.
- Surfaces the parsed identity (incl. avatar + creature) on `ResolvedAgent` and renders avatar/creature on the web agent list and detail page.
- Wires `seedDefaults` to pass the full template bundle (agents/tools/heartbeat) to `createProfile` so the default profile actually ships these files, not just SOUL/IDENTITY/BOOTSTRAP.

**Strict additivity:** no endpoint shape changes other than `ResolvedAgent` gaining an optional `identity: AgentIdentityFile | null`. Existing endpoints, existing agents, existing profiles continue to work unchanged. Custom profiles created with explicit `templates: { … }` overrides are untouched.

## Why now

Three pressures converge:

1. **The 0.2.0 USER.md surface is half-finished.** v0.2.0 shipped `user_md_get` / `user_md_write` tools so agents can curate the human's profile — but nothing populates USER.md initially, and nothing prompts the agent to fill it in. The capability exists; the agent never reaches for it. This BAZ closes that loop.
2. **External-messaging is on the roadmap.** Telegram / WhatsApp / Signal channels are a near-term BAZ. When agents start talking in group chats, they need pre-existing guidance on platform formatting, when to react vs reply, the triple-tap problem — not behaviour learned mid-incident in front of real humans. Seeding this guidance into AGENTS.md now means the integration PR just adds transport; the operating rules are already in the agent's prompt.
3. **The Avatar/Creature parser is already in tree.** `AgentIdentityFile` and `parseIdentityMarkdown` already understand `creature` + `avatar`, and the placeholder-skip list ([apps/daemon/src/core/profile/identity.ts:4-10](../../../apps/daemon/src/core/profile/identity.ts)) is literally the OpenClaw IDENTITY.md placeholder text. Someone laid this plumbing intending to use it; we just never connected the template. Connecting it now is essentially free.

## Scope

### Templates (`apps/daemon/src/core/profile/templates.ts`)

Rewrite these constants in place. The existing exported names stay (`DEFAULT_SOUL`, `DEFAULT_IDENTITY`, etc.) and `DEFAULT_USER_MD` is added.

- **`DEFAULT_SOUL`** — replace the 14-line current stub with a richer version inspired by OpenClaw's `SOUL.md`: Core Truths (be genuinely helpful, have opinions, be resourceful, earn trust through competence, remember you're a guest), Boundaries (private things stay private, confirm before external actions, never send half-baked replies, careful in group chats), Vibe (concise when needed, thorough when it matters, not corporate, not sycophantic), Continuity (each session you wake up fresh — these files are your memory). Phrased for bazilion (no OpenClaw-isms).
- **`DEFAULT_IDENTITY`** — add two fields below Name/Vibe/Emoji:
  ```
  - **Creature:**
    _(AI? robot? familiar? ghost in the machine? something weirder?)_
  - **Avatar:**
    _(workspace-relative path, http(s) URL, or data URI)_
  ```
  Placeholder text matches the `IDENTITY_PLACEHOLDER_VALUES` set in `identity.ts:4-10` so the parser still skips empty templates.
- **`DEFAULT_BOOTSTRAP`** — two-phase ritual. Phase 1 (unchanged in shape) gathers Name / Creature / Vibe / Emoji over multiple turns → `home_write IDENTITY.md`. Phase 2 (new) gathers user-side info over additional turns: their name, what to call them, timezone, anything they want you to know → `user_md_get` (must read first for etag) → `user_md_write` with the merged content. THEN `bootstrap_done`. Keep the "one question per turn" cadence; explicitly call out that `user_md_write` requires a fresh `user_md_get` etag.
- **`DEFAULT_USER_MD`** — new constant. Structure from OpenClaw's `USER.md`:
  ```
  # USER.md — About Your Human

  _Learn about the person you're helping. Update via `user_md_write` as you go._

  - **Name:**
  - **What to call them:**
  - **Pronouns:** _(optional)_
  - **Timezone:**
  - **Notes:**

  ## Context

  _(What do they care about? What projects are they working on? Build this over time.)_

  ---

  The more you know, the better you can help. But remember — you're learning
  about a person, not building a dossier. Respect the difference.
  ```
- **`DEFAULT_AGENTS`** — full restructure into the workspace doc. Sections (in order): First Run (if BOOTSTRAP.md exists, follow it then delete) → Session Startup (use runtime-provided startup context first; don't re-read injected files) → Memory (group-shared `memory_write`, personal `home_write` on IDENTITY.md, shared user `user_md_write`) → Red Lines (no exfiltration of private data, no destructive commands without asking, `trash` > `rm`) → External vs Internal (read/explore freely; ask before sending email/posts) → **External Channels (forward-looking)** → Peers & Routing (the current stub content, kept as a section) → Tools brief (point at TOOLS.md). The "External Channels" subsection covers Discord/WhatsApp/Telegram formatting, "Know When to Speak", "React Like a Human", "Avoid the Triple-Tap" — phrased as guidance for future channels, so the agent has the rules in their prompt before the integration ships.
- **`DEFAULT_TOOLS`** — keep the "local notes" framing but add concrete category examples (device nicknames, SSH hosts, TTS voice prefs, camera names) so the agent has a template to extend rather than a blank section header.
- **`DEFAULT_HEARTBEAT`** — leave as-is (already aligned with OpenClaw's "comment-only by default" stance).

### Profile creation (`apps/daemon/src/core/profile/create.ts`)

Today `createProfile` defaults to writing only SOUL + IDENTITY + BOOTSTRAP and treats AGENTS/TOOLS/HEARTBEAT as opt-in. Flip the default: SOUL/IDENTITY/BOOTSTRAP/AGENTS/TOOLS/HEARTBEAT all default to their template, with `null` opting out (mirrors BOOTSTRAP's existing `undefined = default, null = skip, string = override` shape). Updates the `CreateProfileInput.templates.agents/tools/heartbeat` field types from `string | undefined` to `string | null | undefined` for consistency.

### Default profile seeding (`apps/daemon/src/core/profile/seed.ts`)

`seedDefaults` doesn't need to change once `createProfile`'s defaults flip — the new defaults flow through automatically. Sanity check: add an assertion in the existing `ctx-bootstrap.test.ts` that the seeded default profile dir contains all six template files.

### Group creation (`apps/daemon/src/core/group/register.ts` + `apps/daemon/src/core/repos/groups.ts`)

`registerGroup` calls `groupRepo.insert` with an empty `userMd`. Change `insert` (and only `insert`; updates stay untouched) to default to `DEFAULT_USER_MD` when the caller passes nothing or an empty string. Callers that pass non-empty content (e.g., profile-group spawn at `apps/daemon/src/core/profile-group/spawn.ts:131`) are unaffected — they win the assignment as today.

### Backfill migration (`apps/daemon/src/core/db/migrations/0003_seed_user_md.sql`)

One-shot SQL update against existing rows. Since SQL can't `import { DEFAULT_USER_MD }`, the migration inlines the same content as a multi-line string literal. We accept a minor maintenance cost (two copies, one source of truth — flag in code review if they drift). Migration is idempotent against the conditional:
```sql
UPDATE groups SET user_md = '<inlined DEFAULT_USER_MD>' WHERE user_md = '';
```
Tradeoff acknowledged per BAZ-002 As-built decision: operators who deliberately set `user_md` to `''` see it replaced. Bazilion is alpha; the upside (every existing install gets the new template) beats the downside (a power-user manually re-clears).

### Avatar/Creature surface (`packages/api-types/src/entities.ts` + `apps/daemon/src/core/agent/resolve.ts`)

- Add optional `identity?: AgentIdentityFile | null` field to `ResolvedAgent`.
- In `resolveAgent`, read the AGENT'S IDENTITY.md (not the profile's) via a new helper `loadIdentityFromFile(join(agent.dir, 'IDENTITY.md'))` (function already exists at `identity.ts:61`). Cache result in the response so single-agent and list endpoints both benefit. If the file is missing or has no values, return `null`.
- Web: render avatar (if URL or `data:` URI) in the agent list row + agent detail header; fall back to the emoji when avatar is absent. Render creature as a small subtitle line under the name.
- Workspace-relative paths (e.g. `avatars/foo.png`) are out of scope — only `http(s)://` and `data:` URIs render in this PR. Workspace-relative paths get treated as "no avatar" (parser still stores the string, but the renderer skips them). Document this in the IDENTITY.md placeholder text so agents don't pick paths during bootstrap.

### CLI

No CLI changes in this PR. `bazilion agent show` already prints the agent's working tree; an avatar URL is just one more line if it's present in IDENTITY.md. If we want a dedicated `bazilion agent identity` view later, that's a separate small BAZ.

### Mobile

No mobile changes. Mobile's agent list doesn't render avatars today; adding it is a side quest worth its own BAZ once we ship something past the "list of names" stage.

## Out of scope

- **The actual Telegram / WhatsApp / Signal integration.** This BAZ seeds the *behavioural* template content. Transport, gateway, webhook routing, message-tool wiring is a separate BAZ.
- **Workspace-relative avatar paths.** Resolving `avatars/foo.png` against the agent's home dir requires either a static-file route (`/api/agents/:id/avatar/*`) or a content-bundled response. Either is a meaningful surface area; we're skipping it for this PR. Only `http(s)://` and `data:` URIs render.
- **Editing IDENTITY.md / USER.md via the web UI.** The agent edits these via tools; the human edits them via direct file write (CLI: `bazilion memory write` doesn't apply since these aren't memory entries). A dedicated web editor for these files is a separate BAZ.
- **Per-skill USER.md hints.** OpenClaw's skills can carry USER.md prompts ("if this skill is attached, ask the user X"). Out of scope — bazilion's skill model is prompt-only and we keep it that way.
- **Auto-upgrading existing default profiles on upgrade.** The DB migration backfills `groups.user_md`, but `~/.bazilion/profiles/default/BOOTSTRAP.md` and friends are on-disk files that won't auto-refresh. Operators who want the new bootstrap on the default profile have two options: (a) `bazilion uninstall --data` (wipes profiles, keeps secrets) then re-init, or (b) delete the profile dir manually and re-seed. Document in CHANGELOG; don't write auto-upgrade code.

## Decisions

1. **IDENTITY.md gains both Creature and Avatar.** Avatar plumbing is essentially free (parser already exists, wire type already includes it) so it's no longer a "future PR" deferral.
2. **USER.md backfill via one-shot migration.** Simpler than lazy-on-read. Accepts the "can't distinguish never-set from cleared" caveat from BAZ-002 — bazilion is alpha; the upside dominates.
3. **AGENTS.md fully restructured as the workspace doc.** The current "Peers & Routing" stub becomes one section among many in the new structure. This mirrors OpenClaw's role for the file and gives us a single canonical "operating manual" the agent reads each session.
4. **External-messaging guidance lives in AGENTS.md, not a separate file.** Operating rules belong with the rest of the workspace operating manual; a `CHATS.md` would just fragment the agent's mental model.
5. **`createProfile` flips to default-on for AGENTS/TOOLS/HEARTBEAT.** The opt-in posture made sense when these were thin stubs nobody read; once they carry real content, every agent should get them. `null` still opts out for callers that want a minimal profile.
6. **Workspace-relative avatar paths deferred.** Only `http(s)://` and `data:` URIs render in this PR. Workspace-relative-path resolution needs a static-file route that's its own design conversation.

## Deliverable

- Spawning a fresh agent from the default profile runs a two-phase bootstrap: agent persona → IDENTITY.md (incl. creature, optional avatar URL); then user-side info → USER.md; then `bootstrap_done`.
- Newly-created groups land with `DEFAULT_USER_MD` content in `user_md`; existing groups with `user_md = ''` get backfilled on upgrade.
- Agent list and detail pages show avatar (when http(s) or data: URI) and creature.
- AGENTS.md ships content that anchors group-chat behaviour (formatting, when to speak, when to react), unblocking the future external-messaging BAZ from having to re-derive operating rules.
- All existing endpoints/CLI/mobile surfaces behave identically for agents/groups that don't use the new fields.

## Tests

- **Template content tests** (`apps/daemon/test/core/templates.test.ts`) — assert key markers exist in each template constant (e.g., `DEFAULT_USER_MD` contains `Pronouns:`, `DEFAULT_BOOTSTRAP` contains both `home_write` AND `user_md_write`, `DEFAULT_AGENTS` contains `Red Lines` AND `External Channels` AND `Triple-Tap`). Cheap regression-guard against accidental content deletion.
- **Identity parser test** (`apps/daemon/test/core/identity.test.ts`) — add cases for the new fields in the new IDENTITY.md template; ensure the placeholder text is filtered (test that `loadIdentityFromFile` returns `null` for an unmodified `DEFAULT_IDENTITY`).
- **Migration test** (`apps/daemon/test/core/db/migrations/0003-seed-user-md.test.ts`) — fresh DB with two groups, one with `user_md = ''` and one with `user_md = 'curated content'`. Run migration. Assert: empty row backfilled, curated row untouched.
- **Group registration test** (`apps/daemon/test/core/group.test.ts`) — `registerGroup` with no explicit `userMd` produces a row whose `user_md` matches `DEFAULT_USER_MD`. Existing test of explicit `userMd` still passes.
- **ResolvedAgent identity test** (`apps/daemon/test/core/agent/resolve.test.ts`) — agent whose IDENTITY.md is unmodified returns `identity: null`; agent whose IDENTITY.md has Name + Creature + Avatar set returns the parsed fields.
- **First-run regression** (`apps/daemon/test/lib/ctx-bootstrap.test.ts`) — after `ensureSetupSeeded`, the default profile dir contains all six template files; the default group's `user_md` matches `DEFAULT_USER_MD`.
- **Spawn integration** (`apps/daemon/test/core/agent/spawn.test.ts`, if it exists; add it if not) — fresh spawn produces an agent dir with all six template files copied.
- **Web e2e (optional, ship without if dev-only)** — spawn agent, complete bootstrap with Name/Creature/Vibe/Emoji set, navigate to `/agents` — assert creature renders under the name. If avatar is set to a `data:` URI, assert the `<img>` renders.
- **Backwards-compat smoke** — existing agents (created before this BAZ) whose IDENTITY.md still has the old 3-field template continue to resolve cleanly; identity returns `null` (no values means no identity object).

## As-built (2026-05-29, shipped in v0.5.0 / PR #9)

Shipped as planned, with these deltas worth recording:

- **Migration number is `0008_seed_user_md.sql`, not `0003`.** The branch was rebased onto a `main` that had already taken `0003`–`0007` (Telegram, mirror-mode, topic-format, ACL, MCP), so the USER.md backfill landed as `0008`. A test asserts the inlined SQL literal stays byte-identical to `DEFAULT_USER_MD` to guard the two-copies-drift risk.
- **`identity` lives on `Agent`, not `ResolvedAgent`.** The plan put it on `ResolvedAgent`, but the agent *list* endpoint returns `Agent[]` and never resolves — so a single optional `identity?: AgentIdentityFile | null` on `Agent` (populated at the route/resolve layer, repo untouched) serves both the list and detail surfaces with one additive field.
- **HEARTBEAT.md is opt-in, not default-on.** The plan flipped AGENTS/TOOLS/HEARTBEAT all to default-on; research into OpenClaw's actual defaults showed HEARTBEAT is optional there, so HEARTBEAT stays opt-in (off) while AGENTS/TOOLS default on. `null` opts any of them out.
- **On-disk default-profile refresh added.** Beyond the DB backfill, the bazilion-managed `default` profile is brought in sync with the shipped templates on every boot (write-if-differs; custom profiles untouched) — so existing installs pick up the new templates without a manual reseed. This was originally listed under the plan's "out of scope."
- **Create-form redesign went further than the plan.** The two collapsible template groups were replaced with a tab-per-template + an "enable" checklist that disables a template's tab when unticked (SOUL/IDENTITY always-on).
- **External-channel guidance written for Telegram-as-shipped.** Since 0.3.0 shipped Telegram, AGENTS.md phrases the channel etiquette for the channel that now exists rather than as a purely forward-looking section.
- **Follow-up captured:** real skill-execution security (sandbox / content-scan / approval) was drafted as BAZ-006; per-agent skill *selection* was deliberately left as-is (it's curation, not a security boundary).
