// `apply_patch`: one patch that adds, changes, moves and deletes files, in the format
//
//   *** Begin Patch
//   *** Add File: notes/new.md
//   +a line of the new file
//   *** Update File: src/app.ts
//   *** Move to: src/main.ts            (optional)
//   @@ function start()                 (optional: a line the hunk comes after)
//    a line kept as it is
//   -a line removed
//   +a line added
//   *** End of File                     (optional: the hunk ends the file)
//   *** Delete File: old.txt
//   *** End Patch
//
// Every change is worked out before anything is written, so a patch with a hunk that does not fit
// changes no file.

export interface PatchFiles {
  /** The path a patch names, resolved for `access` (it throws when the path is not allowed). */
  resolve(path: string, access: 'read' | 'write'): string
  exists(path: string): boolean
  read(path: string): string
  /** Creates missing parent directories. */
  write(path: string, content: string): void
  remove(path: string): void
}

type Hunk = { anchor?: string; lines: string[]; endOfFile: boolean }
type Operation =
  | { kind: 'add'; path: string; lines: string[] }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; moveTo?: string; hunks: Hunk[] }

const BEGIN = '*** Begin Patch'
const END = '*** End Patch'
const ADD = '*** Add File: '
const DELETE = '*** Delete File: '
const UPDATE = '*** Update File: '
const MOVE = '*** Move to: '
const END_OF_FILE = '*** End of File'

export function parsePatch(input: string): Operation[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n')
  while (lines.length > 0 && lines[0]?.trim() === '') lines.shift()
  while (lines.length > 0 && lines.at(-1)?.trim() === '') lines.pop()
  if (lines[0]?.trim() !== BEGIN) throw new Error(`The patch must start with "${BEGIN}".`)
  if (lines.at(-1)?.trim() !== END) throw new Error(`The patch must end with "${END}".`)
  const body = lines.slice(1, -1)
  const operations: Operation[] = []
  let at = 0
  const fail = (message: string): never => {
    throw new Error(`Line ${at + 2} of the patch: ${message}`)
  }
  while (at < body.length) {
    const line = body[at] ?? ''
    if (line.startsWith(ADD)) {
      const path = line.slice(ADD.length).trim()
      const content: string[] = []
      at++
      while (at < body.length && !(body[at] ?? '').startsWith('*** ')) {
        const added = body[at] ?? ''
        if (!added.startsWith('+')) fail('every line of an added file starts with "+".')
        content.push(added.slice(1))
        at++
      }
      operations.push({ kind: 'add', path, lines: content })
    } else if (line.startsWith(DELETE)) {
      operations.push({ kind: 'delete', path: line.slice(DELETE.length).trim() })
      at++
    } else if (line.startsWith(UPDATE)) {
      const path = line.slice(UPDATE.length).trim()
      at++
      let moveTo: string | undefined
      if ((body[at] ?? '').startsWith(MOVE)) {
        moveTo = (body[at] ?? '').slice(MOVE.length).trim()
        at++
      }
      const hunks: Hunk[] = []
      let hunk: Hunk | undefined
      while (at < body.length) {
        const current = body[at] ?? ''
        if (current.startsWith('*** ') && current.trim() !== END_OF_FILE) break
        if (current.trim() === END_OF_FILE) {
          if (!hunk) fail(`"${END_OF_FILE}" must follow a hunk.`)
          else hunk.endOfFile = true
        } else if (current.startsWith('@@')) {
          const anchor = current.slice(2).trim()
          hunk = { ...(anchor ? { anchor } : {}), lines: [], endOfFile: false }
          hunks.push(hunk)
        } else {
          if (!hunk) {
            hunk = { lines: [], endOfFile: false }
            hunks.push(hunk)
          }
          // A blank line in a hunk is an unchanged blank line.
          const marked = current === '' ? ' ' : current
          if (!' -+'.includes(marked[0] ?? '')) {
            fail('a hunk line starts with " " (kept), "-" (removed) or "+" (added).')
          }
          hunk.lines.push(marked)
        }
        at++
      }
      if (hunks.length === 0 && !moveTo) fail(`"${UPDATE}${path}" has no change.`)
      operations.push({ kind: 'update', path, ...(moveTo ? { moveTo } : {}), hunks })
    } else {
      fail(`expected "${ADD}", "${UPDATE}" or "${DELETE}", found "${line}".`)
    }
  }
  if (operations.length === 0) throw new Error('The patch changes nothing.')
  for (const op of operations) {
    if (!op.path) throw new Error('A file operation in the patch has no path.')
  }
  return operations
}

/** Where `wanted` appears in `lines` from `from` on: exactly, then ignoring trailing, then all space. */
function findBlock(lines: string[], wanted: string[], from: number, endOfFile: boolean): number {
  const compare = [
    (a: string, b: string) => a === b,
    (a: string, b: string) => a.trimEnd() === b.trimEnd(),
    (a: string, b: string) => a.trim() === b.trim(),
  ]
  for (const same of compare) {
    const starts = endOfFile
      ? [lines.length - wanted.length]
      : range(from, lines.length - wanted.length)
    for (const start of starts) {
      if (start < from) continue
      if (wanted.every((line, i) => same(lines[start + i] ?? '', line))) return start
    }
  }
  return -1
}

function range(from: number, to: number): number[] {
  const out: number[] = []
  for (let i = from; i <= to; i++) out.push(i)
  return out
}

function applyHunks(path: string, content: string, hunks: Hunk[]): string {
  // A file that ends with a newline keeps it, one that does not stays without; an empty file gets one.
  const endsWithNewline = content === '' || content.endsWith('\n')
  const lines = content === '' ? [] : content.split('\n')
  if (content.endsWith('\n')) lines.pop()
  let position = 0
  hunks.forEach((hunk, index) => {
    if (hunk.anchor) {
      const anchor = hunk.anchor
      const found = lines.findIndex((line, i) => i >= position && line.trim() === anchor.trim())
      if (found < 0)
        throw new Error(
          `${path}: hunk ${index + 1} comes after "${anchor}", which is not in the file.`,
        )
      position = found + 1
    }
    const before = hunk.lines.filter((line) => line[0] !== '+').map((line) => line.slice(1))
    const start =
      before.length === 0
        ? hunk.endOfFile
          ? lines.length
          : position
        : findBlock(lines, before, position, hunk.endOfFile)
    if (start < 0) {
      const first = before.find((line) => line.trim() !== '') ?? before[0] ?? ''
      throw new Error(
        `${path}: hunk ${index + 1} does not match the file (looked for "${first.trim()}" and the lines after it). Read the file again and retry.`,
      )
    }
    // Lines the hunk keeps stay exactly as the file has them, whatever spacing the patch gave.
    const kept: string[] = []
    let old = start
    for (const line of hunk.lines) {
      if (line[0] === '+') kept.push(line.slice(1))
      else if (line[0] === ' ') kept.push(lines[old++] ?? line.slice(1))
      else old++
    }
    lines.splice(start, before.length, ...kept)
    position = start + kept.length
  })
  if (lines.length === 0) return ''
  return lines.join('\n') + (endsWithNewline ? '\n' : '')
}

/** Apply a patch through `files`; returns one line per changed file. */
export function applyPatch(input: string, files: PatchFiles): string {
  const operations = parsePatch(input)
  // Work out every file's new content first.
  const writes: Array<{ path: string; content: string }> = []
  const removals: string[] = []
  const summary: string[] = []
  const touched = new Map<string, string | null>()
  const current = (resolved: string, shown: string): string => {
    if (touched.has(resolved)) {
      const content = touched.get(resolved)
      if (content === null || content === undefined)
        throw new Error(`${shown} was deleted earlier in this patch.`)
      return content
    }
    if (!files.exists(resolved)) throw new Error(`${shown} does not exist.`)
    return files.read(resolved)
  }
  for (const op of operations) {
    const path = files.resolve(op.path, 'write')
    if (op.kind === 'add') {
      if ((touched.get(path) ?? null) !== null || (!touched.has(path) && files.exists(path))) {
        throw new Error(`${op.path} already exists: change it with "${UPDATE}${op.path}".`)
      }
      const content = op.lines.length > 0 ? `${op.lines.join('\n')}\n` : ''
      touched.set(path, content)
      summary.push(`A ${op.path}`)
    } else if (op.kind === 'delete') {
      current(path, op.path)
      touched.set(path, null)
      summary.push(`D ${op.path}`)
    } else {
      const content = applyHunks(op.path, current(path, op.path), op.hunks)
      if (op.moveTo) {
        const target = files.resolve(op.moveTo, 'write')
        if (
          target !== path &&
          ((touched.get(target) ?? null) !== null || (!touched.has(target) && files.exists(target)))
        ) {
          throw new Error(`${op.moveTo} already exists; the patch would replace it.`)
        }
        touched.set(path, null)
        touched.set(target, content)
        summary.push(`M ${op.path} → ${op.moveTo}`)
      } else {
        touched.set(path, content)
        summary.push(`M ${op.path}`)
      }
    }
  }
  for (const [path, content] of touched) {
    if (content === null) removals.push(path)
    else writes.push({ path, content })
  }
  for (const write of writes) files.write(write.path, write.content)
  for (const path of removals) if (files.exists(path)) files.remove(path)
  return `Applied the patch:\n${summary.join('\n')}`
}
