---
id: BAZ-001
title: Spike — federated multi-employee Bazilion via A2A
status: draft
size: S (timebox 1–2 days, investigation only)
created: 2026-05-17
note: Spike — output is a recommendation + a follow-up BAZ with the chosen approach scoped, not shipped code. Do not pull this BAZ expecting deliverable software.
---

# BAZ-001 — Spike — federated multi-employee Bazilion via A2A

**Status:** Backlog (draft, spike). Today Bazilion is single-tenant per install: one operator, one bootstrap token (= god mode), all state under `~/.bazilion/` on one box. Inter-agent communication (`send_message` / `read_inbox` / `wait_for_reply`) is in-process inside the daemon, with `MessagingHost` injected either as `createDbMessagingHost(db)` (compact/context routes) or `createIpcMessagingHost()` (worker subprocess, proxied over Node IPC). To make Bazilion usable inside a company without rebuilding it as multi-tenant SaaS, an alternative direction is: every employee runs their own Bazilion, installs speak to each other over A2A (Google's Agent-to-Agent protocol, or a comparable open spec) so that `alice@acme/refactor-helper` can be invoked from Bob's box. This spike resolves the open questions before an implementation BAZ is written.

**Dependency:** None on code; depends on a product decision that federation is the target shape (vs. SaaS or hardened multi-user self-hosted).

## User stories (spike)

- **As the operator considering company adoption**, I want a documented, decided answer to "is A2A-based federation viable as Bazilion's company-deployment story, and what's the smallest end-to-end slice that proves it", so the implementation BAZ can be scoped + estimated without revisiting the protocol choice mid-flight.
- **As a future employee installing Bazilion on my laptop**, I want the spike to define how my install discovers and trusts other employees' installs without each pair needing manual setup, so the onboarding step is "install + join company directory", not "exchange certs with every coworker".
- **As the operator legally responsible for audit and offboarding**, I want the spike to surface what minimum centralised infrastructure is required (directory? PKI? audit sink?) even in a peer-to-peer runtime, so the "central infra footprint" decision is informed, not accidental.

## Goal

Produce a written recommendation that answers the questions below with enough detail that a follow-up implementation BAZ can be drafted, sized, and pulled. **Strict timebox: 1–2 days.** No code lands from this BAZ beyond a throwaway sandbox proof-of-concept if needed to validate the wire model (e.g. a minimal A2A endpoint serving one agent card and round-tripping one message between two local installs on different ports).

## Why now

The exploratory conversation surfaced federation as a credible alternative to SaaS that preserves Bazilion's single-tenant ethos ("bleeding-edge personal software, skip compat shims"). Before committing direction — and before any of the existing internals (the in-process `MessagingHost`, the `~/.bazilion/teams/<slug>/` filesystem-rooted team model, the bootstrap-token-equals-god-mode auth) get refactored in ways that prematurely lock in either direction — confirm whether federation actually answers the company-deployment question or whether it just punts the hard problems to a different layer.

## Questions to answer

1. **Protocol choice — A2A vs. alternatives.**
   - Google A2A (agent cards, task lifecycle, SSE-based streaming responses): the obvious candidate, openly published, framework-agnostic, maps directly onto Bazilion's existing `ChatFrame` NDJSON shape.
   - MCP (Model Context Protocol): solves agent ↔ tool, not agent ↔ agent. Probably wrong for this use case but document the rejection.
   - Custom HTTP + WebSocket between Bazilion installs: maximum control, minimum interop. Reject unless A2A has a hard incompatibility with Bazilion's existing shapes.
   - Matrix / NATS / similar message bus: solves the async-delivery problem (laptops sleep) but doesn't define agent semantics; could compose with A2A rather than replace it.
   - Decision criterion: pick the option that gives the smallest delta from the existing in-process `MessagingHost` shape while interoperating with non-Bazilion agents (a third-party A2A-speaking agent should be addressable too).

2. **Discovery — how does Alice's install resolve `bob@acme/code-reviewer`?**
   - Static config (each install lists every other install): trivial, doesn't scale past a handful of employees.
   - mDNS / Tailscale magic DNS: works on shared networks (Tailnet, office LAN), breaks across geographies and home networks.
   - Thin company "directory" service: a small centralised HTTP service that maps `<user>@<company>` to a current endpoint URL + presence + public key fingerprint. Each install registers itself on startup and refreshes a TTL.
   - DNS-based (SRV records under `acme.com`): elegant but requires DNS ops and doesn't carry presence.
   - Recommendation expected: thin directory service. Confirm the smallest surface (probably 3 endpoints: register, lookup, list).

3. **Identity / trust — what authenticates an A2A call from Alice's install to Bob's?**
   - mTLS with per-install certs issued by a company CA: standard, secure, requires CA infrastructure.
   - Signed messages (per-install Ed25519 key, signature over the request body): simpler than mTLS, no CA per se but still needs key distribution → back to directory service holding pubkeys.
   - OIDC + JWT bearer per call (the directory service issues short-lived tokens after the operator authenticates via SSO): heavier on the directory, lighter on the install.
   - Today's bootstrap-token-equals-god-mode is incompatible with any of the above — `isValidToken` in `apps/daemon/src/lib/auth.ts` will need to grow a "remote A2A peer" code path that does NOT grant the same powers as a loopback bearer.
   - Decision criterion: pick the option with the smallest surface that still supports per-agent ACLs (next question).

4. **Per-agent authorization — who can invoke which of my agents.**
   - Today: token holders can do everything. A federated story needs `alice` to expose `refactor-helper` to "the whole company", `code-reviewer` to "team-platform", and `personal-todo` to nobody.
   - Schema sketch: an `agent_exposures(agent_id, audience, capability)` table on each install. `audience` could be `*`, `@company`, `@team:platform`, `@user:bob@acme`. `capability` could be `chat`, `read_inbox`, `read_skills_list`.
   - Default-deny: a newly spawned agent is local-only until the operator publishes it.
   - Open question: where does the audience definition live? On the directory service (single source of truth) or on each install (federated and possibly inconsistent)?

5. **Async delivery — laptops sleep.**
   - Bazilion's existing inbox model (`send_message`, `read_inbox`, `wait_for_reply`) is already async-friendly within a single install. Extending it cross-install means: when Alice sends to `bob@acme/code-reviewer` and Bob's box is offline, the message must be durably queued somewhere.
   - Option A: sender retries with backoff until receiver online. Simple but requires sender to stay online too.
   - Option B: directory service has a per-user store-and-forward inbox (HTTP PUT to deposit, HTTP GET to drain when online). The directory grows from "thin registry" into "small message broker"; design implication for question 2.
   - Option C: third-party message bus (Matrix federation, NATS JetStream). External dep, but separates concerns cleanly.
   - Recommendation expected: option B for the first cut (operationally simpler than running a Matrix homeserver), with the door left open to swap in C later.

6. **Cross-install team state — the deepest problem.**
   - Today: a Bazilion team is `~/.bazilion/teams/<slug>/` (real dir or symlink) + the `teams.user_md` DB column + shared qmd memory at `<team.path>/memory/`. Every member of the team writes to the same store.
   - Federated equivalent: "Alice and Bob both belong to the platform-team team" — where does the team filesystem live? Where do the shared memory writes go?
   - Option A — **single-owner teams**: a team lives on exactly one employee's install (its "host"). Other employees join as remote guests via A2A; their `memory_*` tool calls become A2A round-trips to the host. Loses local availability for guests when the host is offline. Simple to implement, big UX limitation.
   - Option B — **mirrored teams with sync**: each member's install has a local copy of team state; changes sync via CRDT or last-writer-wins. Genuinely hard (qmd index conflicts, USER.md merge conflicts, file content conflicts) and changes the on-disk model materially.
   - Option C — **directory-hosted teams**: the directory service stores team memory and USER.md; every install reads/writes via the directory. Centralises the most contested piece of state.
   - Recommendation expected: option A for the first cut (smallest delta from today's code). Explicitly document the limitation; revisit if the limitation becomes the dominant complaint.

7. **Offboarding + audit — the compliance angle.**
   - When Alice leaves Acme: who can revoke her A2A access? Who gets her agent transcripts? Who shuts down her install's team-host role for teams she was hosting (option A from question 6)?
   - Pure peer-to-peer makes this brittle. A central component (the directory) is the natural revocation point — yanking Alice's directory entry makes her unaddressable.
   - Centralised audit: even with a federated runtime, compliance will likely want all transcripts streamed to a central audit sink. pi's session JSONL files are local-only today; the design should at least define the streaming hook (a webhook fired per `SessionEvent`?), even if the spike doesn't implement it.
   - Output of the spike: a one-paragraph plain-English summary of "what central infra is mandatory for a viable company deployment" so the operator can decide whether to commit to running a directory + audit sink, or whether that footprint reframes the decision toward SaaS.

8. **Implementation surface — what changes in the current codebase.**
   - `apps/daemon/src/lib/messaging-host.ts`: a third host shape (`createA2AMessagingHost(directoryUrl)`) that resolves `alice@acme/...` addresses via the directory, then makes A2A calls.
   - `apps/daemon/src/routes/`: a new `a2a.ts` exposing this install's agents over A2A's task/streaming endpoints, gated by the per-agent authorization model (question 4).
   - `apps/daemon/src/lib/middleware-auth.ts`: a second code path for A2A peer auth that does NOT grant bootstrap-token powers (question 3).
   - The `MessagingHost` interface itself probably needs to grow remote addressing semantics (address parsing for `<user>@<company>/<agent>`) — confirm whether the existing signatures cover this or need a v2.
   - Worker IPC: workers today RPC the daemon for messaging via `createIpcMessagingHost`. Cross-install calls still resolve at the daemon (workers don't speak A2A directly), so the worker side likely doesn't change.

## Out of scope (for the spike)

- **Picking the directory hosting model** (self-hosted by the operator vs. a hosted service). That's an ops decision the implementation BAZ inherits.
- **Identity provider integration** (SSO via Okta / Azure AD / Google Workspace). The spike assumes the directory has *some* way to authenticate users; which IDP is plumbing for the implementation BAZ.
- **Billing / cost attribution.** Each install uses its own provider keys today; that's the federated default and doesn't need solving at the spike stage.
- **A2A spec compliance certification.** The spike validates that the protocol fits Bazilion's shape; full conformance testing is implementation work.
- **Mobile client A2A.** `apps/mobile` today talks only to its paired daemon. Federated mobile is a follow-on concern, not a spike concern.
- **Multi-tenant within a single install.** Federation deliberately avoids this — each install stays single-tenant; multi-tenant per-install is the SaaS direction and would be a different BAZ.

## Deliverable

A new BAZ file `docs/backlog/todo/BAZ-NNN-a2a-federation-implementation.md` (number assigned at spike-completion time) containing:

1. The chosen protocol (A2A vs. alternative) + one-paragraph rationale.
2. The directory service shape: language/runtime, hosting model, endpoint surface, auth model. (Could itself be a separate BAZ if the directory turns out to be a non-trivial service.)
3. The per-install changes: routes added, middleware changes, `MessagingHost` shape, schema additions for `agent_exposures` + remote-peer auth.
4. The cross-install team model decision (single-owner / mirrored / directory-hosted) + rationale + a one-paragraph description of the limitation it accepts.
5. The async-delivery model (sender-retries / directory-inbox / external-bus) + rationale.
6. The compliance hook (audit-streaming webhook? per-`SessionEvent` outbound?) — at minimum, a defined surface even if implementation is deferred.
7. A size estimate (S/M/L/XL) and explicit dependencies. If the answer is XL, split into multiple BAZs at this point.
8. The smallest end-to-end slice that proves the model works (e.g. "two local installs on ports 4321/4421, each exposes one agent over A2A, one invokes the other through the directory, audit log captures the call") — this is what the first implementation BAZ ships.

The implementation BAZ (or BAZs) is what gets pulled into a sprint. **This BAZ (BAZ-001) closes when that file lands.**

## Open questions to confirm with the operator before starting the spike

1. **Is federation actually the chosen direction**, or is this spike comparing federation against hardened-multi-user-self-hosted and SaaS as siblings? If sibling-comparison, the spike's deliverable is a three-way recommendation, not a federation implementation plan — which roughly doubles the timebox.
2. **Target company size for the first deployment** — 5 employees? 50? 500? The directory service shape and the team-state decision both flex significantly between those numbers.
3. **Operator's appetite for running central infrastructure** — "I'll happily run a small directory + audit sink on Kamal / Fly / a VPS" keeps federation in play; "I want zero central infra" forces the spike to investigate fully peer-to-peer alternatives (BitTorrent-style DHT discovery, gossip-based presence) which are research-grade and probably push the size to L or XL.
4. **Interop ambition** — does Bazilion want to be addressable from non-Bazilion A2A clients (a Google ADK agent, a LangGraph agent), or is A2A just an internal wire format between Bazilion installs? Affects strictness of spec compliance and how much of A2A's surface needs implementing.

## Tests (sketch — for the eventual implementation BAZ, not the spike itself)

- Two Bazilion installs on the same machine, different ports, register with a local directory; install A invokes an agent on install B via A2A; the `ChatFrame` NDJSON stream round-trips end-to-end through the new `MessagingHost`.
- Per-agent ACL: an agent published to `@team:platform` rejects a call from a peer not in that team; the rejection is logged on both sides.
- Offline-recipient delivery: install A sends to an agent on install B while B is down; B comes online and drains the queued message via whatever path question 5 picks.
- Cross-install team memory: a `memory_write` from install A appears in subsequent `memory_search` results from install B (assuming the chosen team-state model supports it; if option A from question 6 wins, the test instead asserts that B's `memory_*` tool calls correctly proxy to A as host).
- Peer-auth code path: an A2A call presenting a valid peer credential CANNOT escalate to bootstrap-token actions (e.g. cannot mint new tokens, cannot read `auth.json`, cannot list other agents not exposed to it).
- Compliance hook (if scoped into the first implementation BAZ): an A2A-initiated turn produces an audit event with the remote caller's identity stamped on it.
