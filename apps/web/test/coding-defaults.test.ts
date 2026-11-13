import { expect, test } from 'vitest'
import { codingDefaultsBody } from '../src/components/CodingDefaultsCard.tsx'

test('the web form saves the same image and cwd fields as the CLI', () => {
  expect(codingDefaultsBody(' local/toolchain:one ', 'app')).toEqual({
    image: 'local/toolchain:one',
    cwd: 'app',
  })
  expect(codingDefaultsBody('', '')).toEqual({ image: null, cwd: '.' })
})
