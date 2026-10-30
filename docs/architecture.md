# Bazilion architecture

Bazilion is a local-first multi-agent application. The daemon owns state, credentials, policy,
resource lifecycles and the LLM/tool stack. The CLI and browser UI are clients, not alternative
runtime owners. The embedded Pi engine owns each conversation's execution loop and transcript.

## Processes and trust boundaries

```text
CLI (@bazilion/client) ── bearer ───────────────────────────┐
                                                         ▼
Browser ── session + CSRF ── Web gateway ── cookies ── Daemon
                             :4322                    :4321
                                                        │
                                   ┌────────────────────┼───────────────────┐
                                   ▼                    ▼                   ▼
                              SQLite + files     Turn worker(s)      Persistent resources
                                                 stdin/stdout/IPC    browser / MCP
```

Both listeners are loopback-only. The supported remote entry is the web gateway over private
HTTPS, not a directly exposed daemon. Browser sessions are forwarded unchanged; the web server
**never converts session cookies into bearer credentials**. See [private gateway](private-gateway.md).

### Repository layout

| Location | Responsibility |
| --- | --- |
| `apps/daemon/src/core/` | SQLite, repositories, domain operations, paths, config and secrets |
| `apps/daemon/src/lib/` | Admission, authorization, scheduling, results, resource ownership and service hosts |
| `apps/daemon/src/runtime/` | Pi bridge, provider adapters, tool definitions, worker protocol and shell controls |
| `apps/cli/` | CLI client, daemon/dashboard launchers and offline filesystem operations |
| `apps/web/` | TanStack Start browser UI and hardened same-origin gateway |
| `packages/api-types/` | Dependency-free HTTP/IPC contracts, with no Node-only or daemon imports |
| `packages/client/` | Fetch-based authenticated HTTP/NDJSON client for native consumers |

The Expo application has been removed; native mobile apps are future scope. The wire packages stay
platform-neutral. Nothing outside the daemon imports its internals at runtime, apart from the
CLI's explicit daemon launcher. CLI tests may import internals for fixture setup.

## State and ownership

```text
~/.bazilion/                    # BAZILION_HOME overrides this root
  bazilion.db                  # entities, config, encrypted secrets, bounded evidence, Results
  auth.json                    # bootstrap bearer; optional remote CLI configuration
  agents/<id>/                 # private Agent documents, uploads, Pi sessions
  teams/<slug>/                # Team work tree, or a symlink to an existing project
    memory/                    # shared Markdown notes and qmd BM25 index
  profiles/<id>/               # reusable Agent templates
  skills/<name>/               # prompt-only skill bodies and helper assets
  browsers/<agent-id>/          # sensitive managed browser profile; excluded from backups
  logs/
```

The daemon is the sole **live** database owner. Before opening SQLite it acquires a realpath-keyed
sibling ownership record. Offline restore and credential rotation use the same ownership boundary
and private staging; they never open a running daemon's live database. Unknown ownership or an
interrupted home swap must remain blocked, not be repaired by deleting lock files.

The DB uses built-in `node:sqlite`, WAL and foreign keys. Its wrapper caches prepared statements
and implements transactions with explicit `BEGIN` / `COMMIT` / `ROLLBACK`. Workers have no DB handle.

`bazilion.db` and `auth.json` form one identity/encryption pair. A genuinely fresh home creates both;
exactly one missing half refuses startup. Existing identity must match an active bootstrap token row.
The bootstrap token cannot be revoked through normal token management.

### Schema compatibility

The product remains alpha: **0.23 requires clean rebootstrap for incompatible prior homes**,
including 0.22's SSE-capable schema. No legacy schema importer, ALTER-based compatibility adapter,
old API alias or filesystem adapter is supplied.

`core/db/migrations/0001_init.sql` defines the canonical baseline. The loader replays the bundled
SQL chain, validates migration identities and actual schema objects, and checks `PRAGMA user_version`.
An exact current home reopens idempotently; an unknown, drifted or newer schema refuses. The loader's
supported-prefix migration/snapshot mechanism is not a promise that every published older home
can upgrade, nor that a snapshot is created before an incompatible-schema refusal.

See [upgrades and safe preservation](upgrades.md). Never replace one identity half, bypass schema
validation or reset state without the operator's explicit decision and a full backup.

### Canonical storage surfaces

| Data | Canonical owner |
| --- | --- |
| Agent instructions and identity | Private files under `agents/<id>/` |
| Team USER.md | `teams.user_md` in SQLite |
| Team memory | Team-root `memory/`, shared by all members |
| Conversation messages and tool results | Pi session JSONL; not a second DB transcript |
| Conversation selection, queue, questions and approvals | Narrow daemon-owned DB records |
| Durable delivered files/images | `agent_results`, with bytes, digest and provenance |
| Coding command output and source manifests | Bounded evidence tables, not general events/runs |
| Browser cookies/logins | Daemon-owned persistent browser profile, not backup material |

There is no general `runs` or `events` table. A turn identity used for IPC admission is not a
persistent run ledger. See [Agent files](agent-files.md), [conversations](conversations.md),
[Results](results.md) and [retention](growth-and-retention.md).

## Authentication, setup and secrets

Native clients authenticate with bootstrap/device bearers appropriate to their scope. Browsers
exchange device credentials for hashed, bounded daemon-owned sessions plus session-bound CSRF.
During incomplete first-run setup only, browser login may exchange the bootstrap secret for an
internal expiring device identity and bounded setup session. That exception closes after setup;
the bootstrap bearer is never stored in a browser cookie.

Public daemon paths are exactly `/api/login` and minimal `/api/health`. Detailed health, identity
and management routes require authentication. The web gateway validates Host/Origin, strips
untrusted forwarding headers, bounds bodies and requires CSRF for unsafe browser requests.

Setup completes when an enabled provider has at least one curated chat model. Crossing that
threshold seeds the `default` Team and Profile. Before then, only the required setup/auth/config
surfaces are available. Provider catalog membership or stored credentials do not prove entitlement.

Config is plaintext in `config`; credentials use AES-256-GCM envelopes in `secrets`, keyed from
the bootstrap bearer via PBKDF2. Anyone who can read both the DB and `auth.json` can decrypt them;
this protects against accidental disclosure, not filesystem compromise. Effective configuration
precedence is `process.env` over stored secrets over stored config.

ChatGPT OAuth refresh stays daemon-owned. Workers receive only the admitted access credential;
refresh requests are bound to their provider, Agent and turn. Protected workers use a minimal
environment and explicit provider credential projection, not ambient host credential discovery.

## A turn from request to response

1. A CLI/web/Telegram/scheduler/inbox entry resolves the Agent, conversation and invocation posture.
2. The daemon revalidates Team Policy, provider access, capability admission and workspace ownership.
3. It resolves documents, skills, repository context and the permitted credential/tool projection.
4. `runtime/worker/spawn.ts` starts a fresh Node subprocess with stdin, stdout, stderr and Node IPC.
5. Stdin supplies the resolved turn input. The worker creates an explicitly configured Pi SDK session.
6. Pi executes the provider/tool loop and appends the canonical session JSONL. DB-backed operations
   round-trip through turn-bound daemon hosts over IPC; the worker never opens the database.
7. Worker stdout emits NDJSON `ChatFrame`s. The daemon also supplies its own approval/progress frames
   and streams the result to the caller. Clients render events and durable Result references.
8. Cancellation aborts the turn, stops the child with bounded escalation and rejects outstanding IPC.
   Cleanup releases ownership only when the corresponding owned resource has actually settled.

`ChatFrame` is `event`, `done` or `fatal`; tool errors and uncertain external effects are not fabricated
successes. Cancellation is keyed by Agent ID. Conversation selection, queued work and restricted
review/verification invocations keep their own narrow state machines, not a shared workflow engine.

The worker handles the main chat loop, but **not every provider request happens in a worker**:
provider tests, native search and image-generation hosts may make explicit daemon-owned requests.
The daemon remains the credential and admission authority for all of them.

For execution details see [Agent engine](agent-engine.md) and [embedded Pi](pi-runtime.md).

## Capability boundaries

### Tools, skills and coding

Tool admission is explicit. Pi SDK sessions do not enable CLI extensions, ambient resources,
`mcp.json`, codemode or tool search. Skills inject prompt-only SKILL.md bodies; scripts/assets run
through the currently admitted shell tool, not a skill extension loader.

With shell isolation off, Pi coding tools use the Team root as cwd; this is **not filesystem
confinement**. Opt-in Docker mode removes all host-backed coding tools and supplies network-disabled
container `bash`, bounded mounts, a scrubbed environment and read-only inputs. Failure never falls
back to host execution. Dangerous-command approval is an independent ephemeral interactive control,
not a Team Policy communication approval.

Shipped in 0.24.0, ordinary macOS chat has actual installed CLI/API/browser qualification through a shared capture adapter: Linux retains
fd-relative reads; macOS uses guarded public fs-safe opens plus capture-wide identity/source checks.
This is not an atomic filesystem snapshot or complete platform parity. In that release hardened
Git inspection and MCP stdio retain Linux-only admission. The 0.25 alpha adds bounded private
macOS Git worktree capture and public-libproc-owned macOS MCP stdio while preserving Linux
inspection/retirement paths. Unknown ownership remains blocked. Owned workers and managed
headed/non-GUI browsing passed actual macOS 26.6.2 arm64 checks on both Node baselines, including
private native browser keychains and reset/relaunch without personal keychain access. Generic native
Mac shell isolation is now deferred/unqualified. Ordinary Mac operator coding is trusted unisolated
host execution; isolation-required protected coding and specialist checks refuse without fallback.
Existing closed reviewer-only workers have no shell/coding surface and keep their separate contract.
Linux native/retained Docker keep independent qualification. The 0.25 alpha accepts installed
Mac 27.0.1 arm64 / Node 26.12.1 evidence for the 27.x major line, including actual non-GUI browser
and main-process shutdown/restart/restore. Headed/desktop qualification is deferred, not passed;
a newer 27.x minor is not an additional release gate. See
[repository context](repository-context.md), [BAZ-057](backlog/done/BAZ-057-portable-safe-reads.md)
and [coding environments](coding-environments.md).

### Communication and scheduling

A Team has one collaboration root, USER.md, roster, shared memory and effective revisioned policy.
An Agent belongs to exactly one Team. Profiles template Agents; Team Templates are the only reusable
stable-slot roster and policy definition. Missing directed edges deny when enforcement is enabled.

The shared authorizer covers user, peer, cross-Team, scheduler, HTTP, worker and Telegram boundaries.
An approval-required edge captures one typed attempt before its side effect; dispatch revalidates
membership and policy and does not turn approval into a reusable grant. A causal-hop circuit breaker
separately bounds peer-message loops.

The scheduler materializes durable occurrences in `trigger_dispatches`, claims leased work,
defers busy Agents and retries to bounded terminal states. `last_fired_at` is a scheduling watermark,
not proof of successful execution. Interval coalescing and cron matching do not guarantee catch-up
for every missed wall-clock slot or exactly-once provider effects. See [Team Policy](harness-policy-handoff.md)
and [follow-up queue](follow-up-queue.md).

### Browser and MCP resources

Browser processes and MCP clients outlive individual workers and stay in the daemon's resource
registry. Workers receive only admitted identity-bound proxies. Protected/restricted and background
postures must not acquire browser/MCP capability through a worker or fallback path.

Managed browsing directly launches an installed browser on its private persistent profile, verifies
its loopback debugging listener and attaches Playwright via CDP. Normal launches use the validating
SSRF proxy, including service-worker egress; downloads are denied. CDP disconnect is not process
shutdown. Unknown/live owners remain recovery-required; never manually delete profile locks.

MCP uses standalone `@earendil-works/pi-mcp` inside the daemon; its pinned version is documented
in [embedded Pi ownership](pi-runtime.md). Streamable HTTP is portable;
stdio refuses before allocation/spawn off-Linux. Legacy SSE is retired. Turn-bound tool/config/key
revalidation, no tool-call replay and ownership until close settles remain load-bearing.
See [browser research](browser-research.md) and [MCP](mcp.md).

### Research, images and Results

Ordinary discovery respects explicit route choice, configured Brave/SearXNG priority and eligible
native OpenAI/ChatGPT admission. Discovery is not source reading; Agents must retrieve original
sources and distinguish citations from verified facts. No provider/account/browser fallback is
implicit. Protected SearXNG discovery is a separate bounded capability.

Image generation is opt-in, daemon-owned and selected independently from chat. It records admission
before dispatch and never replays an uncertain paid request. Immutable bytes are captured as Results;
retention is not permission to disclose. Private-image inventory/recovery uses the same authorizer
and does not regenerate output. Reference editing, exact geometry and all-route live entitlement
are not implied. See [web research](web-research.md) and [image generation](image-generation.md).

## Captured code changes

Coding receipts and source snapshots are narrow bounded evidence, not another transcript.
Source snapshots store paths/digests, never code content. Applicability is `identical`, `changed`
or `unknown`, never a test verdict. Git inspection uses the one hardened `lib/git/capture.ts` path.

A specialist verification request freezes one snapshot and bounded command set. Restricted workers
cannot widen its two-tool capability; drift refuses, interrupted execution is uncertain, and outcomes
are per attempt. Reviews are similarly snapshot-bound and read-only.

Publication is a deterministic operator action performed by the daemon, with no publishing Agent
or model capability. Captured digests must still match; no force push or uncertain push replay.
See [coding evidence](coding-evidence.md) and [publication](publication.md).

## Maintenance boundaries

- The supported CLI/daemon Node line is `^26.12.1`, checked before application bootstrap.
- CLI/web management parity is required; shared wire contracts live in `packages/api-types`.
- `apps/web/src/lib/daemon-client.ts` is server-only; browser-safe constants live separately.
- Backup/restore validates the identity pair, schema and blob digests; managed browser profiles
  and qmd indexes are excluded. Restore cannot create old provider/publication authority.
- Documentation describes current behavior. Product work and unresolved acceptance belong in
  [user stories](backlog/README.md); CI logs, release journals and generated evidence stay out of docs.
