import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { resolveRepositoryContext } from '../../src/lib/repository-context/index.ts'
import { repositoryContextIntegration } from '../../src/runtime/pi/repository-context.ts'
import { assertRepositoryContext } from '../../src/runtime/pi/repository-context-contract.ts'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bazilion-context-runtime-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
const report = (target = '.') => resolveRepositoryContext({ teamId: 'team', root, target })
const invoke = (tool: ToolDefinition, target: string) =>
  tool.execute(
    'context-call',
    { target },
    undefined,
    undefined,
    {} as Parameters<ToolDefinition['execute']>[4],
  )

test('Pi loader consumes daemon snapshots and targeted refresh replaces active scoped instructions', async () => {
  mkdirSync(join(root, 'app'))
  writeFileSync(join(root, 'AGENTS.md'), 'ROOT SENTINEL')
  writeFileSync(join(root, 'app', 'AGENTS.md'), 'NESTED SENTINEL')
  const initial = await report()
  const integration = repositoryContextIntegration(initial, report, '/workspace')
  const settingsManager = SettingsManager.inMemory({})
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager,
    noContextFiles: true,
    noSkills: true,
    noExtensions: true,
    noThemes: true,
    noPromptTemplates: true,
  })
  loader.getAgentsFiles = integration.files
  await loader.reload()
  expect(loader.getAgentsFiles().agentsFiles[0]?.content).toContain('ROOT SENTINEL')
  expect(loader.getAgentsFiles().agentsFiles[0]?.content).not.toContain('NESTED SENTINEL')
  const rebuild = vi.fn()
  integration.bind({ setActiveToolsByName: rebuild } as unknown as AgentSession, [
    'bash',
    'repository_context',
  ])
  await invoke(integration.tool, 'app/file.ts')
  expect(loader.getAgentsFiles().agentsFiles[0]?.content).toContain('NESTED SENTINEL')
  expect(rebuild).toHaveBeenCalledWith(['bash', 'repository_context'])
  writeFileSync(join(root, 'AGENTS.md'), 'ROOT REPLACED')
  await invoke(integration.tool, '.')
  const prompt = loader.getAgentsFiles().agentsFiles[0]?.content ?? ''
  expect(prompt).toContain('ROOT REPLACED')
  expect(prompt).not.toContain('ROOT SENTINEL')
  expect(prompt).not.toContain('NESTED SENTINEL')
  expect(prompt).not.toContain(root)
  expect(loader.getSkills().skills).toEqual([])
})

test('incomplete targeted instructions replace the old scope with an explicit block', async () => {
  writeFileSync(join(root, 'AGENTS.md'), 'VALID INSTRUCTIONS')
  const integration = repositoryContextIntegration(await report(), report, '/workspace')
  await invoke(integration.tool, '../escape')
  expect(integration.files().agentsFiles[0]?.content).toContain('BLOCKED SCOPE')
  expect(integration.files().agentsFiles[0]?.content).not.toContain('VALID INSTRUCTIONS')
})

test('normal and protected context integration preserve identical instruction bytes and provenance', async () => {
  writeFileSync(join(root, 'AGENTS.md'), 'EXACT\r\nBYTES\n')
  const initial = await report()
  const normal = repositoryContextIntegration(initial, report, root)
  const protectedContext = repositoryContextIntegration(initial, report, '/workspace')
  expect(normal.files().agentsFiles[0]?.content.replace(root, '/workspace')).toBe(
    protectedContext.files().agentsFiles[0]?.content,
  )
})

test('malformed, oversized and cross-Team wire reports are rejected', async () => {
  const value = await report()
  expect(() => assertRepositoryContext(value, 'team')).not.toThrow()
  expect(() => assertRepositoryContext(value, 'other')).toThrow()
  expect(() => assertRepositoryContext({ ...value, instructions: {} })).toThrow()
  expect(() => assertRepositoryContext({ ...value, extra: 'x'.repeat(256 * 1024) })).toThrow()
})
