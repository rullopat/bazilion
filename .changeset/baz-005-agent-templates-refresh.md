---
"bazilion": minor
---

Agent templates refresh: a two-sided bootstrap, a seeded USER.md, a richer workspace manual, and agent identity (avatar + creature) in the web UI.

**Two-phase bootstrap + seeded USER.md.** The first-run ritual now asks about *you* as well as the agent. Phase 1 fills IDENTITY.md (name, creature, vibe, emoji, optional avatar); phase 2 reads `user_md_get` → writes USER.md → `bootstrap_done`. New groups are seeded with a starter `USER.md` instead of an empty string, and a one-shot migration backfills existing groups whose `user_md` is still empty.

**Richer default templates.** SOUL.md, AGENTS.md (now a full workspace operating manual — memory discipline, red lines, and external-channel etiquette for Telegram + future channels), and TOOLS.md are substantially expanded. IDENTITY.md gains **Creature** and **Avatar** fields.

**Default-on templates, HEARTBEAT opt-in.** AGENTS.md and TOOLS.md now ship with every profile by default (previously opt-in); HEARTBEAT.md stays opt-in. Pass `null` to opt any of them out. The bazilion-managed `default` profile is brought in sync with the shipped templates on boot (operator edits to custom profiles are never touched).

**Agent identity in the web UI.** Agents now expose a parsed `identity` (name, creature, vibe, avatar) read from their own IDENTITY.md. The agent list and detail pages render an avatar (http(s):// or data: URIs only) and creature, falling back to the emoji.

**Profile create form redesign.** The two collapsible template groups are replaced by a tab per template plus a "templates to include" checklist — SOUL/IDENTITY are always included; BOOTSTRAP/AGENTS/TOOLS default on; HEARTBEAT defaults off. Disabling a template greys out its tab. The profile-group create form now prefills the starter USER.md.

Strictly additive: existing endpoints, profiles, and agents behave unchanged. `Agent`/`ResolvedAgent` gain an optional `identity`, and `CreateProfileRequest` accepts `null` for `agents`/`tools`/`heartbeat` to skip those files.
