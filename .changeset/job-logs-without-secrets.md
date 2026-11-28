---
"bazilion": minor
---

**Background job logs without secrets.** A background job's output now reaches its `output.log` through the daemon with the saved API keys and the Agent's own secrets replaced by `[REDACTED]`, as a command's output in a turn is, so the file in the home never holds them, even when a value is printed in two pieces. Output that waits for an answer, such as a prompt, shows at once: the turn's output and the job's hold back only an ending that could be the start of a secret. A job ends when its command does; what a process it started in the background still prints is added afterwards.
