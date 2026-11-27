# Agent questions

During a turn you started and are watching (a web chat, `bazilion agent chat` in a terminal, or a
Telegram message), an Agent can stop and ask you through its `ask_user` tool, in one of two ways:

- **Questions:** one or more, in one card, each with two to four choices. A question can let you
  pick several. The Agent waits up to five minutes. For each question you pick, write your own
  answer, or skip it, and send the card; the first answer from any surface wins and the turn
  continues. Without an answer the Agent carries on knowing it got none.
- **Something only you can do:** a sign-in, a confirmation in your bank's app, a cable to plug in.
  The card says why, what to do, and may carry a link. It does not hold the turn: the Agent ends
  it, saying what it waits for. You answer **Done** or **Can't**, with a note if you like, when it
  suits you; that answer starts the Agent's next turn in the same conversation. A sign-in in the
  Agent's own browser needs it to show a window (`BROWSER_HEADLESS=false`) or your running Chrome
  ([browser research](browser-research.md)).

The card and its outcome stay in the conversation transcript. An open conversation in the web
shows a card the moment it is asked, wherever the turn started, and drops it once it is answered,
skipped, timed out or cancelled anywhere.

An answer is information only: it grants no shell or communication permission. Do not answer a
question with credentials: an Agent asks for those with `secret_request`
([below](#secrets-an-agent-asks-for)), and Bazilion's own keys go in the configuration.

Turns nobody is watching (scheduled triggers, inbox wake-ups, queued web messages, piped CLI
chats, reviews) do not get `ask_user` or `secret_request`. `secret_list`, which shows an Agent its
secrets' names, is in every turn.

## Answering

- **Web:** the card appears under the chat the moment it is asked, the Agent's line in the list
  says `Waiting for you: a question` (or `needs you to do something`), and it is the first item of
  **Attention**, with the time a question stops waiting. With desktop notifications on, the
  browser shows one when no Bazilion tab has the focus ([the workspace](workspace.md#live)). A
  card of one question answers with one click on a choice; in a card of several you pick for
  each, then **Send answers**, or **Skip all**. Your own words go in each question's field. An
  action has **Done** and **Can't** and a field for a note.
- **Terminal chat:** `bazilion agent chat` asks the card's questions one by one: a number (several,
  separated by spaces, where the question allows it), `o` for your own text or `s` to skip it.
  Blank input picks nothing. An action is printed with the command that answers it.
- **CLI, from another terminal:**

  ```sh
  bazilion question list <agent>
  bazilion question answer <agent> <question-id> --choice 2
  bazilion question answer <agent> <question-id> --text 'Use CSV'
  bazilion question answer <agent> <question-id> --answer 2 --answer 1,3 --answer 'Calm'  # one per question
  bazilion question answer <agent> <question-id> --skip
  bazilion question answer <agent> <action-id> --done --note 'Signed in'
  bazilion question answer <agent> <action-id> --cannot --note 'No access to that account'
  ```

- **Telegram:** when the Agent has a topic, each question of the card is posted there with one
  button per choice and **Skip**. A question that allows several choices has only **Skip**: reply
  to it with the numbers (`1 3`). Reply to a question's message with your own answer. The card is answered once
  every question is. An action is posted with **Done** and **Can't**.

Waiting questions and actions live only in the daemon's memory: restarting the daemon or
cancelling the turn ends a question without an answer, and an action the Agent waits on is
forgotten on a restart (it has no time limit otherwise), as is a waiting secret request.

## Secrets an Agent asks for

When an Agent needs a token or a password, `secret_request` asks for it by name
(`GITHUB_TOKEN`), with why, and optionally the hosts `web_fetch` may send it to. Like an action it
does not hold the turn. You answer when it suits you:

- **Web:** the card has a masked field with **Store**, and **Decline** with an optional note. The
  value goes to the daemon and is not shown again, here or to the Agent.
- **Telegram:** a message is not masked, so it says where to type the secret (a link to the chat
  when the web is published, else the command) and has **Decline**.
- **Terminal:** `bazilion agent secret set <agent> <NAME>` reads it without echo (`--from-file` for
  a key file); `bazilion question answer <agent> <id> --decline [--note …]` declines.

Storing it, from the card, the Agent's **Secrets** sheet or the CLI, answers the request: the
Agent's next turn is told **stored** or **declined**, never the value. The hosts the Agent asked
for are on the card and in the Telegram message; the sheet and the CLI give only the hosts you
type (`--hosts`), and the CLI says what the Agent asked for first. A reply to the Telegram message
is never passed on, and is deleted when the bot may delete messages. Each Agent's secrets are
encrypted in the `secrets` table and deleted with the Agent. Its commands get each as an
environment variable of its name (host and Docker); `web_fetch` puts it in a header written
`{{secret:NAME}}` only for its hosts and over https, and drops the Agent's headers on a redirect to
another site; the system prompt lists their names. Tool output (its details included) and the
turn's own message, such as a background job's end, are checked for the values, and for
Bazilion's credentials, before the model or the transcript gets them: the exact value, without its
ends' whitespace, each long line of a key file, and its JSON-escaped form. A stored value loses
the whitespace at its ends. The Agent's **Secrets** sheet
and `bazilion agent secret list|set|rm` list, add, replace and remove them. A name that Bazilion or
a command's process already uses (`PATH`, `OPENAI_API_KEY`, `BAZILION_*`) is refused.

This keeps the value out of the conversation; it is not a sandbox. A command can still send it
elsewhere or change it, and only the exact value is taken out of output. A Docker command has no
network, so there a token helps only local tools.
