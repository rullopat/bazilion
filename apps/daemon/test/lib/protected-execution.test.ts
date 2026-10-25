import { mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createProfile, resolveAgent, spawnAgent } from '../../src/core/index.ts'
import type { ProtectedDockerPreflightInput } from '../../src/runtime/shell/docker.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let preflightInputs: ProtectedDockerPreflightInput[]
let preflightFailure: Error | null
let preflightGate: ((input: ProtectedDockerPreflightInput) => Promise<void>) | undefined
let agentId: string

describe('protected execution preparation', () => {
  beforeEach(async () => {
    env = makeTestEnv()
    preflightInputs = []
    preflightFailure = null
    preflightGate = undefined
    createProfile(env.db, env.paths, {
      id: 'protected',
      defaultModel: 'openai-codex:gpt-5.6-sol',
    })
    agentId = spawnAgent(env.db, env.paths, {
      profileId: 'protected',
      teamId: env.teamId,
    }).id
    vi.resetModules()
    vi.doMock('../../src/lib/ctx.ts', () => ({
      getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-auth' }),
    }))
    vi.doMock('../../src/lib/protected-provider.ts', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/lib/protected-provider.ts')>()
      return {
        ...actual,
        resolveProtectedProviderRuntime: async () => ({
          runtime: {
            providerName: 'openai-codex' as const,
            modelId: 'gpt-5.6-sol',
            reasoningLevel: 'medium' as const,
            apiKey: 'ACCESS_SENTINEL',
          },
          refreshApiKey: async () => 'ROTATED_ACCESS_SENTINEL',
        }),
      }
    })
    vi.doMock('../../src/runtime/shell/docker.ts', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/runtime/shell/docker.ts')>()
      return {
        ...actual,
        preflightProtectedDockerRuntime: async (input: ProtectedDockerPreflightInput) => {
          preflightInputs.push(input)
          await preflightGate?.(input)
          if (preflightFailure) throw preflightFailure
          return {
            dockerPath: '/usr/bin/docker',
            executableIdentity: {
              device: '1',
              inode: '2',
              mode: '33261',
              size: '3',
              modifiedTimeNs: '4',
              changedTimeNs: '5',
            },
            endpoint: 'unix:///var/run/docker.sock',
            image: input.image,
            ...(input.coding ? { coding: input.coding } : {}),
            imageId: 'sha256:protected-image',
            uid: 1000,
            gid: 1000,
            workspace: {
              source: realpathSync(input.workspaceDir),
              target: '/workspace',
              sourceRoot: realpathSync(input.workspaceRoot ?? input.workspaceDir),
            },
            readOnlyMounts: [],
            containerEnv: {
              PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
              HOME: '/tmp' as const,
              LANG: 'C.UTF-8' as const,
              LC_ALL: 'C.UTF-8' as const,
              SHELL: '/bin/bash' as const,
              TMPDIR: '/tmp' as const,
            },
          }
        },
      }
    })
  })

  afterEach(() => {
    vi.doUnmock('../../src/lib/ctx.ts')
    vi.doUnmock('../../src/lib/protected-provider.ts')
    vi.doUnmock('../../src/runtime/shell/docker.ts')
    vi.resetModules()
    env.cleanup()
  })

  test('prepares canonical session/input paths and fixed no-follow home documents', async () => {
    const { prepareProtectedExecution } = await import('../../src/lib/protected-execution.ts')
    const resolved = resolveAgent(env.db, env.paths, agentId)
    const prepared = await prepareProtectedExecution(resolved, { includeUploads: true })

    expect(prepared.paths.sessionDir).toBe(realpathSync(join(resolved.agent.dir, 'sessions')))
    expect(prepared.paths.uploadsDir).toBe(realpathSync(join(resolved.agent.dir, 'uploads')))
    expect(prepared.paths.memoryDir).toBe(realpathSync(join(resolved.team.path, 'memory')))
    expect(prepared.paths.homeDocuments).toMatchObject({
      'AGENTS.md': expect.any(String),
      'SOUL.md': expect.any(String),
      'IDENTITY.md': expect.any(String),
    })
    expect(preflightInputs).toHaveLength(1)
    expect(preflightInputs[0]?.readOnlyMounts?.map((mount) => mount.target)).toContain('/inputs')
  })

  test('configured and protected preparation select identical Team image, cwd, environment and mounts', async () => {
    const { putCodingEnvironment } = await import('../../src/core/repos/coding-environment.ts')
    const { prepareAgentDockerInputs, prepareProtectedExecution } = await import(
      '../../src/lib/protected-execution.ts'
    )
    const resolved = resolveAgent(env.db, env.paths, agentId)
    mkdirSync(join(resolved.team.path, 'app'))
    putCodingEnvironment(env.db, env.teamId, 0, {
      image: 'prepared/node:24',
      cwd: 'app',
      env: { CI: 'true', NO_COLOR: '1' },
    })
    const configured = await prepareAgentDockerInputs(resolved, { includeUploads: true })
    const protectedTurn = await prepareProtectedExecution(resolved, { includeUploads: true })
    expect(preflightInputs).toHaveLength(2)
    expect(preflightInputs[0]).toEqual(preflightInputs[1])
    expect(configured.docker).toEqual(protectedTurn.docker)
    expect(configured.docker.coding).toEqual({
      revision: 1,
      cwd: 'app',
      env: { CI: 'true', NO_COLOR: '1' },
    })
    expect(configured.docker.image).toBe('prepared/node:24')
    expect(configured).not.toHaveProperty('runtime')
    expect(configured).not.toHaveProperty('refreshApiKey')
  })

  test.each([
    'sessions',
    'uploads',
  ] as const)('fails before Docker preflight when Agent %s is a symbolic link', async (name) => {
    const agentDir = env.paths.agentDir(agentId)
    const selected = join(agentDir, name)
    rmSync(selected, { recursive: true, force: true })
    const outside = join(env.home, `outside-${name}`)
    mkdirSync(outside)
    symlinkSync(outside, selected, 'dir')
    const { prepareProtectedExecution } = await import('../../src/lib/protected-execution.ts')
    const resolved = resolveAgent(env.db, env.paths, agentId)

    await expect(
      prepareProtectedExecution(resolved, { includeUploads: name === 'uploads' }),
    ).rejects.toThrow('Protected Agent paths are unavailable or unsafe')
    expect(preflightInputs).toEqual([])
  })

  test('does not produce a worker runtime when Docker rejects required mounts during create', async () => {
    preflightFailure = new Error('Docker sandbox preflight mount failed')
    const { prepareProtectedExecution } = await import('../../src/lib/protected-execution.ts')
    const resolved = resolveAgent(env.db, env.paths, agentId)

    await expect(prepareProtectedExecution(resolved)).rejects.toThrow(
      'Protected Docker runtime is unavailable',
    )
    expect(preflightInputs).toHaveLength(1)
  })

  test('protected Docker diagnostics publish only the closed phase, never raw error material', async () => {
    const { DockerPreflightError } = await import('../../src/runtime/shell/docker.ts')
    preflightFailure = new DockerPreflightError(
      'start',
      new Error(`PRIVATE_RAW_TOKEN ${env.home} unix:///private-endpoint`),
    )
    const { prepareProtectedExecution } = await import('../../src/lib/protected-execution.ts')
    const error = await prepareProtectedExecution(resolveAgent(env.db, env.paths, agentId)).then(
      () => undefined,
      (failure: unknown) => failure,
    )
    expect(error).toMatchObject({
      code: 'protected_execution_unavailable',
      message:
        'Protected Docker runtime is unavailable (start). Run `bazilion doctor` for remediation.',
    })
    expect((error as Error).message).not.toContain('PRIVATE_RAW_TOKEN')
    expect((error as Error).message).not.toContain(env.home)
    expect(error).not.toHaveProperty('cause')
    preflightFailure = new DockerPreflightError('start', new Error('PRIVATE_RAW_TOKEN'), 'timeout')
    await expect(
      prepareProtectedExecution(resolveAgent(env.db, env.paths, agentId)),
    ).rejects.toMatchObject({
      code: 'protected_execution_unavailable',
      message:
        'Protected Docker runtime is unavailable (start: timeout). Run `bazilion doctor` for remediation.',
    })
  })

  test.each([
    'configured',
    'protected',
  ] as const)('%s preparation forwards cancellation through live preflight and waits for cleanup', async (kind) => {
    const { prepareAgentDockerInputs, prepareProtectedExecution } = await import(
      '../../src/lib/protected-execution.ts'
    )
    const entered = Promise.withResolvers<void>()
    const cleanup = Promise.withResolvers<void>()
    let observedAbort = false
    let settled = false
    preflightGate = async (input) => {
      entered.resolve()
      const signal = input.signal
      if (!signal) throw new Error('caller cancellation signal missing')
      await new Promise<void>((_resolve, reject) => {
        const aborted = () => {
          observedAbort = true
          void cleanup.promise.then(() => reject(new Error('aborted')))
        }
        signal.addEventListener('abort', aborted, { once: true })
        if (signal.aborted) aborted()
      })
    }
    const controller = new AbortController()
    const prepare = kind === 'configured' ? prepareAgentDockerInputs : prepareProtectedExecution
    const attempt = prepare(resolveAgent(env.db, env.paths, agentId), {
      signal: controller.signal,
    }).then(
      (value) => {
        settled = true
        return { value }
      },
      (error: unknown) => {
        settled = true
        return { error }
      },
    )
    await entered.promise
    try {
      expect(preflightInputs[0]?.signal).toBe(controller.signal)
      controller.abort()
      expect(observedAbort).toBe(true)
      await Promise.resolve()
      expect(settled).toBe(false)
    } finally {
      controller.abort()
      cleanup.resolve()
      await attempt
    }
    const outcome = await attempt
    expect(outcome).not.toHaveProperty('value')
    expect(outcome).toMatchObject({ error: { code: 'protected_execution_unavailable' } })
    expect(settled).toBe(true)
    expect(preflightInputs).toHaveLength(1)
  })

  test.each([
    'configured',
    'protected',
  ] as const)('%s preparation refuses an already-aborted signal before Docker preflight', async (kind) => {
    const { prepareAgentDockerInputs, prepareProtectedExecution } = await import(
      '../../src/lib/protected-execution.ts'
    )
    const controller = new AbortController()
    controller.abort()
    const prepare = kind === 'configured' ? prepareAgentDockerInputs : prepareProtectedExecution
    await expect(
      prepare(resolveAgent(env.db, env.paths, agentId), { signal: controller.signal }),
    ).rejects.toThrow(/cancelled|aborted/i)
    expect(preflightInputs).toEqual([])
  })

  test('returns an immutable nominal preflight that can be consumed only once', async () => {
    const {
      assertPreparedProtectedExecution,
      consumePreparedProtectedExecution,
      prepareProtectedExecution,
    } = await import('../../src/lib/protected-execution.ts')
    const resolved = resolveAgent(env.db, env.paths, agentId)
    const prepared = await prepareProtectedExecution(resolved)

    expect(Object.isFrozen(prepared)).toBe(true)
    expect(Object.isFrozen(prepared.runtime)).toBe(true)
    expect(Object.isFrozen(prepared.paths)).toBe(true)
    expect(Object.isFrozen(prepared.docker)).toBe(true)
    expect(Reflect.set(prepared.runtime, 'apiKey', 'MUTATED')).toBe(false)
    expect(prepared.runtime.apiKey).toBe('ACCESS_SENTINEL')
    expect(() => assertPreparedProtectedExecution({ ...prepared }, resolved)).toThrow(
      /not prepared by the daemon/,
    )

    expect(() => consumePreparedProtectedExecution(prepared, resolved)).not.toThrow()
    expect(() => consumePreparedProtectedExecution(prepared, resolved)).toThrow(
      /already been consumed/,
    )
  })
})
