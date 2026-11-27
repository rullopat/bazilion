// Background jobs: commands an Agent starts with `bash` and `background: true`. They run until
// they end, the Agent stops them or you do; one that ends after its turn wakes the Agent.

export type JobStatus = 'running' | 'exited' | 'stopped'

export interface Job {
  id: string
  agentId: string
  /** The conversation it was started in, which its end wakes. */
  conversationId: string
  command: string
  /** Its working directory, as the Agent sees it (a container path in Docker mode). */
  cwd: string
  /** Where it runs: on this computer, or in a Docker container. */
  sandbox: 'host' | 'docker'
  status: JobStatus
  /** Set once it ended by itself; null while running or when it was stopped. */
  exitCode: number | null
  /** Who stopped it: the Agent, you, or a daemon stop or restart. */
  stoppedBy: 'agent' | 'owner' | 'restart' | null
  startedAt: number
  endedAt: number | null
}

/** A job with the end of its output, as far as it has run. */
export interface JobDetail extends Job {
  output: string
  /** Earlier output was left out. */
  outputCut: boolean
}

export interface ListJobsResponse {
  jobs: Job[]
}

export interface JobResponse {
  job: JobDetail
}
