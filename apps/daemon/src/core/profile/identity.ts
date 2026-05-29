import { readFileSync } from 'node:fs'
import type { AgentIdentityFile } from '@bazilion/api-types'

const IDENTITY_PLACEHOLDER_VALUES = new Set([
  'pick something you like',
  'ai? robot? familiar? ghost in the machine? something weirder?',
  'how do you come across? sharp? warm? chaotic? calm?',
  'your signature - pick one that feels right',
  'workspace-relative path, http(s) url, or data uri',
  'an http(s) url or data uri - optional',
])

function normalizeIdentityValue(value: string): string {
  let normalized = value.trim()
  normalized = normalized.replace(/^[*_]+|[*_]+$/g, '').trim()
  if (normalized.startsWith('(') && normalized.endsWith(')')) {
    normalized = normalized.slice(1, -1).trim()
  }
  normalized = normalized.replace(/[\u2013\u2014]/g, '-')
  normalized = normalized.replace(/\s+/g, ' ').toLowerCase()
  return normalized
}

function isIdentityPlaceholder(value: string): boolean {
  return IDENTITY_PLACEHOLDER_VALUES.has(normalizeIdentityValue(value))
}

export function parseIdentityMarkdown(content: string): AgentIdentityFile {
  const identity: AgentIdentityFile = {}
  for (const line of content.split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^\s*-\s*/, '')
    const colonIndex = cleaned.indexOf(':')
    if (colonIndex === -1) continue
    const label = cleaned.slice(0, colonIndex).replace(/[*_]/g, '').trim().toLowerCase()
    const value = cleaned
      .slice(colonIndex + 1)
      .replace(/^[*_]+|[*_]+$/g, '')
      .trim()
    if (!value) continue
    if (isIdentityPlaceholder(value)) continue
    if (label === 'name') identity.name = value
    else if (label === 'emoji') identity.emoji = value
    else if (label === 'creature') identity.creature = value
    else if (label === 'vibe') identity.vibe = value
    else if (label === 'theme') identity.theme = value
    else if (label === 'avatar') identity.avatar = value
  }
  return identity
}

export function identityHasValues(identity: AgentIdentityFile): boolean {
  return Boolean(
    identity.name ||
      identity.emoji ||
      identity.theme ||
      identity.creature ||
      identity.vibe ||
      identity.avatar,
  )
}

export function loadIdentityFromFile(path: string): AgentIdentityFile | null {
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const parsed = parseIdentityMarkdown(content)
  return identityHasValues(parsed) ? parsed : null
}
