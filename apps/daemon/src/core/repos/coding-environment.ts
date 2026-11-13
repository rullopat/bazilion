import type { TeamCodingEnvironment } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

/** A Team's Docker defaults; a Team without saved defaults uses the installation image and '.'. */
export function getCodingEnvironment(db: BazilionDb, teamId: string): TeamCodingEnvironment {
  const row = db.raw
    .query<TeamCodingEnvironment, [string]>(
      'SELECT image, cwd FROM team_coding_environments WHERE team_id = ?',
    )
    .get(teamId)
  return row ? { image: row.image, cwd: row.cwd } : { image: null, cwd: '.' }
}

/** Save already-validated defaults. */
export function putCodingEnvironment(
  db: BazilionDb,
  teamId: string,
  environment: TeamCodingEnvironment,
): void {
  db.raw.run(
    `INSERT INTO team_coding_environments (team_id, image, cwd) VALUES (?, ?, ?)
     ON CONFLICT(team_id) DO UPDATE SET image = excluded.image, cwd = excluded.cwd`,
    [teamId, environment.image, environment.cwd],
  )
}
