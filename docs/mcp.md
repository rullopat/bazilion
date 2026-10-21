# MCP: daemon-owned Pi client

Bazilion uses **`@earendil-works/pi-mcp@1.0.0`** inside the daemon. Pi handles JSON-RPC,
initialization, request correlation/cancellation, stdio framing and Streamable HTTP sessions.
Bazilion retains database configuration, encrypted credentials, capability admission, bounded
catalogs and process-lifetime ownership. Workers receive selected definitions and use `mcpInvoke`
IPC; they never connect to a server or receive its bearer token.

## Operator configuration

```sh
bazilion mcp add files --command npx --args "-y @modelcontextprotocol/server-filesystem /my/project"
bazilion mcp add docs --transport http --url https://mcp.example.com/mcp
bazilion mcp list
bazilion mcp test <server-id>
bazilion mcp disable <server-id>
bazilion mcp rm <server-id>
```

The equivalent UI is **Config → MCP**; HTTP is `/api/mcp-servers[/:id[/test]]`.
Bearer tokens supplied via `--token` or the UI are encrypted under `MCP_TOKEN_<id>` and are
write-only. Command-line credentials may be visible in shell history/process arguments; use
the UI when that matters. Stdio servers are operator-selected executable/argv pairs, not shell
interpolation, and retain the existing merged daemon environment (including configured secrets).
They are privileged local programs. HTTP URLs are explicit HTTP(S) endpoints, without embedded
credentials/fragments; redirects are refused. MCP is not an SSRF-confined research surface.

Only admitted ordinary interactive turns receive MCP tools. Protected/restricted review,
verification, inbox and scheduled admission is not widened. Configuration is global, not a
second per-Agent roster. No ambient `mcp.json`, user/project Pi settings, `!command`, automatic
OAuth sign-in, codemode, tool search, roots/resources or sampling capability is enabled.
Pi's standalone OAuth support is not a newly exposed Bazilion login surface.

`list`/`show` and configuration writes do not probe a server. `test` explicitly connects and
lists tools; success is connection/catalog evidence, not proof every tool or account works.

## Legacy SSE is retired (2026-10-02)

The supported transport values are **`stdio` and `http`**. HTTP means **Streamable HTTP**;
its event-stream framing is not the removed legacy HTTP+SSE endpoint transport. SSE is refused
by CLI/API/pool and the canonical SQLite CHECK constraint. No URL rewriting or transport fallback.
Ask the server operator for its actual Streamable HTTP endpoint rather than changing `/sse`
to `/mcp` by assumption.

This changes `0001_init.sql` under the **clean-install alpha contract**. Every prior SSE-capable
schema differs, even with no SSE rows, and startup refuses it with reset guidance. Preserve the
entire old home as a filesystem backup, including paired DB/auth.json, before an operator reset
and rebootstrap. No ALTER migration/importer is provided. Do not reset a personal home as part
of a test; use a fresh isolated home. Old backups require their matching prior binary/schema.

## Admission, lifetime and errors

- A shared connection is lazy and reused across turns/Agents; concurrent first admissions share
  one initialization. Configuration/credential changes retire it. Captured hosts revalidate DB
  enablement/configuration and the selected HTTP credential before dispatch.
- A worker cannot call an undiscovered tool or another server. Duplicate, oversized or ambiguous
  namespaces refuse admission rather than silently replacing a tool. Exact namespaces remain
  `mcp__<server>__<tool>`; tool names must be provider-safe and at most 64 characters including
  the prefix. No normalization/hash alias is introduced.
- Tool-list notifications invalidate the catalog. Refresh is bounded and old turn definitions
  refuse changed/withdrawn tools; refresh is not permission to widen that turn's capability.
- Limits: **60 seconds** per connection/catalog/tool-call operation, **8 MiB** received message,
  **2 MiB / 512 tools / 16 pages** per admitted catalog, **32 KiB** retained stdio stderr.
  Limits are received-byte/admission bounds, not a general native memory sandbox.
- Busy work is not idle-reaped. Disable/delete/test/shutdown retire opening clients too; a late
  initialization cannot publish itself after retirement. Ownership is dropped only after close
  settles. Failed retirement keeps a blocked slot and requires operator/daemon intervention.
- Cancellation reaches Pi's request signal. A failed/cancelled tool call may already have taken
  effect and is **never replayed**. An uncertain result blocks further server dispatch for that
  captured turn, including queued dispatch; reconnecting does not clear that turn's latch. HTTP tool POSTs are not retried, including 401/429/5xx; no
  automatic OAuth or alternate endpoint. Pi may resume an event stream with GET, not reissue
  the guarded POST. Remote errors/stderr/credentials are not echoed as diagnostics.
- Pi's `toLlmContent` handles text/images, embedded resources and structured content. Audio and
  non-image binary resources remain textual placeholders; resource URIs are not fetched.

### Linux stdio ownership guard

Pi 1.0's native close can resolve when the leader exits, sending only SIGTERM to the remaining
process group. A descendant that ignores SIGTERM and owns no inherited pipe can survive.
Bazilion's **`stdio-owner.ts`** wrapper therefore owns normal Linux retirement signals, using
Pi's spawn/framing but not its unguarded numeric-group close timers. It checks process
start/parent/session/group evidence before TERM and before escalation after a 500 ms grace,
then waits up to two seconds for the group and native child handle to retire. Native close is
called only after the child handle is gone. Unknown/drifted identity or failed cleanup retains
the slot, never permission to signal or to open a fresh server. `retirement.ts` shares the
transport's close promise independently of Pi clearing its client reference during initialization
failure; ownership cannot disappear before cleanup settles or after it rejects.

These are observed normal-lifecycle checks, not atomic `/proc`/PID proofs or containment of
processes that detach into another session. Abrupt daemon exit/Pi's emergency exit hook is not
qualified by this normal-retirement evidence. Other platforms use Pi's native close and have no
claimed Linux ownership proof. Cross-platform/manual qualification remains separate.

## Migration evidence

Operator authorized legacy SSE retirement and daemon-side client migration on 2026-10-02.
No personal server/account or native-search trial was run, and no publication was authorized.
The implementation and fixtures are in `apps/daemon/src/lib/mcp/` and:

- `test/lib/mcp-{call,pool,stdio-owner,retirement}.test.ts`: local real Pi HTTP/stdio composition,
  pagination, pooling, tool drift, busy reaping, opening retirement, cancellation, no replay,
  credential/redirect boundaries, descendant shutdown and pure reused-identity refusals.
- `test/routes/mcp.test.ts`: schema/API retirement, encrypted write-only credentials,
  stale config/revocation, credential rotation and namespace collisions.
- `apps/cli/test/mcp.test.ts`: SSE rejection before any client/auth lookup and correct help.
- `scripts/installer-e2e.mjs`: installed CLI MCP registration/discovery, no token disclosure,
  deterministic Linux Agent/Pi/worker/IPC tool receipt round-trip and delete.

Final regression/review/artifact evidence is recorded in [Pi runtime](pi-runtime.md).
These fixtures are not entitlement, human UI acceptance, site research or release approval.
