import { expect, test } from 'vitest'
import { parsePatch, sideBySide } from '../src/lib/diff.ts'

const PATCH = `diff --git a/site/styles.css b/site/styles.css
index cdad464..4bbbb31 100644
--- a/site/styles.css
+++ b/site/styles.css
@@ -1,5 +1,6 @@
 body {
   margin: 0;
-  background: #fbf8f1;
-  color: #2b2118;
+  background: var(--paper);
+  color: var(--ink);
+  line-height: 1.5;
 }
@@ -18,3 +19,3 @@ main {
   padding: 0.7rem;
-  color: red;
+  color: blue;
 }
\\ No newline at end of file
`

test('a patch becomes numbered lines, with what precedes the first hunk kept apart', () => {
  const { header, lines } = parsePatch(PATCH)
  expect(header).toHaveLength(4)
  expect(lines[0]).toEqual({ kind: 'hunk', text: '@@ -1,5 +1,6 @@' })
  expect(lines[1]).toEqual({ kind: 'context', text: 'body {', oldLine: 1, newLine: 1 })
  expect(lines[3]).toEqual({ kind: 'remove', text: '  background: #fbf8f1;', oldLine: 3 })
  expect(lines[5]).toEqual({ kind: 'add', text: '  background: var(--paper);', newLine: 3 })
  expect(lines[7]).toEqual({ kind: 'add', text: '  line-height: 1.5;', newLine: 5 })
  expect(lines[8]).toEqual({ kind: 'context', text: '}', oldLine: 5, newLine: 6 })
  // The second hunk starts its own numbering.
  expect(lines[10]).toEqual({
    kind: 'context',
    text: '  padding: 0.7rem;',
    oldLine: 18,
    newLine: 19,
  })
  expect(lines.at(-1)).toEqual({ kind: 'note', text: 'No newline at end of file' })
})

test('side by side, a removed line sits beside the line that replaced it', () => {
  const rows = sideBySide(parsePatch(PATCH).lines)
  expect(rows[1]).toEqual({
    kind: 'pair',
    left: { line: 1, text: 'body {', changed: false },
    right: { line: 1, text: 'body {', changed: false },
  })
  expect(rows[3]).toEqual({
    kind: 'pair',
    left: { line: 3, text: '  background: #fbf8f1;', changed: true },
    right: { line: 3, text: '  background: var(--paper);', changed: true },
  })
  // Three lines replaced two: the third has nothing on its left.
  expect(rows[5]).toEqual({
    kind: 'pair',
    left: null,
    right: { line: 5, text: '  line-height: 1.5;', changed: true },
  })
  expect(rows.filter((row) => row.kind === 'hunk')).toHaveLength(2)
})

test('a new file has only a right side', () => {
  const rows = sideBySide(parsePatch('@@ -0,0 +1,2 @@\n+one\n+two\n').lines)
  expect(rows.slice(1)).toEqual([
    { kind: 'pair', left: null, right: { line: 1, text: 'one', changed: true } },
    { kind: 'pair', left: null, right: { line: 2, text: 'two', changed: true } },
  ])
})
