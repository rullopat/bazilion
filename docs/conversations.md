# Conversations

Each Agent has one active conversation and a retained library. In web chat, open **Conversations**
to list history, rename a title, view old work, or choose **New conversation**. Viewing or renaming
history does not change where new messages go. New conversation keeps previous history and saved
files. The ordinary destructive chat reset command is removed.

```sh
bazilion conversation list <agent> --json
bazilion conversation show <agent> <conversation-id>
bazilion conversation new <agent> --title "Next task"
bazilion conversation rename <agent> <conversation-id> "Weekly report"
```

New conversation is rejected while the Agent is occupied or has pending queued user messages.
Wait for completion or reconcile pending work first. Web, CLI and mobile sends carry the selection
they observed. If another client changes it, the daemon rejects the old send before execution.
Web preserves its draft and attachments through **reload**; review the refreshed conversation before
sending again. TTY chat restores rejected input at the next prompt. Native conversation management
is deferred; mobile users can open the web library or use the CLI.

Creation uses an immutable UUID request ID and the original expected selection. If a CLI response
is lost, repeat the request ID, expected revision/conversation and title printed before the request.
Use `none` for an originally empty selection. A successful retry returns the original conversation
and the current selection; it never reselects old history. Web keeps its pending creation request
in tab session storage, including across a reload.

## API and history ownership

| Endpoint | Contract |
| --- | --- |
| `GET /api/agents/:id/conversations?limit=20&offset=0` | Bounded list, total and active selection; maximum page size 100 |
| `POST /api/agents/:id/conversations` | `{requestId, expectedSelection: {conversationId, revision}, title?}` |
| `GET /api/agents/:id/conversations/:conversationId` | Agent-scoped retained history; unavailable history returns 409 |
| `PATCH /api/agents/:id/conversations/:conversationId` | `{title, expectedTitleRevision}`; titles are 1–200 characters |

The daemon stores identity, title and routing metadata. Canonical Pi JSONL is the only transcript.
Current history/head includes authoritative selection; an unreadable selected file is marked
`head.unavailable` (or `unavailable` on the head endpoint), so clients can display recovery guidance.
Empty messages with that flag do not mean an empty healthy conversation. Explicit New conversation
is the recovery action. Missing/corrupt history is never recreated by a read or routed by file mtime.

Foreground chat, compact and edit requests include `expectedSelection`. Context inspection requires
an existing selected conversation. Controls share the Agent lifecycle lease. Background operations
carry an exact target: scheduled occurrences capture it at materialization, inbox wakes at claim,
and Telegram before media download. Delayed approvals retain their original destination. Executing
an admitted retained target does not change active selection. Private reviewer scratch sessions are
not listed or selected.

Backups include metadata and canonical files, preserving source IDs and saved-file provenance.
This follows the clean-install alpha schema contract; older homes require the documented reset and
rebootstrap workflow. Search, manual resume, branching and history purge are deferred.
