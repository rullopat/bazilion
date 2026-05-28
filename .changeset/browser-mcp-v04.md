---
"bazilion": minor
---

Add Playwright browser automation and MCP client support.

**Browser automation** — agents get a `browser_*` tool suite (navigate, snapshot, click, type, hover, select, fill_form, press_key, go_back, tabs, take_screenshot, console, network) backed by a persistent per-agent Playwright session that survives across turns. Perception is accessibility-tree-first (`browser_snapshot` returns an aria tree with `[ref=eN]` element refs — no vision model needed); screenshots are a secondary, multimodal escape hatch rendered inline in chat. A network-layer SSRF guard blocks loopback/private targets (override with `BROWSER_ALLOW_PRIVATE_NETWORK` for local dev). Configure on `/config` (Browser Automation) or via env. Run `pnpm exec playwright install chromium` once.

**MCP client** — connect the daemon to Model Context Protocol servers over stdio (local subprocess), Streamable-HTTP, or SSE (with optional bearer auth). Each enabled server's tools are discovered and injected into every agent turn, namespaced `mcp__<server>__<tool>`. Manage with `bazilion mcp add|list|show|rm|enable|disable|test` or the `/config/mcp` page.

Both run as long-lived daemon-side resources (idle-reaped, closed on shutdown) reached from the stateless per-turn worker over IPC. Tool results are now multimodal (text + images).

**Bidirectional images across all clients** — tool-produced images (browser screenshots, MCP image results) are surfaced as first-class deliverables on every client: a standalone image block in the web chat (not buried in the tool call) and a photo on Telegram (sent regardless of mirror mode). And you can now **send images as input**: attach/paste/drag images in the web composer, send a photo to a bound Telegram topic, or `bazilion agent chat <id> --image <path>` — the model sees them via vision (pi `prompt({images})`). Audio and video are intentionally deferred: pi and every wired provider are text+image only, so the model can't perceive them yet; revisit when a provider exposes those modalities.

**Bidirectional documents (any file type)** — since the model can't perceive arbitrary files, documents use a store-and-reference model: **in**, you attach any file (web 📎/paste/**drag-and-drop**, `bazilion agent chat <id> --file <path>`, or a Telegram document/voice/etc.) and the daemon saves it under the agent's home and hands the agent a path reference to open/process with its tools — it decides how to handle it. **Out**, agents call a new `deliver_file` tool to send you a file they produced — a download link in the web chat, a document on Telegram, saved to disk on the CLI. Capped at 25 MB per file.
