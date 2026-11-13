import type { AttentionItem, AttentionListResponse, AttentionSummary } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'
import { apiPath, jsonFlag, positional, printJson } from '../command-helpers.ts'

const list = defineCommand({
  meta: { name: 'list', description: 'List operator attention items' },
  args: {
    state: { type: 'string', default: 'open', description: 'open, acknowledged or all' },
    kind: { type: 'string', description: 'Only items of this kind' },
    json: jsonFlag,
  },
  async run({ args }) {
    const query = new URLSearchParams({ state: args.state, limit: '200' })
    if (args.kind) query.set('kind', args.kind)
    const body = await createClient().get<AttentionListResponse>(`/api/attention?${query}`)
    if (args.json) return printJson(body)
    if (!body.items.length) console.log('(nothing needs attention)')
    else
      for (const line of columnize([
        ['severity', 'kind', 'context', 'when', 'key'],
        ...body.items.map((item) => [
          item.severity,
          item.kind,
          context(item),
          new Date(item.occurredAt).toISOString(),
          item.key,
        ]),
      ]))
        console.log(line)
    for (const source of body.degraded)
      console.error(`warning: ${source.kind} unavailable: ${source.error}`)
  },
})

const summary = defineCommand({
  meta: { name: 'summary', description: 'Summarize open attention items' },
  args: { json: jsonFlag },
  async run({ args }) {
    const body = await createClient().get<AttentionSummary>('/api/attention/summary')
    if (args.json) printJson(body)
    else
      console.log(
        `${body.openTotal} open · ${body.bySeverity.action_required} action required · ${body.bySeverity.error} errors · ${body.bySeverity.warning} warnings`,
      )
  },
})

function mutation(name: 'acknowledge' | 'unacknowledge') {
  return defineCommand({
    meta: { name, description: `${name} one informational attention item` },
    args: {
      key: positional('Attention item key'),
      yes: { type: 'boolean', description: 'Required confirmation' },
      json: jsonFlag,
    },
    async run({ args }) {
      if (!args.yes) throw new Error(`refusing mutation: pass --yes to ${name}`)
      const path = apiPath(
        'attention',
        args.key,
        name === 'acknowledge' ? 'acknowledge' : 'acknowledgement',
      )
      const body =
        name === 'acknowledge'
          ? await createClient().post<{ item: AttentionItem }>(path)
          : await createClient().del<{ item: AttentionItem }>(path)
      if (args.json) printJson(body)
      else console.log(`${body.item.key}: ${body.item.acknowledgedAt ? 'acknowledged' : 'open'}`)
    },
  })
}

const acknowledgeAll = defineCommand({
  meta: { name: 'acknowledge-all', description: 'Acknowledge all open informational items' },
  args: { yes: { type: 'boolean', description: 'Required confirmation' }, json: jsonFlag },
  async run({ args }) {
    if (!args.yes) throw new Error('refusing mutation: pass --yes to acknowledge-all')
    const body = await createClient().post<{ acknowledged: number }>(
      '/api/attention/acknowledge-all',
    )
    if (args.json) printJson(body)
    else console.log(`acknowledged ${body.acknowledged} informational item(s)`)
  },
})

function context(item: AttentionItem): string {
  return [item.agentName, item.teamName].filter(Boolean).join(' / ') || 'system'
}

export const attentionCommand = defineCommand({
  meta: { name: 'attention', description: 'Inspect the operator attention center' },
  subCommands: {
    list,
    summary,
    acknowledge: mutation('acknowledge'),
    unacknowledge: mutation('unacknowledge'),
    'acknowledge-all': acknowledgeAll,
  },
})
