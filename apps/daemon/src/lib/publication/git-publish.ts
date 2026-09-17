import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// BAZ-046: the one place Bazilion commits and pushes.
//
// This is a **mutation** path and it is deliberately separate from BAZ-039's read-only capture: that
// harness exists to inspect a repository without touching it, and stretching it to push would put a write
// through the code whose whole value is that it cannot write. What they share is the *hardening* — a
// private scratch repository, a Bazilion-authored Git config, and no ambient credential helper, template
// or hook from the operator's environment.
//
// The rules this module enforces:
//
//   - The commit is built from the caller's verified bytes, never from the working tree.
//   - A credential is injected through the environment (`GIT_CONFIG_*`), never through argv, never into a
//     URL, never into the scratch config file — so it cannot appear in a process listing, a `.git/config`
//     or an error message.
//   - `--force` is never used. A non-fast-forward update is refused by plain `git push`, and a head branch
//     that already exists on the remote is refused before anything is written.
//   - Signing is off explicitly (`commit.gpgsign=false`), so the recorded `signed: false` is a fact about
//     this build rather than an assumption about the environment.

const COMMAND_BUDGET_MS = 60_000
const MAX_OUTPUT = 64 * 1024
const AUTHOR_NAME = 'Bazilion'
const AUTHOR_EMAIL = 'bazilion@localhost'

export type GitPublishRefusal =
  | 'head_branch_exists'
  | 'base_unknown'
  | 'push_rejected'
  | 'remote_unavailable'
  | 'commit_failed'

export type GitPublishResult =
  | { ok: true; commitOid: string }
  | { ok: false; reason: GitPublishRefusal; detail: string }

export interface GitPublishInput {
  /** The Team working tree the reviewed revision came from. Read-only for this operation. */
  teamDir: string
  /** The pinned base commit the publication is based on. */
  baseOid: string
  headBranch: string
  commitMessage: string
  files: Array<{ path: string; content: Buffer }>
  removed: string[]
  /** The remote to push to. For GitHub this is the repository's https URL without credentials. */
  remoteUrl: string
  /** Injected as an HTTP header only, and only when the remote is HTTP(S). */
  credential: string
  /** Injected so tests can point at their own scratch root. */
  scratchParentDir?: string
}

/**
 * Build one commit on top of the pinned base and push it as a new branch.
 *
 * Returns a refusal rather than throwing for every outcome a caller must report verbatim: the difference
 * between "the branch already exists" and "the push was rejected" is the difference between two different
 * operator actions.
 */
export async function publishRevisionCommit(input: GitPublishInput): Promise<GitPublishResult> {
  const scratch = mkdtempSync(join(input.scratchParentDir ?? '/tmp', 'bazilion-publish-'))
  const gitDir = join(scratch, 'repo')
  const gitEnv = environment(scratch, input.remoteUrl, input.credential)
  const run = (args: string[], cwd = scratch): Promise<string> =>
    git(['-C', gitDir, ...args], cwd, gitEnv)
  try {
    // A scratch repository built from the Team's objects, so the commit shares the base's history — a
    // branch with unrelated history would produce a pull request full of noise, or be refused outright.
    await git(
      [
        '-c',
        'init.templateDir=',
        'clone',
        '--no-checkout',
        '--no-hardlinks',
        '--quiet',
        input.teamDir,
        gitDir,
      ],
      scratch,
      gitEnv,
    )
    try {
      await run(['rev-parse', '--verify', '--quiet', `${input.baseOid}^{commit}`])
    } catch {
      return {
        ok: false,
        reason: 'base_unknown',
        detail: 'the pinned base commit is not present in the Team repository',
      }
    }
    // The head branch must not exist yet: updating an existing branch is a mutation of work somebody may
    // already have, and a force update is never acceptable here.
    const existing = await remoteHeads(input, gitEnv)
    if (existing.includes(input.headBranch)) {
      return {
        ok: false,
        reason: 'head_branch_exists',
        detail: `the remote already has a branch named ${input.headBranch}; publishing over it is not something this build will do`,
      }
    }
    await run(['checkout', '--quiet', '--detach', input.baseOid])
    for (const file of input.files) {
      const target = join(gitDir, file.path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file.content)
    }
    for (const path of input.removed) {
      await run(['rm', '--quiet', '--ignore-unmatch', '--', path])
    }
    await run(['add', '--all', '--', '.'])
    await run([
      '-c',
      'commit.gpgsign=false',
      '-c',
      `user.name=${AUTHOR_NAME}`,
      '-c',
      `user.email=${AUTHOR_EMAIL}`,
      'commit',
      '--quiet',
      '--no-verify',
      '-m',
      input.commitMessage,
    ])
    const commitOid = await run(['rev-parse', 'HEAD'])
    try {
      // No `--force` and no `--force-with-lease`: a non-fast-forward update is git's business to refuse.
      await run(['push', '--quiet', input.remoteUrl, `HEAD:refs/heads/${input.headBranch}`])
    } catch (error) {
      return {
        ok: false,
        reason: 'push_rejected',
        detail: `the push was refused: ${summarize(error)}`,
      }
    }
    return { ok: true, commitOid }
  } catch (error) {
    return { ok: false, reason: 'commit_failed', detail: summarize(error) }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Branch names on the remote, read through the same hardened environment. */
async function remoteHeads(input: GitPublishInput, env: NodeJS.ProcessEnv): Promise<string[]> {
  const output = await git(['ls-remote', '--heads', input.remoteUrl], process.cwd(), env)
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/)[1] ?? '')
    .filter((ref) => ref.startsWith('refs/heads/'))
    .map((ref) => ref.slice('refs/heads/'.length))
}

function environment(scratch: string, remoteUrl: string, credential: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: scratch,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    // Never prompt: a missing credential must fail, not hang a daemon thread waiting for a terminal.
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    GIT_LFS_SKIP_SMUDGE: '1',
  }
  const entries: Array<[string, string]> = [
    ['credential.helper', ''],
    ['core.hooksPath', '/dev/null'],
    ['core.autocrlf', 'false'],
    ['gc.auto', '0'],
    ['http.followRedirects', 'false'],
  ]
  if (/^https?:\/\//.test(remoteUrl)) {
    // The token travels as a header value in the environment. It is never an argument, never part of the
    // URL, and never written to the scratch config.
    const basic = Buffer.from(`x-access-token:${credential}`, 'utf8').toString('base64')
    entries.push(['http.extraheader', `Authorization: Basic ${basic}`])
  }
  entries.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key
    env[`GIT_CONFIG_VALUE_${index}`] = value
  })
  env.GIT_CONFIG_COUNT = String(entries.length)
  return env
}

async function git(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env,
      timeout: COMMAND_BUDGET_MS,
      maxBuffer: MAX_OUTPUT,
      encoding: 'utf8',
    })
    return stdout.trim()
  } catch (error) {
    throw new Error(summarize(error))
  }
}

/** One bounded line of what went wrong, with no environment, argv or header in it. */
function summarize(error: unknown): string {
  const stderr =
    typeof error === 'object' && error !== null && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr ?? '')
      : ''
  const message =
    stderr.trim() || (error instanceof Error ? error.message : String(error)) || 'unknown failure'
  return message.length > 300 ? `${message.slice(0, 300)}…` : message
}
