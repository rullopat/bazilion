// The tools for an Agent's background jobs (started by `bash` with `background: true`). The
// daemon runs the jobs; these only ask it, through the turn's job host.

import type { Job } from '@bazilion/api-types'
import type { JobHost, JobOutputResult } from '../worker/ipc-protocol.ts'
import type { ToolHandler } from './types.ts'

function describe(job: Job): string {
  const state =
    job.status === 'running'
      ? 'running'
      : job.status === 'exited'
        ? `ended, exit code ${job.exitCode}`
        : job.stoppedBy === 'owner'
          ? 'stopped by the user'
          : job.stoppedBy === 'agent'
            ? 'stopped by you'
            : 'stopped when Bazilion stopped or restarted'
  return `${job.id}  ${state}  started ${new Date(job.startedAt).toISOString()}  in ${job.cwd}\n  ${job.command}`
}

function withOutput(result: JobOutputResult): string {
  const output = result.output.trimEnd()
  return [
    describe(result.job),
    output
      ? `${result.cut ? 'New output (the end of it; the earlier part was left out):' : 'New output:'}\n${output}`
      : result.job.status === 'running'
        ? 'No new output.'
        : 'No more output.',
  ].join('\n')
}

const ID = { type: 'string', description: 'The job id, e.g. "job-1a2b3c4d".' }

export function jobTools(host: JobHost): ToolHandler[] {
  return [
    {
      def: {
        name: 'job_list',
        description:
          'List your background jobs, newest first: id, whether each is running or how it ended, and its command.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
      async invoke() {
        const jobs = await host.list()
        return jobs.length > 0 ? jobs.map(describe).join('\n') : 'You have no background jobs.'
      },
    },
    {
      def: {
        name: 'job_output',
        description:
          'The output of a background job that you have not read yet, and whether it is still running. With wait_seconds, wait up to that long for new output or for the job to end.',
        parameters: {
          type: 'object',
          properties: {
            id: ID,
            wait_seconds: {
              type: 'number',
              minimum: 0,
              description: 'Wait up to this many seconds for new output or the end (default 0).',
            },
          },
          required: ['id'],
          additionalProperties: false,
        },
      },
      async invoke(args, call) {
        const id = String(args.id ?? '')
        const wait = typeof args.wait_seconds === 'number' ? args.wait_seconds : undefined
        return withOutput(
          await host.output(
            { id, ...(wait !== undefined ? { waitSeconds: wait } : {}) },
            call?.signal,
          ),
        )
      },
    },
    {
      def: {
        name: 'job_input',
        description:
          'Send text to a running job’s standard input (end a line with \\n), or interrupt it as Ctrl-C does.',
        parameters: {
          type: 'object',
          properties: {
            id: ID,
            text: { type: 'string', description: 'Text for its standard input.' },
            interrupt: { type: 'boolean', description: 'Interrupt it, as Ctrl-C does.' },
          },
          required: ['id'],
          additionalProperties: false,
        },
      },
      async invoke(args) {
        const id = String(args.id ?? '')
        const text = typeof args.text === 'string' ? args.text : undefined
        const interrupt = args.interrupt === true
        if (!text && !interrupt) throw new Error('job_input needs text or interrupt: true.')
        const job = await host.input({
          id,
          ...(text ? { text } : {}),
          ...(interrupt ? { interrupt } : {}),
        })
        return `${interrupt ? 'Interrupted' : 'Sent the text to'} ${job.id}. Read what it does with job_output.`
      },
    },
    {
      def: {
        name: 'job_stop',
        description: 'Stop a running background job.',
        parameters: {
          type: 'object',
          properties: { id: ID },
          required: ['id'],
          additionalProperties: false,
        },
      },
      async invoke(args) {
        return describe(await host.stop({ id: String(args.id ?? '') }))
      },
    },
  ]
}
