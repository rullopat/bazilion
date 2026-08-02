import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildDockerRunSpec, createDockerBashOperations } from '../../src/runtime/shell/docker.ts'

interface FakeDockerInvocation {
  args: string[]
  pid: number
}

let testDir: string
let workspace: string
let dockerPath: string
let logPath: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'bazilion-shell-docker-'))
  workspace = join(testDir, 'workspace')
  dockerPath = join(testDir, 'fake-docker.cjs')
  logPath = join(testDir, 'docker.log')

  writeFileSync(
    dockerPath,
    `#!${process.execPath}
const { appendFileSync, readFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args, pid: process.pid }) + '\\n')

if (args[0] === 'context' && args[1] === 'inspect') {
  const endpoint = process.env.DOCKER_CONTEXT === 'remote-test'
    ? 'ssh://remote.example.test'
    : 'unix:///var/run/docker.sock'
  process.stdout.write(JSON.stringify(endpoint) + '\\n')
  process.exit(0)
}

if (args[0] === 'image' && args[1] === 'inspect') {
  const image = args.at(-1)
  if (image === 'missing:image') {
    process.stderr.write('Error response from daemon: No such image: missing:image\\n')
    process.exit(1)
  }
  const volumes = image === 'volume:image' ? { '/var/lib/example': {} } : null
  process.stdout.write(JSON.stringify('sha256:${'a'.repeat(64)}') + '\\t' + JSON.stringify(volumes) + '\\n')
  process.exit(0)
}

if (args[0] === 'container' && args[1] === 'rm') {
  const calls = readFileSync(${JSON.stringify(logPath)}, 'utf8')
    .trim()
    .split('\\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).args)
  const runCommand = calls.find((call) => call[0] === 'run')?.at(-1)
  const removeCount = calls.filter((call) => call[0] === 'container' && call[1] === 'rm').length
  if (runCommand === '__startup_race__' && removeCount === 1) {
    process.stderr.write('Error response from daemon: No such container\\n')
    process.exit(1)
  }
  if (runCommand === '__cleanup_hang__') {
    setInterval(() => {}, 1_000)
  } else {
    process.exit(0)
  }
}

if (args[0] === 'run') {
  const command = args.at(-1)
  if (args.includes('missing:image')) {
    process.stderr.write('docker: Error response from daemon: No such image: missing:image\\n')
    process.exit(125)
  }
  if (command === '__mount_failure__') {
    process.stderr.write('docker: Error response from daemon: invalid mount config for type "bind"\\n')
    process.exit(125)
  }
  if (command === '__hang__') {
    process.stdout.write('ready\\n')
    setInterval(() => {}, 1_000)
  } else if (command === '__startup_race__' || command === '__cleanup_hang__') {
    setInterval(() => {}, 1_000)
  } else {
    process.stdout.write('from stdout\\n')
    process.stderr.write('from stderr\\n')
    process.exit(0)
  }
}
`,
    'utf8',
  )
  chmodSync(dockerPath, 0o755)
  mkdirSync(workspace)
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function invocations(): FakeDockerInvocation[] {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeDockerInvocation)
}

function flagValues(args: string[], flag: string): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) values.push(args[index + 1] ?? '')
  }
  return values
}

describe('buildDockerRunSpec', () => {
  test('builds one narrow, hardened, exact-name container invocation', () => {
    const spec = buildDockerRunSpec({
      image: 'example/bash:1',
      env: { SAFE_Z: 'last', SAFE_A: 'first', OMITTED: undefined },
      dockerPath: '/opt/docker',
      command: 'printf hello',
      mountSource: '/srv/team',
      containerName: 'bazilion-bash-test-exact',
      uid: 1234,
      gid: 5678,
      hostEnv: {
        PATH: '/host/bin',
        HOME: '/home/operator',
        OPENAI_API_KEY: 'must-not-reach-docker-cli',
      },
      readOnlyMounts: [{ source: '/srv/private-inputs', target: '/inputs' }],
    })

    expect(spec.executable).toBe('/opt/docker')
    expect(spec.containerName).toBe('bazilion-bash-test-exact')
    expect(flagValues(spec.args, '--name')).toEqual(['bazilion-bash-test-exact'])
    expect(flagValues(spec.args, '--mount')).toEqual([
      'type=bind,source=/srv/team,target=/workspace,bind-recursive=disabled',
      'type=bind,source=/srv/private-inputs,target=/inputs,readonly,bind-recursive=disabled',
    ])
    expect(flagValues(spec.args, '--workdir')).toEqual(['/workspace'])
    expect(flagValues(spec.args, '--network')).toEqual(['none'])
    expect(flagValues(spec.args, '--tmpfs')).toEqual(['/tmp:rw,nosuid,nodev,size=64m,mode=1777'])
    expect(flagValues(spec.args, '--user')).toEqual(['1234:5678'])
    expect(flagValues(spec.args, '--cap-drop')).toEqual(['ALL'])
    expect(flagValues(spec.args, '--security-opt')).toEqual(['no-new-privileges=true'])
    expect(flagValues(spec.args, '--pids-limit')).toEqual(['256'])
    expect(flagValues(spec.args, '--entrypoint')).toEqual(['/bin/bash'])
    expect(flagValues(spec.args, '--env')).toEqual(['BASH_ENV='])
    expect(flagValues(spec.args, '--env-file')).toEqual(['/dev/fd/3'])
    expect(spec.processEnv).toEqual({
      PATH: '/host/bin',
      HOME: '/home/operator',
    })
    expect(spec.envFileContent).toBe('SAFE_A=first\nSAFE_Z=last\n')
    expect(spec.processEnv).not.toHaveProperty('OPENAI_API_KEY')
    expect(spec.args.join('\0')).not.toContain('first')
    expect(spec.args.join('\0')).not.toContain('last')
    expect(spec.args).toContain('--read-only')
    expect(spec.args).toContain('--rm')
    expect(spec.args).toEqual(expect.arrayContaining(['--pull', 'never', 'example/bash:1']))
    expect(spec.args.slice(-7)).toEqual([
      'example/bash:1',
      '--noprofile',
      '--norc',
      '-c',
      'exec /usr/bin/env -i SAFE_A="$SAFE_A" SAFE_Z="$SAFE_Z" /bin/bash --noprofile --norc -c "$1"',
      'bazilion-sandbox',
      'printf hello',
    ])
  })

  test('rejects option-shaped images and unsafe mount arguments', () => {
    const base = {
      env: {},
      command: 'true',
      mountSource: '/srv/team',
      containerName: 'bazilion-bash-test-exact',
      uid: 1000,
      gid: 1000,
    }

    expect(() => buildDockerRunSpec({ ...base, image: '--privileged' })).toThrow(
      /image cannot start/,
    )
    expect(() =>
      buildDockerRunSpec({ ...base, image: 'bash:5', mountSource: '/srv/team,other' }),
    ).toThrow(/cannot be represented safely/)
    expect(() =>
      buildDockerRunSpec({ ...base, image: 'bash:5', env: { DOCKER_HOST: 'tcp://attacker' } }),
    ).toThrow(/cannot pass Docker client control variable/)
  })
})

describe('createDockerBashOperations', () => {
  test('streams both output channels and ignores pi incoming env', async () => {
    const output: string[] = []
    const operations = createDockerBashOperations({
      image: 'fake:image',
      env: { SAFE_ONLY: 'configured' },
      dockerPath,
    })

    const result = await operations.exec('true', workspace, {
      onData: (data) => output.push(data.toString('utf8')),
      env: { HOST_SECRET: 'must-not-pass' },
    })

    expect(result).toEqual({ exitCode: 0 })
    expect(output.join('')).toContain('from stdout')
    expect(output.join('')).toContain('from stderr')

    const run = invocations().find((entry) => entry.args[0] === 'run')
    expect(run).toBeDefined()
    expect(flagValues(run?.args ?? [], '--env-file')).toEqual(['/dev/fd/3'])
    expect(run?.args.join('\0')).not.toContain('HOST_SECRET')
    expect(run?.args.join('\0')).not.toContain('configured')
  })

  test('fails closed when the active Docker context is remote', async () => {
    const operations = createDockerBashOperations({
      image: 'fake:image',
      env: {},
      dockerPath,
      hostEnv: { PATH: process.env.PATH, HOME: testDir, DOCKER_CONTEXT: 'remote-test' },
    })

    await expect(operations.exec('true', workspace, { onData: () => undefined })).rejects.toThrow(
      /requires a local Unix-socket context/,
    )
    expect(invocations().some((entry) => entry.args[0] === 'run')).toBe(false)
  })

  test('rejects images that declare implicit writable volumes', async () => {
    const operations = createDockerBashOperations({
      image: 'volume:image',
      env: {},
      dockerPath,
    })

    await expect(operations.exec('true', workspace, { onData: () => undefined })).rejects.toThrow(
      /declares writable volumes.*\/var\/lib\/example/,
    )
    expect(invocations().some((entry) => entry.args[0] === 'run')).toBe(false)
  })

  test('fails clearly when Docker is missing', async () => {
    const operations = createDockerBashOperations({
      image: 'fake:image',
      env: {},
      dockerPath: join(testDir, 'does-not-exist'),
    })

    await expect(operations.exec('true', workspace, { onData: () => undefined })).rejects.toThrow(
      /Docker sandbox unavailable: executable .* was not found/,
    )
  })

  test('fails before spawning Docker when the mount is missing', async () => {
    const operations = createDockerBashOperations({ image: 'fake:image', env: {}, dockerPath })

    await expect(
      operations.exec('true', join(testDir, 'missing-workspace'), {
        onData: () => undefined,
      }),
    ).rejects.toThrow(/mount does not exist/)
    expect(invocations()).toEqual([])
  })

  test.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid timeout %s before spawning Docker', async (timeout) => {
    const operations = createDockerBashOperations({ image: 'fake:image', env: {}, dockerPath })

    await expect(
      operations.exec('true', workspace, { onData: () => undefined, timeout }),
    ).rejects.toThrow(/Invalid timeout/)
    expect(invocations()).toEqual([])
  })

  test('surfaces missing images and mount failures as sandbox startup errors', async () => {
    const missingImage = createDockerBashOperations({
      image: 'missing:image',
      env: {},
      dockerPath,
    })
    await expect(missingImage.exec('true', workspace, { onData: () => undefined })).rejects.toThrow(
      /image "missing:image" is unavailable/,
    )

    const mountFailure = createDockerBashOperations({
      image: 'fake:image',
      env: {},
      dockerPath,
    })
    await expect(
      mountFailure.exec('__mount_failure__', workspace, { onData: () => undefined }),
    ).rejects.toThrow(/mount failed/)
  })

  test.each([
    { kind: 'abort' as const, timeout: undefined },
    { kind: 'timeout' as const, timeout: 0.05 },
  ])('kills the Docker CLI and force-removes the exact container on $kind', async (scenario) => {
    const controller = new AbortController()
    const operations = createDockerBashOperations({ image: 'fake:image', env: {}, dockerPath })
    const execution = operations.exec('__hang__', workspace, {
      signal: controller.signal,
      timeout: scenario.timeout,
      onData: (data) => {
        if (scenario.kind === 'abort' && data.toString('utf8').includes('ready')) {
          controller.abort()
        }
      },
    })

    await expect(execution).rejects.toThrow(
      scenario.kind === 'abort' ? /^aborted$/ : /^timeout:0\.05$/,
    )

    const calls = invocations()
    const run = calls.find((entry) => entry.args[0] === 'run')
    expect(run).toBeDefined()
    if (!run) throw new Error('fake Docker run invocation was not recorded')
    const name = flagValues(run.args, '--name')[0]
    expect(name).toMatch(/^bazilion-bash-\d+-[a-f0-9]{32}$/)
    expect(calls.map((entry) => entry.args)).toContainEqual(['container', 'rm', '--force', name])
    expect(() => process.kill(run.pid, 0)).toThrow()
  })

  test('rechecks after an initial missing-container cleanup race', async () => {
    const operations = createDockerBashOperations({ image: 'fake:image', env: {}, dockerPath })

    await expect(
      operations.exec('__startup_race__', workspace, {
        timeout: 0.05,
        onData: () => undefined,
      }),
    ).rejects.toThrow(/^timeout:0\.05$/)

    const calls = invocations()
    const run = calls.find((entry) => entry.args[0] === 'run')
    expect(run).toBeDefined()
    const name = flagValues(run?.args ?? [], '--name')[0]
    expect(
      calls.filter(
        (entry) =>
          entry.args[0] === 'container' && entry.args[1] === 'rm' && entry.args.at(-1) === name,
      ),
    ).toHaveLength(2)
  })

  test('bounds repeated cleanup failures below the worker kill grace', async () => {
    const operations = createDockerBashOperations({ image: 'fake:image', env: {}, dockerPath })
    const startedAt = Date.now()

    await expect(
      operations.exec('__cleanup_hang__', workspace, {
        timeout: 0.05,
        onData: () => undefined,
      }),
    ).rejects.toThrow(/^timeout:0\.05$/)

    expect(Date.now() - startedAt).toBeLessThan(2_900)
    expect(
      invocations().filter((entry) => entry.args[0] === 'container' && entry.args[1] === 'rm'),
    ).toHaveLength(3)
  }, 5_000)
})
