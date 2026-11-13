import type { AttachSkillRequest } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { agentArg, apiPath, positional } from '../command-helpers.ts'
import { explainScanBlock } from '../errors.ts'

const skillArg = positional('Skill name')

const addCmd = defineCommand({
  meta: { name: 'add', description: 'Attach a skill to an agent' },
  args: {
    agent: agentArg,
    skill: skillArg,
    'allow-warnings': {
      type: 'boolean',
      description: 'Attach even when the static skill scan reports findings',
    },
  },
  async run({ args }) {
    const body: AttachSkillRequest = { skill: args.skill, allowFindings: args['allow-warnings'] }
    await createClient()
      .post(apiPath('agents', args.agent, 'skills'), body)
      .catch(explainScanBlock('--allow-warnings'))
    console.log(`attached skill ${args.skill} to ${args.agent}`)
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: 'Detach a skill from an agent' },
  args: { agent: agentArg, skill: skillArg },
  async run({ args }) {
    await createClient().del(apiPath('agents', args.agent, 'skills', args.skill))
    console.log(`detached skill ${args.skill} from ${args.agent}`)
  },
})

export const agentSkillCommand = defineCommand({
  meta: { name: 'skill', description: 'Attach/detach skills on an agent' },
  subCommands: { add: addCmd, rm: rmCmd },
})
