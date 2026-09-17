-- BAZ-055: per-device authorization scopes on web tokens.
--
-- First forward migration after the BAZ-047 stable-schema contract. The
-- DEFAULT backfills every existing row (bootstrap and device) with the full
-- scope set, so the upgrade is behavior-preserving: pre-055 credentials keep
-- exactly the access they had. The bootstrap token also holds all scopes
-- implicitly in the authz layer (single-operator model, unchanged).
ALTER TABLE web_tokens ADD COLUMN scopes TEXT NOT NULL DEFAULT 'read write approvals admin';
