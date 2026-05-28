-- Per-group Telegram forum-topic name template.
--
-- NULL (default): bazilion composes topic names the built-in way — bare
--   agent.name for the `default` group, "<group.slug> › <agent.name>" for every
--   other group (see lib/telegram/naming.ts:topicNameFor).
-- Non-NULL: an explicit template rendered with the tokens {agent.name},
--   {group.name}, {group.slug}. Must contain {agent.name} so each agent in the
--   group still gets a distinct topic title. Validated on write
--   (lib/telegram/naming.ts:validateTopicNameFormat).
--
-- Changing the template re-renders every bound, non-locked topic in the group
-- via editForumTopic (lib/telegram/topic-rename.ts:syncGroupTopicNames). Topics
-- a human has renamed (telegram_topic_name_locked = 1) are left untouched.

ALTER TABLE groups ADD COLUMN telegram_topic_name_format TEXT;
