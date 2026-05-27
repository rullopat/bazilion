-- Per-agent Telegram outbound-mirror verbosity.
--
-- 'minimal' (default): mirror only the assistant's final message text to
--                      the agent's bound forum topic. Cleanest conversation
--                      feel; what most operators want.
-- 'verbose':           also mirror short tool-call summary lines so the
--                      topic shows the agent's reasoning steps. Helpful
--                      while iterating on a misbehaving agent; noisy in
--                      steady state.
--
-- The column has no effect on agents without a bound topic. Step 6 picks
-- the value up when materializing each ChatFrame; Step 7's CLI + web UI
-- surfaces let operators flip it per-agent.

ALTER TABLE agents
  ADD COLUMN telegram_mirror_mode TEXT NOT NULL DEFAULT 'minimal'
  CHECK (telegram_mirror_mode IN ('minimal','verbose'));
