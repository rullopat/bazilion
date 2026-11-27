import type { Job, JobResponse, ListJobsResponse } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { agentArg, apiPath, positional, printRows } from '../command-helpers.ts'

const jobArg = positional('Job id (job-…)')

function state(job: Job): string {
  if (job.status === 'running') return 'running'
  if (job.status === 'exited') return `exit ${job.exitCode}`
  return `stopped by ${job.stoppedBy === 'owner' ? 'you' : job.stoppedBy === 'agent' ? 'the Agent' : 'a restart'}`
}

const listCmd = defineCommand({
  meta: { name: 'list', description: "List an Agent's background jobs, newest first" },
  args: { agent: agentArg },
  async run({ args }) {
    const { jobs } = await createClient().get<ListJobsResponse>(
      apiPath('agents', args.agent, 'jobs'),
    )
    printRows(
      jobs.map((job) => [job.id, state(job), new Date(job.startedAt).toISOString(), job.command]),
      '(no jobs)',
    )
  },
})

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show a job and the end of its output' },
  args: { id: jobArg },
  async run({ args }) {
    const { job } = await createClient().get<JobResponse>(apiPath('jobs', args.id))
    console.log(
      `${job.id}  ${state(job)}  ${job.sandbox === 'docker' ? 'in Docker' : 'on this computer'}  ${job.cwd}`,
    )
    console.log(`$ ${job.command}`)
    if (job.outputCut) console.log('(earlier output left out)')
    if (job.output) process.stdout.write(job.output.endsWith('\n') ? job.output : `${job.output}\n`)
  },
})

const stopCmd = defineCommand({
  meta: { name: 'stop', description: 'Stop a running job' },
  args: { id: jobArg },
  async run({ args }) {
    const { job } = await createClient().post<JobResponse>(apiPath('jobs', args.id, 'stop'), {})
    console.log(`${job.id}: ${state(job)}`)
  },
})

export const jobCommand = defineCommand({
  meta: { name: 'job', description: 'Background jobs Agents started' },
  subCommands: { list: listCmd, show: showCmd, stop: stopCmd },
})
