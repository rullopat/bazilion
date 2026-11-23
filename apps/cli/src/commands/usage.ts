import {
  formatCost,
  formatTokens,
  type UsageReport,
  type UsageTotals,
  usageSummary,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { jsonFlag, printJson, printRows, terminalSafe } from '../command-helpers.ts'

// `bazilion usage`: tokens and cost per Team, Agent, model and day, as Manage → Usage shows them.

export function usageHeadline(report: UsageReport): string {
  const period =
    report.days === null
      ? 'everything saved'
      : report.days === 1
        ? `today (${report.to})`
        : `the last ${report.days} days (${report.from} to ${report.to})`
  return `Usage over ${period}, ${report.timeZone}`
}

/** The totals on a few lines: money, then tokens by how they are paid for. */
export function totalsLines(totals: UsageTotals): string[] {
  const lines = [
    `Spent       ${formatCost(totals.cost)}${totals.estimated ? ' (estimated from catalog prices)' : ''}`,
    `Tokens      ${formatTokens(totals.totalTokens)} in ${totals.calls} model call${totals.calls === 1 ? '' : 's'}`,
  ]
  if (totals.planTokens > 0) lines.push(`On a plan   ${formatTokens(totals.planTokens)} tokens`)
  if (totals.localTokens > 0) lines.push(`Local       ${formatTokens(totals.localTokens)} tokens`)
  return lines
}

export const usageCommand = defineCommand({
  meta: {
    name: 'usage',
    description: 'Show tokens and cost per Team, Agent, model and day',
  },
  args: {
    days: { type: 'string', default: '30', description: 'Days counted, today included' },
    all: { type: 'boolean', description: 'Count everything saved' },
    agent: { type: 'string', description: 'Only this Agent (id)' },
    team: { type: 'string', description: 'Only this Team (id)' },
    daily: { type: 'boolean', description: 'Also list every day' },
    json: jsonFlag,
  },
  async run({ args }) {
    const query = new URLSearchParams({
      days: args.all ? 'all' : args.days,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    if (args.agent) query.set('agent', args.agent)
    if (args.team) query.set('team', args.team)
    const report = await createClient().get<UsageReport>(`/api/usage?${query}`)
    if (args.json) return printJson(report)
    console.log(usageHeadline(report))
    console.log('')
    for (const line of totalsLines(report.totals)) console.log(line)
    if (report.unreadable > 0)
      console.log(
        `${report.unreadable} saved conversation${report.unreadable === 1 ? '' : 's'} could not be read and ${report.unreadable === 1 ? 'is' : 'are'} not counted.`,
      )
    if (report.totals.calls === 0) return
    const section = (title: string, rows: string[][]) => {
      console.log('')
      console.log(title)
      printRows(rows, '(none)')
    }
    section(
      'By Team',
      report.byTeam.map((team) => [terminalSafe(team.teamName), usageSummary(team)]),
    )
    section(
      'By Agent',
      report.byAgent.map((agent) => [
        terminalSafe(agent.agentName) + (agent.archived ? ' (archived)' : ''),
        terminalSafe(agent.teamName),
        usageSummary(agent),
      ]),
    )
    section(
      'By model',
      report.byModel.map((model) => [
        terminalSafe(`${model.providerName} ${model.model}`),
        usageSummary(model),
      ]),
    )
    if (args.daily)
      section(
        'By day',
        report.byDay.map((day) => [day.day, day.calls ? usageSummary(day) : '']),
      )
  },
})
