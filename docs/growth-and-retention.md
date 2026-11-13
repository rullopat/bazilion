# What grows in a Bazilion home

| Path | Holds | Grows with |
|------|-------|------------|
| `bazilion.db` | Agents, messages, saved results, settings, encrypted secrets | Use |
| `agents/<id>/sessions/*.jsonl` | Conversation transcripts, tool output included | Turns |
| `agents/<id>/uploads/` | Files attached to chats | Attachments |
| `teams/<slug>/` | Team work tree and shared memory notes | The Agents' work |
| `profiles/`, `skills/` | Agent templates and installed skills | You |
| `browsers/<agent-id>/` | Managed browser profiles (cookies, logins) | Browsing |

Conversations, messages and uploads are never pruned: they are the record. Finished follow-ups and
their attachments are deleted seven days after they end. Saved results are capped at 25 MiB per
file and 1 GiB per home; they do not expire, and deleting one (Team → Results or
`bazilion result rm`) frees its share.

Inspect sizes with `du -sh ~/.bazilion/* ~/.bazilion/agents/*`, and the database with
`sqlite3 ~/.bazilion/bazilion.db "SELECT name, SUM(pgsize) FROM dbstat GROUP BY name ORDER BY 2 DESC"`.

To reclaim space: delete an Agent you no longer need (`bazilion agent delete`, which removes its
directory and sessions), reset its browser (`bazilion agent browser reset`), or delete results.
A Team's `memory/.qmd-index.sqlite` can be deleted at any time; it is rebuilt from the Markdown
notes. Do not delete session files by hand: the database still lists those conversations, and the
active one's next turn continues from its file.

The daemon writes no log files. It logs to stdout, so under a service manager such as systemd the
journal holds and rotates the log.
