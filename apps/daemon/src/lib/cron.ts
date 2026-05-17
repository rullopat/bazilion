// Minimal 5-field cron matcher: "minute hour day-of-month month day-of-week".
// Supports *, */N, N, N-M, and comma-separated lists thereof per field.
// Day-of-week: 0 or 7 = Sunday, 1 = Monday ... 6 = Saturday.
//
// Matching semantics match the "standard" cron (non-Vixie) rule: if BOTH
// day-of-month and day-of-week are restricted (i.e. not `*`), the match is an
// OR — the trigger fires when either matches. Most common expressions are
// `*/5 * * * *` or `0 9 * * *` where only one of the two is restricted, so
// the subtlety rarely matters.

function parseField(raw: string, min: number, max: number): Set<number> {
  const values = new Set<number>()
  for (const part of raw.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`invalid step "${stepPart}"`)
    }
    let lo: number
    let hi: number
    if (rangePart === '*' || rangePart === undefined) {
      lo = min
      hi = max
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-').map((n) => Number(n))
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        throw new Error(`invalid range "${rangePart}"`)
      }
      lo = a as number
      hi = b as number
    } else {
      const n = Number(rangePart)
      if (!Number.isInteger(n)) {
        throw new Error(`invalid value "${rangePart}"`)
      }
      lo = n
      hi = n
    }
    if (lo < min || hi > max || lo > hi) {
      throw new Error(`value out of range ${min}-${max}: "${part}"`)
    }
    for (let v = lo; v <= hi; v += step) values.add(v)
  }
  return values
}

export interface ParsedCron {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  domRestricted: boolean
  dowRestricted: boolean
}

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`expected 5 fields, got ${parts.length}: "${expr}"`)
  }
  const [m, h, dom, mon, dow] = parts as [string, string, string, string, string]
  const parsed: ParsedCron = {
    minute: parseField(m, 0, 59),
    hour: parseField(h, 0, 23),
    dom: parseField(dom, 1, 31),
    month: parseField(mon, 1, 12),
    // accept 7 as Sunday alias → normalise to 0
    dow: new Set([...parseField(dow.replace(/7/g, '0'), 0, 6)]),
    domRestricted: dom !== '*',
    dowRestricted: dow !== '*',
  }
  return parsed
}

export function matchesCron(parsed: ParsedCron, date: Date): boolean {
  if (!parsed.minute.has(date.getMinutes())) return false
  if (!parsed.hour.has(date.getHours())) return false
  if (!parsed.month.has(date.getMonth() + 1)) return false
  const domMatch = parsed.dom.has(date.getDate())
  const dowMatch = parsed.dow.has(date.getDay())
  if (parsed.domRestricted && parsed.dowRestricted) {
    return domMatch || dowMatch
  }
  if (parsed.domRestricted) return domMatch
  if (parsed.dowRestricted) return dowMatch
  return true
}

/** Validates an expression — throws on syntax errors. Used by API write paths. */
export function validateCron(expr: string): void {
  parseCron(expr)
}
