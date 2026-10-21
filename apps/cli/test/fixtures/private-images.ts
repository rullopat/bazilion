import { spawnAgent } from '../../../daemon/src/core/agent/spawn.ts'
import { openDb } from '../../../daemon/src/core/db/client.ts'
import { resolvePaths } from '../../../daemon/src/core/paths.ts'
import { createProfile } from '../../../daemon/src/core/profile/create.ts'
import * as operations from '../../../daemon/src/core/repos/image-generations.ts'
import * as providerModels from '../../../daemon/src/core/repos/providerModels.ts'
import * as providerState from '../../../daemon/src/core/repos/providerState.ts'
import * as results from '../../../daemon/src/core/repos/results.ts'
import * as webTokens from '../../../daemon/src/core/repos/webTokens.ts'
import { registerTeam } from '../../../daemon/src/core/team/register.ts'

/** Projection fixture only: committed synthetic captures, never a provider request. */
export function seedPrivateImagesForUi(home: string) {
  const paths = resolvePaths(home)
  const db = openDb(paths.db)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhK0AAAAASUVORK5CYII=',
    'base64',
  )
  try {
    providerState.setEnabled(db, 'lmstudio', true)
    providerModels.replace(db, 'lmstudio', ['test-model'])
    if (!db.raw.query<{ id: string }, []>("SELECT id FROM teams WHERE id = 'default'").get())
      registerTeam(db, { id: 'default' }, paths)
    createProfile(db, paths, {
      id: 'private-image-ui',
      defaultModel: 'lmstudio:test-model',
      communicationDefaults: {
        userInput: true,
        userOutput: true,
        outsideTeamInput: false,
        outsideTeamOutput: false,
        peerDefault: 'allow_all',
      },
    })
    const agent = spawnAgent(db, paths, { profileId: 'private-image-ui' })
    const ids = ['recover', 'discard'].map((call) =>
      db.raw.transaction(() => {
        const op: operations.ImageOperation = {
          agentId: agent.id,
          teamId: agent.teamId,
          sessionId: 'private-ui-session',
          toolCallId: call,
          turnId: 'private-ui-turn',
          requestSha256: 'c'.repeat(64),
          model: 'openai:gpt-image-2',
        }
        operations.admit(db, op)
        const result = results.publish(db, {
          ...op,
          name: `${call}-private-image.png`,
          mimeType: 'image/png',
          imageModel: op.model,
          bytes: png,
        })
        operations.settle(db, op, 'completed')
        return result.id
      })(),
    )
    const [recoverId, discardId] = ids
    if (!recoverId || !discardId) throw new Error('Missing private image projection fixture')
    return {
      recoverId,
      discardId,
      credential: webTokens.create(db, 'private-ui').token,
      png,
    }
  } finally {
    db.close()
  }
}
