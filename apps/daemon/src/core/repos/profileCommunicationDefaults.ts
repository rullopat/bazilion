import type { ProfileCommunicationDefaults } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawDefaults {
  user_input: number
  user_output: number
  outside_group_input: number
  outside_group_output: number
  peer_default: ProfileCommunicationDefaults['peerDefault']
}

export function get(db: BazilionDb, profileId: string): ProfileCommunicationDefaults | null {
  const row = db.raw
    .query<RawDefaults, [string]>(
      `SELECT user_input, user_output, outside_group_input, outside_group_output, peer_default
       FROM profile_communication_defaults WHERE profile_id = ?`,
    )
    .get(profileId)
  return row
    ? {
        userInput: row.user_input === 1,
        userOutput: row.user_output === 1,
        outsideGroupInput: row.outside_group_input === 1,
        outsideGroupOutput: row.outside_group_output === 1,
        peerDefault: row.peer_default,
      }
    : null
}

export function set(
  db: BazilionDb,
  profileId: string,
  value: ProfileCommunicationDefaults | null,
): void {
  if (value === null) {
    db.raw.run('DELETE FROM profile_communication_defaults WHERE profile_id = ?', [profileId])
    return
  }
  db.raw.run(
    `INSERT INTO profile_communication_defaults
       (profile_id, user_input, user_output, outside_group_input, outside_group_output, peer_default, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
       user_input = excluded.user_input,
       user_output = excluded.user_output,
       outside_group_input = excluded.outside_group_input,
       outside_group_output = excluded.outside_group_output,
       peer_default = excluded.peer_default,
       updated_at = excluded.updated_at`,
    [
      profileId,
      Number(value.userInput),
      Number(value.userOutput),
      Number(value.outsideGroupInput),
      Number(value.outsideGroupOutput),
      value.peerDefault,
      Date.now(),
    ],
  )
}
