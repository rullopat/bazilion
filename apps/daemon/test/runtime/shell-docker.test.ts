import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  buildDockerRunSpec,
  checkProtectedDockerReadiness,
  createDockerBashOperations,
  createPreparedDockerBashOperations,
  preflightProtectedDockerRuntime,
} from '../../src/runtime/shell/docker.ts'

interface FakeDockerInvocation {
  args: string[]
  pid: number
  env: Record<string, string>
}

let testDir: string
let workspace: string
let dockerPath: string
let logPath: string
let imageIdPath: string
let dockerSocketPath: string
let containerStatePath: string
let dockerSocketServer: Server | null = null

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'bazilion-shell-docker-'))
  workspace = join(testDir, 'workspace')
  dockerPath = join(testDir, 'fake-docker.cjs')
  logPath = join(testDir, 'docker.log')
  imageIdPath = join(testDir, 'image-id')
  dockerSocketPath = join(testDir, 'docker.sock')
  containerStatePath = join(testDir, 'preflight-container')
  writeFileSync(imageIdPath, `sha256:${'a'.repeat(64)}`)

  writeFileSync(
    dockerPath,
    `#!${process.execPath}
const { appendFileSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args, pid: process.pid, env: process.env }) + '\\n')

if (args[0] === 'context' && args[1] === 'inspect') {
  const endpoint = process.env.DOCKER_CONTEXT === 'remote-test'
    ? 'ssh://remote.example.test'
    : ${JSON.stringify(`unix://${dockerSocketPath}`)}
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
  const imageId = image === 'missing-tools:image'
    ? ${JSON.stringify(`sha256:${'c'.repeat(64)}`)}
    : readFileSync(${JSON.stringify(imageIdPath)}, 'utf8').trim()
  process.stdout.write(JSON.stringify(imageId) + '\\t' + JSON.stringify(volumes) + '\\n')
  process.exit(0)
}

if (args[0] === 'container' && args[1] === 'create') {
  if (args.some((arg) => arg.includes('reject-create'))) {
    process.stderr.write('Error response from daemon: invalid mount config for type "bind"\\n')
    process.exit(125)
  }
  const name = args[args.indexOf('--name') + 1]
  writeFileSync(${JSON.stringify(containerStatePath)}, name)
  process.stdout.write('preflight-container-id\\n')
  process.exit(0)
}

if (args[0] === 'container' && args[1] === 'start') {
  const calls = readFileSync(${JSON.stringify(logPath)}, 'utf8')
    .trim()
    .split('\\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).args)
  const createCommand = calls.find((call) => call[0] === 'container' && call[1] === 'create')
  if (createCommand?.includes(${JSON.stringify(`sha256:${'c'.repeat(64)}`)})) {
    process.stderr.write('exec: "/bin/bash": stat /bin/bash: no such file or directory\\n')
    process.exit(1)
  }
  if (createCommand?.some((arg) => arg.includes('probe-start-hang'))) {
    setInterval(() => {}, 1_000)
  } else {
    process.exit(0)
  }
}

if (args[0] === 'container' && args[1] === 'rm') {
  const calls = readFileSync(${JSON.stringify(logPath)}, 'utf8')
    .trim()
    .split('\\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).args)
  const runCommand = calls.find((call) => call[0] === 'run')?.at(-1)
  const createCommand = calls.find((call) => call[0] === 'container' && call[1] === 'create')
  const removeCount = calls.filter((call) => call[0] === 'container' && call[1] === 'rm').length
  if (runCommand === '__startup_race__' && removeCount === 1) {
    process.stderr.write('Error response from daemon: No such container\\n')
    process.exit(1)
  }
  if (runCommand === '__cleanup_hang__' || createCommand?.some((arg) => arg.includes('cleanup-hang-preflight'))) {
    setInterval(() => {}, 1_000)
  } else {
    rmSync(${JSON.stringify(containerStatePath)}, { force: true })
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
  } else if (command === '__startup_race__') {
    process.stdout.write('ready\\n')
    setInterval(() => {}, 1_000)
  } else if (command === '__cleanup_hang__') {
    process.stdout.write('ready\\n')
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

afterEach(async () => {
  if (dockerSocketServer) {
    const server = dockerSocketServer
    dockerSocketServer = null
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  rmSync(testDir, { recursive: true, force: true })
})

async function startDockerSocket(): Promise<void> {
  dockerSocketServer = createServer()
  await new Promise<void>((resolve, reject) => {
    dockerSocketServer?.once('error', reject)
    dockerSocketServer?.listen(dockerSocketPath, resolve)
  })
}

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

describe('protected Docker preflight and pinned execution', () => {
  test('returns a secret-free readiness result and executes only the pinned local facts', async () => {
    await startDockerSocket()
    const memory = join(workspace, 'memory')
    mkdirSync(memory)
    const hostEnv = { PATH: testDir, HOME: testDir }

    await expect(
      checkProtectedDockerReadiness({ image: 'fake:image', dockerPath, hostEnv }),
    ).resolves.toEqual({ ready: true, image: 'fake:image' })
    const runtime = await preflightProtectedDockerRuntime({
      image: 'fake:image',
      dockerPath,
      hostEnv,
      workspaceDir: workspace,
      workspaceRoot: workspace,
      readOnlyMounts: [{ source: memory, sourceRoot: workspace, target: '/workspace/memory' }],
    })
    expect(runtime.dockerPath).toBe(dockerPath)
    expect(runtime.executableIdentity).toMatchObject({
      device: expect.stringMatching(/^\d+$/),
      inode: expect.stringMatching(/^\d+$/),
    })
    expect(runtime.endpoint).toBe(`unix://${dockerSocketPath}`)
    expect(runtime.imageId).toBe(`sha256:${'a'.repeat(64)}`)

    const preflightCalls = invocations()
    const workspaceMount = `type=bind,source=${workspace},target=/workspace,bind-recursive=disabled`
    const create = preflightCalls.find(
      (entry) =>
        entry.args[0] === 'container' &&
        entry.args[1] === 'create' &&
        flagValues(entry.args, '--mount').includes(workspaceMount),
    )
    expect(create).toBeDefined()
    expect(flagValues(create?.args ?? [], '--network')).toEqual(['none'])
    expect(flagValues(create?.args ?? [], '--pull')).toEqual(['never'])
    expect(flagValues(create?.args ?? [], '--mount')).toEqual([
      workspaceMount,
      `type=bind,source=${memory},target=/workspace/memory,readonly,bind-recursive=disabled`,
    ])
    expect(create?.args).toContain(runtime.imageId)
    expect(create?.args).not.toContain(runtime.image)
    const preflightName = flagValues(create?.args ?? [], '--name')[0]
    expect(preflightName).toMatch(/^bazilion-preflight-\d+-[a-f0-9]{32}$/)
    expect(preflightCalls.map((entry) => entry.args)).toContainEqual([
      'container',
      'start',
      '--attach',
      preflightName,
    ])
    expect(preflightCalls.map((entry) => entry.args)).toContainEqual([
      'container',
      'rm',
      '--force',
      preflightName,
    ])
    expect(existsSync(containerStatePath)).toBe(false)
    expect(preflightCalls.some((entry) => entry.args[0] === 'run')).toBe(false)

    const output: string[] = []
    const operations = createPreparedDockerBashOperations(runtime)
    await expect(
      operations.exec('true', workspace, {
        onData: (data) => output.push(data.toString('utf8')),
        env: { HOST_SECRET: 'must-not-pass' },
      }),
    ).resolves.toEqual({ exitCode: 0 })
    expect(output.join('')).toContain('from stdout')

    const run = invocations()
      .reverse()
      .find((entry) => entry.args[0] === 'run')
    expect(run?.args).toContain(runtime.imageId)
    expect(run?.args).not.toContain(runtime.image)
    expect(run?.env).toEqual({ DOCKER_HOST: `unix://${dockerSocketPath}` })
    expect(run?.args.join('\0')).not.toContain('HOST_SECRET')
  })

  test('rejects a daemon mount/create failure during preflight and removes the exact probe', async () => {
    await startDockerSocket()
    const rejectedWorkspace = join(testDir, 'reject-create-workspace')
    mkdirSync(rejectedWorkspace)

    await expect(
      preflightProtectedDockerRuntime({
        image: 'fake:image',
        dockerPath,
        hostEnv: { PATH: testDir, HOME: testDir },
        workspaceDir: rejectedWorkspace,
        workspaceRoot: rejectedWorkspace,
      }),
    ).rejects.toThrow(/preflight mount failed/)

    const calls = invocations()
    const create = calls.find(
      (entry) => entry.args[0] === 'container' && entry.args[1] === 'create',
    )
    expect(create).toBeDefined()
    const name = flagValues(create?.args ?? [], '--name')[0]
    expect(calls.map((entry) => entry.args)).toContainEqual(['container', 'rm', '--force', name])
    expect(existsSync(containerStatePath)).toBe(false)
    expect(calls.some((entry) => entry.args[0] === 'run')).toBe(false)
  })

  test('reports an image missing required shell executables as not protected-ready', async () => {
    await startDockerSocket()

    const result = await checkProtectedDockerReadiness({
      image: 'missing-tools:image',
      dockerPath,
      hostEnv: { PATH: testDir, HOME: testDir },
    })

    expect(result).toEqual({
      ready: false,
      image: 'missing-tools:image',
      reason: 'Docker preflight failed',
    })
    expect(JSON.stringify(result)).not.toContain(testDir)
    expect(JSON.stringify(result)).not.toContain(dockerSocketPath)
    expect(
      invocations().some((entry) => entry.args[0] === 'container' && entry.args[1] === 'start'),
    ).toBe(true)
    expect(existsSync(containerStatePath)).toBe(false)
  })

  test('rejects an image missing the required shell executables before returning runtime', async () => {
    await startDockerSocket()

    await expect(
      preflightProtectedDockerRuntime({
        image: 'missing-tools:image',
        dockerPath,
        hostEnv: { PATH: testDir, HOME: testDir },
        workspaceDir: workspace,
        workspaceRoot: workspace,
      }),
    ).rejects.toThrow(/required \/bin\/bash and \/usr\/bin\/env probe/)

    const calls = invocations()
    const create = calls.find(
      (entry) => entry.args[0] === 'container' && entry.args[1] === 'create',
    )
    const name = flagValues(create?.args ?? [], '--name')[0]
    expect(calls.map((entry) => entry.args)).toContainEqual([
      'container',
      'start',
      '--attach',
      name,
    ])
    expect(calls.map((entry) => entry.args)).toContainEqual(['container', 'rm', '--force', name])
    expect(existsSync(containerStatePath)).toBe(false)
    expect(calls.some((entry) => entry.args[0] === 'run')).toBe(false)
  })

  test('bounds an unresponsive executable probe and force-removes its exact container', async () => {
    await startDockerSocket()
    const hangingWorkspace = join(testDir, 'probe-start-hang-workspace')
    mkdirSync(hangingWorkspace)
    const startedAt = Date.now()

    await expect(
      preflightProtectedDockerRuntime({
        image: 'fake:image',
        dockerPath,
        hostEnv: { PATH: testDir, HOME: testDir },
        workspaceDir: hangingWorkspace,
        workspaceRoot: hangingWorkspace,
      }),
    ).rejects.toThrow(/could not start its protected preflight container within 2000ms/)

    expect(Date.now() - startedAt).toBeLessThan(3_000)
    const calls = invocations()
    const create = calls.find(
      (entry) => entry.args[0] === 'container' && entry.args[1] === 'create',
    )
    const name = flagValues(create?.args ?? [], '--name')[0]
    expect(calls.map((entry) => entry.args)).toContainEqual(['container', 'rm', '--force', name])
    expect(existsSync(containerStatePath)).toBe(false)
  }, 4_000)

  test('bounds preflight cleanup failures and never returns a protected runtime', async () => {
    await startDockerSocket()
    const cleanupHangWorkspace = join(testDir, 'cleanup-hang-preflight-workspace')
    mkdirSync(cleanupHangWorkspace)
    const startedAt = Date.now()

    await expect(
      preflightProtectedDockerRuntime({
        image: 'fake:image',
        dockerPath,
        hostEnv: { PATH: testDir, HOME: testDir },
        workspaceDir: cleanupHangWorkspace,
        workspaceRoot: cleanupHangWorkspace,
      }),
    ).rejects.toThrow(/could not confirm cleanup of its preflight container/)

    expect(Date.now() - startedAt).toBeLessThan(2_900)
    expect(
      invocations().filter((entry) => entry.args[0] === 'container' && entry.args[1] === 'rm'),
    ).toHaveLength(3)
    expect(invocations().some((entry) => entry.args[0] === 'run')).toBe(false)
  }, 5_000)

  test('readiness failures expose a bounded reason without endpoint or executable paths', async () => {
    await startDockerSocket()
    const result = await checkProtectedDockerReadiness({
      image: 'volume:image',
      dockerPath,
      hostEnv: { PATH: testDir, HOME: testDir },
    })
    expect(result).toEqual({
      ready: false,
      image: 'volume:image',
      reason: 'Docker image declares writable volumes',
    })
    expect(JSON.stringify(result)).not.toContain(testDir)
    expect(JSON.stringify(result)).not.toContain(dockerSocketPath)
  })

  test('rejects an image-tag change between preflight and execution without host fallback', async () => {
    await startDockerSocket()
    const runtime = await preflightProtectedDockerRuntime({
      image: 'fake:image',
      dockerPath,
      hostEnv: { PATH: testDir, HOME: testDir },
      workspaceDir: workspace,
      workspaceRoot: workspace,
    })
    writeFileSync(imageIdPath, `sha256:${'b'.repeat(64)}`)

    await expect(
      createPreparedDockerBashOperations(runtime).exec('true', workspace, {
        onData: () => undefined,
      }),
    ).rejects.toThrow(/image no longer matches.*immutable id/)
    expect(invocations().some((entry) => entry.args[0] === 'run')).toBe(false)
  })

  test('rejects Docker executable replacement before any worker-side Docker call', async () => {
    await startDockerSocket()
    const runtime = await preflightProtectedDockerRuntime({
      image: 'fake:image',
      dockerPath,
      hostEnv: { PATH: testDir, HOME: testDir },
      workspaceDir: workspace,
      workspaceRoot: workspace,
    })
    const callsBeforeReplacement = invocations().length
    const replacement = join(testDir, 'replacement-docker.cjs')
    writeFileSync(replacement, readFileSync(dockerPath))
    chmodSync(replacement, 0o755)
    renameSync(replacement, dockerPath)

    await expect(
      createPreparedDockerBashOperations(runtime).exec('true', workspace, {
        onData: () => undefined,
      }),
    ).rejects.toThrow(/executable no longer matches.*preflighted identity/)
    expect(invocations()).toHaveLength(callsBeforeReplacement)
    expect(invocations().some((entry) => entry.args[0] === 'run')).toBe(false)
  })

  test('rejects a read-only mount replaced by a symlink after preflight', async () => {
    await startDockerSocket()
    const memory = join(workspace, 'memory')
    const replacement = join(workspace, 'memory-real')
    mkdirSync(memory)
    const runtime = await preflightProtectedDockerRuntime({
      image: 'fake:image',
      dockerPath,
      hostEnv: { PATH: testDir, HOME: testDir },
      workspaceDir: workspace,
      workspaceRoot: workspace,
      readOnlyMounts: [{ source: memory, sourceRoot: workspace, target: '/workspace/memory' }],
    })
    renameSync(memory, replacement)
    symlinkSync(replacement, memory, 'dir')

    await expect(
      createPreparedDockerBashOperations(runtime).exec('true', workspace, {
        onData: () => undefined,
      }),
    ).rejects.toThrow(/mount no longer matches preflight/)
    expect(invocations().some((entry) => entry.args[0] === 'run')).toBe(false)
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
    // Keep enough headroom for the Docker preflight subprocesses when the
    // whole Vitest tree is saturating the host; the timeout still exercises
    // the same cleanup path without racing before `docker run` starts.
    { kind: 'timeout' as const, timeout: 0.5 },
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
      scenario.kind === 'abort' ? /^aborted$/ : /^timeout:0\.5$/,
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
    const controller = new AbortController()
    const operations = createDockerBashOperations({ image: 'fake:image', env: {}, dockerPath })

    await expect(
      operations.exec('__startup_race__', workspace, {
        signal: controller.signal,
        onData: (data) => {
          if (data.toString('utf8').includes('ready')) controller.abort()
        },
      }),
    ).rejects.toThrow(/^aborted$/)

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
    const controller = new AbortController()
    const operations = createDockerBashOperations({ image: 'fake:image', env: {}, dockerPath })
    const startedAt = Date.now()

    await expect(
      operations.exec('__cleanup_hang__', workspace, {
        signal: controller.signal,
        onData: (data) => {
          if (data.toString('utf8').includes('ready')) controller.abort()
        },
      }),
    ).rejects.toThrow(/^aborted$/)

    expect(Date.now() - startedAt).toBeLessThan(2_900)
    expect(
      invocations().filter((entry) => entry.args[0] === 'container' && entry.args[1] === 'rm'),
    ).toHaveLength(3)
  }, 5_000)
})
