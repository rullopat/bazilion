// Secrets an Agent asks for (BAZ-090): the user types the value into a masked field, the daemon
// keeps it encrypted, and the Agent only ever learns its name. Its commands get it as an
// environment variable; web_fetch puts it in headers written {{secret:NAME}}, for its hosts only.

import type { AgentSecret } from '@bazilion/api-types'
import type { SecretHost } from '../worker/ipc-protocol.ts'
import type { ToolHandler } from './types.ts'

function stored(at: number): string {
  return new Date(at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function uses(secret: Pick<AgentSecret, 'name' | 'hosts'>): string {
  const env = `your commands have it as $${secret.name}`
  return secret.hosts.length > 0
    ? `${env}, and web_fetch sends {{secret:${secret.name}}} in headers to ${secret.hosts.join(', ')}`
    : `${env} (no host may get it from web_fetch)`
}

function describe(secret: AgentSecret): string {
  return [
    `${secret.name}: ${uses(secret)}. Stored ${stored(secret.storedAt)}.`,
    secret.reason ? `  Asked for: ${secret.reason}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function secretTools(host: SecretHost): ToolHandler[] {
  const tools: ToolHandler[] = [
    {
      def: {
        name: 'secret_list',
        description:
          'List your secrets: their names, where you can use them and why they were asked for. Values are never shown.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
      async invoke() {
        const secrets = await host.list()
        return secrets.length > 0
          ? secrets.map(describe).join('\n')
          : 'You have no secrets. Ask for one with secret_request.'
      },
    },
  ]
  const request = host.request
  if (!request) return tools
  tools.push({
    // Asking the operator is the model's to do, never a script's (BAZ-100).
    reach: 'model-only',
    def: {
      name: 'secret_request',
      description: [
        'Ask the user for a secret you need (an API token, a password, a key file), by name. They type it into a masked field; you never see the value and it never enters this conversation.',
        'Once stored, your commands have it as an environment variable of that name, and web_fetch puts it in a header you write as {{secret:NAME}}, only for the hosts you list here.',
        'It does not wait: end your turn after asking, saying what you need it for. Their answer, stored or declined, starts your next turn.',
        'Never ask for a secret in a message or with ask_user, and never print one.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'An environment variable name in capitals, such as GITHUB_TOKEN or STRIPE_API_KEY.',
          },
          reason: {
            type: 'string',
            description: 'Why you need it, in a line the user reads next to the field.',
          },
          hosts: {
            type: 'array',
            items: { type: 'string' },
            description:
              'The hosts web_fetch may send it to, such as ["api.github.com"]. Leave out for commands only.',
          },
          replace: {
            type: 'boolean',
            description:
              'Ask again for a secret you already have (it stopped working, or the user wants to change it).',
          },
        },
        required: ['name', 'reason'],
        additionalProperties: false,
      },
    },
    async invoke(args) {
      const result = await request(
        {
          name: args.name,
          reason: args.reason,
          ...(args.hosts !== undefined ? { hosts: args.hosts } : {}),
        },
        args.replace === true,
      )
      if (result.kind === 'stored') {
        return `You already have ${result.secret.name}, stored ${stored(result.secret.storedAt)}: ${uses(result.secret)}. Pass replace: true only if it no longer works.`
      }
      const secret = result.question.question.secret
      const name = secret?.name ?? String(args.name)
      return `Asked the user for ${name}: they get a masked field in the chat (on Telegram, a link to it). End your turn now and say what you need it for; their answer starts your next turn.`
    },
  })
  return tools
}
