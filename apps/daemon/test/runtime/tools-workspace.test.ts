// BAZ-097: the Agent in the workspace. screen and theme go to the tabs on the conversation, a
// progress card is named by its first call, and a canvas is saved as a page or a drawing.
import type { WorkspaceAction } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { progressText } from '../../src/lib/telegram/mirror.ts'
import type { DeliveredFile } from '../../src/runtime/tools/deliver-file.ts'
import { canvasTool, progressTool, workspaceTools } from '../../src/runtime/tools/workspace.ts'

const call = { toolCallId: 'call_progress_1' }
const text = async (output: unknown) =>
  typeof output === 'string' ? output : JSON.stringify(output)

test('screen and theme are sent as actions, and say when no browser saw them', async () => {
  const sent: WorkspaceAction[] = []
  let browsers = 1
  const tools = workspaceTools({
    host: {
      show: async (action) => {
        sent.push(action)
        return { browsers }
      },
    },
  })
  const screen = tools.find((tool) => tool.def.name === 'screen')
  const theme = tools.find((tool) => tool.def.name === 'theme')
  expect(tools.map((tool) => tool.def.name)).toEqual(['progress', 'screen', 'theme'])

  expect(await text(await screen?.invoke({ place: 'panel:changes' }))).toMatch(/panel:changes/)
  await screen?.invoke({ place: 'sheet:schedules' })
  await screen?.invoke({ place: 'view:files' })
  await screen?.invoke({ place: 'conversation' })
  await theme?.invoke({ theme: 'dark' })
  expect(sent).toEqual([
    { kind: 'panel', tab: 'changes' },
    { kind: 'sheet', sheet: 'schedules' },
    { kind: 'view', view: 'files' },
    { kind: 'conversation' },
    { kind: 'theme', theme: 'dark' },
  ])
  await expect(screen?.invoke({ place: 'panel:nowhere' })).rejects.toThrow(/unknown place/)
  await expect(theme?.invoke({ theme: 'pink' })).rejects.toThrow(/one of light, dark, system/)

  browsers = 0
  expect(await text(await theme?.invoke({ theme: 'light' }))).toMatch(/No browser is connected/)
  // Without a host (no workspace to reach), only progress is offered.
  expect(workspaceTools({}).map((tool) => tool.def.name)).toEqual(['progress'])
})

test('a progress card is named by its first call, and later calls update it by that id', async () => {
  const tool = progressTool()
  const steps = [
    { step: 'Build', state: 'done' },
    { step: 'Test', state: 'doing', note: 'unit tests' },
    { step: 'Release', state: 'todo' },
  ]
  expect(await tool.invoke({ task: 'Deploy', steps }, call)).toBe(
    'Progress card "Deploy" (id call_progress_1): 1 of 3 done. Pass id "call_progress_1" to update this card.',
  )
  expect(
    await tool.invoke(
      {
        id: 'call_progress_1',
        task: 'Deploy',
        steps: [...steps.slice(0, 2), { step: 'Release', state: 'failed' }],
      },
      { toolCallId: 'call_progress_2' },
    ),
  ).toBe('Progress card "Deploy" (id call_progress_1): 1 of 3 done, 1 failed.')
  await expect(tool.invoke({ task: 'Deploy', steps: [] }, call)).rejects.toThrow(/non-empty/)
  await expect(
    tool.invoke({ task: 'Deploy', steps: [{ step: 'Build', state: 'maybe' }] }, call),
  ).rejects.toThrow(/state is one of/)

  // On Telegram the card is one message: a title with how far it got, a line per step.
  expect(
    progressText({
      task: 'Deploy',
      steps: [
        { step: 'Build', state: 'done' },
        { step: 'Test', state: 'doing', note: 'unit tests' },
        { step: 'Release', state: 'todo' },
      ],
    }),
  ).toBe('📋 Deploy (1/3)\n✅ Build\n⏳ Test — unit tests\n▫️ Release')
})

test('a canvas is saved as an HTML page or an SVG drawing, never both', async () => {
  const saved: DeliveredFile[] = []
  const tool = canvasTool(async (file) => {
    saved.push(file)
    return { resultId: `r${saved.length}` }
  })
  const page = await tool.invoke({ name: 'Sales chart.html', html: '<h1>Sales</h1>' }, call)
  expect(page).toMatchObject({ details: { results: [{ resultId: 'r1' }] } })
  await tool.invoke({ name: 'logo', svg: '<svg viewBox="0 0 1 1"></svg>' }, call)
  expect(saved.map(({ name, mimeType }) => ({ name, mimeType }))).toEqual([
    { name: 'Sales chart.html', mimeType: 'text/html' },
    { name: 'logo.svg', mimeType: 'image/svg+xml' },
  ])
  expect(Buffer.from(saved[0]?.data ?? '', 'base64').toString()).toBe('<h1>Sales</h1>')
  await expect(tool.invoke({ name: 'x', html: '<p>', svg: '<svg/>' }, call)).rejects.toThrow(
    /exactly one/,
  )
  await expect(tool.invoke({ name: 'x', svg: '<p>not a drawing</p>' }, call)).rejects.toThrow(
    /<svg>/,
  )
})
