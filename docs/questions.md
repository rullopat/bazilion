# Agent questions

During a turn you started and are watching (a web chat, `bazilion agent chat` in a terminal, or a
Telegram message), an Agent can stop and ask you one question with two to four choices through its
`ask_user` tool. It waits up to five
minutes. You pick a choice, write your own answer, or skip; the first answer from any surface wins
and the turn continues. Without an answer the Agent carries on knowing it got none. The question
and its outcome stay in the conversation transcript.

An answer is information only: it grants no shell or communication permission. Do not answer a
question with credentials; put those in the configuration.

Turns nobody is watching (scheduled triggers, inbox wake-ups, queued web messages, piped CLI
chats, reviews) do not get the tool.

## Answering

- **Web:** the question appears under the chat. Choose an option or **Other**, then
  **Send answer**, or **Skip**.
- **Terminal chat:** `bazilion agent chat` prompts for a number, `o` for your own text or `s` to
  skip. Blank input picks nothing.
- **CLI, from another terminal:**

  ```sh
  bazilion question list <agent>
  bazilion question answer <agent> <question-id> --choice 2
  bazilion question answer <agent> <question-id> --text 'Use CSV'
  bazilion question answer <agent> <question-id> --skip
  ```

- **Telegram:** when the Agent has a topic, the question is posted there with one button per
  choice and **Skip**. Tap a button, or reply to the question message with your own answer.

Waiting questions live only in the daemon's memory: restarting the daemon or cancelling the turn
ends them without an answer.
