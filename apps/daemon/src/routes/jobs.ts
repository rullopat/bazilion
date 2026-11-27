// Background jobs: /api/agents/:id/jobs lists an Agent's, /api/jobs/:id shows one with the end of
// its output, and /api/jobs/:id/stop stops it, as you.

import type { JobResponse, ListJobsResponse } from '@bazilion/api-types'
import { getCtx } from '../lib/ctx.ts'
import { jobDetail, listJobs, stopJob } from '../lib/jobs.ts'
import { newRouter, routeAgent } from './http.ts'

export const agentJobsRouter = newRouter()
export const jobsRouter = newRouter()

agentJobsRouter.get('/:id/jobs', (c) => {
  const agent = routeAgent(c)
  return c.json({ jobs: listJobs(getCtx().paths, agent.id) } satisfies ListJobsResponse)
})

jobsRouter.get('/:id', (c) => {
  const job = jobDetail(getCtx().paths, c.req.param('id'))
  if (!job) return c.json({ error: `job not found: ${c.req.param('id')}` }, 404)
  return c.json({ job } satisfies JobResponse)
})

jobsRouter.post('/:id/stop', async (c) => {
  const { paths } = getCtx()
  const id = c.req.param('id')
  if (!jobDetail(paths, id)) return c.json({ error: `job not found: ${id}` }, 404)
  await stopJob(paths, id, 'owner')
  const job = jobDetail(paths, id)
  if (!job) return c.json({ error: `job not found: ${id}` }, 404)
  return c.json({ job } satisfies JobResponse)
})
