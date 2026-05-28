-- MCP (Model Context Protocol) servers.
--
-- Each row is one configured server the daemon connects to as an MCP client.
-- Tools discovered on it (`tools/list`) are namespaced `mcp__<name>__<tool>`
-- and injected into agent turns. v0.4.0 scopes servers globally — every agent
-- sees the tools of every enabled server.
--
-- Transports:
--   stdio — local subprocess (`command` + JSON `args`); inherits the daemon's
--           merged secrets env, so a server needing e.g. GITHUB_TOKEN picks it
--           up from the normal secrets table.
--   http  — Streamable-HTTP endpoint at `url`.
--   sse   — SSE endpoint at `url`.
--
-- Bearer auth for http/sse is NOT stored here: the token lives in the encrypted
-- `secrets` table under key `MCP_TOKEN_<id>`; `has_auth` records whether one is
-- set so the UI/API can show it without decrypting.

CREATE TABLE IF NOT EXISTS mcp_servers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  transport   TEXT NOT NULL CHECK (transport IN ('stdio','http','sse')),
  command     TEXT,
  args        TEXT NOT NULL DEFAULT '[]',
  url         TEXT,
  has_auth    INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
