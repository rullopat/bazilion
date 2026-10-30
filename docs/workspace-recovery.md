# Workspace recovery

A failed or interrupted turn can leave a recorded writer blocking its Team with
`workspace_recovery_required`. The block protects against overlapping writes; restarting the daemon
or acknowledging an error does not prove that work stopped.

## macOS ownership (0.24 baseline; 0.25 candidate)

The 0.24 ordinary-chat port uses a live daemon-owned ChildProcess observer, not Linux `/proc`.
The 0.25 candidate adds public libproc birth/uid/session/group observations and bounded retirement
of original-group descendants captured while their parent is live. A receipt cannot create a new
live owner or signalling anchor. Native readiness is checked before spawn; identity is recorded
before executable input.

Recorded cleanup requires observed closure, natural output EOF and original-group absence. A coded
nonzero exit can confirm cleanup, not task success. A forced host-command exit cannot prove detached
host work stopped; a locally closed pipe cannot prove EOF. Unknown descendants, inspection errors
and missing live authority remain blocked, including after restart/restore. Management never guesses
PID ownership or force-clears records. This is not arbitrary detached-host-writer recovery. See
[BAZ-057](backlog/done/BAZ-057-portable-safe-reads.md) for historical qualification limits and the
active BAZ-072 story for current candidate evidence.

## Linux native coding workers (unreleased 0.25)

The native coding worker is trusted SDK/control-plane code with no host-command tool surface;
sandboxed commands have their own independent resource owners. The daemon binds its actual child,
Linux birth/uid/parent/namespaces and original pidfd before input. Signals target that pidfd only.
Cleanup requires natural stdout/stderr EOF, exited pidfd and positive original-group absence. Group
absence alone, locally destroyed pipes or another process's FD visibility are not cleanup proofs.

A stored `owned-linux-native-child` identity cannot construct live authority. Restart/restore,
substituted bindings and lost original handles remain blocked; no receipt or census PID is adopted.
Legacy host/Docker worker recovery retains its existing stricter global endpoint inspection. This
is not arbitrary detached-host-job recovery or a claim that the provider worker itself is sandboxed.

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
  recovery from those failures was **not supported in 0.23.0**, was not added by the 0.24
  ordinary-chat port and remains outside the 0.25 native-owner candidate; the workspace stays blocked.
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
