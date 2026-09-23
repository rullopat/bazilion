---
'bazilion': patch
---

Worker turns exit immediately when their work is done. A lingering post-turn handle kept the worker
process alive for about thirty seconds, so a scheduled or inbox wake held its Team's exclusive
workspace lease long after finishing and every interleaved turn on that Team failed with
`workspace_busy` until the process finally exited. Found by the content-Team acceptance harness
(BAZ-064); the success path now exits explicitly once the session is disposed and IPC is disconnected,
matching the error path.
