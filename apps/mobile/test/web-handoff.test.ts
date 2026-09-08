import { expect, test } from 'vitest'
import { questionWebHandoff } from '../src/web-handoff.ts'
const agent = '00000000-0000-4000-8000-000000000001'
test('question handoff uses only the paired origin and never carries credentials', () => {
  expect(questionWebHandoff('https://bazilion.example/', agent)).toBe(`https://bazilion.example/agents/${agent}`)
  expect(questionWebHandoff('http://127.0.0.1:4322', agent)).toBe(`http://127.0.0.1:4322/agents/${agent}`)
  for (const origin of ['https://token@example.com', 'https://example.com/?token=secret', 'https://example.com/path', 'https://example.com/#secret', 'http://example.com', 'javascript:alert(1)'])
    expect(questionWebHandoff(origin, agent)).toBeNull()
  expect(questionWebHandoff('https://example.com', '../config')).toBeNull()
})
