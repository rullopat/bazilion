# Agent files and storage

Every artifact has one canonical owner. Files are not interchangeable with DB rows, and a
Team work tree is not an Agent's private home. See [architecture](architecture.md).

## Ownership map

| Artifact | Canonical location | Writer / access |
| --- | --- | --- |
| SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md | `agents/<id>/` | Seeded from a Profile; supported private-home tools edit admitted files |
| BOOTSTRAP.md | `agents/<id>/` | Prompt input until `bootstrap_done` completes onboarding |
| Profile documents | `profiles/<id>/` | Operator-managed templates; existing Agents have their own copies |
| Team USER.md | DB `teams.user_md` | Operator management and admitted `user_md_*` tools with revision checks |
| Team memory notes/index | `teams/<slug>/memory/` | Shared `memory_*` tools / Team memory API; qmd BM25 |
| Conversation transcript | `agents/<id>/sessions/<sessionId>.jsonl` | Pi's canonical append-only transcript |
| Input attachments | `agents/<id>/uploads/` | Daemon saves non-image files and supplies references to the turn |
| Saved Results | DB `agent_results` | Immutable bytes, digest and provenance; policy controls disclosure |
| Roster, policy, selection, queues, approvals | SQLite | Daemon only, through supported APIs/tools |
| Learned proposals/reviews | SQLite | Existing learning/review operations, not a second memory directory |
| Credentials | Encrypted `secrets` rows | Daemon resolves only the admitted credential; never a prompt document |
| Bootstrap identity | `auth.json` paired with DB token hash | Daemon bootstrap and trusted local CLI; preserve together |
| Browser profile/cookies | `browsers/<agent-id>/` | Daemon-owned browser lifecycle; sensitive and excluded from backup |

Agent instruction documents live **outside the Team tree**. Repository instructions are a separate,
labelled input supplied by the repository-context resolver; an Agent's private AGENTS.md is not the
repository's AGENTS.md. Host coding-tool cwd is not filesystem confinement.

## USER.md and memory

USER.md is a Team-owned DB value even though it is presented as Markdown. A file named USER.md
in the work tree is not its authority. Edit through Team management or admitted tools, not a
hand-edited SQLite row or assumed generated-file synchronization. Revision conflicts require a
fresh read before writing.

Team memory is shared across all members. Keep personal identity/preferences in the Agent's
private IDENTITY.md rather than treating shared memory as an Agent-private store. Memory notes
are Markdown; the qmd index is derived state and excluded from backups.

## Preservation

Pi JSONL is the conversation record, not a disposable cache. Do not truncate live transcripts,
edit Result blobs/tombstones or delete ownership markers to reclaim space. Use the supported
management interfaces and preserve the complete DB/auth identity pair before any reset.
See [Results](results.md), [conversations](conversations.md), [retention](growth-and-retention.md)
and [upgrades](upgrades.md).
