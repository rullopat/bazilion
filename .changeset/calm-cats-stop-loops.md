---
'bazilion': minor
'@bazilion/client': minor
'@bazilion/api-types': minor
---

Add a durable agent-message loop circuit breaker. Messages now retain causal
chain and hop metadata, inbox wake turns propagate that ancestry even when an
Agent omits `reply_to`, and the daemon rejects over-budget sends before they can
wake another LLM turn. Configure the ceiling with
`BAZILION_AGENT_LOOP_MAX_HOPS`; inspect payload-free stop events through the
Agent API, `bazilion inbox loop-breaks`, or the web inbox.
