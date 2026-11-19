// A unified patch as lines a person can read: numbered, typed, and paired for a side-by-side
// view. Pure functions; the Changes views render what they return.

export type DiffLine =
  | { kind: 'hunk'; text: string }
  | { kind: 'context'; text: string; oldLine: number; newLine: number }
  | { kind: 'add'; text: string; newLine: number }
  | { kind: 'remove'; text: string; oldLine: number }
  /** A line of the patch that is about the file, not in it ("\ No newline at end of file"). */
  | { kind: 'note'; text: string }

export interface ParsedPatch {
  /** Everything before the first hunk: `diff --git`, modes, the two file names. */
  header: string[]
  lines: DiffLine[]
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parsePatch(patch: string): ParsedPatch {
  const header: string[] = []
  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  const rows = patch.replace(/\n$/, '').split('\n')
  for (const row of rows) {
    const hunk = HUNK.exec(row)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      inHunk = true
      lines.push({ kind: 'hunk', text: row })
    } else if (!inHunk) {
      header.push(row)
    } else if (row.startsWith('+')) {
      lines.push({ kind: 'add', text: row.slice(1), newLine: newLine++ })
    } else if (row.startsWith('-')) {
      lines.push({ kind: 'remove', text: row.slice(1), oldLine: oldLine++ })
    } else if (row.startsWith('\\')) {
      lines.push({ kind: 'note', text: row.slice(1).trim() })
    } else {
      // A context line; an empty row is an empty context line whose leading space was trimmed.
      lines.push({ kind: 'context', text: row.slice(1), oldLine: oldLine++, newLine: newLine++ })
    }
  }
  return { header, lines }
}

export interface SideCell {
  line: number
  text: string
  changed: boolean
}

export type SideRow =
  | { kind: 'hunk'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'pair'; left: SideCell | null; right: SideCell | null }

/** Pair removed lines with the added lines that replace them; the longer run keeps blanks beside it. */
export function sideBySide(lines: readonly DiffLine[]): SideRow[] {
  const rows: SideRow[] = []
  let removed: SideCell[] = []
  let added: SideCell[] = []
  const flush = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
      rows.push({ kind: 'pair', left: removed[index] ?? null, right: added[index] ?? null })
    }
    removed = []
    added = []
  }
  for (const line of lines) {
    if (line.kind === 'remove') {
      // A removal after additions starts a new change.
      if (added.length > 0) flush()
      removed.push({ line: line.oldLine, text: line.text, changed: true })
    } else if (line.kind === 'add') {
      added.push({ line: line.newLine, text: line.text, changed: true })
    } else {
      flush()
      if (line.kind === 'context') {
        rows.push({
          kind: 'pair',
          left: { line: line.oldLine, text: line.text, changed: false },
          right: { line: line.newLine, text: line.text, changed: false },
        })
      } else {
        rows.push(line)
      }
    }
  }
  flush()
  return rows
}
