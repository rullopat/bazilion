# Saved Agent results

An explicit `deliver_file` call captures a file from the Agent's Team workspace. Once its
Agent-to-user delivery is authorized, you can download those captured bytes after the turn
finishes, chat reloads, or the daemon restarts. Editing, moving, or deleting the workspace source
does not change the saved file.

The opt-in [`image_generate` tool](image-generation.md) captures provider-generated images into the
same Results store and uses the same disclosure rules. One generation may produce several saved
images; each retains its ordinal within the original tool call and the selected image route/model
(OpenAI API key, ChatGPT/Codex login, or OpenRouter). This records the request, not independent
attestation of the backend's actual model.
Rework creates new Results rather than replacing the original.

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

Ordinary file snapshots without an active producing turn or pending/delivering approval are reclaimed
at startup, turn settlement, result/approval access, and before new publication. A provider-image
capture whose full source identity/model matches a completed durable image operation is instead
retained privately under the same 1 GiB quota, including across restart. This does not release it,
retry generation, resurrect a deletion or invent a delivery attempt. Denied, cancelled and expired
holds still cannot release bytes. An interrupted approval dispatch is recorded as failed at restart,
without retrying an uncertain Telegram send. Already released files survive that failure.
Abandoned ordinary operations retain tombstones so a retry cannot silently recreate them.

### Retained private images

The Team **Results** page also has an owner-only **Retained private images** inventory. It exposes
only opaque capture IDs, producing Agent/original Team, capture time and byte count, plus quota
usage—not filenames, prompts, models, hashes, source conversations, previews or image bytes.
Normal Results detail/download/preview/source routes remain unavailable until delivery is authorized.

- **Recover through Team Policy** requests library delivery of those immutable bytes, not another
  generation or Agent turn. Current egress policy may release the image or create/reuse the existing
  reference-only approval. A held request is not a successful delivery; use the normal approvals queue.
- Active producers, live delivery holds, unavailable/archived/transferred original producers and
  closed delivery approvals block recovery. No replacement producer, reopened approval or uncertain
  transport replay is created. Already released captures report that existing state idempotently.
- **Discard private image** requires explicit confirmation. It frees eligible private bytes without
  releasing them, retains a deletion receipt and leaves the completed operation intact so retry
  cannot regenerate it. Settle active producers/live holds first. Unavailable original producers may
  still be discarded by the original-Team owner. Released files use the normal deletion control.
- After an interrupted operator request, refresh inventory/approvals and inspect the actual state
  before deciding whether to try again. There is no automatic recovery, discard or generation retry.

```sh
bazilion result private-images --team my-team --limit 20 --offset 0 --json
bazilion result recover-image <capture-id> --team my-team --json
bazilion result discard-image <capture-id> --team my-team --yes
```

Recovery requires retained, atomically committed bytes. It cannot recreate data lost before commit,
restore a deletion or promise that provider charges/subscription usage will be refunded.

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
| `GET /api/results/private-images?teamId=…&agentId=…&limit=20&offset=0` | Owner-only minimal private capture inventory; original Team required, limit1–100 |
| `POST /api/results/private-images/:id/recover` | `{teamId}`; current-policy library delivery or truthful held/blocked state; no generation |
| `POST /api/results/private-images/:id/discard` | `{teamId,confirm:true}`; eligible private capture deletion without disclosure |

Normal Result projections return 404 for private/missing IDs; deleted downloads return 410 and
failed integrity checks return409. The separate owner-only private-image inventory is restricted to
the minimal management metadata described above; it does not grant preview/download/source access.
Source display rejects symlinks, concurrent changes, and transcripts larger than 64 MiB rather than
opening unrelated or partial history. Team/Agent/session/tool-call provenance remains on the receipt.

The daemon stores receipts and immutable BLOBs together in `Paths.db`, outside Team workspaces.
One SQLite transaction commits identity, bytes, size, and SHA-256; rollback/WAL recovery prevents a
partial publication from exposing a successful download. Pi's existing session JSONL stores only
the result reference in tool-result details, and remains the authoritative conversation transcript.

SQLite online backup captures result metadata and bytes in the same database snapshot. The
stored size/hash is their manifest, checked by both backup creation and restore validation. Ordinary
workspace files retain the existing backup consistency contract. Backup restore validates that an
archive matches the current release's full migration chain, so archives from before the
forward-migration contract require the documented reset workflow rather than an import.
