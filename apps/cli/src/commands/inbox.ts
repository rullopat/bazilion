import {
  type Agent,
  type AgentLoopBreakEvent,
  type ListAgentLoopBreaksResponse,
  type ListExchangesResponse,
  type ListInboxResponse,
  type Message,
  type StopExchangeResponse,
  usageSummary,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { type BazilionClient, createClient } from '../client.ts'
import { agentArg, apiPath, positional, printRows, teamArg } from '../command-helpers.ts'

const messageArg = positional('Message id')

function decodeText(payload: string): string {
  try {
    const obj = JSON.parse(payload) as { text?: unknown }
    if (typeof obj.text === 'string') return obj.text
  } catch {}
  return payload
}

function messageRow(m: Message): string[] {
  const when = new Date(m.createdAt).toISOString()
  const state = m.readAt ? 'read' : 'NEW'
  const text = decodeText(m.payload)
  const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text
  return [m.id, state, when, `from:${m.fromAgentId.slice(0, 8)}`, `"${preview}"`]
}

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List messages in an agent inbox' },
  args: {
    agent: positional('Recipient agent id or prefix'),
    unread: { type: 'boolean', description: 'Only show unread messages' },
  },
  async run({ args }) {
    const { messages } = await createClient().get<ListInboxResponse>(
      `${apiPath('agents', args.agent, 'messages')}${args.unread ? '?unread=1' : ''}`,
    )
    printRows(messages.map(messageRow), args.unread ? '(no unread messages)' : '(inbox empty)')
  },
})

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show a single message in full' },
  args: { id: messageArg },
  async run({ args }) {
    const m = await createClient().get<Message>(apiPath('messages', args.id))
    const when = new Date(m.createdAt).toISOString()
    const read = m.readAt ? new Date(m.readAt).toISOString() : '(unread)'
    console.log(`id:        ${m.id}`)
    console.log(`from:      ${m.fromAgentId}`)
    console.log(`to:        ${m.toAgentId}`)
    console.log(`created:   ${when}`)
    console.log(`read:      ${read}`)
    if (m.replyTo) console.log(`reply_to:  ${m.replyTo}`)
    console.log('')
    console.log(decodeText(m.payload))
  },
})

const readCmd = defineCommand({
  meta: { name: 'read', description: 'Mark a message as read' },
  args: { id: messageArg },
  async run({ args }) {
    await createClient().patch<Message>(apiPath('messages', args.id), { read: true })
    console.log(`marked read: ${args.id}`)
  },
})

async function agentNames(client: BazilionClient): Promise<(id: string) => string> {
  const names = new Map(
    (await client.get<Agent[]>('/api/agents?includeArchived=true')).map((a) => [a.id, a.name]),
  )
  return (id) => names.get(id) ?? id.slice(0, 8)
}

const STOPPED: Record<AgentLoopBreakEvent['reason'], string> = {
  repeated_message: 'repeated a message: not delivered',
  stopped: 'stopped by you',
  step_limit: 'step limit of earlier versions',
}

const stoppedCmd = defineCommand({
  meta: { name: 'stopped', description: 'List the stopped exchanges an Agent was in' },
  args: {
    agent: agentArg,
    limit: { type: 'string', description: 'Maximum to show (default 50)' },
  },
  async run({ args }) {
    const client = createClient()
    const limit = args.limit ? `?limit=${encodeURIComponent(args.limit)}` : ''
    const [{ events }, name] = await Promise.all([
      client.get<ListAgentLoopBreaksResponse>(
        `${apiPath('agents', args.agent, 'loop-breaks')}${limit}`,
      ),
      agentNames(client),
    ])
    printRows(
      events.map((event) => [
        new Date(event.createdAt).toISOString(),
        event.causalChainId,
        `${name(event.fromAgentId)} → ${name(event.toAgentId)}`,
        `step ${event.step}`,
        STOPPED[event.reason],
      ]),
      '(no stopped exchanges)',
    )
  },
})

const exchangesCmd = defineCommand({
  meta: {
    name: 'exchanges',
    description: "List the exchanges between a Team's Agents going on now, with what each used",
  },
  args: { team: teamArg },
  async run({ args }) {
    const client = createClient()
    const [{ exchanges }, name] = await Promise.all([
      client.get<ListExchangesResponse>(apiPath('teams', args.team, 'exchanges')),
      agentNames(client),
    ])
    printRows(
      exchanges.map((exchange) => [
        exchange.id,
        exchange.agentIds.map(name).join(' → '),
        `${exchange.messages} message${exchange.messages === 1 ? '' : 's'}`,
        `since ${new Date(exchange.startedAt).toISOString()}`,
        exchange.used.calls > 0 ? usageSummary(exchange.used) : 'nothing used yet',
        exchange.runningAgentIds.length > 0
          ? `working: ${exchange.runningAgentIds.map(name).join(', ')}`
          : 'waiting to be read',
      ]),
      '(no exchange going on)',
    )
  },
})

const stopCmd = defineCommand({
  meta: {
    name: 'stop',
    description: 'Stop an exchange between Agents: its turns stop and nothing in it is delivered',
  },
  args: { exchange: positional('Exchange id (see: bazilion inbox exchanges <team>)') },
  async run({ args }) {
    const result = await createClient().post<StopExchangeResponse>(
      apiPath('exchanges', args.exchange, 'stop'),
    )
    if (!result.stopped) {
      console.log(`exchange ${args.exchange} was stopped already`)
      return
    }
    const turns = result.cancelled.length
    console.log(
      `stopped exchange ${args.exchange}: ${turns} turn${turns === 1 ? '' : 's'} stopped, ` +
        `${result.unread} unread message${result.unread === 1 ? '' : 's'} not delivered`,
    )
  },
})

export const inboxCommand = defineCommand({
  meta: { name: 'inbox', description: 'Inspect agent inboxes and the exchanges between Agents' },
  subCommands: {
    list: listCmd,
    show: showCmd,
    read: readCmd,
    exchanges: exchangesCmd,
    stop: stopCmd,
    stopped: stoppedCmd,
  },
})
