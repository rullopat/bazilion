# Team Policy

Team Policy decides which Agent may send a message to which other Agent. It never limits you:
you can always chat with every Agent, and every Agent can always reach you through chat,
Telegram, Results, questions and notifications.

## Model

- **Profiles** are reusable Agent templates.
- **Teams** own a workspace, USER.md, shared memory, their members and their policy.
  Every Agent belongs to exactly one Team.
- **Team templates** are reusable rosters: one slot (profile and Agent name) per Agent, plus allow
  edges between slots and a policy mode. Spawning a template creates the Agents and their edges.

A Team's policy is a **mode** plus directed **allow edges**. An edge endpoint is a member Agent or
`outside`, which stands for every Agent in other Teams.

| Message | Allowed when |
| --- | --- |
| Between members of an **open** Team (the default) | always |
| Between members of a **restricted** Team | an edge `sender -> recipient` exists |
| From a member of Team A to a member of Team B | Team A has `sender -> outside` and Team B has `outside -> recipient`, whatever the modes |

A denied message is an error returned to the `send_message` tool or the HTTP request, with the
reason, and a `team_policy_denied` line in the daemon log. Nothing is stored and nothing is queued.
An Agent that moves to another Team loses its edges and joins the new Team with none; in a restricted
Team a new member starts isolated until you add edges. Edits take effect immediately and the last
write wins.

The 8-hop loop guard on message chains is separate from policy: it bounds cost, not reach.

## Surfaces

| Task | CLI | Web |
| --- | --- | --- |
| Show a Team's policy | `bazilion team policy show <team>` | Team → Policy |
| Open or restrict a Team | `bazilion team policy mode <team> open\|restricted` | Open/Restricted toggle |
| Add or remove an edge | `bazilion team policy allow\|deny <team> <from> <to>` | Flow or Matrix editor |
| Manage templates | `bazilion team-template list\|show\|create\|export\|import\|rm` | Templates → Teams |
| Spawn a template into a Team | `bazilion team-template spawn <template> <team>` | Spawn team dialog |
| Save a Team as a template | `bazilion team-template save <team> <template>` | Team → Policy → Save as Team template |

HTTP: `GET` and `PATCH /api/teams/:id/policy`, `POST /api/teams/:id/policy/save-as-template`, and
`/api/team-templates` (`GET`, `POST`, `PUT /:id`, `DELETE /:id`, `POST /:id/spawn`).

In a template, edges name slots by position (`0` is the first slot) or `outside`. Spawning into a
new Team copies the template's USER.md and mode; spawning into an existing Team adds the Agents and
their edges and keeps the Team's mode.
