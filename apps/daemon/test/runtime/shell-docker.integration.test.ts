import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDockerBashOperations } from '../../src/runtime/shell/docker.ts'

const execFileAsync = promisify(execFile)
const dockerEnabled = process.env.BAZILION_TEST_DOCKER === '1'
const dockerPath = process.env.BAZILION_TEST_DOCKER_PATH ?? 'docker'
const image = process.env.BAZILION_TEST_DOCKER_IMAGE ?? 'debian:bookworm-slim'

let testDir: string
let workspace: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'bazilion-docker-integration-'))
  workspace = join(testDir, 'workspace')
  mkdirSync(workspace)
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe.skipIf(!dockerEnabled)('Docker bash integration', () => {
  test('isolates filesystem, env, and network while keeping the team mount writable', async () => {
    const sentinel = join(testDir, 'outside-sentinel')
    const inputs = join(testDir, 'inputs')
    const memory = join(workspace, 'memory')
    const skill = join(testDir, 'skill')
    mkdirSync(inputs)
    mkdirSync(memory)
    mkdirSync(skill)
    writeFileSync(sentinel, 'host-only', 'utf8')
    writeFileSync(join(workspace, 'inside.txt'), 'inside', 'utf8')
    writeFileSync(join(inputs, 'attached.txt'), 'attachment', 'utf8')
    writeFileSync(join(memory, 'note.md'), 'memory', 'utf8')
    writeFileSync(join(skill, 'helper.sh'), 'skill helper', 'utf8')

    const operations = createDockerBashOperations({
      image,
      env: {
        HOME: '/tmp',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        SAFE_VALUE: 'visible',
      },
      dockerPath,
      readOnlyMounts: [
        { source: memory, target: '/workspace/memory' },
        { source: inputs, target: '/inputs' },
        { source: skill, target: '/skills/0-test' },
      ],
    })
    let output = ''
    const result = await operations.exec(
      [
        'cat inside.txt',
        "printf 'written' > written.txt",
        'printf "safe=%s\\n" "$SAFE_VALUE"',
        `printf "host_secret=%s\\n" "\${HOST_ONLY_SECRET-unset}"`,
        'test "$(cat /inputs/attached.txt)" = attachment',
        '{ printf blocked > /inputs/blocked.txt; } 2>/dev/null && exit 92 || true',
        'test "$(cat /workspace/memory/note.md)" = memory',
        '{ printf blocked > /workspace/memory/note.md; } 2>/dev/null && exit 93 || true',
        '{ ln /workspace/memory/note.md memory-link; } 2>/dev/null && exit 94 || true',
        'test "$(cat /skills/0-test/helper.sh)" = "skill helper"',
        '{ printf blocked > /skills/0-test/helper.sh; } 2>/dev/null && exit 95 || true',
        `test ! -e ${shellQuote(sentinel)}`,
        'if { exec 3<>/dev/tcp/1.1.1.1/80; } 2>/dev/null; then exit 91; fi',
      ].join('\n'),
      workspace,
      {
        timeout: 10,
        env: { HOST_ONLY_SECRET: 'must-not-enter-container' },
        onData: (data) => {
          output += data.toString('utf8')
        },
      },
    )

    expect(result).toEqual({ exitCode: 0 })
    expect(output).toContain('inside')
    expect(output).toContain('safe=visible')
    expect(output).toContain('host_secret=unset')
    expect(output).not.toContain('must-not-enter-container')
    expect(readFileSync(join(workspace, 'written.txt'), 'utf8')).toBe('written')
  }, 20_000)

  test('reports an unavailable local image without pulling or falling back', async () => {
    const missingImage = `bazilion-test-missing:${process.pid}-${Date.now()}`
    const operations = createDockerBashOperations({ image: missingImage, env: {}, dockerPath })

    await expect(
      operations.exec('true', workspace, { onData: () => undefined, timeout: 10 }),
    ).rejects.toThrow(new RegExp(`image "${escapeRegExp(missingImage)}" is unavailable`))
  }, 20_000)

  test('abort stops and removes the live exact-name container', async () => {
    const prefix = `bazilion-bash-${process.pid}-`
    const before = await containersWithPrefix(prefix)
    const operations = createDockerBashOperations({
      image,
      env: { HOME: '/tmp', PATH: '/usr/local/bin:/usr/bin:/bin' },
      dockerPath,
    })
    const controller = new AbortController()

    const execution = operations.exec('echo ready; sleep 30', workspace, {
      signal: controller.signal,
      timeout: 15,
      onData: (data) => {
        if (data.toString('utf8').includes('ready')) controller.abort()
      },
    })

    await expect(execution).rejects.toThrow(/^aborted$/)
    expect(await containersWithPrefix(prefix)).toEqual(before)
  }, 30_000)
})

async function containersWithPrefix(prefix: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    dockerPath,
    ['ps', '--all', '--filter', `name=^/${prefix}`, '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  )
  return stdout.trim().split('\n').filter(Boolean).sort()
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
