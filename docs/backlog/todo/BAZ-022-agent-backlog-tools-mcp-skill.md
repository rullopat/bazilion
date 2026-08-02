---
id: BAZ-022
title: Agent backlog tools, MCP server, and installable workflow skill
status: todo
size: L (1-2 weeks)
created: 2026-08-02
refined: 2026-08-02
priority: high
note: Depends on BAZ-020; makes one backlog contract usable by Bazilion Agents and external AI clients.
---

# BAZ-022 - Agent backlog tools, MCP server, and installable workflow skill

**Status:** Todo. Refined; blocked on BAZ-020.

## User stories

- **As a Bazilion Agent**, I want typed backlog tools, so I can inspect and update user stories without
  reconstructing file conventions in every prompt.
- **As an external AI client**, I want the same backlog operations over MCP, so Codex, Claude Code, and
  other MCP clients can collaborate against the Team's canonical stories.
- **As an operator**, I want an installable backlog-management skill, so Agents follow the project's
  refinement, state-transition, testing, and completion conventions consistently.
- **As a CLI user**, I want to install and configure the integration explicitly, so no Agent receives
  mutation powers merely because a backlog exists.

## Goal

Expose the BAZ-020 backlog service as a single policy-aware tool contract across native Agent tools and
a Bazilion-hosted MCP server, then ship a reviewed skill that teaches Agents how to use that contract.

## Decisions

- One application service backs HTTP, CLI, native Agent tools, and MCP; integrations do not parse or
  mutate Markdown independently.
- Read tools may be enabled independently from mutation tools. Mutation is default-off for external MCP
  clients and explicitly granted per Team/token.
- The skill contains workflow guidance only. It does not bypass tool authorization or run hidden scripts.
- MCP is an outbound-facing Bazilion capability in this story: Bazilion hosts a Streamable HTTP server
  for external clients. Existing inbound MCP-server configuration remains unchanged.

## Scope

- Add native `backlog_list`, `backlog_get`, `backlog_create`, `backlog_update`, `backlog_move`, and
  `backlog_validate` Agent tools scoped to the Agent's current Team.
- Enforce Team Policy/turn boundaries and produce immutable mutation audit entries containing actor,
  operation, story id, previous/new state, timestamp, and outcome; do not copy story bodies into audit.
- Add a standards-compliant Streamable HTTP MCP endpoint with equivalent tools, capability discovery,
  bearer authentication, Team scoping, structured errors, and cancellation.
- Add CLI commands to enable/disable the MCP surface, mint/revoke least-privilege MCP credentials, show
  the endpoint/config snippet, and run a connection/tool-discovery smoke test.
- Ship a first-party `bazilion-backlog` skill in a distributable skills catalog/bundle. It teaches story
  discovery, refinement rules, safe moves, test evidence, and when `done` is allowed.
- Let operators install the skill from both CLI and the existing Skills web page, pass it through the
  existing content scan, and attach it through normal profile/Agent skill controls.
- Document Codex and Claude Code MCP configuration examples without embedding credentials.

## Acceptance criteria

- A Bazilion Agent can list and inspect only its Team backlog; it cannot select another Team by forging
  tool arguments.
- With mutations disabled, native and MCP mutation calls fail closed while read calls still work.
- An MCP client can initialize, discover the six tools, list a board, inspect a story, and—when granted—
  move it using the exact BAZ-020 validation and conflict semantics.
- Revoking an MCP credential blocks the next request; tokens are never returned by list/log/audit APIs.
- Every successful and denied mutation is attributable without storing full story content in the audit.
- The first-party skill installs through CLI and web, is scanned like any other skill, and cannot grant
  capabilities that the attached Agent or MCP token lacks.
- CLI help and docs distinguish Bazilion consuming third-party MCP servers from hosting its backlog MCP
  server.

## Out of scope

- Automatically assigning a story, spawning an Agent, creating a branch, committing, or opening a PR.
- OAuth/OIDC and public Internet exposure; v1 uses Bazilion bearer credentials behind operator-managed
  TLS and retains the daemon's default loopback posture.
- Generic MCP hosting for every Bazilion API or arbitrary third-party skill registries.
- Letting skills execute privileged framework hooks.

## Tests

- Tool tests cover Team scoping, read/mutation capability split, malformed stories, stale writes, policy
  denial, cancellation, audit redaction, and consistent error shapes.
- MCP conformance tests cover initialize, discovery, calls, invalid/revoked auth, Team scope, disabled
  mutations, and clean disconnect.
- CLI/web tests cover configuration, credential lifecycle, smoke test, catalog install, scan warnings,
  and skill attachment.
- An end-to-end test exercises the same story through CLI list, MCP move, native Agent read, and HTTP
  validation, proving all surfaces observe one filesystem state.
- Root tests, root/web typechecks, lint, production build, and `git diff --check` pass.
