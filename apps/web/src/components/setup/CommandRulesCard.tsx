// The commands each Agent may run without asking: kept from an approval with "Always for this
// Agent", until they are removed here or with `bazilion approval rm`.

import type { Agent, CommandRule, ListCommandRulesResponse } from '@bazilion/api-types'
import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { useHydrated, useResource } from '../../lib/use-resource'
import { CardEmpty, CardList, ListRow, Notice, RowMenu, SetupCard } from '../ui/parts'

export function CommandRulesCard() {
  const data = useResource(async (signal) => {
    const [{ rules }, agents] = await Promise.all([
      api<ListCommandRulesResponse>('/api/command-rules', { signal }),
      api<Agent[]>('/api/agents?includeArchived=true', { signal }),
    ])
    return { rules, names: new Map(agents.map((agent) => [agent.id, agent.name])) }
  }, [])
  const hydrated = useHydrated()
  const [error, setError] = useState<string | null>(null)

  async function remove(rule: CommandRule) {
    setError(null)
    try {
      await api(`/api/command-rules/${encodeURIComponent(rule.id)}`, { method: 'DELETE' })
      await data.reload()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  const rules = data.data?.rules ?? []
  return (
    <SetupCard
      labelledBy="command-rules"
      icon={<ShieldCheck className="size-5" />}
      title="Commands allowed without asking"
      description="Kept with Always for this Agent when you allowed a dangerous command. Each applies to its Agent's single commands that start with it."
    >
      {(error ?? data.error) && (
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <Notice role="alert" title="That did not work.">
            {error ?? data.error}
          </Notice>
        </div>
      )}
      {data.data && rules.length === 0 ? (
        <CardEmpty icon={<ShieldCheck className="size-5" />} title="None yet">
          When a dangerous command asks you, Always for this Agent lets that Agent run commands that
          start the same way without asking again.
        </CardEmpty>
      ) : (
        <CardList>
          {rules.map((rule) => {
            const agent = data.data?.names.get(rule.agentId) ?? 'An Agent no longer here'
            return (
              <ListRow
                key={rule.id}
                inline
                title={<code className="font-mono text-[0.92em]">{rule.prefix}</code>}
                meta={
                  <>
                    <span>{agent}</span>
                    {hydrated && <span>Kept {new Date(rule.createdAt).toLocaleDateString()}</span>}
                  </>
                }
                actions={
                  <RowMenu
                    label={`More for ${rule.prefix}`}
                    items={[{ label: 'Remove', danger: true, onSelect: () => void remove(rule) }]}
                  />
                }
              />
            )
          })}
        </CardList>
      )}
    </SetupCard>
  )
}
