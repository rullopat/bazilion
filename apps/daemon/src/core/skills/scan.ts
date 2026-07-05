import type { SkillScanFinding } from '@bazilion/api-types'

interface Rule {
  code: string
  severity: SkillScanFinding['severity']
  message: string
  test: (line: string) => boolean
}

const SECRET_ENV_RE =
  /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_CODEX_OAUTH|GEMINI_API_KEY|GOOGLE_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AZURE_OPENAI_API_KEY|MISTRAL_API_KEY|GROQ_API_KEY|BRAVE_API_KEY|SEARXNG_URL)\b/i

const SENSITIVE_PATH_RE = /(~\/\.(ssh|aws|gnupg|config)|\b(auth\.json|bazilion\.db)\b)/i

const SECRET_TARGET_RE =
  /(secret|credential|token|api[-_\s]?key|env(?:ironment)?(?: variable)?|private key|ssh key|auth\.json|bazilion\.db|~\/\.(ssh|aws|gnupg))/i

const EXFIL_VERB_RE =
  /(exfiltrat|send|upload|post|curl|webhook|pastebin|remote server|external server|http endpoint)/i

const UNICODE_STEALTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/

const RULES: Rule[] = [
  {
    code: 'sensitive-reference',
    severity: 'danger',
    message: 'Mentions a sensitive path, database, auth file, or credential environment variable.',
    test: (line) => SENSITIVE_PATH_RE.test(line) || SECRET_ENV_RE.test(line),
  },
  {
    code: 'secret-exfiltration',
    severity: 'danger',
    message: 'Combines secret/env/file access with exfiltration-style language.',
    test: (line) => SECRET_TARGET_RE.test(line) && EXFIL_VERB_RE.test(line),
  },
  {
    code: 'instruction-hijack',
    severity: 'danger',
    message: 'Contains instruction-hijacking language such as ignoring prior instructions.',
    test: (line) =>
      /ignore (all )?(previous|prior|system|developer|user) instructions/i.test(line) ||
      /override (the )?(system|developer) (prompt|instructions)/i.test(line) ||
      /bypass (safety|security|policy|guardrails)/i.test(line) ||
      /you are now (root|unrestricted|in developer mode)/i.test(line),
  },
  {
    code: 'unicode-stealth',
    severity: 'warning',
    message: 'Contains zero-width, bidi, or byte-order characters that can hide prompt text.',
    test: (line) => UNICODE_STEALTH_RE.test(line),
  },
]

function addFinding(
  findings: SkillScanFinding[],
  seen: Set<string>,
  finding: SkillScanFinding,
): void {
  const key = `${finding.code}:${finding.line ?? 0}`
  if (seen.has(key)) return
  seen.add(key)
  findings.push(finding)
}

export function scanSkillContent(raw: string): SkillScanFinding[] {
  const findings: SkillScanFinding[] = []
  const seen = new Set<string>()
  const lines = raw.split(/\r?\n/)

  lines.forEach((line, index) => {
    for (const rule of RULES) {
      if (!rule.test(line)) continue
      addFinding(findings, seen, {
        code: rule.code,
        severity: rule.severity,
        message: rule.message,
        line: index + 1,
      })
    }
  })

  return findings
}

export function formatSkillScanFindings(findings: SkillScanFinding[]): string {
  return findings
    .map((f) => `${f.severity}: ${f.code}${f.line ? ` line ${f.line}` : ''} - ${f.message}`)
    .join('\n')
}
