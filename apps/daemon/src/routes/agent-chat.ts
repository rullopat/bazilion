// /api/agents/:id chat: the streaming turn, Stop, the selected conversation's transcript, and
// the compact / context / truncate actions on it.

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Attachment,
  ChatCompactRequest,
  ChatCompactResponse,
  ChatContextResponse,
  ChatRequest,
  ContextFileEntry,
  ContextSkillEntry,
  ContextTeamEntry,
  ContextToolEntry,
  ConversationTarget,
  SessionHeadResponse,
  SessionMessagesResponse,
  TruncateChatRequest,
  TruncateChatResponse,
} from '@bazilion/api-types'
import type { Context } from 'hono'
import { DomainError } from '../core/errors.ts'
import { imageRoute } from '../core/image-generation-config.ts'
import { discoverSkills, mergeSecretsIntoEnv, resolveAgent } from '../core/index.ts'
import { ConversationChangedError } from '../core/repos/conversations.ts'
import { runAgentLifecycleMutation } from '../lib/agent-cancel.ts'
import { prepareAgentTurn, runAgentTurn } from '../lib/agent-turn.ts'
import { assertProviderReady, resolveAgentApiKey } from '../lib/api-key.ts'
import { isBrowserEnabled } from '../lib/browser/config.ts'
import { selectedConversationTarget } from '../lib/conversation-target.ts'
import { getCtx } from '../lib/ctx.ts'
import { createDbMessagingHost } from '../lib/messaging-host.ts'
import { createDbUserMdHost } from '../lib/user-md-host.ts'
import { stopAgentTurn } from '../lib/user-queue.ts'
import { searchRoute } from '../lib/web-search.ts'
import { hasCredentials } from '../runtime/auth/openai-codex.ts'
import {
  conversationUsage,
  createBazilionSession,
  describeTurn,
  loadInitialMessages,
  loadSessionHead,
  openConversation,
  type PromptSection,
  piMessagesToProviderView,
  qmdBackend,
} from '../runtime/index.ts'
import { envSecretValues } from '../runtime/worker/runtime.ts'
import { jsonBody, newRouter, routeAgent } from './http.ts'

export const agentChatRouter = newRouter()

// Cap attachments per message: keeps a runaway client from blowing up the worker stdin payload
// and the model's context.
const MAX_INPUT_ATTACHMENTS = 16

function sanitizeAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return []
  const out: Attachment[] = []
  for (const r of raw) {
    const a = r as Attachment
    if (
      a &&
      typeof a === 'object' &&
      typeof a.data === 'string' &&
      typeof a.mimeType === 'string'
    ) {
      out.push({
        mimeType: a.mimeType,
        data: a.data,
        ...(typeof a.name === 'string' ? { name: a.name } : {}),
      })
      if (out.length >= MAX_INPUT_ATTACHMENTS) break
    }
  }
  return out
}

// Stop: aborts the agent's running turn and, when follow-ups are waiting, pauses its queue so
// they do not start right away. 409 when there was nothing to stop.
agentChatRouter.post('/:id/cancel', (c) => {
  const result = stopAgentTurn(getCtx().db, routeAgent(c).id)
  if (!result.cancelled && !result.queuePaused) {
    return c.json({ error: 'agent has no active turn' }, 409)
  }
  return c.json(result)
})

/** The selected conversation's transcript size: clients poll it to notice out-of-band turns. */
agentChatRouter.get('/:id/sessions/head', (c) => {
  const { db, paths } = getCtx()
  const resolved = resolveAgent(db, paths, c.req.param('id'))
  const target = selectedConversationTarget(db, resolved.agent.id)
  const conversationId = target?.id ?? null
  try {
    return c.json({
      ...loadSessionHead(resolved, paths, target),
      conversationId,
    } satisfies SessionHeadResponse)
  } catch {
    return c.json(unavailableHead(target, conversationId))
  }
})

/** The selected conversation's transcript as ProviderMessage[], for the chat's first paint. */
agentChatRouter.get('/:id/sessions/messages', (c) => {
  const { db, paths, authToken } = getCtx()
  const resolved = resolveAgent(db, paths, c.req.param('id'))
  const target = selectedConversationTarget(db, resolved.agent.id)
  const conversationId = target?.id ?? null
  try {
    const messages = piMessagesToProviderView(
      loadInitialMessages(resolved, paths, target),
      envSecretValues(mergeSecretsIntoEnv(db, authToken)),
    )
    return c.json({
      messages,
      head: { ...loadSessionHead(resolved, paths, target), conversationId },
    } satisfies SessionMessagesResponse)
  } catch {
    return c.json({
      messages: [],
      head: unavailableHead(target, conversationId),
    } satisfies SessionMessagesResponse)
  }
})

function unavailableHead(
  target: ConversationTarget | null,
  conversationId: string | null,
): SessionHeadResponse {
  return { file: target ? `${target.id}.jsonl` : null, size: 0, conversationId, unavailable: true }
}

/**
 * Streaming chat. Prior history comes from the agent's session file; the client sends only the
 * new message. The response is NDJSON `ChatFrame`s.
 */
agentChatRouter.post('/:id/chat', async (c) => {
  const { id } = routeAgent(c)
  const body = await jsonBody<ChatRequest>(c)
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  const { message, questionMode, bashApprovalMode } = body
  if (questionMode !== undefined && questionMode !== 'web' && questionMode !== 'tty') {
    return c.json({ error: 'questionMode must be "web" or "tty"' }, 400)
  }
  if (typeof message !== 'string') return c.json({ error: 'message is required' }, 400)
  if (
    bashApprovalMode !== undefined &&
    bashApprovalMode !== 'interactive' &&
    bashApprovalMode !== 'auto_deny'
  ) {
    return c.json({ error: 'bashApprovalMode must be "interactive" or "auto_deny"' }, 400)
  }
  const attachments = sanitizeAttachments(body.attachments)
  // A turn needs *something*: text or at least one attachment.
  if (!message && attachments.length === 0) {
    return c.json({ error: 'message or an attachment is required' }, 400)
  }

  // Refusals before the turn starts (a busy Agent, an unavailable provider) are DomainErrors.
  // The web queues the message as a follow-up when the Agent is busy.
  const preparedTurn = await prepareAgentTurn({
    origin: 'http',
    attemptId: c.req.header('x-request-id') ?? randomUUID(),
    agentId: id,
    message,
    attachments,
    bashApprovalMode: bashApprovalMode ?? 'auto_deny',
    ...(questionMode ? { questionMode } : {}),
  })
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      // Flush the response headers before the first provider frame. NDJSON consumers already
      // ignore blank lines.
      controller.enqueue(encoder.encode('\n'))
      try {
        for await (const frame of runAgentTurn(preparedTurn)) {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
          } catch {
            // client disconnected: keep draining so state gets saved
          }
        }
      } catch (err) {
        const error = (err as Error).message
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify({ kind: 'fatal', error })}\n`))
        } catch {}
      }
      try {
        controller.close()
      } catch {}
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    },
  })
})

/**
 * Run `action` on the Agent's selected conversation while no turn can start. 409 when the Agent
 * has no conversation yet, is busy, or its conversation cannot be opened.
 */
async function withSelectedConversation(
  c: Context,
  action: (agentId: string, target: ConversationTarget) => Promise<Response> | Response,
): Promise<Response> {
  const { id } = routeAgent(c)
  try {
    return await runAgentLifecycleMutation(id, async () => {
      const target = selectedConversationTarget(getCtx().db, id)
      if (!target) return c.json({ error: 'Start a conversation before using this action.' }, 409)
      return await action(id, target)
    })
  } catch (error) {
    if (error instanceof DomainError) throw error
    return c.json(
      { error: error instanceof Error ? error.message : 'Conversation unavailable' },
      409,
    )
  }
}

agentChatRouter.post('/:id/chat/compact', async (c) => {
  // Every field is optional, so is the body.
  const body: ChatCompactRequest = (await jsonBody<ChatCompactRequest>(c)) ?? {}
  return withSelectedConversation(c, async (id, target) => {
    const { db, paths, authToken } = getCtx()
    const resolved = resolveAgent(db, paths, id)
    assertProviderReady(db, authToken, resolved.model)
    const memory = qmdBackend(join(resolved.team.path, 'memory'))
    await memory.init()
    const handle = await createBazilionSession({
      agent: resolved,
      conversation: target,
      paths,
      env: mergeSecretsIntoEnv(db, authToken),
      memory,
      messagingHost: createDbMessagingHost(db),
      ...(await resolveAgentApiKey(db, authToken, resolved)),
    })
    try {
      const sessionManager = handle.session.sessionManager
      const entriesBefore = sessionManager.getEntries().length
      const result = await handle.session.compact(body.customInstructions)
      const entriesAfter = sessionManager.getEntries().length
      let keptTail = 0
      if (result.firstKeptEntryId) {
        const branch = sessionManager.getBranch()
        const idx = branch.findIndex((e) => e.id === result.firstKeptEntryId)
        if (idx >= 0) for (const e of branch.slice(idx)) if (e.type === 'message') keptTail++
      }
      return c.json({
        before: entriesBefore,
        after: entriesAfter,
        summarized: Math.max(0, entriesBefore - entriesAfter + 1),
        keptTail,
        tokensBefore: result.tokensBefore,
        tokensAfter: handle.session.getContextUsage()?.tokens ?? 0,
        summary: result.summary,
      } satisfies ChatCompactResponse)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502)
    } finally {
      handle.dispose()
    }
  })
})

const CONTEXT_FILE_ORDER = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'BOOTSTRAP.md']

function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4)
}

function countProperties(schema: unknown): number | null {
  if (!schema || typeof schema !== 'object') return null
  const props = (schema as { properties?: unknown }).properties
  if (!props || typeof props !== 'object') return null
  return Object.keys(props as Record<string, unknown>).length
}

/** What a turn of this Agent would be given: system prompt parts, tools, skills, history. */
agentChatRouter.get('/:id/chat/context', (c) =>
  withSelectedConversation(c, (id, target) => {
    const { db, paths, authToken } = getCtx()
    const resolved = resolveAgent(db, paths, id)
    const env = mergeSecretsIntoEnv(db, authToken)
    const files: ContextFileEntry[] = []
    for (const file of CONTEXT_FILE_ORDER) {
      const path = join(resolved.agent.dir, file)
      if (!existsSync(path)) continue
      const content = readFileSync(path, 'utf8').trimEnd()
      if (!content) continue
      const chars = content.length + file.length + 6
      files.push({ name: file, chars, tokens: estimateTokens(chars) })
    }

    // The hosts the Agent's current configuration admits (MCP tools and ask_user depend on the
    // turn itself and are not counted).
    const reportOnly = async (): Promise<never> => {
      throw new Error('context report only')
    }
    const codexConnected = hasCredentials(db, authToken)
    const turn = describeTurn({
      agent: resolved,
      paths,
      env,
      memory: qmdBackend(join(resolved.team.path, 'memory')),
      messagingHost: createDbMessagingHost(db),
      userMdHost: createDbUserMdHost(db, paths),
      fileSink: reportOnly,
      ...(isBrowserEnabled(env) ? { browserHost: { invoke: reportOnly } } : {}),
      ...(searchRoute(env, resolved.model, codexConnected).backend
        ? { webSearchHost: { search: reportOnly } }
        : {}),
      ...(imageRoute(env, codexConnected).ready
        ? { imageGenerationHost: { generate: reportOnly } }
        : {}),
    })
    const sectionChars = (sectionId: PromptSection['id']) =>
      turn.promptSections.find((section) => section.id === sectionId)?.text.length ?? 0
    const systemPromptChars = turn.systemPrompt.length

    let toolsSchemaChars = 0
    let toolsListChars = 0
    const toolEntries: ContextToolEntry[] = turn.tools.map((tool) => {
      const schemaChars = JSON.stringify(tool.parameters ?? {}).length
      toolsSchemaChars += schemaChars
      toolsListChars += tool.name.length + tool.description.length + 3
      return {
        name: tool.name,
        schemaChars,
        descriptionChars: tool.description.length,
        paramCount: countProperties(tool.parameters),
      }
    })
    toolEntries.sort((a, b) => b.schemaChars - a.schemaChars)

    const installed = discoverSkills(paths)
    const skillEntries: ContextSkillEntry[] = resolved.skills.map((name) => {
      const match = installed.find((s) => s.name === name)
      let blockChars = name.length + 2
      if (match) {
        try {
          blockChars = readFileSync(match.skillFile, 'utf8').length
        } catch {}
      }
      return { name, blockChars }
    })
    skillEntries.sort((a, b) => b.blockChars - a.blockChars)

    const team: ContextTeamEntry = {
      id: resolved.team.id,
      name: resolved.team.name,
      path: resolved.team.path,
      userMdChars: resolved.team.userMd.length,
    }
    const history = conversationUsage(openConversation(resolved, paths, target))
    const historyChars = history.tokens * 4

    const cap = c.req.query('detail') === '1' ? Number.POSITIVE_INFINITY : 30
    const totalsChars = systemPromptChars + toolsSchemaChars + historyChars
    return c.json({
      agentId: resolved.agent.id,
      model: resolved.model,
      systemPrompt: {
        chars: systemPromptChars,
        tokens: estimateTokens(systemPromptChars),
        files,
        skillsListChars: sectionChars('skills'),
        teamListChars: sectionChars('team'),
        userMdChars: sectionChars('user'),
        memoryHintChars: sectionChars('memory'),
      },
      tools: {
        count: turn.tools.length,
        listChars: toolsListChars,
        schemaChars: toolsSchemaChars,
        entries: toolEntries.slice(0, cap),
      },
      skills: { count: resolved.skills.length, entries: skillEntries.slice(0, cap) },
      team,
      history: {
        messageEntries: history.messageEntries,
        compactionEntries: history.compactionEntries,
        chars: historyChars,
        bytes: loadSessionHead(resolved, paths, target).size,
        tokensEstimate: history.tokens,
      },
      totals: { chars: totalsChars, tokens: estimateTokens(totalsChars) },
    } satisfies ChatContextResponse)
  }),
)

agentChatRouter.post('/:id/chat/truncate', async (c) => {
  const body = await jsonBody<TruncateChatRequest>(c)
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  const keep = Number(body.keepCount)
  if (!Number.isInteger(keep) || keep < 0) {
    return c.json({ error: 'keepCount must be a non-negative integer' }, 400)
  }
  return withSelectedConversation(c, (id, target) => {
    // keepCount counts the messages of the conversation the client shows.
    if (body.conversationId !== undefined && body.conversationId !== target.id) {
      throw new ConversationChangedError()
    }
    const { db, paths } = getCtx()
    const conversation = openConversation(resolveAgent(db, paths, id), paths, target)
    // The messages a client shows: Pi's system-prompt entries are not among them.
    const messageEntries = conversation
      .getBranch()
      .filter((e) => e.type === 'message' && e.message.role !== 'system')
    const before = messageEntries.length
    const after = Math.max(0, Math.min(keep, before))
    if (after === before) return c.json({ before, after } satisfies TruncateChatResponse)

    const lastKept = messageEntries[after - 1]
    if (lastKept) conversation.branch(lastKept.id)
    else conversation.resetLeaf()
    // Moving the leaf only lasts in memory; an appended marker makes it the file's last entry,
    // which is where the next turn continues. Pi leaves it out of the model's context.
    conversation.appendCustomEntry('bazilion.truncate', { keep: after })
    return c.json({ before, after } satisfies TruncateChatResponse)
  })
})
