-- 0.66.0: reviewed learning is removed (BAZ-103). Before this runs, the daemon reads each Agent's
-- approved private lessons and, once the upgrade has succeeded, adds them to its AGENTS.md
-- (lib/approved-lessons.ts). Shared lessons stay where they are, notes in the Team's memory.
DROP TABLE agent_lesson_proposals;
DROP TABLE agent_reviews;
ALTER TABLE agents DROP COLUMN review_enabled;
ALTER TABLE agents DROP COLUMN review_every_n_turns;
ALTER TABLE agents DROP COLUMN review_model;
ALTER TABLE agents DROP COLUMN review_reasoning_level;
ALTER TABLE agents DROP COLUMN review_turns_since_last;
-- Its two kinds of Attention item go from the notification settings and the records of them.
UPDATE notification_settings SET kinds_json = (
  SELECT json_group_array(value) FROM json_each(notification_settings.kinds_json)
  WHERE value NOT IN ('lesson_proposal', 'review_failure')
);
DELETE FROM attention_acknowledgements WHERE source_kind IN ('lesson_proposal', 'review_failure');
DELETE FROM attention_notified WHERE source_kind IN ('lesson_proposal', 'review_failure');
