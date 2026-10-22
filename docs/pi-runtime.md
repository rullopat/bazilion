# Embedded Pi runtime

Bazilion pins `@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent` and standalone
`pi-mcp` to **1.4.0** in the daemon and packed CLI on the **unreleased 0.24 branch**.
Published 0.23.0 embeds Pi 1.0.0. This upgrade does not change the operator's global Pi installation.

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

Streamable HTTP is portable. Stdio is **Linux-only**, refused before allocation or spawn on
other platforms. Pi's native close can settle after its leader exits while descendants
survive; `lib/mcp/stdio-owner.ts` guards anchored Linux descendant retirement. Unknown identity
or cleanup retains a blocked slot, not a native-close fallback. Legacy SSE is retired and its
old schema requires clean rebootstrap. See [MCP](mcp.md) and [upgrades](upgrades.md).

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

## Upstream interfaces

- [Pi v1.4.0](https://github.com/earendil-works/pi/releases/tag/v1.4.0)
- [SDK](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sdk.md)
- [Models](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/models.md)
- [Standalone MCP client](https://github.com/earendil-works/pi/blob/v1.4.0/packages/mcp/README.md)

Any future engine upgrade must preserve explicit admission and daemon ownership rather than
turn on new upstream defaults. See [architecture](architecture.md) and [Agent engine](agent-engine.md).
