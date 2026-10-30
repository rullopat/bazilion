# MCP: daemon-owned Pi client

Bazilion 0.24.0 uses **`@earendil-works/pi-mcp@1.4.0`** inside the daemon.
Pi handles JSON-RPC,
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

**In published 0.24.0, stdio execution is Linux-only.** Other platforms refuse before creating a connection or spawning
any server process; use **Streamable HTTP** instead. Registration remains portable and does not
launch a server. HTTP MCP remains available on macOS.

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
- Pi's `toLlmContent` handles text/images, embedded resources and structured content (objects,
  arrays, primitives and null). Audio and
  non-image binary resources remain textual placeholders; resource URIs are not fetched.

### Linux stdio ownership guard

Pi's native close can resolve when the leader exits, sending only SIGTERM to the remaining
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
qualified by this normal-retirement evidence. In published 0.24.0, other platforms refuse stdio
before spawn rather than using Pi's native close without equivalent ownership checks. No
all-platform stdio cleanup or abnormal-exit guarantee is claimed.

## Unreleased 0.25: macOS owned stdio

BAZ-072 adds a daemon-only macOS inspection backend using public `libproc` APIs through pinned
`koffi@3.3.3`. Its platform-specific prebuilt is a declared dependency of the daemon and packed CLI;
Koffi's install/build script remains **disabled**. There is no compiler invocation, `ps` fallback,
private Node binding, ambient MCP configuration or worker-side native connection.

Before allocating a stdio client/slot or spawning a server, admission checks actual native access
to the daemon's process identity and group listing. Missing bindings, denied/incomplete reads or
unsupported layouts fail closed. This readiness check does not run during passive platform reports.

The closed native surface reads `PROC_PIDTBSDINFO`, `RUSAGE_INFO_V0`, process-group membership and
session ids. An anchor combines exact BSD seconds/microseconds with monotonic Mach birth time,
parent, uid, group and session observations; it never relies on a wall-clock/second-resolution
PID stamp alone. Composite observations are rechecked. Groups are bounded to 16,384 members and
500 ms per inspection; malformed, duplicate, truncated or denied results are unknown. An empty
live-member result receives another group-list check so a leader disappearing during enumeration
cannot silently hide a newly forked child.

The shared owner retains the Linux `/proc` route and its normal TERM/KILL retirement rules. macOS
uses the native observations before signalling and escalation, and still waits for the original
Pi child handle to disappear before native close. Unknown/drifted identity or failed cleanup
retains the slot. A reported stdio retirement phase is closed diagnostic metadata only; it
contains no PID/path/credential, does not reveal raw SDK errors and never authorizes cleanup or
a retry. Stored PID numbers, restored receipts or a native-package availability label
never authorize signalling. These remain normal-lifecycle observations, not atomic identity
proofs, arbitrary detached-descendant containment or abrupt-exit recovery guarantees.

Implementation `21ab568` passed all eight jobs in
[CI](https://github.com/rullopat/bazilion/actions/runs/39979009335). On actual **macOS 26.6.2 arm64**,
both Node **24.22.0** and **26.4.0** passed the 153-case focused Git/process/MCP collection (four
legacy Linux `/proc`-mock cases remain Linux-only, with separate Darwin coverage). Native cases
check real process birth/group facts; protocol cases cover tool calls, busy/cancelled turns,
initialization failure and opening-client retirement. The guarded installed macOS trial also
passed packaged stdio discovery and descendant retirement without enabling lifecycle scripts.
The expanded security gate passed all 418 required cases on Linux.

CLI/web platform diagnostics and management help now describe native-owned macOS stdio, while
actual native inspection still gates every connection. This is bounded normal-lifecycle evidence,
not complete 0.25 feature parity: the initial hosted image reported 26.6.2. Subsequent actual
then-latest **27.0.1 (26A434) arm64** (confirmed 2026-10-25) guarded installed trials pass native stdio admission,
catalog and descendant retirement on **24.22.0 / 26.4.0**. Worker and protected milestones also
have observed coverage, with latest-stable desktop/non-GUI browser and installed journeys now
passing both baselines. This is not full BAZ-072 release readiness; the story preserves hosted
TCG deadline failures and unrelated acceptance rather than declaring every environment green.
Those dual-Node observations are historical: current support is Node 26.12.1 only. Current installed
26.12.1 owned-stdio/main-process trials also pass on physical 27.0.1. The 0.25 alpha accepts this
observed 27.x major line; newer 27.x minors are not a release gate, and Mac headed qualification
is deferred to a later version. Generic Mac shell isolation deferral does not retire or qualify
MCP's independent ownership contract.

## Implementation and regression coverage

The daemon-owned implementation is in `apps/daemon/src/lib/mcp/`. Regression fixtures cover:

- `apps/daemon/test/lib/mcp-{call,pool,stdio-owner,retirement}.test.ts`: local real Pi HTTP/stdio composition,
  pagination, pooling, tool drift, busy reaping, opening retirement, cancellation, no replay,
  credential/redirect boundaries, descendant shutdown and pure reused-identity refusals.
- `apps/daemon/test/lib/darwin-process{,-native}.test.ts` and `mcp-darwin-owner.test.ts`: public-ABI
  parsing, monotonic identity, bounded/unknown process observations and guarded Darwin retirement;
  native-only cases run on actual macOS, not platform simulation.
- `apps/daemon/test/routes/mcp.test.ts`: schema/API retirement, encrypted write-only credentials,
  stale config/revocation, credential rotation and namespace collisions.
- `apps/cli/test/mcp.test.ts`: SSE rejection before any client/auth lookup and correct help.
- `scripts/installer-e2e.mjs`: installed CLI MCP registration/discovery, no token disclosure,
  deterministic Linux Agent/Pi/worker/IPC tool receipt round-trip and delete.

See [embedded Pi ownership](pi-runtime.md). Fixtures do not establish account entitlement,
independent human acceptance or arbitrary site access.
