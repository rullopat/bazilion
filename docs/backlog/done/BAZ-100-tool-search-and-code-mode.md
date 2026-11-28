---
id: BAZ-100
title: "Tool search and Code Mode"
status: done
created: 2026-11-28
shipped: 2026-11-28
release: v0.66.0
---

# BAZ-100 — Tool search and Code Mode

## Outcome

Every request to the model carried the definition of every tool, MCP tools included: a few
connections with dozens of tools each filled the window before the conversation started, and a
task that needed ten calls took ten round trips through the model. Now MCP tools wait until the
Agent searches for them, and the Agent can run one short script that calls several tools and
hands back only what matters. Both come from Pi (`tool_search` and `codemode`), as its own
coding agent uses them.

## As built

- `runtime/pi/tool-reach.ts` adds Pi's `createCodemodeExtension({ mode: 'on', models: false })` and
  `createToolSearchExtension()` as inline factories; nothing is discovered from disk. Pi's `tools`
  allowlist gets every declared tool plus `codemode`, and `tool_search` when deferred tools exist.
  Deferred (MCP) names stay out of it: an `mcp__` name there makes Pi filter the other MCP tools.
- `ToolHandler.reach` and `group` map to Pi's `exposure` and `namespace`: MCP proxies are
  `deferred` in the group `mcp__<connection>`; `ask_user`, `secret_request` and `browser_use` are
  `model-only`. The prompt's **Connections** section lists each connection and its tool count.
- `restoreLoadedTools` declares again, in every new turn, what `tool_search` loaded on the branch
  (its results' `details.loaded`); Pi does not when given an explicit tool list.
- Pi numbers a script's calls `<caller id>/<n>`; the results store takes those ids. Pi runs
  them with its own hooks, so `redactNestedCalls` (an extension) takes credentials out of what
  they return and of the `nestedCalls` record saved with the script's result.
- `surfaceNestedResults` collects `details.results` of calls a script made (events with
  `parentToolCallId`) and adds them to the script's own result, so the transcript and Files keep
  them. Nested `tool_execution_*` events are not chat steps; a script's progress is its calls,
  and its result (live and saved) carries `calls` (`ScriptCall`), listed as `✓ name` in the step.
- Web: **Ran a script** (the code as its input) and **Searched tools for**; a running script
  waiting on an approval reads `waiting for you`. `/context` counts `codemode`; like MCP tools,
  which it leaves out, `tool_search` and the Connections list are not counted.
- Tests: `test/runtime/tool-reach.test.ts` runs a real turn session with Pi's faux model; a
  browser test adds a stdio MCP server (`e2e/mcp-releases.mjs`) and checks the steps.

## Decided while building

- Bazilion's own tools stay declared; only MCP tools wait to be found. Choosing per connection
  that its tools are always declared is left for later, if searching turns out to cost too much.
- Scripts get no `models` (Pi's classifiers and image models): Bazilion has its own image tools.

## Limits

- Code Mode costs every request about 840 tokens (a line per declared tool on calling it from a
  script, and `codemode`'s own description); tool search saves far more once connections bring
  many tools.
- A script's long output is cut and the rest written to a file in the system's temporary
  folder, which a Docker turn cannot read and from which credentials are not taken out, as for a
  long command output; pictures a script shows are saved there too.
