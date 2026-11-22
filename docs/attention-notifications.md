# Attention and notifications

**Attention** lists what needs you. First what an Agent is waiting on right now: a
[question](questions.md) it asked (`agent_question`) and a command it wants approved
(`command_approval`), soonest to expire first, each with the time it stops waiting. Then lesson
proposals waiting for a decision, failed or cancelled reviews, scheduled triggers that failed,
Agent message loops that were stopped, and Agent queues paused after a daemon restart.

It is the **Attention** page of the web UI, which says how much is open, filters by state, kind
and severity, links each item to where it is dealt with (**Answer** and **Decide** open the
Agent's conversation) and keeps itself current; and `bazilion attention list|summary`. The top
bar's **Attention** shows how many items are open and stays current on every page, and the
browser tab counts the ones waiting for you. Failures and loop breaks can be acknowledged
(`bazilion attention acknowledge <key> --yes`, or `acknowledge-all`); questions, commands,
proposals and paused queues leave the list when you act on them, and a question or a command also
leaves it when it stops waiting.

Questions and commands live in the daemon's memory while their turn waits, so a daemon restart
ends them; they are never acknowledged and never sent as Attention notifications. They reach you
in other ways: every question is posted in the Agent's Telegram topic, a command still waiting
after half a minute too (see [questions](questions.md) and
[coding environments](coding-environments.md)), and the web UI can show a desktop notification
when Bazilion is in the background ([the workspace](workspace.md#live)).

## Telegram notifications

Bazilion can post new Attention items to the [Telegram](telegram.md) bot's service topic, so they
reach your phone. This is off by default. Each new open item of a selected kind is sent once, with
its title, Agent and Team. When the web UI is published at `BAZILION_PUBLIC_ORIGIN` the notice
links to the item; otherwise open **Attention** in the web UI. A notice resolves nothing.

### Configure

On the web: **Attention notifications** under **Setup → Telegram** (`/config/telegram`). Switch
it on, pick the kinds, optionally set quiet hours, and save. From the CLI:

```sh
bazilion notification settings
bazilion notification configure --enable
bazilion notification configure --kinds review_failure,trigger_failure
bazilion notification configure --quiet-start 22:00 --quiet-end 07:00 --timezone Europe/Warsaw
bazilion notification configure --clear-quiet-hours
bazilion notification configure --disable
```

### How sending works

- Items that were already open when you switch notifications on are not sent; only items that
  open or change afterwards are.
- During quiet hours (start inclusive, end exclusive, in the given IANA timezone; overnight
  windows work) nothing is sent; waiting notices go out when quiet hours end.
- The daemon checks every 30 seconds and sends at most 10 notices per check. Nothing is sent while
  the bot is stopped. A notice that fails to send is tried again on the next check.
- An item that is resolved and later opens again is sent again. A notice cut off by a daemon
  restart can arrive twice, and restoring a backup repeats notices sent after the backup was taken
  for items that are still open.
