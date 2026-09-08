# Saved Agent results

An explicit `deliver_file` call captures a file from the Agent's Team workspace. Once its
Agent-to-user delivery is authorized, you can download those captured bytes after the turn
finishes, chat reloads, or the daemon restarts. Editing, moving, or deleting the workspace source
does not change the saved file.

## Find and download

- **Web:** open a Team and choose **Results**, or use the saved-file card in chat. Filter by the
  producing Agent ID and page through the list. Each entry identifies the producer, capture date,
  and source conversation. **Source conversation** opens a read-only view only while that exact
  canonical conversation remains available; starting a new conversation retains that source, and missing history never redirects to a newer chat.
- **CLI:** list results, inspect their metadata and SHA-256 hash, and download to an explicit path.
  Downloads refuse to overwrite an existing file.
- **Mobile:** the saved-file row opens the exact result page in your browser. Sign in with a device
  credential if needed; sign-in returns to that result. The native credential is never put in the URL.
- **Telegram:** an authorized document send uses the same captured bytes. A failed send does not
  remove the saved result or establish that Telegram received it.

```sh
bazilion result list --team my-team
bazilion result list --team my-team --agent <agent-id> --limit 20 --offset 20 --json
bazilion result show <result-id>
bazilion result download <result-id> --output ./report.pdf
bazilion result rm <result-id> --yes
```

The Team page offers plain-text and Markdown previews up to 256 KiB, displayed as text. PNG,
JPEG, GIF, and WebP previews are limited to 10 MiB and require the matching file signature. HTML,
SVG, scripts, and unsupported types remain downloads. Previews do not execute markup or load
linked resources. Downloaded files use an attachment response, even for active content.

## Authorization and retention

Saved files are private until the shared Team Policy authorizer allows Agent-to-user delivery.
A pending communication approval holds an opaque result reference, not a second copy of its bytes.
Approving it revalidates policy and membership and releases only the captured snapshot. Background
turns use a library delivery attempt in the same approval queue; HTTP and Telegram retain their
transport-specific attempts. A reference in a transcript does not bypass authorization.

Released files stay available to the owner after later policy edits. They do not expire
automatically. Each file is limited to **25 MiB**, and a Bazilion home may retain **1 GiB of file
bytes**, including private snapshots awaiting approval. At capacity, delivery fails with cleanup
guidance. Repeating the same source operation returns its existing receipt; different tool calls
with the same filename create separate results.

**Delete saved file** removes captured bytes and leaves a deletion receipt for old chat cards.
It does not delete the workspace source. Deleting an Agent or moving it to another Team retains
its released files under the original Team. Deleting that original Team removes its result records;
Team deletion first requires moving or deleting its members. Starting a new conversation retains results and their source history. Reset/full uninstall removes results with the DB.
Linked external Team source directories are never traversed to clean result storage.

Private snapshots without an active producing turn or pending/delivering approval are reclaimed
at startup, turn settlement, result/approval access, and before new publication. Denied, cancelled,
and expired holds cannot release bytes. An interrupted approval dispatch is recorded as failed at
restart, without retrying an uncertain Telegram send. Already released files survive that failure.
Abandoned operations retain tombstones so a retry cannot silently recreate them.

The 1 GiB limit counts retained file bytes, not the physical SQLite file size. SQLite reuses freed
pages; deleting a result need not immediately shrink the database file on disk.

## API and storage contract

All routes require existing owner authentication. Browser writes also require the existing CSRF
contract. Agents publish through a turn-bound private IPC host; there is no public upload route.

| Route | Behavior |
| --- | --- |
| `GET /api/results?teamId=…&agentId=…&limit=20&offset=0` | Released, undeleted results; total and pagination |
| `GET /api/results/:id` | Metadata and provenance, including deletion state |
| `GET /api/results/:id/download` | Verified captured bytes as an attachment |
| `GET /api/results/:id/preview` | Bounded safe preview, or an explicit unsupported response |
| `GET /api/results/:id/source` | Exact retained source conversation, or `available: false` |
| `DELETE /api/results/:id` | Remove bytes and preserve a deletion receipt |

Private/missing IDs return 404; deleted downloads return 410; failed integrity checks return 409.
Source display rejects symlinks, concurrent changes, and transcripts larger than 64 MiB rather than
opening unrelated or partial history. Team/Agent/session/tool-call provenance remains on the receipt.

The daemon stores receipts and immutable BLOBs together in `Paths.db`, outside Team workspaces.
One SQLite transaction commits identity, bytes, size, and SHA-256; rollback/WAL recovery prevents a
partial publication from exposing a successful download. Pi's existing session JSONL stores only
the result reference in tool-result details, and remains the authoritative conversation transcript.

SQLite online backup captures result metadata and bytes in the same database snapshot. The
stored size/hash is their manifest, checked by both backup creation and restore validation. Ordinary
workspace files retain the existing backup consistency contract. This is an alpha schema change:
older homes/backups require the documented clean-install/reset workflow, with no ALTER migration
or compatibility importer.
