# Manage

**Manage** in the top bar holds the pages for what Agents are made of: **Agents**, **Teams**,
**Agent templates**, **Team templates** and **Skills**, and what they used, **Usage**, under one
tab bar. The workspace (`/`) is
for working with Agents; these pages are for housekeeping. Each lists what there is first, and
creates new things in a dialog from the button at the top right. The rarer and destructive
actions of a row are behind its **⋯** button; one the daemon would refuse is shown disabled,
with the reason.

| Page | Address | What you do there | CLI |
| --- | --- | --- | --- |
| Agents | `/agents` | Find an Agent, add one, archive, restore, move to another Team, delete | `bazilion agent list\|spawn\|archive\|unarchive\|move\|delete` |
| Teams | `/teams` | Create a Team in a new folder or on a project folder; remove an empty one | `bazilion team add\|list\|rm` |
| Agent templates | `/templates/agents` | Create a template; edit its settings and files; add an Agent from it; delete an unused one | `bazilion profile create\|list\|show\|edit\|update\|delete` |
| Team templates | `/templates/teams` | Create a roster; arrange its Agents and connections; use it for a Team | `bazilion team-template list\|create\|show\|spawn\|rm` |
| Skills | `/skills` | Import from OpenClaw, a folder or a ZIP file; read the scan's findings; remove | `bazilion skill list\|import\|rm` |
| Usage | `/usage` | Tokens and money per day, Team, Agent and model ([usage](usage.md)) | `bazilion usage` |

## Agents

Agents are grouped by Team, in the order of the workspace's list (set there by dragging or
**Move up** / **Move down**, or with `bazilion team order` and `bazilion agent order`). **Find**
matches a name, or the creature and vibe from IDENTITY.md;
**Current**, **Archived** and **All** choose which Agents are shown. Each row says the template
the Agent was spawned from and the model it answers with, and says so when that model is not in
Chat. An archived Agent keeps its files and conversations and takes no work; **Restore** brings
it back. **Move to another Team** keeps its conversations and files and leaves its connections
behind. **Delete permanently** removes everything, after asking. A row shows the name an Agent
gave itself in IDENTITY.md when it differs (`· calls itself Sales Director`).

**Add an Agent** asks for a template, a Team, a name and **What is it for?**. With a role the
Agent starts working at once: the role goes on top of its SOUL.md with who added it, and it skips
the first-run ritual that would ask you its name and purpose. Without one it starts with that
ritual. From the CLI: `bazilion agent spawn --profile <template> --name Ana --role "Runs the
weekly newsletter"`. Names are unique within a Team, whatever their case: adding, renaming or
moving an Agent to a Team that has one by that name is refused (an Agent added without a name
takes its template's, numbered when taken: `Writer 2`).

## Teams

**Create a Team** asks for a name (the ID is made from it) and where the files are: **A new
folder** in the Bazilion home, or **A project folder** that exists, which the Team links to.
Removing a Team removes only the link to a project folder, never the folder. A Team can be
removed once it has no Agents. Its members, USER.md, memory and connections are in the
workspace's **Team** tab.

## Agent templates

A template is what a new Agent starts with. Its page has two cards, each saved with one
**Save**:

- **Settings**: the name (it cannot be blank; a template created without one takes its id), the
  default model, and the skills attached at spawn (all installed skills, or chosen ones). A banner says when the default model is not in Chat: Agents spawned
  from it are refused until it is.
- **Files**: SOUL.md (who the Agent is and how it works), IDENTITY.md and BOOTSTRAP.md, one at a
  time. A dot marks a file changed and not saved; **Save** keeps every changed file. A template
  without a BOOTSTRAP.md can add one, starting from the built-in text.

Agents already spawned keep their own copies. A template cannot be deleted while an Agent was
spawned from it or a Team template uses it.

## Team templates

A Team template is a roster: one Agent per slot, each from an Agent template, and the
connections between them. On its page, drag from one Agent to another to connect them, or use
the **Matrix** view; **Save** keeps the roster. **Use this template** adds the Agents and
connections to a new Team or to one that exists ([team policy](team-policy.md)).

## Skills

Every skill is scanned when it is imported. A risky finding, or a SKILL.md that cannot be read,
is shown under the skill and in a banner at the top. Each row says which templates chose the
skill by name; templates that take all skills attach every one. **Import skills** takes skills
from OpenClaw, a folder on the computer Bazilion runs on, or a ZIP file uploaded from the
browser; to replace installed skills or import despite findings, tick the box in the dialog.
