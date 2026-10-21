# Workspace recovery

A failed or interrupted turn can leave a recorded writer blocking its Team with
`workspace_recovery_required`. The block protects against overlapping writes; restarting the daemon
or acknowledging an error does not prove that work stopped.

## Inspect and attempt supported cleanup

Open the Team page's **Workspace recovery** section, or use:

```sh
bazilion team recovery list <team>
bazilion team recovery attempt <team> <writer-id>
```

`list` and **Refresh status** are read-only. `attempt` selects an opaque id from the report and asks
the daemon to clean up its existing records. It never retries the failed turn. `--json` returns the
canonical report/response; `attempt` exits nonzero unless the outcome is `recovered`.

Both routes require owner/admin authorization, including read-only reports:

- `GET /api/teams/:id/workspace/recovery`
- `POST /api/teams/:id/workspace/recovery/:writerId`, with no body.

## What the report means

- **Active:** recovery cannot interrupt an active writer. Use the normal Agent cancellation surface
  when appropriate; requesting cancellation is not itself cleanup confirmation.
- **Recovery required, no blocker code:** recorded cleanup can be attempted. The writer remains
  blocking until every selected resource has a persisted cleanup confirmation.
- **Unconfirmed host commands:** host commands may detach and outlive a failed turn. Guaranteed
  recovery from those failures is **not supported in 0.23.0**; the workspace remains blocked.
- **Unconfirmed worker:** management will not signal it or manufacture a confirmation. Existing
  lifecycle cleanup must establish the confirmation first.
- **Missing/inconsistent records:** ownership cannot be established, so cleanup stays blocked.
- **Restored:** archive metadata is not authority to terminate processes or containers. Management
  recovery is unavailable for those records.
- **Root changed:** the registered workspace identity no longer matches the selection. No guessed
  root or replacement path is used.

`recovered` means the selected writer was released after recorded cleanup. It does not certify the
workspace contents or guarantee that another legitimate writer has not started. Reports are per
Team; an empty report does not rule out a writer in another Team with an overlapping linked root.
`not_found` is not
a recovery confirmation. If the selection changes during cleanup, inspect the fresh report before
any further action.

There is **no force-clear**, SQL workaround, imported cleanup proof or supported manual marker
removal. Do not reset/delete a Team or create a replacement Team merely to hide unknown ownership.
The limited 0.23.0 scope was explicitly accepted; it does not promise universal failed-turn recovery.
