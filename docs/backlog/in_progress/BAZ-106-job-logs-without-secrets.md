---
id: BAZ-106
title: "Background job logs without secrets"
status: in_progress
created: 2026-11-28
release: v0.67.0
---

# BAZ-106 — Background job logs without secrets

## Outcome

Asked for on 2026-11-28 for 0.67.0. Since 0.66.0 a command's output reaches the turn, and Pi's
file for a long output, with secrets taken out. A background job's output did not: the command
wrote straight to `agents/<id>/jobs/<job-id>/output.log`, so a key it printed stayed in the
home in plain text. Now the log never holds the values a turn takes out.

## As built

- `lib/jobs.ts`: a job's stdout and stderr come to the daemon through pipes and go to
  `output.log` through `ExactValueStreamRedactor` as a stream, bytes as latin1 so nothing is
  decoded and a value split between two chunks is still found. A job that prints faster than the
  disk takes waits for it; the daemon does not (300 MB of output: no pause over 2 ms).
- The end of the output (the end wake, `job_output`, the web and CLI) is read from the end of the
  log only, not the whole file.
- The values are the turn's own: the credentials in the turn's environment
  (`envSecretValues`) and every form of the Agent's secrets (`secretForms`), from
  `lib/agent-turn.ts`.
- The redactor now holds back only an end that could be the start of a value, not as many
  characters as the longest one. A prompt waiting for an answer ("Name? ") shows at once, in a
  job and in a turn's streamed command output alike.
- A job ends when its command does. If a process it started in the background still holds its
  output, the end waits the stop grace (3 s) for the last output, then comes; what that process
  prints later is still added to the log, and the start of a value stays held back until the
  output closes.
- Tests: `test/lib/jobs.test.ts` prints a secret whole and in two pieces with a pause between,
  then waits on a prompt; the log on disk has `[REDACTED]` and the prompt shows before its input.
  Another prints one in two pieces from a process left running, around the job's end.
  `test/runtime/worker-runtime.test.ts` checks what the redactor holds back.

## Limits

- Logs written before 0.67.0 keep what they hold; delete `agents/<id>/jobs/` to clear them.
- A secret that changes during a job (a token refreshed meanwhile) is not taken out of it.
- Output that ends with the first characters of a secret waits for the next output or the end.
