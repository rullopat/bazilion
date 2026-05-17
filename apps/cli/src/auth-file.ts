import { existsSync, readFileSync } from 'node:fs'

export interface AuthFile {
  token: string
  remote?: { server: string; token: string } | null
}

export function readAuthFile(authFile: string): AuthFile {
  if (!existsSync(authFile)) {
    throw new Error(`${authFile} not found. Start the daemon with \`bazilion serve\` first.`)
  }
  const raw = readFileSync(authFile, 'utf8')
  const parsed = JSON.parse(raw) as Partial<AuthFile>
  if (typeof parsed.token !== 'string' || !parsed.token) {
    throw new Error(`${authFile} is missing the "token" field`)
  }
  return { token: parsed.token, remote: parsed.remote ?? null }
}
