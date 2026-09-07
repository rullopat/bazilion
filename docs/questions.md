# Agent questions

An Agent in an interactive web, terminal, or paired-owner Telegram conversation can ask one
question with two to four choices. Select a choice, enter **Other**, or explicitly **Skip**.
A recommendation is never selected for you. An answer supplies information; it grants no shell
or communication permission. Use configuration for credentials, never a question answer.

## Answering and checking progress

The web chat shows the question's conversation, deadline, answer and continuation status.
Reloading recovers a pending question while its original worker remains alive. Another supported
client can answer the same question; only the first accepted answer settles it. If acknowledgement
is lost, the web card retains the exact request for retry. Do not change the answer and treat that
as a retry. Recent settled questions are available under **Recent question outcomes**.

Terminal chat uses its existing prompt: enter a choice number, `o` for Other, or `s` to Skip.
Blank input does not choose a default. Piped chat does not offer a live question prompt.
You can inspect or answer an existing question through the CLI:

```sh
bazilion question list <agent-id>
bazilion question list <agent-id> --conversation <conversation-id>
bazilion question show <agent-id> <question-id>
bazilion question answer <agent-id> <question-id> --choice 2
bazilion question answer <agent-id> <question-id> --text 'Use CSV'
bazilion question answer <agent-id> <question-id> --skip
```

Use exactly one answer flag. The command prints its request UUID and conversation ID before
submission. After a lost acknowledgement, inspect the question first; an exact retry uses those
original `--request-id` and `--conversation` values and the identical answer.

In Telegram, use the buttons in the final question message, reply directly to that message with
Other text, or send `/answer <question-id> <text>`. Earlier chunks of a long prompt cannot receive
answers. Unrelated topic text remains a normal queued message. Replies must come from the paired
owner in the original authorized topic. Stale or rebound buttons cannot answer another question.

Native mobile does not offer question controls. Its waiting notice links to the paired web
origin where supported; the browser uses its own login. Mobile-only turns, background schedules,
inbox wakeups and review turns do not receive this interactive tool.

## What the status means

- **Pending:** the original turn is waiting, normally for at most five minutes. A communication
  approval can hold delivery or an answer but does not extend this deadline.
- **Answered / skipped:** the daemon recorded the outcome. An answer held for communication
  approval has not yet been accepted or delivered to the Agent.
- **Consumed:** the daemon verified the matching result in the original conversation transcript.
  This confirms that the answer reached the conversation, not that the subsequent task succeeded.
- **Unconfirmed / interrupted:** acceptance lacks verified consumption, or the originating turn
  ended. Bazilion does not restart a worker or replay an answer to manufacture continuation.
- **Expired / cancelled:** the question is closed. Skip and expiry provide a typed no-answer
  outcome to a surviving waiter; cancelling the turn stops it.

Restart and restore close previous live questions. Revoked policy, membership or Telegram binding
also prevents settlement; content may become unavailable when access is revoked. Question records
are retained for seven days after settlement, subject to bounded storage. Canonical conversation
history retains the consumed question and outcome under its normal authorization checks.

## Repeatable local demo

Run `node --import tsx scripts/check-question-flow.mts` from the repository. It creates a disposable
home and loopback model simulator, runs real daemon/Pi workers, and verifies choice, Other and Skip
with persisted consumption. It sends no external model or Telegram traffic. The printed fixture
home is retained for inspection. Browser and terminal acceptance evidence is recorded in
[the release progress log](backlog/BAZ-035-038-progress.md).
