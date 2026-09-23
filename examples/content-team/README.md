# Content Team recipe — first BAZ-064 slice

**Experimental, partial acceptance only.** This recipe prepares topic-neutral Mastodon content for
manual handoff using existing Profiles, Team Templates, prompt-only skills, policy and Results.
It is not auto-installed, not a publisher and not evidence that the end-to-end campaign passed.

**Known blocker:** normal protected peer/inbox and scheduled turns currently expose `web_fetch`, not
`web_search`. A delegated researcher cannot use the configured search backend through that surface.
Do not unblock it with host execution, browser/MCP, injected keys or fabricated search responses.
See [the preflight/evidence record](../../docs/backlog/BAZ-064-acceptance.md). Until a qualified discovery
path exists, the complete research journey is blocked; supplied-URL retrieval is a narrower exercise.

## What is supplied

- `team-template.json`: canonical version-1 interchange with four stable role keys and eight directed
  edges: user ↔ coordinator and coordinator ↔ each specialist. All other routes are absent/denied
  when policy enforcement is active. The template has no fixed provider, topic, brief or trigger.
- `profiles/*.md`: coordinator, researcher, writer and designer role instructions.
- `skills/content-preparation/SKILL.md`: shared prompt-only preparation/review/handoff convention.
- `operating-rules.md` and `tools.md`: private Agent instruction inputs, not workspace discovery hooks.
- `brief.md`: fillable project worksheet. Confirm it conversationally; store concise project context
  in existing Team memory and preserve source conversations, not a second transcript/approval ledger.

The designer proposes concepts/prompts; the coordinator performs image generation and user delivery
only after text/concept approval. This avoids granting every specialist a user-egress edge or claiming
that the coordinator can release another Agent's private image. Role instructions do not restrict the
actual tool set: image timing is tested behavior, not an implemented backend spending-approval gate.

## Safe setup through existing interfaces

Use a dedicated disposable home and a loopback daemon on Linux. Do not copy real publishing credentials
or logged-in browser/MCP sessions into it. Set `BAZILION_TEAM_POLICY_ENFORCEMENT=on` for that daemon.
Keep the scheduler and image generation **off during this installation/preflight**; no instructions
here authorize paid text/research/image calls. Do not change another running home's configuration.

First complete ordinary text-provider/model setup. Choose a supported, explicitly enabled model that
also satisfies protected-provider admission; do not assume a model string supplies credentials or
that configured-operator Docker proves protected execution. Images have their separate opt-in.

From the repository root, with the CLI targeting that disposable daemon, install using normal CLI
commands (replace `bazilion` with `pnpm tsx apps/cli/src/index.ts` when running from source):

```sh
(
  set -eu
  : "${CONTENT_MODEL:?Set an enabled, curated provider:model for this disposable home}"
  recipe="$PWD/examples/content-team"
  # This filesystem source is read by the daemon; use a local daemon with this path available.
  bazilion skill import --from "$recipe/skills"
  for role in coordinator researcher writer designer; do
    bazilion profile create "content-$role" \
      --model "$CONTENT_MODEL" --skills-mode selected --skills content-preparation \
      --skip-bootstrap --soul-file "$recipe/profiles/$role.md" \
      --agents-file "$recipe/operating-rules.md" --tools-file "$recipe/tools.md"
  done
  bazilion team-template import "$recipe/team-template.json" --dry-run
  # Review the four slots and eight directed edges before this explicit mutation:
  bazilion team-template import "$recipe/team-template.json" --apply
)
```

Use fresh names/home. If profiles/skills already exist, stop and inspect their contents rather than
forcing replacement or assuming skipped imports matched this recipe. Profile changes affect future
spawns; existing Agents do not automatically receive edits. Selected skills avoid ambient installation
of unrelated capabilities/prompts. No default model is selected by the recipe itself.

Open **Templates → Teams** (`/templates/teams`) in the web UI, choose `content-preparation`, preview
revision 1 and initialize a **new** Team. Do not append to an existing work Team for this acceptance
fixture. Inspect the resulting roster and policy before starting a turn. The existing HTTP equivalent
is `POST /api/team-templates/content-preparation/spawn/preview`, then `/spawn`, with
`{templateExpectedRevision:1, teamId:"content-trial", mode:"initialize"}`. Use authenticated normal
clients, not a bootstrap bearer pasted into a browser or command transcript. The current CLI manages
import/export but has no `team-template spawn` subcommand; do not invent one in setup instructions.

Copy current role UUIDs from the canonical roster/API response into the coordinator's initial setup
message with the brief. There is currently no `list_agents` tool/automatic roster prompt in this path;
names are not recipient IDs. Routing notes are hints, not a parallel authoritative roster: stale or
missing identities must stop delegation, and daemon policy still validates actual endpoints.

## Policy and operation expectations

| Route | Expected policy decision |
| --- | --- |
| User ↔ coordinator | Allow |
| Coordinator ↔ researcher/writer/designer | Allow |
| User ↔ any specialist | Deny |
| Specialist ↔ specialist | Deny |
| Any member ↔ another Team/outside-Team endpoint | Deny |

Check effective edges with the Team page or `bazilion team policy show <team> --json`; inspect a path
without sending with `bazilion team policy evaluate <team> --source user --target agent:<uuid> --json`.
Communication permission is neither final editorial approval nor social-publication permission.

After preflight and separate usage authorization, the intended sequence is: confirm brief → research
and concept drafting → human text/concept approval → coordinator image generation → image rework and
final review → exact manual handoff. Send substantive work via messaging and end turns to release shared
workspace ownership; don't create acknowledgment loops or wait while holding a peer's workspace.

A failed/held tool is not a reason to weaken the graph or rerun uncertain images. Keep known private-
image loss and no-refund limits visible. No trigger is included; BAZ-065 owns actual cron qualification
and BAZ-066 the live/human observations. Mastodon API publication needs separate implementation/consent.

## Local validation (no provider calls)

```sh
pnpm vitest run apps/cli/test/content-team-recipe.test.ts
```

The first slice checks import/spawn, exact role documents and skill attachment, canonical lineage,
unfilled brief context across two Teams, the directed policy matrix and rejected direct specialist ingress. It **does not**
run a model, demonstrate research/rework, or qualify the full D/S/L/H journey. Those observations remain
open in [BAZ-064](../../docs/backlog/in_progress/BAZ-064-content-team-recipe-and-manual-handoff.md)
and [the shared protocol](../../docs/testing/beta-readiness/content-team-acceptance.md).
