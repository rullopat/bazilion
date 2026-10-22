# Embedded Pi runtime

Bazilion pins `@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent` and standalone
`pi-mcp` to **1.0.0** in the daemon and packed CLI. This is the embedded runtime, not the
operator's global Pi installation.

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
other platforms. Pi 1.0's native close can settle after its leader exits while descendants
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

## Upstream interfaces

- [Pi v1.0.0](https://github.com/earendil-works/pi/releases/tag/v1.0.0)
- [SDK](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/sdk.md)
- [Models](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/models.md)
- [Standalone MCP client](https://github.com/earendil-works/pi/blob/v1.0.0/packages/mcp/README.md)

Any future engine upgrade must preserve explicit admission and daemon ownership rather than
turn on new upstream defaults. See [architecture](architecture.md) and [Agent engine](agent-engine.md).
