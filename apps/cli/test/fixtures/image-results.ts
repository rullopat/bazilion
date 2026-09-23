import { join } from 'node:path'
import { openDb } from '../../../daemon/src/core/db/client.ts'
import * as results from '../../../daemon/src/core/repos/results.ts'

/** Browser projection fixture only; never used by the product or advertised as live generation. */
export function seedImageResultsForUi(home: string): { png: Buffer; privateResultId: string } {
  const db = openDb(join(home, 'bazilion.db'))
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhK0AAAAASUVORK5CYII=',
    'base64',
  )
  let privateResultId = ''
  try {
    const agent = db.raw
      .query<{ id: string; team_id: string }, [string]>(
        'SELECT id, team_id FROM agents WHERE name = ?',
      )
      .get('image-demo')
    if (!agent) throw new Error('Missing browser fixture Agent')
    for (let index = 0; index < 3; index++) {
      const result = results.publish(db, {
        teamId: agent.team_id,
        agentId: agent.id,
        sessionId: 'fixture-session',
        toolCallId: `fixture-call-${index}`,
        name: `image-version-${index + 1}.png`,
        mimeType: 'image/png',
        bytes: png,
        imageModel: [
          'openai:gpt-image-2',
          'openai-codex:gpt-image-2',
          'google/gemini-3.1-flash-image',
        ][index],
      })
      if (index < 2) results.release(db, result.id, agent.id)
      else privateResultId = result.id
    }
    return { png, privateResultId }
  } finally {
    db.close()
  }
}
