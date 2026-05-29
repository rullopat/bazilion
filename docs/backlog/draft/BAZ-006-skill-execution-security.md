---
id: BAZ-006
title: Skill execution security — sandbox, content scan, command approval
status: draft
size: L (1–2 weeks; layers are independently shippable)
created: 2026-05-29
note: Surfaced while discussing whether to remove per-agent skill *selection*. Conclusion — selection is curation, NOT a security boundary (prompt-only model; the bash tool gives full capability regardless of which SKILL.md is attached). The real gap is that skill helper scripts run with the daemon's full permissions and merged-secrets env, with no sandbox, no content scan, and no approval gate. This BAZ scopes the layers OpenClaw and Hermes actually invest in. Strictly additive — opt-in hardening, default behaviour unchanged until an operator turns it on.
---

# BAZ-006 — Skill execution security — sandbox, content scan, command approval

**Status:** Backlog (draft). Bazilion's skill model is deliberately prompt-only ([CLAUDE.md](../../../CLAUDE.md) "OpenClaw skill model: prompt-only"): a `SKILL.md` under `~/.bazilion/skills/<name>/` is injected into the system prompt of every agent it's attached to, and any helper scripts run through the agent's generic `bash` tool. There is **no trust gate, no sandbox, and no content scanning**. Two consequences:

1. **`SKILL.md` is an un-scanned prompt-injection vector.** It lands verbatim in the system prompt. A malicious or compromised skill can instruct the agent to read `~/.ssh`, exfiltrate secrets, or override its own boundaries — and nothing inspects the markdown before injection.
2. **Skill scripts run with the daemon's full authority.** The per-turn worker is spawned with `mergeSecretsIntoEnv` applied (every provider key + config in the env) and unrestricted filesystem/network access. A `bash` call from any skill can read `~/.ssh/`, `~/.aws/`, the env-injected `ANTHROPIC_API_KEY`/`OPENAI_CODEX_OAUTH`, `~/.bazilion/bazilion.db` + `auth.json` (→ decrypt the secrets table), or reach the network freely.

Per-agent skill *selection* (`skills_mode`, `profile_default_skills`, `agent skill add/rm`) does **not** mitigate any of this — an unattached skill only removes its `SKILL.md` from the prompt; the agent's `bash` tool can still do anything. So selection is a curation/token-economy feature, not a security control, and the security investment belongs in execution + content layers instead.

**Dependency:** None. Sits on top of the existing worker spawner, tools layer, and skills store. Reuses the SSRF-guard precedent already in tree (`runtime/tools/web-ssrf.ts`, `lib/browser/ssrf.ts`).

## How OpenClaw and Hermes secure skills (research-backed)

**OpenClaw** treats an installed skill as third-party code on the host and layers three defences:
- **Trust / allowlist at install time** — "installing a ClawHub skill is effectively running third-party code on your host"; review before adding.
- **Optional execution sandbox** — `OPENCLAW_SKILLS_SANDBOX=true` (3.22+): sandboxed skills get no host filesystem and no network outside whitelisted domains. Skill-root discovery also refuses realpaths that escape the configured root unless explicitly trusted.
- **Content scanning** of `SKILL.md` for prompt-injection patterns + Unicode steganography.

**Hermes** leans on runtime isolation and approval:
- **Sandboxed containers** (7 terminal backends: local, Docker, SSH, Singularity, Modal, Daytona, Vercel Sandbox).
- **Command-approval flows** + **dangerous-pattern blocking** + **explicit tool whitelists**.
- **Credentials mounted read-only** into containers; a **Skills Guard** scans skill content for suspicious environment-access patterns before install.

Sources: [OpenClaw Skills](https://docs.openclaw.ai/tools/skills) · [OpenClaw Security](https://docs.openclaw.ai/gateway/security) · [OpenClaw skills-sandbox issue #28298](https://github.com/openclaw/openclaw/issues/28298) · [Hermes Security](https://hermes-agent.nousresearch.com/docs/user-guide/security) · [Hermes Skills System](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)

Neither uses per-agent skill *selection* as a security primitive — confirming the framing above.

## User stories

- **As an operator importing a skill from a third party** (`bazilion skill import --from openclaw`), I want its `SKILL.md` scanned for prompt-injection / data-exfiltration / steganography before it can be attached to any agent, so a poisoned skill can't silently rewrite my agent's boundaries.
- **As an operator running agents that browse the web and run code**, I want skill-invoked shell commands to run in a sandbox that can't read my SSH keys, cloud creds, or the bazilion secrets DB, so a prompt-injected agent can't turn one bad page into credential theft.
- **As an operator who wants a tripwire, not a cage**, I want an optional approval prompt for shell commands matching dangerous patterns (`curl | sh`, writes outside the group dir, reads of `~/.ssh`/`~/.aws`/`auth.json`), surfaced on the web + CLI, so I stay in the loop on the risky 1% without gating every `ls`.

## Scope (three independently-shippable layers)

### Layer 1 — `SKILL.md` content scan (cheapest, highest ROI)
- A scanner run at **import + attach** time (`apps/daemon/src/core/skills/`) that flags: instructions to read sensitive paths (`~/.ssh`, `~/.aws`, `~/.gnupg`, `auth.json`, the DB), exfiltration verbs against the secrets/env, "ignore previous instructions"-class overrides, and Unicode-steganography / bidi / zero-width characters.
- Surfaces a warning + requires explicit confirmation before the skill becomes attachable. CLI `bazilion skill import` prints findings; web `/skills` shows a badge + confirm.
- Pure static analysis, no runtime cost on the hot path. Ship this first.

### Layer 2 — sandboxed skill-script execution (the real capability boundary)
- Gate the worker's `bash` tool (and any skill-invoked process) behind an opt-in sandbox, config'd like the existing `browser` service in `core/services.ts` (`SKILLS_SANDBOX_ENABLED`, allow-listed dirs/domains).
- Minimum viable: a **scrubbed env** (drop the merged secrets unless the skill declares a need) + **fs jail** to the group dir + **network allowlist** reusing the SSRF classifier. Stronger: a real container backend (Docker) as a follow-up, mirroring Hermes.
- Default OFF (preserve today's behaviour); loud opt-in, like `bazilion serve --host 0.0.0.0`.

### Layer 3 — command-approval tripwire
- A dangerous-pattern matcher on `bash` invocations that, when tripped, pauses the turn and emits an approval request over the existing chat/IPC surfaces (reuse the `MessagingHost` / NDJSON frame plumbing). Auto-deny in non-interactive contexts (heartbeats, the BAZ-003 reviewer fork) to avoid deadlocks — same stance Hermes takes.

## Decisions / open questions

1. **Sandbox backend.** Start with an in-process env-scrub + fs/network jail (no new dep), or go straight to Docker (heavier, stronger, matches Hermes)? Lean: env-scrub MVP, Docker as v2.
2. **Default posture.** All three layers default OFF for now (single-user, local). Revisit defaults before any multi-user / hosted story.
3. **Secrets exposure is the sharpest edge** — even without skills, the worker env carries provider keys. Layer 2's env-scrub arguably matters beyond skills; may pull forward independently.

## Out of scope
- **Per-agent skill selection changes** — explicitly *not* a security feature; left as-is (decided 2026-05-29).
- **Signing / a trusted skill registry** — distribution-trust is a separate concern from execution-sandboxing.
- **Sandboxing the browser/MCP resources** — they already have SSRF guards; their process isolation is its own follow-up.

## Tests (when promoted)
- Content-scan unit tests: known-bad `SKILL.md` fixtures (path reads, exfil, zero-width injection) flagged; benign skills pass clean.
- Sandbox tests: a skill `bash` call cannot read a sentinel file outside the group dir / cannot see a scrubbed secret env var when the sandbox is on; unchanged behaviour when off.
- Approval tests: a dangerous-pattern command pauses + emits an approval frame interactively, auto-denies in heartbeat/reviewer contexts.
