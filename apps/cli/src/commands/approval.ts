import type {
  CommunicationApproval,
  CommunicationApprovalDetail,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

const list = defineCommand({
  meta: { name: 'list', description: 'List communication approval queue/history' },
  args: {
    status: { type: 'string', default: 'pending' },
    group: { type: 'string' },
    json: { type: 'boolean' },
  },
  async run({ args }) {
    const query = new URLSearchParams({ status: args.status, limit: '100' })
    if (args.group) query.set('groupId', args.group)
    const body = await createClient().get<{ approvals: CommunicationApproval[] }>(
      `/api/approvals?${query}`,
    )
    if (args.json) return console.log(JSON.stringify(body, null, 2))
    if (!body.approvals.length) return console.log('(no approvals)')
    for (const line of columnize([
      ['id', 'status', 'path', 'origin', 'expires'],
      ...body.approvals.map((item) => [
        item.id,
        item.status,
        `${endpoint(item.source)} -> ${endpoint(item.target)}`,
        item.origin,
        new Date(item.expiresAt).toISOString(),
      ]),
    ]))
      console.log(line)
  },
})

const show = defineCommand({
  meta: { name: 'show', description: 'Show one approval including payload and audit events' },
  args: { id: { type: 'positional', required: true }, json: { type: 'boolean' } },
  async run({ args }) {
    const item = await createClient().get<CommunicationApprovalDetail>(
      `/api/approvals/${encodeURIComponent(args.id)}`,
    )
    if (args.json) return console.log(JSON.stringify(item, null, 2))
    console.log(`# ${item.id}`)
    console.log(`status:    ${item.status}`)
    console.log(`attempt:   ${item.attemptKind}:${item.attemptId}`)
    console.log(`path:      ${endpoint(item.source)} -> ${endpoint(item.target)}`)
    console.log(`origin:    ${item.origin}`)
    console.log(`expires:   ${new Date(item.expiresAt).toISOString()}`)
    console.log(
      `revisions: ${item.policyRefs.map((ref) => `${ref.groupId}@${ref.revision}`).join(', ')}`,
    )
    console.log(`events:    ${item.events.map((event) => event.event).join(' -> ')}`)
  },
})

function decision(name: 'approve' | 'deny' | 'cancel') {
  return defineCommand({
    meta: {
      name,
      description:
        name === 'approve'
          ? 'Approve and deliver one captured attempt'
          : `${name === 'deny' ? 'Deny' : 'Cancel'} one pending attempt`,
    },
    args: {
      id: { type: 'positional', required: true },
      reason: { type: 'string' },
      yes: { type: 'boolean', description: 'Required explicit non-interactive confirmation' },
      json: { type: 'boolean' },
    },
    async run({ args }) {
      if (!args.yes) throw new Error(`refusing ${name}: review with approval show, then pass --yes`)
      const item = await createClient().post<CommunicationApproval>(
        `/api/approvals/${encodeURIComponent(args.id)}/${name}`,
        args.reason ? { reason: args.reason } : {},
      )
      if (args.json) console.log(JSON.stringify(item, null, 2))
      else console.log(`${item.id}: ${item.status}`)
    },
  })
}

function endpoint(value: CommunicationApproval['source']): string {
  return value.kind === 'agent'
    ? `agent:${value.id}`
    : value.kind === 'user'
      ? `user:${value.groupId}`
      : `outside:${value.groupId}`
}

export const approvalCommand = defineCommand({
  meta: { name: 'approval', description: 'Manage communication approval queue and history' },
  subCommands: {
    list,
    show,
    approve: decision('approve'),
    deny: decision('deny'),
    cancel: decision('cancel'),
  },
})
