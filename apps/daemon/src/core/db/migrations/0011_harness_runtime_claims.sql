ALTER TABLE messages ADD COLUMN policy_claimed_at INTEGER;
ALTER TABLE messages ADD COLUMN policy_delivered_at INTEGER;

CREATE INDEX messages_policy_delivery_queue
  ON messages(to_agent_id, policy_disposition, read_at, policy_claimed_at, created_at);
