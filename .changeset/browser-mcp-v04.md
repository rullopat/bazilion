---
"bazilion": minor
---

Add Playwright browser automation and MCP client support.

**Browser automation** — agents get a `browser_*` tool suite (navigate, snapshot, click, type, hover, select, fill_form, press_key, go_back, tabs, take_screenshot, console, network) backed by a persistent per-agent Playwright session that survives across turns. Perception is accessibility-tree-first (`browser_snapshot` returns an aria tree with `[ref=eN]` element refs — no vision model needed); screenshots are a secondary, multimodal escape hatch rendered inline in chat. A network-layer SSRF guard blocks loopback/private targets (override with `BROWSER_ALLOW_PRIVATE_NETWORK` for local dev). Configure on `/config` (Browser Automation) or via env. Run `pnpm exec playwright install chromium` once.

**MCP client** — connect the daemon to Model Context Protocol servers over stdio (local subprocess), Streamable-HTTP, or SSE (with optional bearer auth). Each enabled server's tools are discovered and injected into every agent turn, namespaced `mcp__<server>__<tool>`. Manage with `bazilion mcp add|list|show|rm|enable|disable|test` or the `/config/mcp` page.

Both run as long-lived daemon-side resources (idle-reaped, closed on shutdown) reached from the stateless per-turn worker over IPC. Tool results are now multimodal (text + images).

**Bidirectional attachments across all clients** — send any file *in* and receive any file *out*, on web, Telegram, and CLI. Inbound files travel as one generic `Attachment {name?, mimeType, data}`; the daemon classifies each at turn assembly: `image/*` goes to the model as **vision** (pi `prompt({images})`), everything else is **stored under the agent's home and referenced by path** so the agent opens/processes it with its tools. Attach via the web composer (📎 / paste / **drag-and-drop**), a Telegram photo/document/voice/etc., or `bazilion agent chat <id> --image <path>` / `--file <path>`.

Outbound: tool-produced images (browser screenshots, MCP image results) surface as first-class deliverables — a standalone image block in the web chat (not buried in the tool call) and a photo on Telegram (regardless of mirror mode). Agents send arbitrary files back with a new **`deliver_file`** tool — a download link in the web chat, a document on Telegram, saved to disk on the CLI.

Audio and video are intentionally deferred: pi and every wired provider are text+image only, so the model can't perceive non-image media as input yet (it gets a stored file + path) — revisit when a provider exposes those modalities. 25 MB per file.
