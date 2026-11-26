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
`outside`, which stands for every Agent in other Teams. The web names the modes by what they do:
**Everyone** (`open`: everyone can message everyone) and **Connections only** (`restricted`: only
along connections).

| Message | Allowed when |
| --- | --- |
| Between members of an **open** Team (the default) | always |
| Between members of a **restricted** Team | an edge `sender -> recipient` exists |
| From a member of Team A to a member of Team B | Team A has `sender -> outside` and Team B has `outside -> recipient`, whatever the modes |

Every turn's system prompt lists the Agent's teammates by name and id, says which of them policy
lets it message, and names the Agents of other Teams it may reach, so you never pass ids around.
When you ask an Agent for teammates it adds them with `agent_create` (see
[the agent engine](agent-engine.md#5-tools)); in a restricted Team each is connected with its
creator both ways, and other connections stay yours to make.

A denied message is an error returned to the `send_message` tool or the HTTP request, with the
reason, and a `team_policy_denied` line in the daemon log. Nothing is stored and nothing is queued.
An Agent that moves to another Team loses its edges and joins the new Team with none; in a restricted
Team a new member starts isolated until you add edges. Edits take effect immediately and the last
write wins. Edges between members of an open Team are kept but unused: the Connections panel says
how many are saved, and they apply once the Team is restricted. Drawing a connection between two
teammates of an open Team asks first whether to switch the Team to **Connections only**, since
the connection would otherwise change nothing; a connection to or from `outside` needs no switch.

## Exchanges between Agents

A message an Agent sends in a turn someone started (you, a schedule) opens an exchange; every
message sent in a turn that messages woke continues the exchange of the latest of them. An
exchange has no length limit: it lasts as long as its Agents have work to hand each other.

- **The Agents see it.** A woken Agent reads the exchange so far after its new messages: how it
  began, and the latest messages. It is told to keep it going only while that moves the first
  request forward, and otherwise to stop writing and tell you where it stands.
- **Going round in circles stops it.** A message its sender already sent the same Agent in the
  exchange (the same words, whatever the case, punctuation and spacing) is not delivered. The
  sender is told so, and to say where the work stands; Attention shows it, and the Agents'
  mailboxes list it under **Stopped exchanges**.
- **You can stop it.** While an exchange goes on, the Connections tab shows it under **Going on
  now**: its Agents, how many messages since when, what the turns it woke used, and **Stop**.
  Stopping it stops the turns it woke, leaves its unread messages unread by anyone, and refuses
  any further message in it.

This is separate from policy, which says who may message whom.

## Surfaces

| Task | CLI | Web |
| --- | --- | --- |
| Show a Team's policy | `bazilion team policy show <team>` | **Connections** in the side panel |
| Open or restrict a Team | `bazilion team policy mode <team> open\|restricted` | **Who can message whom** in the Connections view: Everyone or Connections only |
| Add or remove an edge | `bazilion team policy allow\|deny <team> <from> <to>` | Connections view: the map or the table |
| See what Agents said to each other | `bazilion team messages <team>` | Connections: recent messages |
| See and stop the exchanges going on | `bazilion inbox exchanges <team>`, `bazilion inbox stop <exchange>` | Connections: **Going on now** |
| See the exchanges that stopped | `bazilion inbox stopped <agent>` | An Agent's mailbox: **Stopped exchanges** |
| Manage templates | `bazilion team-template list\|show\|create\|export\|import\|rm` | Manage → Team templates |
| Use a template for a Team | `bazilion team-template spawn <template> <team>` | **Use** on Team templates, or **Use this template** on its page |
| Save a Team as a template | `bazilion team-template save <team> <template>` | Team tab → Settings → Save as a Team template |

On the map every Agent is a node with what it is doing, and every pair that is connected or that
talked is one line: an arrowhead for each allowed direction, a dashed line for a pair that only
talked (an open Team), and the number of recent messages on it. Drag from one Agent to another to
connect them; select an Agent or a line to switch each direction and to read their messages.
Changes apply when you press **Save**. Where you drag the nodes is remembered in the browser.

HTTP: `GET` and `PATCH /api/teams/:id/policy`, `POST /api/teams/:id/policy/save-as-template`,
`GET /api/teams/:id/messages`, `GET /api/teams/:id/exchanges`, `POST /api/exchanges/:id/stop`,
and `/api/team-templates` (`GET`, `POST`, `PUT /:id`,
`DELETE /:id`, `POST /:id/spawn`).

In a template, edges name slots by position (`0` is the first slot) or `outside`. Spawning into a
new Team copies the template's USER.md and mode; spawning into an existing Team adds the Agents and
their edges and keeps the Team's mode.
