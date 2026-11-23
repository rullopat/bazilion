import type { TeamHost } from '../worker/ipc-protocol.ts'
import type { ToolHandler } from './types.ts'

/** `agent_create`: add a teammate to the Agent's own Team, when the operator asks for one. */
export function agentCreateTool(host: TeamHost): ToolHandler {
  return {
    def: {
      name: 'agent_create',
      description:
        'Add a new Agent to your Team, when the operator asks you to (to build a team, or to hand part of the work to a specialist). It joins your Team, shares its workspace and memory, and starts knowing its role and that you made it: give it a clear name and say what it is for. It uses your model and Agent template unless you name others. In a restricted Team it is connected with you both ways. Message it afterwards with send_message, by the id this returns. Do not create Agents the operator did not ask for, or several for one job.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Its name, unique in your Team, e.g. "Lead Researcher"',
          },
          role: {
            type: 'string',
            description:
              'What it is for and how it should work, in a few sentences: its job, what it delivers and to whom, and its limits',
          },
          template: {
            type: 'string',
            description: 'Optional: an Agent template id (default: your own)',
          },
          model: {
            type: 'string',
            description: 'Optional: a model as "provider:model" (default: your own model)',
          },
        },
        required: ['name', 'role'],
      },
    },
    async invoke(args) {
      const created = await host.createAgent({
        name: String(args.name ?? ''),
        role: String(args.role ?? ''),
        ...(typeof args.template === 'string' && args.template ? { template: args.template } : {}),
        ...(typeof args.model === 'string' && args.model ? { model: args.model } : {}),
      })
      return [
        `Created ${created.name} (id ${created.id}) in ${created.teamName}, from the template ${created.template}, on ${created.model}.`,
        created.connected ? 'It is connected with you both ways.' : '',
        'Brief it with send_message to that id.',
      ]
        .filter(Boolean)
        .join(' ')
    },
  }
}
