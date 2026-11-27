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
question with credentials; put those in the configuration.

Turns nobody is watching (scheduled triggers, inbox wake-ups, queued web messages, piped CLI
chats, reviews) do not get the tool.

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
forgotten on a restart (it has no time limit otherwise).
