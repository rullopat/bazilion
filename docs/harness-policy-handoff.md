# Team Policy

Bazilion has one reusable roster model and one live policy model:

- **Profiles** are reusable Agent templates.
- **Team Templates** own revisioned stable slots and directed communication edges.
- **Teams** own a filesystem root, USER.md, roster, shared memory and one effective policy.
- **Agents** are permanent resources with exactly one Team membership.
- Template instantiation and source-slot bindings retain lineage, not a second live roster.

## Management surfaces

| Resource | HTTP | CLI | Web |
| --- | --- | --- | --- |
| Team Templates | `/api/team-templates` | `bazilion team-template` | `/templates/teams` |
| Teams | `/api/teams` | `bazilion team` | `/teams` |
| Live policy | `/api/teams/:id/policy` | `bazilion team policy` | `/teams/:id/policy` |
| Approvals | `/api/approvals` | `bazilion approval` | `/approvals` |

Spawn, move and deletion are revision-checked. Spawn/move select explicit `isolated` or
`profile_defaults` placement. Team Templates are the only reusable Team roster; do not add
Profile Groups, detached live Harness identities, legacy URL aliases or another membership model.

## Authorization

With `BAZILION_TEAM_POLICY_ENFORCEMENT=on`, missing directed edges deny. The shared authorizer
covers user/peer/cross-Team, scheduler/inbox, HTTP/worker and Telegram communication boundaries.
Cross-Team communication needs both the source's outside-Team edge and the target's ingress edge.
Policy block records retain policy evidence, not message content.

An `approval_required` edge captures one typed attempt before its guarded effect. Approval
revalidates membership and policy and dispatches at most once. Scheduled approval grants only
the captured durable occurrence; the scheduler executes it under its own lease/retry contract.
Approval is not a reusable publishing credential, editorial workflow or permission to bypass
private Result disclosure. Shell dangerous-command approval is a separate ephemeral mechanism.

The product remains alpha with a clean-install schema boundary. Incompatible prior homes are
refused rather than imported or adapted; see [safe upgrade/reset guidance](upgrades.md).
For domain relationships see [ADR 0001](adr/0001-production-harness-domain.md) and
[architecture](architecture.md).
