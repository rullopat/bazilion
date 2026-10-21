# Embedded Pi runtime: 1.0.0 upgrade and MCP ownership

## Current boundary (2026-10-02)

Bazilion pins `@earendil-works/pi-ai`, `pi-agent-core` and `pi-coding-agent` to **1.0.0**
in both the daemon and packed CLI. This updates the embedded engine, not the operator's global
Pi installation. The bundled official OpenAI and ChatGPT/Codex catalogs include **`gpt-6.1-sol`**.
It is the requested default for forthcoming research qualification attempts, not a silent
replacement of existing Agent/Profile models or historical trial evidence.

Native discovery admits this exact model only when the bundled provider, API and official
endpoint match. An unrecognized next model still refuses; catalog membership is not hosted-search
entitlement or a successful live trial. No authenticated research ran during the upgrade.

The daemon remains the credential, policy and resource owner. SDK sessions have explicit in-memory
credentials/settings, `modelsPath: null`, `allowModelNetwork: false`, disabled automatic resource
loading, and **`cacheWarming: 'off'`**. Protected/restricted capabilities are not widened.
No Pi MCP, `codemode` or `tool_search` extension is enabled by this upgrade.

Pi 1.0 unifies chat, image and classifier providers through `createModels`. Bazilion's existing
image host now selects `getModelOfType('image', ...)` on `openrouterProvider()`. Its separate
admission, bounded transport, durable result capture, no-replay and communication controls remain
in force. Pi's codemode image/classifier paths are not an alternative admission or billing route.

## Why MCP cannot simply move into a worker

Pi's **CLI** loads MCP/codemode/tool-search built-ins; embedded **SDK** sessions opt in through
extension factories. Pi's default MCP extension connects on session start, disconnects with the
session, discovers `mcp.json`, and owns its own OAuth files/logs. Bazilion's worker lasts one turn,
while its daemon's MCP resources persist across turns. A direct worker delegation would:

- move server credentials and persistent clients out of the daemon;
- reconnect/retire servers every turn, including stateful stdio sessions;
- introduce a second config/auth store and project-controlled executable discovery;
- potentially expose resource tools, codemode and classifier/image calls beyond admitted tools.

A `hidden` tool or a server annotation is not an authorization boundary. Restricted workers must
never receive the server capability in the first place.

## Recommended delegation: Pi client inside the daemon

Pi 1.0 ships **`@earendil-works/pi-mcp`**, a standalone client with no dependency on Pi sessions or
the official MCP SDK. Its `McpClient`, `StdioTransport`, `StreamableHttpTransport`, cancellation and
process-group shutdown are a suitable replacement for Bazilion's low-level protocol/transport
implementation **inside the daemon**. Its OAuth helper accepts an injected durable state store;
it does not choose an auth-file path or open a browser itself.

Keep Bazilion's canonical `mcp_servers` table, encrypted secrets, API/CLI/web management, turn-bound
IPC, selected tool projection and process-lifetime resource registry. Replace implementation
plumbing, not product ownership. Use explicit daemon-supplied configs/credentials, no ambient
`mcp.json`, `!command` interpolation or automatic OAuth sign-in. Preserve no tool-call replay and
truthful uncertain-effect handling. Client reconnects are not permission to repeat a tool call.

### Implemented after explicit operator approval (2026-10-02)

Legacy SSE is retired across the canonical schema, wire types, API, CLI and web UI. Old
SSE-capable schemas require clean rebootstrap, even without SSE rows; no ALTER/import adapter
or guessed endpoint fallback was added. Pi's event-stream framing for Streamable HTTP remains
supported and is not legacy SSE.

The daemon now directly depends on `pi-mcp@1.0.0`, not the official MCP SDK. It delegates
protocol/framing/HTTP sessions and multimodal projection to Pi, while retaining captured
server/tool/credential admission, bounded catalogs, turn cancellation, shared ownership and
no uncertain tool-call replay. Protected/background capabilities and resource discovery remain
unchanged. Failed retirement retains ownership instead of orphaning a slot.

**Observed Pi 1.0 edge:** native stdio close can resolve after the leader exits with only SIGTERM
for a remaining descendant. A Linux ownership wrapper handles anchored original descendants
that ignore SIGTERM, refusing unknown/reused identities. This is not a replacement MCP protocol
stack. Native cross-platform closure has no claimed Linux proof.

**0.23.0 platform update:** required macOS CI observed the surviving-descendant edge. With explicit
operator approval, stdio now refuses before slot allocation/spawn off-Linux; Streamable HTTP stays
available. The Linux retirement guard is unchanged. Earlier cross-platform limits below remain
historical observations, not acceptance of native-close fallback.

See [MCP operator contract and evidence](mcp.md). MCP account/OAuth trials, native research,
human UI acceptance and publication remain separate approvals.

### Reconciled migration evidence

- Initial independent Sol review (`/tmp/bazilion-mcp-review-current`) blocked two P1 and one P2:
  Pi initialization failure cleared client transport ownership too early; native close could
  signal a reused numeric group before our guard; mixed-case JSON/error bodies bypassed the cap.
  All three were repaired, never relabelled as passing.
- `retirement.ts` retains a shared transport close independent of Pi's client reference; only
  settled successful retirement releases the slot. Actual Pi memory/HTTP cleanup fixtures cover
  pending and rejected close. Linux native close is entered only after its child handle is gone;
  guarded normal TERM/KILL replaces its unsafe timers, not its protocol/framing. HTTP caps include
  normalized media types and every non-SSE/error body.
- Repaired independent Sol follow-up (`/tmp/bazilion-mcp-repaired-review-current`) accepts the
  narrow candidate with **25 pins unchanged** and no remaining actionable P1/P2. Pure checks,
  not fixture reruns/live entitlement/human acceptance. `/proc` checks are non-atomic, detached
  sessions and abrupt-exit/emergency hooks are outside normal-retirement qualification;
  non-Linux closure remains unobserved.
- **113 scoped tests / 12 files**, root/web types passed. Final full **2,301 passed / 47 skipped;
  267 files passed / seven skipped** (`/tmp/bazilion-mcp-repaired-full.log`, exit 0).
  Security **261 required cases passed** (`/tmp/bazilion-mcp-repaired-security.log`, exit 0).
- Scoped Biome exits 0 with seven test-style warnings. Whole-tree lint still has **10 unrelated
  errors / 110 warnings / nine infos** (`/tmp/bazilion-mcp-whole-lint.log`); unrelated edits were
  preserved. This is not a whole-HEAD approval.
- Fresh rebuilt packed Linux installation passed with actual default Agent/Pi/worker/IPC/local
  HTTP MCP execution and a receipt observed by the scripted parent, exactly one tool POST,
  encrypted write-only credential, SSE refusal, delete, search/browser diagnostics without
  launch, deterministic chat/coding and uninstall cleanup.
  `/tmp/bazilion-mcp-repaired-packed-current` points to logs/artifact; exit 0.
- The first installed MCP trial returned only prose because the fixture mistook array user
  content for a string; it **failed**, not an MCP pass. Corrected array recognition then passed
  on the earlier artifact, followed by the final repaired rebuild/pass above. No public model
  or account/server was used.
- Source/dependency/test freeze: `/tmp/bazilion-mcp-frozen.sha256`. Artifact:
  `/tmp/bazilion-mcp-repaired-packed-jpi270/bazilion-0.22.0.tgz`, SHA-256
  `cddbd3626cf719b9b7c07649937c62d42b6bc38430a97cbfc7bf5c02b794d865`.
  Local dirty-tree engineering artifact, not a published release. No commit/publication recorded.

## Sources and upgrade evidence

- Official Pi tag: [v1.0.0](https://github.com/earendil-works/pi/releases/tag/v1.0.0).
- [SDK](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/sdk.md),
  [MCP](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/mcp.md),
  [models](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/models.md),
  [standalone client](https://github.com/earendil-works/pi/blob/v1.0.0/packages/mcp/README.md).
- Inspected package/docs and release JSON: `/tmp/bazilion-pi100-inspect-current`.
- Read the `pi-upgrade` skill from `mrclrchtr/skills`, pinned to
  `886e012d91408e837516e2db7a95e022c366f486` (17 installs, repository eight stars at inspection).
  Its helper was reviewed, not executed/installed globally: broad automatic install/dedupe is
  unsuitable for this dirty tree. Exact manifest edits and `pnpm install --ignore-scripts` were
  used instead. No personal/global Pi settings or credentials were copied.
- Focused upgrade regression: **167 tests / eight files**, root/web types passed.
- Review/full/security/packed evidence is reconciled in the
  [native qualification handoff](backlog/BAZ-069-native-search-implementation.md).

These are code/configuration and fixture observations, not entitlement, human UI acceptance,
live research or release approval.
