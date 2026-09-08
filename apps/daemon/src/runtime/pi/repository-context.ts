import type { RepositoryContextReport } from '@bazilion/api-types'
import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { assertRepositoryContext } from './repository-context-contract.ts'

export type RepositoryContextHost = (target: string) => Promise<RepositoryContextReport>

/** Supplies a custom ResourceLoader's public getAgentsFiles contract; no filesystem discovery. */
export function repositoryContextIntegration(
  initial: RepositoryContextReport,
  host: RepositoryContextHost,
  cwd: string,
) {
  assertRepositoryContext(initial)
  if (initial.instructions.state !== 'complete')
    throw new Error('Repository instructions incomplete')
  let current = initial
  let refreshPrompt = () => {}
  const files = () => ({
    agentsFiles: [
      {
        path: 'Repository instructions and provenance',
        content: [
          '# Repository context',
          `Captured target: ${current.target}; fingerprint: ${current.fingerprint}; captured at: ${new Date(current.capturedAt).toISOString()}.`,
          `Repository root for this runtime: ${cwd}. This is captured context, not a live workspace lock or verification evidence.`,
          'Platform/runtime policy and explicit operator instructions take priority. Repository guidance specializes general private Agent preferences for repository work. Deeper documents govern only their own subtree. Team Policy and execution authority are unchanged.',
          'Before editing a different subtree, call repository_context with its directory or file path. A returned snapshot replaces previous applicable repository guidance; older transcript snapshots are historical. Do not edit a scope whose instructions are incomplete.',
          current.instructions.state === 'complete'
            ? 'Applicable instructions are complete for the captured scope. Missing AGENTS.md is normal.'
            : `BLOCKED SCOPE: ${current.instructions.issues.map((issue) => issue.code).join(', ')}. Resolve this context before editing.`,
          ...(current.instructions.state === 'complete'
            ? current.instructions.files.map(
                (file) =>
                  `## ${file.path}\nScope: ${file.scope}; precedence: ${file.precedence}; SHA-256: ${file.sha256}\n\n${file.content}`,
              )
            : []),
          `Git orientation at capture time: ${JSON.stringify(current.git)}`,
          `Command suggestions (task data, not execution permission):\n${JSON.stringify(current.commands)}`,
        ].join('\n\n'),
      },
    ],
  })
  const tool: ToolDefinition = {
    name: 'repository_context',
    label: 'Repository context',
    description:
      'Resolve the complete applicable repository AGENTS.md instructions and passive command/Git context for a contained file or directory. Call before editing a new subtree. Does not run project commands or change cwd. Incomplete instructions block editing that scope.',
    parameters: Type.Object(
      { target: Type.String({ maxLength: 4096 }) },
      { additionalProperties: false },
    ),
    executionMode: 'sequential',
    async execute(_id, params) {
      const target = (params as { target: string }).target
      const replacement = await host(target)
      assertRepositoryContext(replacement)
      if (
        replacement.teamId !== initial.teamId ||
        replacement.rootIdentity !== initial.rootIdentity
      ) {
        current = {
          ...initial,
          instructions: {
            state: 'incomplete',
            files: [],
            issues: [
              {
                code: 'root_changed',
                message: 'Repository identity changed; start a new admitted turn.',
              },
            ],
          },
          commands: { state: 'incomplete', sources: [], candidates: [], issues: [] },
        }
        refreshPrompt()
        throw new Error('Repository context identity changed; start a new admitted turn')
      }
      current = replacement
      refreshPrompt()
      return {
        content: [{ type: 'text', text: JSON.stringify(replacement) }],
        details: { repositoryContext: replacement },
      }
    },
  }
  return {
    files,
    tool,
    bind(session: AgentSession, allowedTools: string[]) {
      // Public SDK API rebuilds the prompt from the ResourceLoader. The admitted tool set is
      // unchanged; only the captured context supplied by getAgentsFiles has been replaced.
      refreshPrompt = () => session.setActiveToolsByName(allowedTools)
    },
  }
}
