# Follow-up queue

This describes BAZ-036 in the next-release draft PR. Web, CLI, HTTP and Telegram controls are
implemented and locally verified. Publication and deployment remain separate release steps.

Each Agent has one durable FIFO queue. Accepted input retains its text, original attachment
names/types/bytes, Team, conversation and request identity. Acknowledgement means the input was
stored; it does not mean the Agent completed it. Later inputs cannot pass a held or uncertain head.

The web composer remains usable while the Agent responds. **Queue follow-up** adds input to the
queue; the panel lists pending work and history. **Edit** creates a replacement at the original
position, preserving attachments unless you remove them. Claimed, running and approval-held input
cannot be edited or removed. A stale edit preserves the attempted correction for review.

**Pause queue** stops future claims. **Stop** persists a pause before cancelling the active Agent
turn. **Resume queue** is explicit. New conversations remain unavailable while unresolved queue
items exist, so pending input cannot accidentally switch targets.

The browser retains an unacknowledged submission and its files locally before sending. After a
connection failure or reload, **Retry saved request** reconciles that same request. Separate tabs
retain separate request identities. Do not resubmit the same instruction as a new request when
its outcome is still unknown.

## CLI

`bazilion queue list <agent>` returns pending items and queue-control revision as JSON. Use
`--all` for history and `--offset` for pagination. `show <agent> <item>` returns one receipt.

```sh
bazilion queue add <agent> --message 'Review the next section'
bazilion queue add <agent> --message 'Review this file' --files '["./report.txt"]'
bazilion queue edit <agent> <item> --expected-revision <item-revision> --message 'Revised request'
bazilion queue remove <agent> <item> --expected-revision <item-revision>
bazilion queue pause <agent> --expected-revision <control-revision>
bazilion queue resume <agent> --expected-revision <control-revision>
bazilion queue stop <agent> --expected-revision <control-revision>
```

Text-only edits preserve existing files. Explicit `--files '[]'` removes them. Add/edit print the
request ID and original selection parameters before submission. An exact retry must use those
parameters and the same message/files; it returns the original receipt, even after completion.

## Interrupted and restored work

A normal restart retains pending input. A claimed/running item without a recorded outcome becomes
**uncertain** and pauses its Agent's queue. This includes a crash between approval claiming and
queue claiming. No uncertain item is automatically replayed.

Restoring a backup is more conservative: every unresolved queued item becomes uncertain and its
Agent's queue is paused before the restored home is installed. Even an item that was pending in
the backup might already have acted after the snapshot. Its original attachment bytes and
approval reference remain available, but its approval cannot dispatch it.

Review the retained conversation and any external effects, then use **Acknowledge and close**, or:

```sh
bazilion queue reconcile <agent> <item> --expected-revision <item-revision> --acknowledge
```

This closes the receipt without replay and leaves the queue paused. Resume separately. If another
attempt is needed after review, submit a new request with a new identity.

## Limits and authority

The limits are 20 unresolved items per Agent, 100 per home, 16 attachments and 25 MiB of combined
attachment bytes per item, 256 MiB of retained attachment bytes per home, and 64 KiB of text.
Eligible terminal input bytes expire after seven days. Compact request receipts remain to prevent
replay; their bounded capacity rejects new requests instead of forgetting old request identities.
Pending, held and unresolved uncertain input is not pruned.

The existing Team Policy authorizer and Agent admission path still apply. Approval holds refer to
the exact retained input and have one canonical delivery owner. Queue execution cannot obtain an
interactive shell approval and uses automatic denial for such requests.

## Telegram

Messages in a bound Agent topic use the same durable queue and retain their original transport
identity. Attachment download failure means the complete input was not accepted. The paired owner
can use `/queue` to inspect IDs, statuses and revisions, or `/queue history [offset]` for terminal
receipts. Controls are `/queue pause <control-revision>`, `/queue resume <control-revision>`,
`/queue stop <control-revision>` and `/queue remove <item-id> <item-revision>`.

Delayed hold/failure/cancellation notices contain only the queue ID and status. These are
best-effort control receipts: delivery errors do not change the durable input outcome and do not
retry the Agent turn. Notices are suppressed when the captured owner, Team, topic or credential
binding is no longer current. Inspect the queue when a notice is missing.
