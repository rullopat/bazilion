# Telegram Attention notifications

Attention notifications are off by default. Enable them in **Configuration → Integrations →
Telegram → Attention notifications**, after configuring and pairing the private Telegram forum.
Choose its service topic explicitly, select the kinds to include, and save. Bazilion uses the
existing bot; it does not create another recipient list.

The five kinds are communication approvals, lesson proposals, review failures, scheduled trigger
failures and Agent message loop breaks. Notifications contain minimal authorized metadata and a
link to the existing decision screen when a private HTTPS gateway origin is configured. Otherwise
there are instructions for finding the item in the web Attention page. Receiving or opening a
notice does not approve, acknowledge, retry or otherwise resolve its source.

## New and currently open items

First enablement and re-enable normally consider only future items. **Preview open items** shows
an eligible count and asks explicitly before including older open items. The preview expires after
five minutes and is bound to the selected kinds, destination and settings revision. Resolved items
are omitted at confirmation or dispatch. Confirmed deliveries are not sent again by ordinary polling.

Adding a kind gives that kind a fresh cutoff while retaining pending notices and eligibility for
unchanged kinds. Removing a kind suppresses its pending notices. Re-adding it does not silently
replay those notices; use an explicit preview if you want to include eligible old items.

## Quiet hours and delivery state

Quiet hours apply to every selected kind in the named IANA timezone, for example `Europe/Warsaw`.
The start is inclusive and the end exclusive; an overnight window is supported. Equal start/end
values are rejected. Both occurrences of a repeated daylight-saving hour are evaluated as local
clock time. A skipped clock hour does not create an artificial send time.

Delivery receipts appear below the settings:

- **Deferred:** waiting for dispatch, quiet hours or safe destination validation. Sources are
  rechecked after pacing; resolved or no-longer-authorized items are suppressed.
- **Sending:** an API attempt is in flight. It is not a confirmed delivery.
- **Delivered:** Telegram returned a message ID. The underlying Attention item remains unchanged.
- **Failed:** a known rejection prevented confirmed delivery. Inspect the configuration before retry.
- **Uncertain:** a send may have happened, but Bazilion lacks confirmation. Explicit retry requires
  accepting the possibility of a duplicate message; Telegram has no sender-controlled idempotency key.
- **Suppressed:** the source, selected kind, configuration, policy or captured destination no longer
  permits the notice, or the record represents excluded historical work.

Refresh receipts to see current outcomes. A retry rechecks the original source and destination;
changing the destination does not redirect an old uncertain notice to another chat. Disabling or
revoking pairing prevents pending sends. With Team Policy enforcement enabled, only an allowed
Agent-to-user egress edge permits a notice. Denied and approval-required edges suppress it without
creating another approval. Clarification answers and notifications grant no permissions.

The pump uses bounded batches and the existing Telegram pacing queue. A known 429 can retry once
with a delay of at most 30 seconds. Ambiguous failures do not automatically retry. Notification
errors remain in settings/receipt metadata and never create recursive Attention items. Agent-topic
error mirrors lack reliable Attention source receipt correlation, so they may intentionally report
the same failure independently.

## CLI controls

The CLI uses the same daemon endpoints and optimistic revisions:

```sh
bazilion notification settings
bazilion notification configure --enable --destination-id <id-from-settings>
bazilion notification configure --kinds review_failure,trigger_failure --timezone Europe/Warsaw --quiet-start 22:00 --quiet-end 07:00
bazilion notification preview --kinds review_failure,trigger_failure
bazilion notification configure --include-open-preview <preview-id>
bazilion notification list --limit 50
bazilion notification show <receipt-id>
bazilion notification retry <receipt-id> --acknowledge-possible-duplicate
bazilion notification configure --clear-quiet-hours
bazilion notification configure --disable
```

Preview kinds must match the saved selection submitted with confirmation. When changing them at
confirmation, pass the same `--kinds` list to `configure`. Receipt lists return `nextCursor`; pass it
as `notification list --cursor <id>` for another bounded page. `configure --expected-revision <n>`
can bind scripted changes to an earlier observation. Refresh after a conflict instead of silently
substituting a new destination or preview.

## Restart, restore and retention

Ordinary restart preserves confirmed receipts and marks interrupted sends uncertain. Restoring a
backup is different: Telegram can retain messages newer than that snapshot. Notifications resume
**paused**, with saved pending notices suppressed. Explicit re-enable defaults to a new cutoff.
Including old open items requires a preview with a possible-duplicate explanation; the backup cannot
prove what Telegram received after its capture.

Receipts contain source/destination identity, timestamps, attempt state, fixed diagnostics and known
message IDs, without source payloads or bot credentials. Up to 100,000 deduplication keys are retained
per home. At capacity, new admission stops visibly while existing admitted notices can still finish;
confirmed keys are not evicted to create accidental resends. The alpha schema changes follow the
existing clean-install contract and are included in canonical backup validation.

## Repeatable local demonstration

Run `node --import tsx scripts/demo-notifications.mts` from the repository. The script creates a
fresh temporary home and prints its loopback daemon URL and an owner-only file containing a
temporary browser device credential. Start the web UI with `BAZILION_DAEMON` set to that URL, then
log in with that fixture credential and open **Configuration → Integrations → Telegram**.

Enable notifications and verify that the two old review failures are not sent. Preview and include
them explicitly: one delivers, and the other simulates an ambiguous timeout. Inspect the receipt,
confirm its possible-duplicate retry, and refresh receipts to see delivery. Reload to verify saved
settings; repeat at a narrow width using keyboard controls. Quiet hours can be configured normally.
The bot and preflight are simulated, and the fixture blocks Telegram configuration mutations.
Stop the script with Ctrl-C; the temporary home is retained for inspection.
