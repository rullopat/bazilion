-- Per-user Telegram allowlist (Phase 7).
--
-- Bootstrap model: TOFU (trust-on-first-use). While this table is empty the
-- bot is open; the first user to message it is auto-added as 'owner' and
-- enforcement begins immediately after. Scope: FLAT — an allowlisted user can
-- do everything (commands + agent chat); anyone not on the list is ignored.
--
-- role: 'owner' can manage the allowlist (/allow, /deny) and cannot be removed;
-- 'member' can use the bot but not manage who else can. At least one owner must
-- always remain (enforced in the repo + routes).

CREATE TABLE IF NOT EXISTS telegram_allowed_users (
  user_id   INTEGER PRIMARY KEY,
  username  TEXT,
  label     TEXT,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  added_at  INTEGER NOT NULL
);
