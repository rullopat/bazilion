import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  checkDockerImage,
  createDockerBashOperations,
  type DockerSandbox,
  homeContainerPrefix,
  removeDockerContainers,
  turnContainerPrefix,
} from '../../src/runtime/shell/docker.ts'

const execFileAsync = promisify(execFile)
const dockerEnabled = process.env.BAZILION_TEST_DOCKER === '1'
const image = 'debian:bookworm-slim'

let testDir: string
let workspace: string
/** Covers every container this test home starts. */
let homePrefix: string
let turnPrefix: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'bazilion-docker-integration-'))
  workspace = join(testDir, 'workspace')
  mkdirSync(join(workspace, 'memory'), { recursive: true })
  homePrefix = homeContainerPrefix(testDir)
  turnPrefix = turnContainerPrefix(testDir)
})

afterEach(async () => {
  if (dockerEnabled) {
    const remaining = await containersWithPrefix(homePrefix)
    await removeDockerContainers(homePrefix)
    expect(remaining).toEqual([])
  }
  rmSync(testDir, { recursive: true, force: true })
})

function sandbox(overrides: Partial<DockerSandbox> = {}): DockerSandbox {
  return {
    image,
    workspace: realpathSync(workspace),
    workdir: '/workspace',
    readOnlyMounts: [
      { source: realpathSync(join(workspace, 'memory')), target: '/workspace/memory' },
    ],
    containerPrefix: turnPrefix,
    ...overrides,
  }
}

async function run(command: string, box = sandbox()) {
  let output = ''
  const result = await createDockerBashOperations(() => box).exec(command, '/workspace', {
    timeout: 20,
    onData: (data) => {
      output += data.toString('utf8')
    },
  })
  return { ...result, output }
}

describe.skipIf(!dockerEnabled)('Docker bash integration', () => {
  test('isolates filesystem, environment and network while keeping the Team writable', async () => {
    const sentinel = join(testDir, 'outside-sentinel')
    const inputs = join(testDir, 'inputs')
    const skill = join(testDir, 'skill')
    mkdirSync(inputs)
    mkdirSync(skill)
    writeFileSync(sentinel, 'host-only')
    writeFileSync(join(workspace, 'inside.txt'), 'inside')
    writeFileSync(join(inputs, 'attached.txt'), 'attachment')
    writeFileSync(join(workspace, 'memory', 'note.md'), 'memory')
    writeFileSync(join(skill, 'helper.sh'), 'skill helper')
    process.env.HOST_ONLY_SECRET = 'must-not-enter-container'
    try {
      const result = await run(
        [
          'cat inside.txt',
          "printf 'written' > written.txt",
          'printf "home=%s\\n" "$HOME"',
          `printf "host_secret=%s\\n" "\${HOST_ONLY_SECRET-unset}"`,
          'test "$(cat /inputs/attached.txt)" = attachment',
          '{ printf blocked > /inputs/blocked.txt; } 2>/dev/null && exit 92 || true',
          'test "$(cat /workspace/memory/note.md)" = memory',
          '{ printf blocked > /workspace/memory/note.md; } 2>/dev/null && exit 93 || true',
          'test "$(cat /skills/0-test/helper.sh)" = "skill helper"',
          '{ printf blocked > /skills/0-test/helper.sh; } 2>/dev/null && exit 95 || true',
          '{ printf blocked > /etc/blocked; } 2>/dev/null && exit 96 || true',
          `test ! -e '${sentinel}'`,
          'if { exec 3<>/dev/tcp/1.1.1.1/80; } 2>/dev/null; then exit 91; fi',
        ].join('\n'),
        sandbox({
          readOnlyMounts: [
            ...sandbox().readOnlyMounts,
            { source: realpathSync(inputs), target: '/inputs' },
            { source: realpathSync(skill), target: '/skills/0-test' },
          ],
        }),
      )
      expect(result.exitCode, result.output).toBe(0)
      expect(result.output).toContain('inside')
      expect(result.output).toContain('home=/tmp')
      expect(result.output).toContain('host_secret=unset')
      expect(readFileSync(join(workspace, 'written.txt'), 'utf8')).toBe('written')
    } finally {
      delete process.env.HOST_ONLY_SECRET
    }
  }, 30_000)

  test('runs in the Team working directory and keeps the exit code', async () => {
    mkdirSync(join(workspace, 'app'))
    const result = await run('printf "%s" "$PWD"; exit 7', sandbox({ workdir: '/workspace/app' }))
    expect(result).toEqual({ exitCode: 7, output: '/workspace/app' })
  }, 30_000)

  test('an unavailable local image is reported, never pulled', async () => {
    const missing = `bazilion-test-missing:${process.pid}-${Date.now()}`
    const result = await run('true', sandbox({ image: missing }))
    expect(result.exitCode).toBe(125)
    expect(result.output).toMatch(/No such image|Unable to find image/i)
    expect(await checkDockerImage(missing)).toMatchObject({ ok: false })
    expect(await checkDockerImage(image)).toEqual({ ok: true })
  }, 30_000)

  test('cancellation stops and removes the running container', async () => {
    const controller = new AbortController()
    const execution = createDockerBashOperations(() => sandbox()).exec(
      'echo ready; sleep 30',
      '/workspace',
      {
        signal: controller.signal,
        timeout: 20,
        onData: (data) => {
          if (data.toString('utf8').includes('ready')) controller.abort()
        },
      },
    )
    await expect(execution).rejects.toThrow(/^aborted$/)
    expect(await containersWithPrefix(turnPrefix)).toEqual([])
  }, 30_000)

  test('what a killed worker leaves is removed by its turn prefix, and only that', async () => {
    const leftover = `${turnPrefix}leftover`
    const otherTurn = `${turnContainerPrefix(testDir)}other`
    for (const name of [leftover, otherTurn])
      await execFileAsync('docker', [
        'run',
        '--detach',
        '--name',
        name,
        '--network',
        'none',
        image,
        'sleep',
        '60',
      ])
    await removeDockerContainers(turnPrefix)
    expect(await containersWithPrefix(homePrefix)).toEqual([otherTurn])
    // The daemon's startup sweep removes every container of the home.
    await removeDockerContainers(homePrefix)
    expect(await containersWithPrefix(homePrefix)).toEqual([])
  }, 60_000)
})

async function containersWithPrefix(prefix: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'docker',
    ['ps', '--all', '--filter', `name=^/${prefix}`, '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  )
  return stdout.trim().split('\n').filter(Boolean).sort()
}
