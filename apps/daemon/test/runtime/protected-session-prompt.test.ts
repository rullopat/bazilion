import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedAgent } from '@bazilion/api-types'
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { afterEach, describe, expect, test } from 'vitest'
import type { MemoryBackend } from '../../src/runtime/memory/types.ts'
import {
  createProtectedBazilionSession,
  createRestrictedReviewSession,
} from '../../src/runtime/pi/session.ts'
import type { BashApprovalHost } from '../../src/runtime/shell/approval.ts'
import type { ProtectedDockerRuntime } from '../../src/runtime/shell/docker.ts'
import type { MessagingHost, UserMdHost } from '../../src/runtime/worker/ipc-protocol.ts'
import {
  cleanupMinimalWorkerScratch,
  createMinimalWorkerScratch,
} from '../../src/runtime/worker/runtime.ts'

const cleanup: string[] = []

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('protected provider prompt boundary', () => {
  test('normal protected provider context names only logical container paths', async () => {
    const root = temporaryRoot()
    const teamDir = join(root, 'teams', 'team-1')
    const memoryDir = join(teamDir, 'memory')
    const agentDir = join(root, 'agents', 'agent-1')
    const sessionDir = join(agentDir, 'sessions')
    const skillDir = join(root, 'skills', 'audit-skill')
    for (const path of [memoryDir, sessionDir, skillDir]) mkdirSync(path, { recursive: true })
    const scratch = createMinimalWorkerScratch(root)
    const agent = resolvedAgent(agentDir, teamDir)
    const runtime = {
      providerName: 'openai-codex' as const,
      modelId: 'gpt-5.6-sol',
      reasoningLevel: 'high' as const,
      apiKey: 'protected-prompt-access-token',
    }
    const hosts = scopedHosts()
    const handle = await createProtectedBazilionSession({
      agent,
      runtime,
      paths: {
        agentDir,
        teamDir,
        memoryDir,
        sessionDir,
        skills: [
          {
            name: 'audit-skill',
            description: 'A test skill.',
            body: 'Use the mounted helper when needed.',
            hostDir: skillDir,
            sandboxDir: '/skills/0-audit-skill',
          },
        ],
        homeDocuments: {
          'AGENTS.md': 'Stay inside the protected surface.',
          'SOUL.md': null,
          'TOOLS.md': null,
          'IDENTITY.md': null,
          'BOOTSTRAP.md': null,
        },
      },
      scratch,
      docker: protectedDockerRuntime(teamDir, memoryDir, skillDir),
      memory: memoryBackend(),
      messagingHost: hosts.messagingHost,
      userMdHost: hosts.userMdHost,
      bashApprovalHost: hosts.bashApprovalHost,
      refreshApiKey: async () => runtime.apiKey,
      fileSink: () => {},
    })
    let providerSystemPrompt = ''
    handle.session.agent.streamFunction = (model, context) => {
      providerSystemPrompt = context.systemPrompt ?? ''
      return completedStream(model)
    }

    try {
      await handle.session.prompt('inspect the protected prompt')
    } finally {
      handle.dispose()
      cleanupMinimalWorkerScratch(scratch)
    }

    expect(providerSystemPrompt).toContain('/workspace')
    expect(providerSystemPrompt).toContain('/skills/0-audit-skill')
    expect(providerSystemPrompt).not.toContain(root)
    expect(providerSystemPrompt).not.toContain(teamDir)
    expect(providerSystemPrompt).not.toContain(agentDir)
    expect(providerSystemPrompt).not.toContain(skillDir)
    expect(providerSystemPrompt).not.toContain('node_modules')
  })

  test('restricted review provider context contains no host or package paths', async () => {
    const root = temporaryRoot()
    const scratch = createMinimalWorkerScratch(root)
    const proposalTool: ToolDefinition = {
      name: 'propose_lesson',
      label: 'propose_lesson',
      description: 'Return a bounded proposal set.',
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: 'text', text: 'ok' }], details: {} }
      },
    }
    const handle = await createRestrictedReviewSession({
      runtime: {
        providerName: 'openai-codex',
        modelId: 'gpt-5.6-sol',
        reasoningLevel: 'low',
        apiKey: 'review-prompt-access-token',
      },
      scratch,
      systemPrompt: 'Restricted reviewer instructions. Use propose_lesson only.',
      tools: [proposalTool],
      refreshApiKey: async () => 'review-prompt-access-token',
    })
    let providerSystemPrompt = ''
    handle.session.agent.streamFunction = (model, context) => {
      providerSystemPrompt = context.systemPrompt ?? ''
      return completedStream(model)
    }

    try {
      await handle.session.prompt('bounded review digest')
    } finally {
      handle.dispose()
      cleanupMinimalWorkerScratch(scratch)
    }

    expect(providerSystemPrompt).toBe(
      'Restricted reviewer instructions. Use propose_lesson only.\nCurrent working directory: /review',
    )
    expect(providerSystemPrompt).not.toContain(root)
    expect(providerSystemPrompt).not.toContain('node_modules')
  })

  test('materializes explicit Vertex credentials only inside turn scratch', async () => {
    const root = temporaryRoot()
    const scratch = createMinimalWorkerScratch(root)
    const content = JSON.stringify({ type: 'service_account', private_key: 'vertex-secret' })
    const handle = await createRestrictedReviewSession({
      runtime: {
        providerName: 'google-vertex',
        modelId: 'gemini-3.6-flash',
        reasoningLevel: 'low',
        credentialEnv: [
          { name: 'GOOGLE_CLOUD_PROJECT', value: 'project-one' },
          { name: 'GOOGLE_CLOUD_LOCATION', value: 'europe-west1' },
        ],
        credentialFile: { envName: 'GOOGLE_APPLICATION_CREDENTIALS', content },
      },
      scratch,
      systemPrompt: 'Restricted reviewer instructions.',
      tools: [],
      refreshApiKey: async () => '',
    })
    const credentialPath = join(scratch.tempDir, 'provider-credential.json')
    try {
      expect(readFileSync(credentialPath, 'utf8')).toBe(content)
      expect(statSync(credentialPath).mode & 0o777).toBe(0o600)
      expect(credentialPath.startsWith(scratch.root)).toBe(true)
    } finally {
      handle.dispose()
      cleanupMinimalWorkerScratch(scratch)
    }
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bazilion-protected-prompt-test-'))
  cleanup.push(root)
  return root
}

function resolvedAgent(agentDir: string, teamDir: string): ResolvedAgent {
  return {
    agent: {
      id: 'agent-1',
      profileId: 'profile-1',
      name: 'Agent One',
      modelOverride: 'openai-codex:gpt-5.6-sol',
      reasoningLevel: 'high',
      reviewEnabled: true,
      reviewEveryNTurns: 8,
      reviewModel: 'openai-codex:gpt-5.6-sol',
      reviewReasoningLevel: 'low',
      reviewTurnsSinceLast: 0,
      status: 'idle',
      dir: agentDir,
      teamId: 'team-1',
      telegramTopicId: null,
      telegramMirrorMode: 'minimal',
      telegramIconEmoji: null,
      createdAt: 0,
      archivedAt: null,
    },
    profile: {
      id: 'profile-1',
      name: 'Profile One',
      dir: join(agentDir, '..', '..', 'profiles', 'profile-1'),
      defaultModel: 'openai-codex:gpt-5.6-sol',
      skillsMode: 'selected',
      createdAt: 0,
      updatedAt: 0,
    },
    model: 'openai-codex:gpt-5.6-sol',
    reasoningLevel: 'high',
    team: {
      id: 'team-1',
      name: 'Team One',
      path: teamDir,
      userMd: '',
      telegramTopicNameFormat: null,
      createdAt: 0,
    },
    skills: ['audit-skill'],
    privateLessons: [],
  }
}

function protectedDockerRuntime(
  teamDir: string,
  memoryDir: string,
  skillDir: string,
): ProtectedDockerRuntime {
  return {
    dockerPath: process.execPath,
    executableIdentity: {
      device: '1',
      inode: '2',
      mode: '33261',
      size: '3',
      modifiedTimeNs: '4',
      changedTimeNs: '5',
    },
    endpoint: 'unix:///tmp/bazilion-test-docker.sock',
    image: 'test:image',
    imageId: `sha256:${'a'.repeat(64)}`,
    uid: typeof process.getuid === 'function' ? process.getuid() : 1,
    gid: typeof process.getgid === 'function' ? process.getgid() : 1,
    workspace: { source: teamDir, sourceRoot: teamDir, target: '/workspace' },
    readOnlyMounts: [
      { source: memoryDir, sourceRoot: teamDir, target: '/workspace/memory' },
      { source: skillDir, sourceRoot: join(skillDir, '..'), target: '/skills/0-audit-skill' },
    ],
    containerEnv: {
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: '/tmp',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      SHELL: '/bin/bash',
      TMPDIR: '/tmp',
    },
  }
}

function memoryBackend(): MemoryBackend {
  return {
    init: async () => {},
    read: async () => {
      throw new Error('unused')
    },
    write: async () => {
      throw new Error('unused')
    },
    search: async () => [],
    list: async () => [],
    remove: async () => {},
  }
}

function scopedHosts(): {
  messagingHost: MessagingHost
  userMdHost: UserMdHost
  bashApprovalHost: BashApprovalHost
} {
  return {
    messagingHost: {
      agentExists: () => false,
      sendMessage: () => ({ messageId: 'unused' }),
      listInbox: () => [],
      markRead: () => {},
      findReplies: () => [],
      approvalStatus: () => null,
    },
    userMdHost: {
      get: () => ({ content: '', etag: 'unused' }),
      write: () => ({ etag: 'unused', totalBytes: 0 }),
    },
    bashApprovalHost: {
      requestApproval: async () => 'denied',
    },
  }
}

function completedStream(model: Model<Api>) {
  const stream = createAssistantMessageEventStream()
  queueMicrotask(() => {
    stream.push({
      type: 'done',
      reason: 'stop',
      message: assistantMessage(model),
    })
  })
  return stream
}

function assistantMessage(model: Model<Api>): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'done' }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}
