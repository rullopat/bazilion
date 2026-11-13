import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import {
  checkDockerImage,
  createDockerBashOperations,
  type DockerSandbox,
  dockerRunArgs,
  removeDockerContainers,
} from '../../src/runtime/shell/docker.ts'
import { createSessionShellTools } from '../../src/runtime/shell/tooling.ts'

const prefix = `bazilion-${'1'.repeat(12)}-${'2'.repeat(12)}-`
let root: string
let log: string
let listed: string
const originalPath = process.env.PATH

// A fake `docker` on PATH: it logs its arguments and plays the part of `run`, `rm`, `ps` and
// `image inspect`.
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'bazilion-shell-docker-'))
  log = join(root, 'docker.log')
  listed = join(root, 'listed')
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'docker'),
    `#!${process.execPath}
const { appendFileSync, existsSync, readFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n')
if (args[0] === 'run') {
  const command = args.at(-1)
  if (command === 'hang') {
    process.stdout.write('ready\\n')
    setInterval(() => {}, 1000)
    return
  }
  process.stdout.write('ran ' + command + '\\n')
  process.stderr.write('to stderr\\n')
  const code = /^exit (\\d+)$/.exec(command)
  process.exit(code ? Number(code[1]) : 0)
}
if (args[0] === 'ps') {
  process.stdout.write(existsSync(${JSON.stringify(listed)}) ? readFileSync(${JSON.stringify(listed)}, 'utf8') : '')
  process.exit(0)
}
if (args[0] === 'image' && args.at(-1) === 'missing:image') {
  process.stderr.write('Error response from daemon: No such image: missing:image\\n')
  process.exit(1)
}
process.exit(0)
`,
  )
  chmodSync(join(bin, 'docker'), 0o755)
  process.env.PATH = `${bin}${delimiter}${originalPath}`
})

afterAll(() => {
  process.env.PATH = originalPath
  rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(log, { force: true })
  rmSync(listed, { force: true })
})

function calls(): string[][] {
  return existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[])
    : []
}

function sandbox(overrides: Partial<DockerSandbox> = {}): DockerSandbox {
  return {
    image: 'local/toolchain:1',
    workspace: '/srv/team',
    workdir: '/workspace',
    readOnlyMounts: [{ source: '/srv/team/memory', target: '/workspace/memory' }],
    containerPrefix: prefix,
    ...overrides,
  }
}

describe('docker run arguments', () => {
  test('isolate the command: no network, read-only root, private /tmp, local image only', () => {
    const args = dockerRunArgs(sandbox(), `${prefix}abc`, 'make test')
    expect(args.slice(0, 4)).toEqual(['run', '--rm', '--name', `${prefix}abc`])
    for (const flag of [
      ['--pull', 'never'],
      ['--network', 'none'],
      ['--tmpfs', '/tmp:rw,nosuid,nodev,size=64m,mode=1777'],
      ['--cap-drop', 'ALL'],
      ['--security-opt', 'no-new-privileges=true'],
      ['--pids-limit', '256'],
      ['--workdir', '/workspace'],
      ['--entrypoint', '/bin/bash'],
    ])
      expect(args.join(' ')).toContain(flag.join(' '))
    expect(args).toContain('--read-only')
    expect(args).toContain('type=bind,source=/srv/team,target=/workspace,bind-recursive=disabled')
    expect(args).toContain(
      'type=bind,source=/srv/team/memory,target=/workspace/memory,readonly,bind-recursive=disabled',
    )
    // The environment is fixed: nothing from the host is passed.
    expect(args.filter((_, i) => args[i - 1] === '--env')).toEqual([
      'HOME=/tmp',
      'TMPDIR=/tmp',
      'LANG=C.UTF-8',
    ])
    expect(args.slice(-3)).toEqual(['local/toolchain:1', '-c', 'make test'])
  })

  test('refuse a host path that cannot be one --mount field', () => {
    expect(() => dockerRunArgs(sandbox({ workspace: '/srv/a,b' }), 'x', 'true')).toThrow(
      /cannot mount a path containing a comma/,
    )
  })
})

describe('Docker bash operations', () => {
  test('stream stdout and stderr and keep the exit code', async () => {
    let output = ''
    const result = await createDockerBashOperations(() => sandbox()).exec('exit 7', '/workspace', {
      onData: (data) => {
        output += data.toString()
      },
    })
    expect(result).toEqual({ exitCode: 7 })
    expect(output).toContain('ran exit 7')
    expect(output).toContain('to stderr')
    const [run] = calls()
    expect(run?.[0]).toBe('run')
    expect(run?.[3]).toMatch(new RegExp(`^${prefix}[0-9a-f]{12}$`))
  })

  test('cancellation kills docker run and removes its container', async () => {
    const controller = new AbortController()
    const execution = createDockerBashOperations(() => sandbox()).exec('hang', '/workspace', {
      signal: controller.signal,
      onData: (data) => {
        if (data.toString().includes('ready')) controller.abort()
      },
    })
    await expect(execution).rejects.toThrow(/^aborted$/)
    const [run, rm] = calls()
    expect(rm).toEqual(['rm', '--force', run?.[3]])
  })

  test('a timeout rejects with the timeout marker Pi expects and removes the container', async () => {
    const execution = createDockerBashOperations(() => sandbox()).exec('hang', '/workspace', {
      timeout: 0.2,
      onData: () => {},
    })
    await expect(execution).rejects.toThrow(/^timeout:0.2$/)
    expect(calls()[1]?.slice(0, 2)).toEqual(['rm', '--force'])
  })

  test('a mount problem fails the command before Docker runs', async () => {
    const operations = createDockerBashOperations(() => {
      throw new Error('Docker sandbox read-only mount must be a real directory: /srv/team/memory')
    })
    await expect(operations.exec('true', '/workspace', { onData: () => {} })).rejects.toThrow(
      /must be a real directory/,
    )
    expect(calls()).toEqual([])
  })
})

test('leftover containers are removed by name prefix only', async () => {
  writeFileSync(listed, `${prefix}aaa\nbazilion-other-container\n${prefix}bbb\n`)
  await removeDockerContainers(prefix)
  expect(calls()).toEqual([
    ['ps', '--all', '--filter', `name=${prefix}`, '--format', '{{.Names}}'],
    ['rm', '--force', `${prefix}aaa`, `${prefix}bbb`],
  ])
})

test('the image check reports Docker’s own error, or that Docker is missing', async () => {
  expect(await checkDockerImage('local/toolchain:1')).toEqual({ ok: true })
  expect(await checkDockerImage('missing:image')).toEqual({
    ok: false,
    error: 'Error response from daemon: No such image: missing:image',
  })
  const path = process.env.PATH
  process.env.PATH = join(root, 'empty')
  try {
    expect(await checkDockerImage('local/toolchain:1')).toEqual({
      ok: false,
      error: 'Docker is not installed: no `docker` executable on PATH',
    })
  } finally {
    process.env.PATH = path
  }
})

describe('the Docker bash tool', () => {
  const toolContext = {
    cwd: '/workspace',
    sessionManager: {
      getSessionId: () => 'test-session',
      getSessionFile: () => undefined,
      getCwd: () => '/workspace',
    },
  } as never

  function team() {
    return {
      dir: mkdtempSync(join(root, 'team-')),
      agent: mkdtempSync(join(root, 'agent-')),
      skill: mkdtempSync(join(root, 'skill-')),
    }
  }

  async function run(
    teamDir: string,
    options: Parameters<typeof createSessionShellTools>[2],
    command = 'true',
  ) {
    const tools = createSessionShellTools(teamDir, { BAZILION_BASH_SANDBOX: 'docker' }, options)
    if (!tools.customBash) throw new Error('Docker mode must provide bash')
    return tools.customBash.execute('call-1', { command }, undefined, undefined, toolContext)
  }

  test('mounts the Team read/write, its memory, uploads and skills read-only', async () => {
    const { dir, agent, skill } = team()
    mkdirSync(join(dir, 'app'))
    mkdirSync(join(agent, 'uploads'))
    await run(dir, {
      docker: { image: 'team/image:2', cwd: 'app', containerPrefix: prefix },
      inputsDir: join(agent, 'uploads'),
      skillMounts: [{ source: skill, target: '/skills/0-audit' }],
    })
    const args = calls()[0] ?? []
    const real = realpathSync(dir)
    expect(args).toContain(`type=bind,source=${real},target=/workspace,bind-recursive=disabled`)
    expect(args).toContain(
      `type=bind,source=${real}/memory,target=/workspace/memory,readonly,bind-recursive=disabled`,
    )
    expect(args).toContain(
      `type=bind,source=${realpathSync(join(agent, 'uploads'))},target=/inputs,readonly,bind-recursive=disabled`,
    )
    expect(args).toContain(
      `type=bind,source=${realpathSync(skill)},target=/skills/0-audit,readonly,bind-recursive=disabled`,
    )
    expect(args.join(' ')).toContain('--workdir /workspace/app')
    expect(args.at(-3)).toBe('team/image:2')
    // The memory store is created so that it is always mounted read-only.
    expect(existsSync(join(dir, 'memory'))).toBe(true)
  })

  test('refuses a memory store that is a symlink, and a missing working directory', async () => {
    const { dir } = team()
    symlinkSync(mkdtempSync(join(root, 'outside-')), join(dir, 'memory'))
    await expect(run(dir, { containerPrefix: prefix })).rejects.toThrow(
      /read-only mount must be a real directory/,
    )
    await expect(
      run(team().dir, { docker: { image: 'team/image:2', cwd: 'gone', containerPrefix: prefix } }),
    ).rejects.toThrow('Working directory does not exist: /workspace/gone')
    expect(calls()).toEqual([])
  })

  test('without Docker on PATH the command fails and never runs on the host', async () => {
    const { dir } = team()
    const marker = join(dir, 'ran-on-host')
    const path = process.env.PATH
    process.env.PATH = join(root, 'empty')
    try {
      await expect(run(dir, { containerPrefix: prefix }, `echo ran > ${marker}`)).rejects.toThrow(
        'Docker is not installed: no `docker` executable on PATH',
      )
    } finally {
      process.env.PATH = path
    }
    expect(existsSync(marker)).toBe(false)
  })
})
