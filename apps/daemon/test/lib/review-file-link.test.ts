import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import {
  getReviewPacket,
  REVIEW_REPORTED_STATES,
  recordReportedState,
} from '../../src/core/repos/review-packets.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { captureReviewPacket } from '../../src/lib/review/capture.ts'
import { buildFileLink, openFileLink, splitTemplate } from '../../src/lib/review/file-link.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-043 slices 7: completion facts and the file-link surface.
//
// The rules under test are the ones an editor button usually gets wrong: it must not claim to have opened a
// path on a machine the viewer is not on, it must not present the live file as the reviewed revision, and a
// filename must never become a command.

function seed(db: BazilionDb, teamId: string): void {
  db.raw.run(
    "INSERT INTO profiles (id,name,dir,default_model,created_at,updated_at) VALUES ('profile','Profile','p','lmstudio:model',1,1)",
  )
  for (const id of ['coder', 'reviewer']) {
    db.raw.run(
      `INSERT INTO agents (id, profile_id, name, status, dir, team_id, created_at)
       VALUES (?, 'profile', ?, 'idle', ?, ?, 1)`,
      [id, id, `/tmp/${id}`, teamId],
    )
  }
}

function git(env: TestEnv, ...args: string[]): string {
  return execFileSync('git', ['-C', env.paths.teamDir(env.teamId), ...args], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: env.home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim()
}

async function packetEnv(fileName = 'app.txt') {
  const env = makeTestEnv()
  seed(env.db, env.teamId)
  git(env, 'init', '-q', '-b', 'main')
  writeFileSync(join(env.paths.teamDir(env.teamId), fileName), 'one\ntwo\n')
  git(env, 'add', '.')
  git(env, 'commit', '-qm', 'base')
  writeFileSync(join(env.paths.teamDir(env.teamId), fileName), 'one\ntwo\nthree\n')
  const captured = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
    capturedBy: 'operator',
    base: 'HEAD',
  })
  const result = captureReviewPacket(env.db, env.paths, {
    teamId: env.teamId,
    snapshotId: captured.reference.id,
    reviewerAgentId: 'reviewer',
    requesterKind: 'operator',
  })
  if (result.kind !== 'captured') throw new Error('capture blocked')
  return { env, packet: result.packet }
}

test('reported states are what the operator said, and nothing is inferred', async () => {
  const { env, packet } = await packetEnv()
  try {
    // Every state starts unset: the daemon never claims a commit, a merge or a deployment on its own.
    expect(getReviewPacket(env.db, packet.id)?.reported).toEqual({
      committed: null,
      pushed: null,
      pullRequest: null,
      merged: null,
      deployed: null,
      productionAccepted: null,
    })
    const after = recordReportedState(env.db, {
      packetId: packet.id,
      state: 'pullRequest',
      reference: 'https://example.invalid/pr/12',
    })
    expect(after.pullRequest).toBe('https://example.invalid/pr/12')
    // Reporting a later state does not touch the earlier ones.
    expect(after.merged).toBeNull()
    recordReportedState(env.db, { packetId: packet.id, state: 'merged', reference: 'merge 12' })
    // A state can be cleared, because a report can be wrong.
    const cleared = recordReportedState(env.db, {
      packetId: packet.id,
      state: 'pullRequest',
      reference: null,
    })
    expect(cleared.pullRequest).toBeNull()
    expect(cleared.merged).toBe('merge 12')
    // An unknown state is refused rather than stored.
    expect(() =>
      recordReportedState(env.db, {
        packetId: packet.id,
        state: 'approved' as never,
        reference: 'x',
      }),
    ).toThrow(/unknown reported state/)
    expect(REVIEW_REPORTED_STATES).toHaveLength(6)
  } finally {
    env.cleanup()
  }
})

test('a file link names the host, the copyable location, and whether it is the reviewed revision', async () => {
  const { env, packet } = await packetEnv()
  try {
    const link = buildFileLink({
      db: env.db,
      paths: env.paths,
      packet,
      path: 'app.txt',
      line: 3,
      contentAvailable: true,
      env: {},
    })
    // Repository-relative for copying, absolute for the daemon host, and the host is named.
    expect(link.copyTarget).toBe('app.txt:3')
    expect(link.hostPath).toBe(join(env.paths.teamDir(env.teamId), 'app.txt'))
    expect(link.host.daemon).toBeTruthy()
    expect(link.host.ownsWorkspace).toBe(true)
    expect(link.mode).toBe('live')
    // No editor configured is the safe default: a copyable location and no open action.
    expect(link.canOpen).toBe(false)
    expect(link.command).toBeNull()
    expect(link.notes.join(' ')).toMatch(/No editor is configured/)

    // Once the tree has moved, the same file is *not* the reviewed revision and the link says so.
    writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\nthree\nfour\n')
    const stale = buildFileLink({
      db: env.db,
      paths: env.paths,
      packet,
      path: 'app.txt',
      line: null,
      contentAvailable: false,
      env: {},
    })
    expect(stale.mode).toBe('stale')
    expect(stale.notes.join(' ')).toMatch(/current content, not the reviewed revision/)

    // A path outside the reviewed revision is never offered, whatever exists on disk.
    const unknown = buildFileLink({
      db: env.db,
      paths: env.paths,
      packet,
      path: 'secrets.env',
      line: null,
      contentAvailable: true,
      env: {},
    })
    expect(unknown.hostPath).toBeNull()
    expect(unknown.canOpen).toBe(false)
    expect(unknown.notes.join(' ')).toMatch(/not part of the reviewed revision/)
  } finally {
    env.cleanup()
  }
})

test('a configured editor runs without a shell, so a filename cannot become a command', async () => {
  const { env, packet } = await packetEnv('app; touch pwned.txt')
  try {
    const link = buildFileLink({
      db: env.db,
      paths: env.paths,
      packet,
      path: 'app; touch pwned.txt',
      line: 2,
      contentAvailable: true,
      env: { BAZILION_REVIEW_EDITOR: 'true --goto {path}:{line}' },
    })
    expect(link.canOpen).toBe(true)
    // The template splits into argv and the path is one element of it: no quoting rules, no re-parsing.
    expect(splitTemplate('true --goto {path}:{line}', link.hostPath ?? '', 2)).toEqual([
      'true',
      '--goto',
      `${link.hostPath}:2`,
    ])
    const result = await openFileLink(link)
    expect(result.opened).toBe(true)
    // `true` ignores its arguments. The invariant is that nothing in the *path* was interpreted: had the
    // name been spliced into a shell string, the `; touch pwned.txt` in it would have created that file.
    expect(existsSync(join(env.paths.teamDir(env.teamId), 'pwned.txt'))).toBe(false)
    expect(
      readFileSync(join(env.paths.teamDir(env.teamId), 'app; touch pwned.txt'), 'utf8'),
    ).toContain('three')

    // A command that does not exist is reported, not thrown: opening is an operator action with an outcome.
    const broken = await openFileLink({ ...link, command: 'definitely-not-a-real-editor {path}' })
    expect(broken.opened).toBe(false)
    expect(broken.detail).toMatch(/could not be started/)

    // Nothing opens when the path is not the revision's, even with an editor configured.
    const refused = await openFileLink({
      ...link,
      canOpen: false,
      hostPath: null,
      notes: [
        'That path is not part of the reviewed revision, so there is nothing to open for it.',
      ],
    })
    expect(refused.opened).toBe(false)
    expect(refused.detail).toMatch(/not part of the reviewed revision/)
  } finally {
    env.cleanup()
  }
})

test('an editor mapping is applied, and a mapping that does not match refuses rather than guessing', async () => {
  const { env, packet } = await packetEnv()
  try {
    const root = env.paths.teamDir(env.teamId)
    const mapped = buildFileLink({
      db: env.db,
      paths: env.paths,
      packet,
      path: 'app.txt',
      line: null,
      contentAvailable: true,
      env: {
        BAZILION_REVIEW_EDITOR: 'editor {path}',
        BAZILION_REVIEW_EDITOR_MAP: `${root}:/remote/workspace`,
      },
    })
    expect(mapped.hostPath).toBe('/remote/workspace/app.txt')
    expect(mapped.canOpen).toBe(true)

    // A mapping configured for a different root means the editor could not reach the file: that is reported.
    const unmapped = buildFileLink({
      db: env.db,
      paths: env.paths,
      packet,
      path: 'app.txt',
      line: null,
      contentAvailable: true,
      env: {
        BAZILION_REVIEW_EDITOR: 'editor {path}',
        BAZILION_REVIEW_EDITOR_MAP: '/somewhere/else:/remote/workspace',
      },
    })
    expect(unmapped.hostPath).toBeNull()
    expect(unmapped.canOpen).toBe(false)
    expect(unmapped.notes.join(' ')).toMatch(/path mapping/)
  } finally {
    env.cleanup()
  }
})

test('the workspace owner is the daemon host, and nothing here writes to the reviewed tree', async () => {
  const { env, packet } = await packetEnv()
  try {
    const scratch = mkdtempSync(join(tmpdir(), 'baz043-link-'))
    const script = join(scratch, 'editor.sh')
    writeFileSync(script, `#!/bin/sh\nprintf '%s' "$1" > ${scratch}/args.txt\n`)
    chmodSync(script, 0o755)
    const link = buildFileLink({
      db: env.db,
      paths: env.paths,
      packet,
      path: 'app.txt',
      line: 3,
      contentAvailable: true,
      env: { BAZILION_REVIEW_EDITOR: `${script} {path}` },
    })
    const result = await openFileLink(link)
    expect(result.opened).toBe(true)
    // The editor received the absolute path as a single argument, and the tree is untouched.
    expect(readFileSync(join(scratch, 'args.txt'), 'utf8')).toBe(link.hostPath)
    expect(readFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'utf8')).toBe(
      'one\ntwo\nthree\n',
    )
    rmSync(scratch, { recursive: true, force: true })
  } finally {
    env.cleanup()
  }
})
