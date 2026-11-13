# Follow-up queue

A message sent while an Agent is busy is not lost: it waits in the Agent's follow-up queue and runs
as its own turn when the Agent is free, oldest first, in the conversation it was sent to. Follow-ups
queued from the web or the CLI run without anyone watching: they cannot ask questions, and shell
commands that need approval are denied. Telegram follow-ups ask their questions in their topic.

## Web

While the Agent runs a turn, **Send** becomes **Queue follow-up**; a message sent while a turn from
elsewhere runs (Telegram, a schedule, another tab, a follow-up) is queued too. **Stop** appears
while the Agent runs a turn, whichever started it, and cancels that turn; a turn started elsewhere
shows up within about ten seconds. If follow-ups are waiting, Stop also pauses the queue, so they
do not start right away; resume it when you want them to run.

The **Follow-ups** panel above the composer appears while follow-ups wait, run or have failed, and
while the queue is paused:

- **Edit** changes the text of a waiting follow-up (its attachments stay); **Remove** deletes one
  that is not running.
- **Pause queue** keeps waiting follow-ups from starting; **Resume queue** starts them again.
- When a follow-up finishes, the chat reloads to show its reply. **View conversation** opens the
  conversation it ran in.

The chat checks the queue when it opens, after each of its own turns, when the conversation shows
activity from elsewhere, and every 5 seconds while a follow-up waits or another turn runs.

## CLI

```sh
bazilion queue list <agent>                     # waiting, running and failed, and turnActive
bazilion queue add <agent> --message 'Review the next section' [--file ./report.txt] [--image ./chart.png]
bazilion queue edit <agent> <item> --message 'Revised request'   # text only; attachments stay
bazilion queue remove <agent> <item>
bazilion queue pause <agent>
bazilion queue resume <agent>
bazilion agent cancel <agent>                   # Stop: pauses the queue when follow-ups wait
```

## Telegram

Messages in a bound Agent topic go through the same queue; a message Telegram delivers twice is
queued once. `/queue` lists waiting messages, `/queue drop <n|all>` removes them, `/stop` cancels
the running turn (and pauses the queue when messages wait) and `/resume` resumes it. A queued
message that fails, is cancelled or is removed gets a short reply in the topic.

## Restarts and limits

- A follow-up that was running when the daemon stopped is marked failed and not run again, and the
  Agent's queue is paused; **Attention** shows it until you resume.
- Restoring a backup behaves like a restart at the moment the backup was taken: follow-ups still
  waiting in the backup run again, even if they already ran after the backup was made.
- Up to 20 waiting or running follow-ups per Agent, 64 KiB of text and 16 attachments (25 MiB) each,
  and 256 MiB of follow-up attachments in total. Follow-ups that ran, failed or were cancelled count
  towards that total until they are deleted, seven days after they ended.
