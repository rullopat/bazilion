// A note's title and preview read as words, without Markdown's marks.
import { expect, test } from 'vitest'
import { markdownPreview, markdownTitle } from '../src/lib/markdown-text.ts'

test('a note is named by its first heading and previewed by the words after it', () => {
  const voice =
    '# Voice\n\nShort sentences. Friendly, never cute. No exclamation marks in headlines.'
  expect(markdownTitle(voice)).toBe('Voice')
  expect(markdownPreview(voice)).toBe(
    'Short sentences. Friendly, never cute. No exclamation marks in headlines.',
  )
  const questions =
    '# Open questions\n\n- Is 2.0 free for 1.x licence holders?\n- Which **cover** goes on the `announcement`?'
  expect(markdownPreview(questions)).toBe(
    'Is 2.0 free for 1.x licence holders? Which cover goes on the announcement?',
  )
  expect(markdownTitle('Just text\n# Later')).toBeNull()
  expect(markdownPreview('Just text, [a link](https://x.test) and _stress_.')).toBe(
    'Just text, a link and stress.',
  )
})

test('code and rules are left out, and a long preview stops on a word', () => {
  expect(markdownPreview('# T\n\n```sh\nrm -rf /\n```\n---\nAfter the code.')).toBe(
    'After the code.',
  )
  const long = `# T\n\n${'word '.repeat(60)}`
  const preview = markdownPreview(long, 40)
  expect(preview.endsWith('word…')).toBe(true)
  expect(preview.length).toBeLessThanOrEqual(41)
  expect(markdownPreview('')).toBe('')
})

test('every heading is left out of a preview, so sections do not run into sentences', () => {
  const userMd =
    '# About me\n\nI run Paperboat. I like short answers.\n\n# This Team\n\nWe ship 2.0 on Friday.'
  expect(markdownPreview(userMd)).toBe(
    'I run Paperboat. I like short answers. We ship 2.0 on Friday.',
  )
})

test('emphasis that runs over two lines leaves no marks behind', () => {
  expect(markdownPreview('_Learn about the person\nyou are helping._')).toBe(
    'Learn about the person you are helping.',
  )
  expect(markdownPreview('snake_case_name stays')).toBe('snake_case_name stays')
})

test('only real emphasis loses its marks, and a fence closes on its own kind', () => {
  expect(markdownPreview('Edit __init__.py and compute 2 * 3 * 4.')).toBe(
    'Edit __init__.py and compute 2 * 3 * 4.',
  )
  expect(markdownPreview('```\ncode\n~~~\nmore\n```\nafter')).toBe('after')
  // A memory search hit starts with where it was found.
  expect(markdownPreview('@@ -4,4 @@ # Voice\nShort sentences.')).toBe('Short sentences.')
  expect(markdownTitle('@@ -1,2 @@\n# Voice\nShort.')).toBe('Voice')
})
