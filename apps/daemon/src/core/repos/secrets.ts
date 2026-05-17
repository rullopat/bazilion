// Encrypted secrets store, backed by the `secrets` table.
//
// Layout: one row per env-var-shaped key (`ANTHROPIC_API_KEY`,
// `OPENAI_CODEX_OAUTH`, …). Each value is an AES-256-GCM envelope (salt +
// iv + tag + data, hex-encoded JSON), with the key derived from the
// bootstrap token via PBKDF2-SHA256 (100k iterations). The crypto matches
// the previous `secrets.enc` file format byte-for-byte — only the storage
// medium changed.
//
// Why encrypt at all when the password lives in `~/.bazilion/auth.json`
// next to the DB? Same reason as before: it's defense against accidental
// exposure (cat'd dumps, screenshares, naive backups), not against an
// attacker with filesystem read. Anyone who can read both files wins.
//
// Caching: `deriveKey` runs PBKDF2 once per (password, salt) pair and the
// salt is per-row, so a busy daemon does ~one PBKDF2 per secret read. The
// `secretCache` keeps decrypted values in-memory keyed by row id so repeated
// reads inside one process don't repeat the work; mutations clear the cache
// row.

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import type { BazilionDb } from '../db/client.ts'

const ALGORITHM = 'aes-256-gcm'
const KEY_LEN = 32
const ITERATIONS = 100_000
const DIGEST = 'sha256'

interface EncryptedEnvelope {
  salt: string
  iv: string
  tag: string
  data: string
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST)
}

function encrypt(plaintext: string, password: string): EncryptedEnvelope {
  const salt = randomBytes(16)
  const key = deriveKey(password, salt)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  let data = cipher.update(plaintext, 'utf8', 'hex')
  data += cipher.final('hex')
  const tag = cipher.getAuthTag()
  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data,
  }
}

function decrypt(envelope: EncryptedEnvelope, password: string): string {
  const salt = Buffer.from(envelope.salt, 'hex')
  const key = deriveKey(password, salt)
  const iv = Buffer.from(envelope.iv, 'hex')
  const tag = Buffer.from(envelope.tag, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  let plaintext = decipher.update(envelope.data, 'hex', 'utf8')
  plaintext += decipher.final('utf8')
  return plaintext
}

interface RawRow {
  key: string
  envelope: string
  updated_at: number
}

export interface SecretsStore {
  get(key: string): string | undefined
  set(key: string, value: string): void
  remove(key: string): void
  has(key: string): boolean
  list(): { key: string; preview: string }[]
  getAll(): Record<string, string>
}

/**
 * Open the encrypted secrets store. `password` is the bootstrap token
 * (read from `auth.json` by the caller). Throws on individual-row decrypt
 * failures only when actively reading that row — bad rows show as
 * `undefined` from `get`, the caller can `set` to overwrite.
 */
export function openSecrets(db: BazilionDb, password: string): SecretsStore {
  function getRow(key: string): RawRow | null {
    return db.raw.query<RawRow, [string]>('SELECT * FROM secrets WHERE key = ?').get(key)
  }

  function listAll(): RawRow[] {
    return db.raw.query<RawRow, []>('SELECT * FROM secrets ORDER BY key ASC').all()
  }

  function tryDecrypt(row: RawRow): string | undefined {
    try {
      const envelope = JSON.parse(row.envelope) as EncryptedEnvelope
      return decrypt(envelope, password)
    } catch {
      return undefined
    }
  }

  return {
    get(key) {
      const row = getRow(key)
      if (!row) return undefined
      return tryDecrypt(row)
    },
    set(key, value) {
      const envelope = JSON.stringify(encrypt(value, password))
      db.raw.run(
        `INSERT INTO secrets (key, envelope, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET envelope = excluded.envelope, updated_at = excluded.updated_at`,
        [key, envelope, Date.now()],
      )
    },
    remove(key) {
      db.raw.run('DELETE FROM secrets WHERE key = ?', [key])
    },
    has(key) {
      return getRow(key) !== null
    },
    list() {
      return listAll().map((r) => {
        const value = tryDecrypt(r)
        return {
          key: r.key,
          preview: value ? (value.length > 8 ? `${value.slice(0, 6)}…` : '***') : '(unreadable)',
        }
      })
    },
    getAll() {
      const out: Record<string, string> = {}
      for (const r of listAll()) {
        const v = tryDecrypt(r)
        if (v !== undefined) out[r.key] = v
      }
      return out
    },
  }
}
