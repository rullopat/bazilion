// Tool search and Code Mode in a turn (BAZ-100): Pi's own `tool_search` and `codemode` tools,
// added as inline extensions (code of Pi's package, nothing discovered from disk).
//
// - Tools marked `deferred` (MCP tools) are registered but not declared: `tool_search` loads the
//   ones the Agent looks for, and codemode scripts can call them at any time.
// - Pi's `tools` list is an allowlist that also picks the declared tools. Deferred tools stay out
//   of it: an `mcp__` name in it would make Pi filter every other MCP tool away.
// - A tool `tool_search` loaded stays loaded for the rest of the conversation: each turn is a new
//   session, so the loads recorded on the branch are applied again.
// - Calls a script makes go through Pi's tool pipeline; the files and pictures they save are
//   added to the script's own result, so the conversation shows them like any other step's.

import { closeSync, constants, openSync, rmSync, writeSync } from 'node:fs'
import type { ResultReference } from '@bazilion/api-types'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  type AgentSession,
  createCodemodeExtension,
  createToolSearchExtension,
  type ExtensionFactory,
  type SessionEntry,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { noFollowFlag, readRegularFileNoFollow } from '../safe-files.ts'
import { redactDeep, redactExactValues } from '../worker/runtime.ts'

export const CODEMODE = 'codemode'
export const TOOL_SEARCH = 'tool_search'

/**
 * The two extensions. Scripts get no `models` (Pi's classifiers and image models): Bazilion has
 * its own image tools, and its credentials are only the turn's chat model.
 */
export function toolReachExtensions() {
  return [createCodemodeExtension({ mode: 'on', models: false }), createToolSearchExtension()]
}

/**
 * Credentials taken out of what a script's calls return, and of the record of those calls that
 * Pi keeps with the script's result (`nestedCalls`: their arguments and errors). Pi runs a
 * script's calls with its own hooks, not the agent's `afterToolCall` that `redactToolResults`
 * wraps, so this is an extension: its hooks run for them too, and before a message is saved.
 * `values` is read at each call, so a token refreshed mid-turn counts.
 */
export function redactNestedCalls(values: readonly string[]): ExtensionFactory {
  return (pi) => {
    pi.on('tool_result', (event) => {
      if (!(event as { parentToolCallId?: string }).parentToolCallId || values.length === 0)
        return undefined
      // Content replaced without its structured form drops it, and the script would get text
      // where the tool's declaration promised an object (bash's `exit_code`, an MCP tool's fields).
      const structured = event.structuredContent
      return {
        content: event.content.map((part) =>
          part.type === 'text' ? { ...part, text: redactExactValues(part.text, values) } : part,
        ),
        details: redactDeep(event.details, values),
        ...(structured === undefined ? {} : { structuredContent: redactDeep(structured, values) }),
      }
    })
    pi.on('message_end', (event) => {
      const message = event.message as { role?: string; nestedCalls?: unknown }
      if (message.role !== 'toolResult' || !message.nestedCalls || values.length === 0)
        return undefined
      return {
        message: {
          ...event.message,
          nestedCalls: redactDeep(message.nestedCalls, values),
        } as AgentMessage,
      }
    })
  }
}

/**
 * Pi writes the whole text of a script's long output to a file in the system's temporary folder
 * (`details.fullOutputPath`) before any hook sees the result: the turn's credentials are taken
 * out of it here, once the script has returned. The text is a script's output, which Pi held in
 * memory, so reading it back costs little. A file that cannot be rewritten is removed. (A
 * command's output never needs this: bash's output is redacted as it arrives, `tooling.ts`.)
 */
export function redactScriptOutputFile(details: unknown, values: readonly string[]): void {
  const path = (details as { fullOutputPath?: unknown } | undefined)?.fullOutputPath
  if (typeof path !== 'string' || values.length === 0) return
  try {
    const text = readRegularFileNoFollow(path)
    const redacted = redactExactValues(text, values)
    if (redacted === text) return
    const fd = openSync(path, constants.O_WRONLY | constants.O_TRUNC | noFollowFlag())
    try {
      writeSync(fd, redacted)
    } finally {
      closeSync(fd)
    }
  } catch {
    rmSync(path, { force: true })
  }
}

const isDeferred = (tool: Pick<ToolDefinition, 'exposure'>) => tool.exposure === 'deferred'

/** The names for Pi's `tools` list: every tool but the deferred ones, plus the two tools. */
export function reachToolNames(
  hostToolNames: readonly string[],
  tools: readonly Pick<ToolDefinition, 'name' | 'exposure'>[],
): string[] {
  const declared = tools.filter((tool) => !isDeferred(tool)).map((tool) => tool.name)
  const search = tools.some(isDeferred) ? [TOOL_SEARCH] : []
  return [...hostToolNames, ...declared, CODEMODE, ...search]
}

/** Tools `tool_search` loaded on this branch, in the order it loaded them. */
export function loadedOnBranch(branch: readonly SessionEntry[]): string[] {
  const loaded: string[] = []
  for (const entry of branch) {
    if (entry.type !== 'message') continue
    const message = entry.message as {
      role?: string
      toolName?: string
      isError?: boolean
      details?: { loaded?: unknown }
    }
    if (message.role !== 'toolResult' || message.toolName !== TOOL_SEARCH || message.isError)
      continue
    const names = message.details?.loaded
    if (!Array.isArray(names)) continue
    for (const name of names)
      if (typeof name === 'string' && !loaded.includes(name)) loaded.push(name)
  }
  return loaded
}

/** Declare again what `tool_search` loaded in earlier turns; names no longer offered are skipped. */
export function restoreLoadedTools(session: AgentSession): void {
  const loaded = loadedOnBranch(session.sessionManager.getBranch())
  if (loaded.length === 0) return
  const active = session.getActiveToolNames()
  const known = new Set(session.getAllTools().map((tool) => tool.name))
  const missing = loaded.filter((name) => known.has(name) && !active.includes(name))
  if (missing.length > 0) session.setActiveToolsByName([...active, ...missing])
}

function resultReferences(details: unknown): ResultReference[] {
  const refs = (details as { results?: unknown } | null | undefined)?.results
  if (!Array.isArray(refs)) return []
  return refs.filter(
    (ref): ref is ResultReference =>
      typeof (ref as { resultId?: unknown } | null)?.resultId === 'string',
  )
}

/**
 * Files and pictures saved by the calls a script made, added to the script's result details, so
 * the conversation shows them (and they stay in the transcript) as for any other step. Call after
 * any other `afterToolCall` wrapper is installed.
 */
export function surfaceNestedResults(session: AgentSession): () => void {
  const byParent = new Map<string, ResultReference[]>()
  const unsubscribe = session.subscribe((event) => {
    if (event.type !== 'tool_execution_end') return
    const parent = (event as { parentToolCallId?: string }).parentToolCallId
    if (!parent || event.isError) return
    const refs = resultReferences((event.result as { details?: unknown } | undefined)?.details)
    if (refs.length > 0) byParent.set(parent, [...(byParent.get(parent) ?? []), ...refs])
  })
  const before = session.agent.afterToolCall
  session.agent.afterToolCall = async (context, signal) => {
    const after = before ? await before(context, signal) : undefined
    const id = context.toolCall.id
    const nested = byParent.get(id)
    if (!nested) return after
    byParent.delete(id)
    const details = (after && 'details' in after ? after.details : context.result.details) ?? {}
    const own = resultReferences(details)
    const seen = new Set(own.map((ref) => ref.resultId))
    const added = nested.filter((ref) => !seen.has(ref.resultId) && seen.add(ref.resultId))
    return {
      ...(after ?? {}),
      details: { ...(details as object), results: [...own, ...added] },
    }
  }
  return unsubscribe
}

/**
 * What the model is told about `codemode` and `tool_search` before a turn adds the tools it can
 * call, for the context report: the extensions' own definitions, read without a session.
 */
export function reachToolDescriptions(
  withSearch: boolean,
): Pick<ToolDefinition, 'name' | 'description' | 'parameters'>[] {
  const registered: Pick<ToolDefinition, 'name' | 'description' | 'parameters'>[] = []
  const pi = {
    registerTool: (tool: ToolDefinition) => registered.push(tool),
    getSettings: () => ({}),
    getAllTools: () => [],
    appendEntry: () => {},
  }
  for (const factory of toolReachExtensions()) (factory as (api: unknown) => void)(pi)
  return registered.filter(
    (tool) => tool.name === CODEMODE || (withSearch && tool.name === TOOL_SEARCH),
  )
}
