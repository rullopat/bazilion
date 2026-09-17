-- BAZ-055 slice 2: one-paste pairing setup codes.
--
-- A pairing token is a short-lived, single-use secret that admits exactly one
-- device-credential exchange (OpenClaw's bootstrap-token ≠ device-credential
-- model). It is NOT an API credential: exchange happens once, then the row is
-- burned. Separate table rather than a new web_tokens.kind — the kind CHECK
-- constraint would require a table rebuild, and pairing tokens have no
-- web_sessions or audit surface of their own.
CREATE TABLE web_pairing_tokens (
  id               TEXT PRIMARY KEY,
  token_hash       TEXT NOT NULL UNIQUE,
  scopes           TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  used_at          INTEGER,
  used_by_token_id TEXT
);
CREATE INDEX web_pairing_tokens_active ON web_pairing_tokens(token_hash) WHERE used_at IS NULL;
