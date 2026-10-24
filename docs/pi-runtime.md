# Embedded Pi runtime

Bazilion pins `@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent` and standalone
`pi-mcp` to **1.4.0** in the daemon and packed CLI, shipped in **0.24.0**.
Historical 0.23.0 embeds Pi 1.0.0. This upgrade does not change the operator's global Pi installation.

## Ownership

Pi owns the Agent's provider/tool loop, compaction, replay and canonical session JSONL.
Bazilion owns Agent/Team identity, policy, credentials, tool admission, subprocesses,
resource lifecycles and durable Results. Workers receive resolved turn inputs and use
identity-bound IPC for daemon-owned operations; they never open the live DB.

SDK sessions use explicit in-memory credentials/settings, `modelsPath: null`,
`allowModelNetwork: false`, disabled automatic resource loading and `cacheWarming: 'off'`.
Pi CLI MCP/codemode/tool-search extensions are not implicitly enabled. A model catalog
entry does not prove provider/account entitlement; existing Agent/Profile choices are
not silently rewritten when the bundled catalog changes.

## MCP stays inside the daemon

A worker lasts one turn; MCP clients may persist across turns. Putting Pi's CLI MCP extension
in a worker would introduce ambient discovery, another credential/config store and per-turn
connection ownership. A hidden tool or server annotation is not an authorization boundary.

The daemon uses standalone `@earendil-works/pi-mcp` for protocol/framing/HTTP sessions and
multimodal results. Bazilion retains:

- Canonical `mcp_servers` configuration and encrypted credentials.
- Turn-specific server/tool/config/credential admission and worker IPC projection.
- Process-lifetime resource slots, cancellation, busy reaping and opening-client retirement.
- Ownership until close settles; uncertain effects are never permission to replay a tool call.
- No ambient `mcp.json`, shell interpolation, automatic OAuth or resource discovery.

Streamable HTTP is portable. In published **0.24.0**, stdio is Linux-only. Unreleased BAZ-072
adds macOS owned stdio backed by public libproc identity/group inspection through pinned Koffi;
its install script remains disabled and the binding is never loaded on Linux. Native readiness
is checked before allocating a client/slot or spawning a server. Missing/unknown inspection
never falls back to shell `ps` or unguarded native close.

Pi's native close can settle after its leader exits while descendants survive;
`lib/mcp/stdio-owner.ts` guards anchored retirement and retains Linux's existing `/proc` route.
Unknown identity or cleanup retains a blocked slot. Native/protocol checks passed on actual
macOS 26.6.2 arm64 with both supported Node baselines; this is not latest-stable or full-platform
parity qualification. Neither persisted receipts nor a dependency availability flag grants
signalling authority. Legacy SSE is retired and its old schema requires clean rebootstrap. See [MCP](mcp.md) and
[upgrades](upgrades.md).

## Auxiliary capabilities

Native search is an explicit daemon-owned request, not an ambient Pi extension or a second
agent harness. It admits the selected official model/endpoint and account only. Catalog
membership is not live search qualification. See [web research](web-research.md).

The OpenRouter image host uses `createModels` and `getModelOfType('image', ...)` with
`openrouterProvider()`. Direct OpenAI and ChatGPT image routes have separate bounded daemon
adapters. Image admission, no-replay receipts, durable capture and disclosure policy remain
independent from chat credentials and Pi's codemode image/classifier paths.
See [image generation](image-generation.md).

## 0.24 upgrade notes

- Bazilion's stored provider ID remains `azure-openai`; the SDK/catalog boundary maps it to Pi's
  renamed `azure` provider. Credentials and both Azure Responses/Foundry catalog APIs use that
  same mapping. Protected refresh matches the SDK's canonical provider name but requests only the
  original Bazilion-bound credential over IPC; rotated tokens join the live redaction set.
  Existing Agents/Profiles are not renamed or silently assigned another model.
- Kimi Code catalog models now use Chat Completions at `https://api.kimi.com/coding/v1`.
  OpenCode Go model discovery follows its current `/inference/go/v1/models` endpoint.
- MCP structured content may be any JSON value, including arrays, primitives and null; projection
  remains bounded and tool calls are not replayed. Automatic MCP OAuth remains disabled.
- Manual compaction summaries now use the model's output limit; `reserveTokens` controls the
  automatic compaction threshold, not a summary output cap. Bazilion still disables automatic
  compaction and cache warming. No classifier/codemode capability is enabled by this upgrade.
- Pi attribution/User-Agent formatting changes are upstream request metadata, not permission for
  extra provider requests. Network catalog refresh remains disabled, including OpenRouter's new
  per-key background catalog. Catalog additions/removals do not prove account entitlement.
  Removed IDs are never silently mapped to another model; without an explicit endpoint that
  can admit the same ID, resolution fails closed.

## Upgrade qualification (shipped in 0.24.0)

Code **`5ab045cb3b6b2018378556857e2cdb32084c84a7`** passed all six jobs in
[CI 39778352776](https://github.com/rullopat/bazilion/actions/runs/39778352776): Linux/macOS
checks/builds, both guarded installed trials, the upgrade matrix and **398 required security
cases** (the original 397 IDs plus the Azure bound-refresh regression). Including serial browser
checks, Linux passed 2,676 tests / 49 existing skips; macOS passed 2,227 / 73 existing skips.

Fresh installed CLI/API/browser turns passed for empty and instructed Teams on Linux and actual
macOS 26.6.2 arm64, Node 24.22.0. Both trials observed all four installed Pi packages at 1.4.0,
provider-side instruction markers, settled owned closes and successful fixture removal. This
revalidates the ordinary BAZ-057 path, not all macOS capabilities or live-provider entitlement.

Retained failed attempts: an old User-Agent expectation and renamed security-test reference were
corrected; initial installed probes used CommonJS resolution against ESM-only Pi exports and
failed before browser turns. The probe now uses Node's public ESM-aware metadata API with the
same strict version/path checks. A red/green SDK-loop test reproduced and fixed the protected
Azure refresh-name mismatch. An outer local check deadline was not counted as a pass; separate
local checks and the final CI succeeded. Earlier failures remain in Git/CI, not a new evidence archive.

## Upstream interfaces

- [Pi v1.4.0](https://github.com/earendil-works/pi/releases/tag/v1.4.0)
- [SDK](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sdk.md)
- [Models](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/models.md)
- [Standalone MCP client](https://github.com/earendil-works/pi/blob/v1.4.0/packages/mcp/README.md)

Any future engine upgrade must preserve explicit admission and daemon ownership rather than
turn on new upstream defaults. See [architecture](architecture.md) and [Agent engine](agent-engine.md).
