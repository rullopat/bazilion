---
'bazilion': minor
'@bazilion/api-types': minor
---

Make scheduled triggers durable across agent contention, retries, and daemon restarts. Add
coalesced dispatch persistence, bounded retry with lease recovery, API and CLI diagnostics, and
recent dispatch status in the web UI. Provider errors now enter the retry state machine, while
approval-gated occurrences remain pending until a durable grant is executed by the scheduler.
