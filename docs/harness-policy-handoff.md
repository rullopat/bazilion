# Team policy implementation handoff

Bazilion has one canonical reusable roster and one canonical live policy model.

- Profiles are reusable Agent templates.
- Team Templates own revisioned stable slots and directed communication edges.
- Teams are live collaboration roots and own exactly one effective revisioned policy.
- Agents are permanent resources with exactly one Team membership.
- Template instantiations and source-slot bindings retain lineage; they do not create another roster.

Canonical surfaces:

| Resource | HTTP | CLI | Web |
| --- | --- | --- | --- |
| Team Templates | `/api/team-templates` | `bazilion team-template` | `/templates/teams` |
| Teams | `/api/teams` | `bazilion team` | `/teams` |
| Live policy | `/api/teams/:id/policy` | `bazilion team policy` | `/teams/:id/policy` |
| Approvals | `/api/approvals` | `bazilion approval` | `/approvals` |

Agent spawn, move, and deletion are revision checked. Spawn and move require an explicit placement
(`isolated`, `open`, or `profile_defaults`). Missing edges deny when enforcement is enabled.

The database is a clean-install-only alpha schema consolidated in `0001_init.sql`. There are no
Profile Group adapters, Group APIs, legacy URLs, compatibility membership modes, or upgrade paths.
Changing the schema requires recreating `~/.bazilion`.
