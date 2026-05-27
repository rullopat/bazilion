// /api/agents/* — agent CRUD + lifecycle + sub-resources (group, skills,
// triggers, messages, sessions, chat). Memory is per-group and lives on
// the groups router.
//
// Sub-resources are inlined here rather than split across files because they
// all share `/api/agents/:id/...` and benefit from being adjacent — e.g. the
// chat streaming endpoint and chat/compact next to each other.

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  type AttachSkillRequest,
  type ChatCompactRequest,
  type ChatCompactResponse,
  type ChatContextResponse,
  type ContextFileEntry,
  type ContextGroupEntry,
  type ContextSkillEntry,
  type ContextToolEntry,
  type CreateTriggerRequest,
  type ListInboxResponse,
  type MoveAgentRequest,
  REASONING_LEVELS,
  type ReasoningLevel,
  type ResolvedSkillsResponse,
  type SendMessageRequest,
  type SessionHeadResponse,
  type SpawnAgentRequest,
  type TruncateChatRequest,
  type TruncateChatResponse,
} from '@bazilion/api-types'
import { Hono } from 'hono'
import {
  agentRepo,
  archiveAgent,
  deleteAgent,
  discoverSkills,
  groupRepo,
  mergeSecretsIntoEnv,
  messageRepo,
  providerStateRepo,
  resolveAgent,
  resolveAgentSkills,
  skillMetaRepo,
  spawnAgent,
  triggerRepo,
  unarchiveAgent,
} from '../core/index.ts'
import { cancelAgent } from '../lib/agent-cancel.ts'
import { resolveAgentIdParam } from '../lib/agent-id.ts'
import { runAgentTurn } from '../lib/agent-turn.ts'
import { resolveAgentApiKey } from '../lib/api-key.ts'
import { validateCron } from '../lib/cron.ts'
import { getCtx } from '../lib/ctx.ts'
import { createDbMessagingHost } from '../lib/messaging-host.ts'
import { getTelegramBotApi } from '../lib/telegram/bot.ts'
import { notifyDirectoryDirty } from '../lib/telegram/directory.ts'
import { ensureAgentTopic } from '../lib/telegram/topic-autocreate.ts'
import {
  buildSystemPrompt,
  createBazilionSession,
  loadInitialMessages,
  loadSessionHead,
  piMessagesToProviderView,
  qmdBackend,
} from '../runtime/index.ts'

export const agentsRouter = new Hono()

// ─── CRUD + lifecycle ────────────────────────────────────────────────────

agentsRouter.get('/', (c) => {
  const includeArchived = c.req.query('includeArchived') === 'true'
  const { db, paths, authToken } = getCtx()
  return c.json(agentRepo.list(db, { includeArchived }))
})

agentsRouter.post('/', async (c) => {
  const raw = (await c.req.json().catch(() => null)) as
    | (Record<string, unknown> & Partial<SpawnAgentRequest>)
    | null
  if (!raw) return c.json({ error: 'invalid JSON body' }, 400)
  const profileId =
    typeof raw.profileId === 'string'
      ? raw.profileId
      : typeof raw.profile === 'string'
        ? raw.profile
        : ''
  if (!profileId) return c.json({ error: 'profileId is required' }, 400)
  const name = typeof raw.name === 'string' && raw.name ? raw.name : undefined
  const model =
    typeof raw.model === 'string' && raw.model
      ? raw.model
      : typeof raw.modelOverride === 'string' && raw.modelOverride
        ? raw.modelOverride
        : undefined
  const groupId =
    typeof raw.groupId === 'string' && raw.groupId
      ? raw.groupId
      : typeof raw.group === 'string' && raw.group
        ? (raw.group as string)
        : undefined
  let reasoningLevel: ReasoningLevel | undefined
  if (typeof raw.reasoningLevel === 'string') {
    if (!REASONING_LEVELS.includes(raw.reasoningLevel as ReasoningLevel)) {
      return c.json({ error: `invalid reasoningLevel: ${raw.reasoningLevel}` }, 400)
    }
    reasoningLevel = raw.reasoningLevel as ReasoningLevel
  }

  const { db, paths, authToken } = getCtx()
  try {
    const agent = spawnAgent(db, paths, {
      profileId,
      name,
      modelOverride: model,
      reasoningLevel,
      groupId,
    })
    notifyDirectoryDirty()
    return c.json(agent, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

agentsRouter.get('/:id', (c) => {
  const { db, paths, authToken } = getCtx()
  const id = resolveAgentIdParam(db, c.req.param('id'))
  try {
    return c.json(resolveAgent(db, paths, id))
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404)
  }
})

agentsRouter.patch('/:id', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  const { db, paths, authToken } = getCtx()
  const resolvedId = agentRepo.resolveId(db, c.req.param('id'))
  if (!resolvedId) return c.json({ error: `agent not found: ${c.req.param('id')}` }, 404)

  let nameChanged = false
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') return c.json({ error: 'name must be a string' }, 400)
    const trimmed = body.name.trim()
    if (!trimmed) return c.json({ error: 'name cannot be empty' }, 400)
    agentRepo.setName(db, resolvedId, trimmed)
    nameChanged = true
  }
  if (body.telegramMirrorMode !== undefined) {
    if (body.telegramMirrorMode !== 'minimal' && body.telegramMirrorMode !== 'verbose') {
      return c.json(
        { error: `invalid telegramMirrorMode: ${String(body.telegramMirrorMode)}` },
        400,
      )
    }
    agentRepo.setTelegramMirrorMode(db, resolvedId, body.telegramMirrorMode)
  }
  if (body.reasoningLevel !== undefined) {
    if (
      typeof body.reasoningLevel !== 'string' ||
      !REASONING_LEVELS.includes(body.reasoningLevel as ReasoningLevel)
    ) {
      return c.json({ error: `invalid reasoningLevel: ${body.reasoningLevel}` }, 400)
    }
    agentRepo.setReasoningLevel(db, resolvedId, body.reasoningLevel as ReasoningLevel)
  }
  if (body.modelOverride !== undefined) {
    if (body.modelOverride !== null && typeof body.modelOverride !== 'string') {
      return c.json({ error: 'modelOverride must be a string or null' }, 400)
    }
    const value = body.modelOverride === '' ? null : (body.modelOverride as string | null)
    agentRepo.setModelOverride(db, resolvedId, value)
  }

  // Telegram directory shows agent names; refresh if rename happened.
  if (nameChanged) notifyDirectoryDirty()

  const agent = agentRepo.get(db, resolvedId)
  if (!agent) return c.json({ error: 'agent vanished after update' }, 404)
  return c.json(agent)
})

agentsRouter.delete('/:id', (c) => {
  const { db, paths, authToken } = getCtx()
  try {
    deleteAgent(db, c.req.param('id'))
    notifyDirectoryDirty()
    return c.body(null, 204)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

agentsRouter.post('/:id/archive', (c) => {
  const { db, paths, authToken } = getCtx()
  try {
    archiveAgent(db, c.req.param('id'))
    notifyDirectoryDirty()
    return c.body(null, 204)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

agentsRouter.post('/:id/unarchive', (c) => {
  const { db, paths, authToken } = getCtx()
  try {
    unarchiveAgent(db, c.req.param('id'))
    notifyDirectoryDirty()
    return c.body(null, 204)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

// ─── Telegram binding ────────────────────────────────────────────────────
//
// These endpoints mirror the topic-context `/talk` and `/unbind` commands
// in HTTP form, so the web UI + CLI can manage bindings without going
// through Telegram itself. POST /:id/telegram/bind invokes the same
// `ensureAgentTopic` primitive `/talk` uses; DELETE /:id/telegram/binding
// just clears the column.

agentsRouter.post('/:id/telegram/bind', async (c) => {
  const { db, paths } = getCtx()
  const resolvedId = agentRepo.resolveId(db, c.req.param('id'))
  if (!resolvedId) return c.json({ error: `agent not found: ${c.req.param('id')}` }, 404)
  const live = getTelegramBotApi()
  if (!live) {
    return c.json(
      {
        error:
          'Telegram bot is not running — configure credentials at /config/integrations/telegram',
      },
      503,
    )
  }
  const result = await ensureAgentTopic({
    db,
    paths,
    api: live.api as unknown as Parameters<typeof ensureAgentTopic>[0]['api'],
    chatId: live.chatId,
    agentId: resolvedId,
  })
  if (result.kind === 'agent-not-found')
    return c.json({ error: `agent not found: ${resolvedId}` }, 404)
  if (result.kind === 'group-not-found') return c.json({ error: `group not found for agent` }, 500)
  // notifyDirectoryDirty is already called inside ensureAgentTopic.
  const agent = agentRepo.get(db, resolvedId)
  return c.json({
    agent,
    topicId: result.topicId,
    deepLink: result.deepLink,
    created: result.created,
  })
})

agentsRouter.delete('/:id/telegram/binding', (c) => {
  const { db } = getCtx()
  const resolvedId = agentRepo.resolveId(db, c.req.param('id'))
  if (!resolvedId) return c.json({ error: `agent not found: ${c.req.param('id')}` }, 404)
  agentRepo.setTelegramTopicId(db, resolvedId, null)
  notifyDirectoryDirty()
  return c.body(null, 204)
})

// ─── Group move ──────────────────────────────────────────────────────────

agentsRouter.patch('/:id/group', async (c) => {
  const body = (await c.req.json().catch(() => null)) as MoveAgentRequest | null
  if (!body || typeof body.groupId !== 'string' || !body.groupId) {
    return c.json({ error: 'groupId (string) is required' }, 400)
  }
  const { db, paths, authToken } = getCtx()
  let resolved: ReturnType<typeof resolveAgent>
  try {
    resolved = resolveAgent(db, paths, c.req.param('id'))
  } catch {
    return c.json({ error: `agent not found: ${c.req.param('id')}` }, 404)
  }
  if (!groupRepo.get(db, body.groupId, paths)) {
    return c.json({ error: `group not found: ${body.groupId}` }, 404)
  }
  agentRepo.setGroup(db, resolved.agent.id, body.groupId)
  notifyDirectoryDirty()
  return c.json(resolveAgent(db, paths, resolved.agent.id))
})

// ─── Skills ──────────────────────────────────────────────────────────────

agentsRouter.get('/:id/skills', (c) => {
  const { db, paths, authToken } = getCtx()
  const id = resolveAgentIdParam(db, c.req.param('id'))
  const set = resolveAgentSkills(db, paths, id)
  const body: ResolvedSkillsResponse = {
    resolved: set.resolved.map((s) => {
      const meta = skillMetaRepo.get(db, s.name)
      return {
        name: s.name,
        description: s.parsed.frontmatter.description,
        source: meta?.source ?? null,
        importedAt: meta?.importedAt ?? null,
      }
    }),
    missing: set.missing,
  }
  return c.json(body)
})

agentsRouter.post('/:id/skills', async (c) => {
  const body = (await c.req.json().catch(() => null)) as AttachSkillRequest | null
  if (!body || typeof body.skill !== 'string' || !body.skill) {
    return c.json({ error: 'skill is required' }, 400)
  }
  const { db, paths, authToken } = getCtx()
  const agent = agentRepo.get(db, c.req.param('id'))
  if (!agent) return c.json({ error: `agent not found: ${c.req.param('id')}` }, 404)
  agentRepo.attachSkill(db, agent.id, body.skill)
  return c.body(null, 204)
})

agentsRouter.delete('/:id/skills/:name', (c) => {
  const { db, paths, authToken } = getCtx()
  const id = resolveAgentIdParam(db, c.req.param('id'))
  agentRepo.detachSkill(db, id, c.req.param('name'))
  return c.body(null, 204)
})

// ─── Triggers ────────────────────────────────────────────────────────────

agentsRouter.get('/:id/triggers', (c) => {
  const { db, paths, authToken } = getCtx()
  const agent = agentRepo.get(db, c.req.param('id'))
  if (!agent) return c.json({ error: `agent not found: ${c.req.param('id')}` }, 404)
  return c.json({ triggers: triggerRepo.listForAgent(db, agent.id) })
})

agentsRouter.post('/:id/triggers', async (c) => {
  const body = (await c.req.json().catch(() => null)) as CreateTriggerRequest | null
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  if (typeof body.message !== 'string' || !body.message.trim()) {
    return c.json({ error: 'message is required' }, 400)
  }
  const { db, paths, authToken } = getCtx()
  const agent = agentRepo.get(db, c.req.param('id'))
  if (!agent) return c.json({ error: `agent not found: ${c.req.param('id')}` }, 404)

  if (body.kind === 'interval') {
    if (!Number.isFinite(body.intervalSec) || (body.intervalSec ?? 0) <= 0) {
      return c.json({ error: 'intervalSec must be a positive number' }, 400)
    }
    const trigger = triggerRepo.insert(db, {
      agentId: agent.id,
      kind: 'interval',
      intervalSec: Math.floor(body.intervalSec as number),
      cronExpr: null,
      message: body.message,
      enabled: body.enabled,
    })
    return c.json({ trigger }, 201)
  }

  if (body.kind === 'cron') {
    if (typeof body.cronExpr !== 'string' || !body.cronExpr.trim()) {
      return c.json({ error: 'cronExpr is required for kind=cron' }, 400)
    }
    try {
      validateCron(body.cronExpr)
    } catch (err) {
      return c.json({ error: `invalid cron: ${(err as Error).message}` }, 400)
    }
    const trigger = triggerRepo.insert(db, {
      agentId: agent.id,
      kind: 'cron',
      intervalSec: null,
      cronExpr: body.cronExpr.trim(),
      message: body.message,
      enabled: body.enabled,
    })
    return c.json({ trigger }, 201)
  }

  return c.json({ error: `invalid kind: ${body.kind}` }, 400)
})

// ─── Messages ────────────────────────────────────────────────────────────

agentsRouter.get('/:id/messages', (c) => {
  const { db, paths, authToken } = getCtx()
  const agent = agentRepo.get(db, c.req.param('id'))
  if (!agent) return c.json({ error: `agent not found: ${c.req.param('id')}` }, 404)
  const unreadOnly = c.req.query('unread') === '1'
  const body: ListInboxResponse = {
    messages: messageRepo.listInbox(db, agent.id, { unreadOnly }),
  }
  return c.json(body)
})

agentsRouter.post('/:id/messages', async (c) => {
  const body = (await c.req.json().catch(() => null)) as SendMessageRequest | null
  if (
    !body ||
    typeof body.from !== 'string' ||
    !body.from ||
    !body.payload ||
    typeof body.payload.text !== 'string'
  ) {
    return c.json({ error: 'from and payload.text are required' }, 400)
  }
  const { db, paths, authToken } = getCtx()
  const fromAgent = agentRepo.get(db, body.from)
  if (!fromAgent) return c.json({ error: `agent not found: ${body.from}` }, 404)
  const toAgent = agentRepo.get(db, c.req.param('id'))
  if (!toAgent) return c.json({ error: `agent not found: ${c.req.param('id')}` }, 404)
  if (body.replyTo && !messageRepo.get(db, body.replyTo)) {
    return c.json({ error: `reply target not found: ${body.replyTo}` }, 404)
  }
  const msg = messageRepo.send(db, {
    from: fromAgent.id,
    to: toAgent.id,
    payload: JSON.stringify({ text: body.payload.text }),
    replyTo: body.replyTo ?? null,
  })
  return c.json(msg, 201)
})

// ─── Cancel ──────────────────────────────────────────────────────────────

// Aborts the agent's currently-running turn, if any. Returns 204 on a
// successful abort, 409 when the agent is idle. Cancellation drives off the
// in-memory agent-cancel registry, which is also what the scheduler probes
// to skip overlapping inbox wakes / triggers.
agentsRouter.post('/:id/cancel', (c) => {
  const { db, paths, authToken } = getCtx()
  const id = resolveAgentIdParam(db, c.req.param('id'))
  const cancelled = cancelAgent(id)
  if (!cancelled) return c.json({ error: 'agent has no active turn' }, 409)
  return c.body(null, 204)
})

// ─── Sessions ────────────────────────────────────────────────────────────

agentsRouter.get('/:id/sessions/head', (c) => {
  const { db, paths, authToken } = getCtx()
  let resolved: ReturnType<typeof resolveAgent>
  try {
    resolved = resolveAgent(db, paths, c.req.param('id'))
  } catch {
    return c.json({ error: `agent not found: ${c.req.param('id')}` }, 404)
  }
  const head: SessionHeadResponse = loadSessionHead(resolved, paths)
  return c.json(head)
})

/**
 * Returns the agent's prior transcript flattened to ProviderMessage[].
 * SSR loaders use it to render the chat history on first paint without
 * touching pi or the filesystem from the web process.
 */
agentsRouter.get('/:id/sessions/messages', (c) => {
  const { db, paths, authToken } = getCtx()
  let resolved: ReturnType<typeof resolveAgent>
  try {
    resolved = resolveAgent(db, paths, c.req.param('id'))
  } catch {
    return c.json({ error: `agent not found: ${c.req.param('id')}` }, 404)
  }
  const messages = piMessagesToProviderView(loadInitialMessages(resolved, paths))
  return c.json({ messages })
})

// ─── Chat ────────────────────────────────────────────────────────────────

/**
 * Streaming chat endpoint. Server-authoritative: prior history is read by
 * pi's SessionManager from the agent's JSONL session file. The client sends
 * only `{ message }`. Response is NDJSON-encoded `ChatFrame`s.
 */
agentsRouter.post('/:id/chat', async (c) => {
  const { db, paths, authToken } = getCtx()
  const id = resolveAgentIdParam(db, c.req.param('id'))

  let body: { message?: string }
  try {
    body = (await c.req.json()) as { message?: string }
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }
  const message = body.message
  if (!message || typeof message !== 'string') {
    return c.json({ error: 'message is required' }, 400)
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        for await (const frame of runAgentTurn(id, message)) {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
          } catch {
            // client disconnected — keep draining so state gets saved
          }
        }
      } catch (err) {
        try {
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ kind: 'fatal', error: (err as Error).message })}\n`),
          )
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

agentsRouter.post('/:id/chat/compact', async (c) => {
  let body: ChatCompactRequest = {}
  if (c.req.header('content-length') !== '0') {
    try {
      const parsed = (await c.req.json()) as ChatCompactRequest | null
      if (parsed && typeof parsed === 'object') body = parsed
    } catch {
      // empty body is allowed — all fields optional
    }
  }

  const { db, paths, authToken } = getCtx()
  const id = resolveAgentIdParam(db, c.req.param('id'))
  if (!agentRepo.get(db, id)) return c.json({ error: 'agent not found' }, 404)

  const resolved = resolveAgent(db, paths, id)
  const memory = qmdBackend(join(resolved.group.path, 'memory'))
  await memory.init()
  const env = mergeSecretsIntoEnv(db, authToken)

  const apiKeyResolution = await resolveAgentApiKey(db, authToken, resolved, {
    withRefresher: true,
  })
  const handle = await createBazilionSession({
    agent: resolved,
    paths,
    env,
    memory,
    enabledProviders: providerStateRepo.listEnabled(db),
    messagingHost: createDbMessagingHost(db),
    ...apiKeyResolution,
  })
  try {
    const entriesBefore = handle.session.sessionManager.getEntries().length
    const result = await handle.session.compact(body.customInstructions)
    const entriesAfter = handle.session.sessionManager.getEntries().length

    let keptTail = 0
    if (result.firstKeptEntryId) {
      const branch = handle.session.sessionManager.getBranch()
      const idx = branch.findIndex((e) => e.id === result.firstKeptEntryId)
      if (idx >= 0) for (const e of branch.slice(idx)) if (e.type === 'message') keptTail++
    }

    const tokensAfter = handle.session.getContextUsage()?.tokens ?? 0

    const resp: ChatCompactResponse = {
      before: entriesBefore,
      after: entriesAfter,
      summarized: Math.max(0, entriesBefore - entriesAfter + 1),
      keptTail,
      tokensBefore: result.tokensBefore,
      tokensAfter,
      summary: result.summary,
    }
    return c.json(resp)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502)
  } finally {
    handle.dispose()
  }
})

agentsRouter.get('/:id/chat/context', async (c) => {
  const { db, paths, authToken } = getCtx()
  const id = resolveAgentIdParam(db, c.req.param('id'))
  if (!agentRepo.get(db, id)) return c.json({ error: 'agent not found' }, 404)

  const resolved = resolveAgent(db, paths, id)

  const files: ContextFileEntry[] = []
  for (const file of CONTEXT_FILE_ORDER) {
    const path = join(resolved.agent.dir, file)
    if (!existsSync(path)) continue
    const content = readFileSync(path, 'utf8').trimEnd()
    if (!content) continue
    const chars = content.length + file.length + 6
    files.push({ name: file, chars, tokens: estimateTokens(chars) })
  }
  const systemPromptText = buildSystemPrompt(resolved)
  const systemPromptChars = systemPromptText.length

  const skillsListChars =
    resolved.skills.length > 0
      ? `# Available Skills\n\nYou have access to the following skills: ${resolved.skills.join(', ')}.`
          .length
      : 0
  const groupLines = [
    '# Group',
    '',
    `- ${resolved.group.id} (${resolved.group.name}): ${resolved.group.path}`,
    '',
    'Your group is where work product lives — code, docs, artefacts, shared scratch. It may be shared with other agents in the same group. Your coding tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) are rooted at the group directory. Never use these tools to edit your identity/soul/behaviour files — those live in your home and are reached via `home_write` / `home_read`.',
  ]
  const groupListChars = groupLines.join('\n').length
  const userMdChars = resolved.group.userMd.trim()
    ? `# About the User\n\nRead-only context about the human you're working with in this group. You cannot edit this — if it's wrong, say so and they will update it.\n\n${resolved.group.userMd.trim()}`
        .length
    : 0
  const memoryHintChars =
    '# Memory\n\nYou have a persistent memory backend. Use `memory_write` to remember things across sessions, and `memory_search` / `memory_read` / `memory_list` to recall them. Always check memory at the start of a session if the user might have told you something important before.'
      .length

  const memory = qmdBackend(join(resolved.group.path, 'memory'))
  await memory.init()
  const env = mergeSecretsIntoEnv(db, authToken)
  const apiKeyResolution = await resolveAgentApiKey(db, authToken, resolved, {
    withRefresher: true,
  })
  const handle = await createBazilionSession({
    agent: resolved,
    paths,
    env,
    memory,
    enabledProviders: providerStateRepo.listEnabled(db),
    messagingHost: createDbMessagingHost(db),
    ...apiKeyResolution,
  })

  try {
    const toolInfos = handle.session.getAllTools()
    let toolsSchemaChars = 0
    let toolsListChars = 0
    const toolEntries: ContextToolEntry[] = []
    for (const info of toolInfos) {
      const schemaJson = JSON.stringify(info.parameters ?? {})
      const schemaChars = schemaJson.length
      const descriptionChars = info.description.length
      toolsSchemaChars += schemaChars
      toolsListChars += info.name.length + descriptionChars + 3
      toolEntries.push({
        name: info.name,
        schemaChars,
        descriptionChars,
        paramCount: countProperties(info.parameters),
      })
    }
    toolEntries.sort((a, b) => b.schemaChars - a.schemaChars)

    const installed = discoverSkills(paths)
    const skillEntries: ContextSkillEntry[] = []
    for (const name of resolved.skills) {
      const match = installed.find((s) => s.name === name)
      let blockChars = name.length + 2
      if (match) {
        try {
          blockChars = readFileSync(match.skillFile, 'utf8').length
        } catch {}
      }
      skillEntries.push({ name, blockChars })
    }
    skillEntries.sort((a, b) => b.blockChars - a.blockChars)

    const group: ContextGroupEntry = {
      id: resolved.group.id,
      name: resolved.group.name,
      path: resolved.group.path,
      userMdChars: resolved.group.userMd.length,
    }

    const stats = handle.session.getSessionStats()
    const historyChars = stats.tokens.total * 4
    const messageEntries = stats.userMessages + stats.assistantMessages + stats.toolResults
    const compactionEntries = handle.session.sessionManager
      .getEntries()
      .filter((e) => e.type === 'compaction').length
    const contextUsage = handle.session.getContextUsage()
    const historyTokens = contextUsage?.tokens ?? stats.tokens.total

    const detail = c.req.query('detail') === '1' || c.req.query('json') === '1'
    const CAP = 30
    const toolEntriesOut = detail ? toolEntries : toolEntries.slice(0, CAP)
    const skillEntriesOut = detail ? skillEntries : skillEntries.slice(0, CAP)

    const totalsChars = systemPromptChars + toolsSchemaChars + historyChars
    const resp: ChatContextResponse = {
      agentId: resolved.agent.id,
      model: resolved.model,
      systemPrompt: {
        chars: systemPromptChars,
        tokens: estimateTokens(systemPromptChars),
        files,
        skillsListChars,
        groupListChars,
        userMdChars,
        memoryHintChars,
      },
      tools: {
        count: toolInfos.length,
        listChars: toolsListChars,
        schemaChars: toolsSchemaChars,
        entries: toolEntriesOut,
      },
      skills: {
        count: resolved.skills.length,
        entries: skillEntriesOut,
      },
      group,
      history: {
        messageEntries,
        compactionEntries,
        chars: historyChars,
        bytes: historyChars,
        tokensEstimate: historyTokens,
      },
      totals: {
        chars: totalsChars,
        tokens: estimateTokens(totalsChars),
      },
    }
    return c.json(resp)
  } finally {
    handle.dispose()
  }
})

agentsRouter.post('/:id/chat/reset', (c) => {
  const { db, paths, authToken } = getCtx()
  const id = resolveAgentIdParam(db, c.req.param('id'))
  const agent = agentRepo.get(db, id)
  if (!agent) return c.json({ error: 'agent not found' }, 404)

  const sessionsDir = join(paths.agentDir(agent.id), 'sessions')
  let deleted = 0
  if (existsSync(sessionsDir)) {
    for (const file of readdirSync(sessionsDir)) {
      if (!file.endsWith('.jsonl')) continue
      try {
        rmSync(join(sessionsDir, file))
        deleted++
      } catch {
        // best-effort
      }
    }
  }
  return c.json({ ok: true, deletedSessionFiles: deleted })
})

agentsRouter.post('/:id/chat/truncate', async (c) => {
  let body: TruncateChatRequest
  try {
    body = (await c.req.json()) as TruncateChatRequest
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }
  const keep = Number(body.keepCount)
  if (!Number.isFinite(keep) || keep < 0 || !Number.isInteger(keep)) {
    return c.json({ error: 'keepCount must be a non-negative integer' }, 400)
  }

  const { db, paths, authToken } = getCtx()
  const id = resolveAgentIdParam(db, c.req.param('id'))
  if (!agentRepo.get(db, id)) return c.json({ error: 'agent not found' }, 404)

  const resolved = resolveAgent(db, paths, id)
  const memory = qmdBackend(join(resolved.group.path, 'memory'))
  await memory.init()
  const env = mergeSecretsIntoEnv(db, authToken)

  const apiKeyResolution = await resolveAgentApiKey(db, authToken, resolved, {
    withRefresher: true,
  })
  const handle = await createBazilionSession({
    agent: resolved,
    paths,
    env,
    memory,
    enabledProviders: providerStateRepo.listEnabled(db),
    messagingHost: createDbMessagingHost(db),
    ...apiKeyResolution,
  })
  try {
    const branch = handle.session.sessionManager.getBranch()
    const messageEntries = branch.filter((e) => e.type === 'message')
    const before = messageEntries.length
    const target = Math.max(0, Math.min(keep, before))

    if (target === before) {
      return c.json({ before, after: before } satisfies TruncateChatResponse)
    }

    if (target === 0) {
      handle.session.sessionManager.resetLeaf()
    } else {
      const lastKept = messageEntries[target - 1]
      if (!lastKept) return c.json({ error: 'internal: missing target entry' }, 500)
      handle.session.sessionManager.branch(lastKept.id)
    }

    return c.json({ before, after: target } satisfies TruncateChatResponse)
  } finally {
    handle.dispose()
  }
})

// ─── helpers ─────────────────────────────────────────────────────────────

const CONTEXT_FILE_ORDER = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
] as const

function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4)
}

function countProperties(schema: unknown): number | null {
  if (!schema || typeof schema !== 'object') return null
  const props = (schema as { properties?: unknown }).properties
  if (!props || typeof props !== 'object') return null
  return Object.keys(props as Record<string, unknown>).length
}
