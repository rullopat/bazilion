---
'bazilion': patch
'@bazilion/client': patch
'@bazilion/api-types': patch
---

BAZ-051: failure-mode visibility audit — no recoverable failure may stay silent. New Attention kind `queue_interrupted`: after a daemon restart interrupts queue processing, the affected Agent's paused queue now appears in the Attention Center (action required, naming the uncertain count) instead of silently buffering messages until someone noticed. A failed OpenAI ChatGPT OAuth refresh now surfaces an actionable re-login error instead of the raw upstream failure. The remaining failure modes (provider outage mid-turn, bounded trigger retries, Telegram delivery failures, loop breaches, failed backups) are pinned by deterministic fault-injection tests asserting the operator-visible surface.
