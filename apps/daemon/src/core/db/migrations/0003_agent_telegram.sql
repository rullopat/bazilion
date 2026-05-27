-- Telegram integration columns. Step 1 of the docs/telegram.md plan adds the
-- schema only; the bot singleton, polling loop, and routing helpers land in
-- subsequent steps. None of these columns are populated yet — they sit empty
-- until the live bot in Step 2 starts persisting topic ids on first traffic.
--
-- agents.telegram_topic_id        — forum-topic message_thread_id; one topic per
--                                   agent. Partial unique index below allows
--                                   multiple NULLs (unbound agents) but enforces
--                                   one-to-one once an id is written.
-- agents.telegram_topic_name_locked — sticky bit set when a human renames the
--                                   topic in Telegram; once set, bazilion stops
--                                   propagating agent/group renames to that topic.
-- agents.telegram_icon_emoji      — per-agent override of the profile-derived
--                                   custom-emoji sticker id. Lookup at topic
--                                   creation: agents.* → profiles.* → null.
--                                   Survives topic delete + recreate, unlike
--                                   a customization that only lived in Telegram.
-- groups.telegram_icon_color      — Telegram's 6-color enum slot allocated to
--                                   this group on first-traffic. Red is reserved
--                                   for the service chat, so groups round-robin
--                                   over the remaining 5.
-- profiles.telegram_icon_emoji    — curated default sticker id from
--                                   getForumTopicIconStickers, per built-in
--                                   profile. Seeded for built-ins, NULL for
--                                   custom profiles (which render color-only).

ALTER TABLE agents ADD COLUMN telegram_topic_id INTEGER;
ALTER TABLE agents ADD COLUMN telegram_topic_name_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN telegram_icon_emoji TEXT;

ALTER TABLE groups ADD COLUMN telegram_icon_color INTEGER;

ALTER TABLE profiles ADD COLUMN telegram_icon_emoji TEXT;

-- Partial unique index: enforces one-to-one mapping between agents and topic
-- ids without blocking many unbound agents (SQLite treats NULLs as distinct
-- in unique indexes, but being explicit avoids surprise if that ever changes).
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_telegram_topic_id
  ON agents(telegram_topic_id)
  WHERE telegram_topic_id IS NOT NULL;
