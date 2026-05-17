/**
 * Render `rows` as space-aligned columns. All rows must have the same column
 * count; empty cells are treated as `""` for width purposes. Column spacing is
 * two spaces — wider than a tab, tighter than tabular CSV tooling expects.
 *
 * Used by list commands so `status` / `kind` / `name` columns don't jump when
 * one row is `idle` (4) and another is `archived` (8). Does not truncate —
 * long cells win the column width. Callers that want a bounded width should
 * slice before passing.
 */
export function columnize(rows: string[][], gap = '  '): string[] {
  if (rows.length === 0) return []
  const colCount = rows[0]?.length ?? 0
  const widths: number[] = new Array<number>(colCount).fill(0)
  for (const row of rows) {
    for (let i = 0; i < colCount; i++) {
      const cell = row[i] ?? ''
      const prev = widths[i] ?? 0
      if (cell.length > prev) widths[i] = cell.length
    }
  }
  return rows.map((row) =>
    row
      .map((cell, i) => {
        // Don't pad the last column — trailing whitespace is pointless and
        // breaks `| wc`-style pipes.
        if (i === colCount - 1) return cell
        return (cell ?? '').padEnd(widths[i] ?? 0)
      })
      .join(gap),
  )
}
