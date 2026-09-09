import type { TeamCodingEnvironment } from '@bazilion/api-types'
import { validateCodingEnvironmentConfig } from '../coding-environment/config.ts'
import { type BazilionDb, inTx } from '../db/client.ts'

interface Row {
  team_id: string
  revision: number
  config_json: string
  updated_at: number
}

export class CodingEnvironmentRevisionError extends Error {
  readonly status = 409
  constructor() {
    super('Coding environment changed. Reload the configuration before saving.')
  }
}

export function getCodingEnvironment(db: BazilionDb, teamId: string): TeamCodingEnvironment | null {
  const row = db.raw
    .query<Row, [string]>('SELECT * FROM team_coding_environments WHERE team_id = ?')
    .get(teamId)
  if (!row) return null
  return {
    teamId: row.team_id,
    revision: row.revision,
    config: validateCodingEnvironmentConfig(JSON.parse(row.config_json)),
    updatedAt: row.updated_at,
  }
}

/** Caller must hold canonical workspace mutation ownership before invoking this synchronous write. */
export function putCodingEnvironment(
  db: BazilionDb,
  teamId: string,
  expectedRevision: number,
  input: unknown,
): TeamCodingEnvironment {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new CodingEnvironmentRevisionError()
  const config = validateCodingEnvironmentConfig(input)
  return inTx(db, () => {
    const current = getCodingEnvironment(db, teamId)
    if ((current?.revision ?? 0) !== expectedRevision) throw new CodingEnvironmentRevisionError()
    const revision = expectedRevision + 1
    const updatedAt = Date.now()
    db.raw.run(
      `INSERT INTO team_coding_environments (team_id, revision, config_json, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(team_id) DO UPDATE SET
      revision = excluded.revision, config_json = excluded.config_json, updated_at = excluded.updated_at`,
      [teamId, revision, JSON.stringify(config), updatedAt],
    )
    return { teamId, revision, config, updatedAt }
  })
}
