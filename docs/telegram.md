# Telegram

Talk to your Agents from Telegram. One bot long-polls one private forum supergroup: the
**⚙ bazilion** service topic takes commands, and every Agent gets its own topic where messages
become Agent turns and the replies come back. The daemon does not need to be reachable from the
internet.

## Set up

1. Create a bot with BotFather (`/newbot`). Turn Privacy Mode off: `/mybots` → your bot →
   **Bot Settings → Group Privacy → Turn off**.
2. Create a supergroup, enable **Topics** in its settings, add the bot and make it an admin with
   the **Manage topics** permission.
3. Save the bot token and the supergroup chat id (`-100…`) on the web page
   `/config/integrations/telegram`, or with
   `bazilion telegram config set --token <token> --chat <id>`.
4. Run the setup checks: **run preflight** on the web page, or `bazilion telegram health`. The bot
   starts by itself, creates the service topic and pins an Agent directory there.
5. Pair yourself as the owner: create a one-time code on the web page or with
   `bazilion telegram pairing create`, then send `/pair <code>` in the service topic within ten
   minutes. Until then the bot answers nobody.

`bazilion telegram bot status` shows the polling state; **restart bot** on the web page or
`bazilion telegram bot restart` restarts it. Disconnecting (clearing the credentials, or
`bazilion telegram config clear`) stops the bot and everything it sends. When Telegram migrates the
group to a new chat id, the web page and `bazilion telegram reconnect` switch to it.

## Who can use the bot

The paired owner, plus the people the owner adds: `/allow <user id>` in Telegram, the allowlist
card on the web page, or `bazilion telegram allow <user id>`. Someone who is not on the list gets a
reply with their user id to pass on. `/deny`, `/allowed` and `bazilion telegram deny|allowed`
manage the list. Everyone on the list can chat with Agents, answer their questions and run the
commands; only the owner can `/allow` and `/deny`. Removing someone also cancels the messages they
still have waiting in a queue; resetting the pairing or clearing the credentials does so for
everyone. Anyone else in the group can still read the topics, so keep the group to people you
trust. Messages from other bots and from anonymous admins are ignored.

Everyone on the list drives Agents with your rights: with `BAZILION_BASH_SANDBOX=off` (the default)
their messages can run commands on the host as the daemon's user. Set it to `docker`, and
`BAZILION_BASH_APPROVAL=dangerous` so Telegram turns auto-deny classified commands, before you
allow anyone else ([coding environments](coding-environments.md)).

## Service topic commands

- `/talk <agent>` opens (or creates) an Agent's topic; use `<team>/<agent>` when names clash.
- `/spawn` creates an Agent from a Profile (interactive, or `/spawn <profile> [name] [in <team>]`).
- `/spawn_team <template> [in <team>]` spawns a Team Template.
- `/list`, `/teams`, `/health`, `/whoami`, `/help`.

`bazilion telegram bind <agent>`, `unbind <agent>` and `list` do the binding from the CLI.

## In an Agent topic

Plain messages, photos and files go to the Agent's follow-up queue and run one turn at a time; a
👀 reaction shows the message was received. Photos reach the model as images; other files are
saved for the Agent to read (up to 20 MB). If a queued message fails, is cancelled or is
removed, the bot replies to it.

- `/queue` lists waiting messages; `/queue drop <n|all>` removes them.
- `/stop` cancels the running turn and, when messages are waiting, pauses the queue; `/resume`
  continues it.
- `/close` closes the topic, `/rebind <agent>` points it at another Agent, `/unbind` detaches it.

Replies, errors, images and delivered files are mirrored into the topic. An Agent's mirror mode
(`bazilion agent edit <id> --mirror minimal|verbose`, or the Agent page) adds short tool-call
lines in verbose mode; those are limited to 30 a minute per Agent.

When an Agent asks a question (see [questions](questions.md)), it appears in its topic with one
button per choice and **Skip**. Tap a button, or reply to the question message with your own
answer. The question can be answered on the web or in the CLI just as well; the first answer wins.

Topic names follow the Team (`bazilion team topic-format set <team> '<template>'`), and topic
icons follow the Profile or the Agent's `--topic-icon`. On iOS, topic links open the topic list
rather than the topic.

Telegram can also post new Attention items to the service topic; see
[attention notifications](attention-notifications.md).
