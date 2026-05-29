-- Backfill USER.md content into pre-existing groups.
--
-- Before this BAZ, groups.user_md was born as '' and stayed empty unless an
-- operator hand-edited it, so the "About the User" section of every system
-- prompt was generic boilerplate. New groups now seed DEFAULT_USER_MD at
-- insert time (core/repos/groups.ts); this one-shot UPDATE gives the same
-- starter content to groups that already exist with an empty user_md.
--
-- The literal below MUST be kept in sync with DEFAULT_USER_MD in
-- core/profile/templates.ts — SQL can't import it. Two copies, one source of
-- truth; flag in review if they drift.
--
-- Tradeoff: the column can't distinguish "never set"
-- from "explicitly cleared", so an operator who deliberately set user_md to ''
-- sees it replaced. bazilion is alpha; the upside (every install gets the new
-- template) beats the downside (a power-user re-clears one file). Idempotent:
-- the WHERE clause matches nothing once every row is non-empty.

UPDATE groups SET user_md = '# USER.md — About Your Human

_Learn about the person you''re helping. Update via `user_md_write` as you go
(read with `user_md_get` first for the etag)._

- **Name:**
- **What to call them:**
- **Pronouns:** _(optional)_
- **Timezone:**
- **Notes:**

## Context

_(What do they care about? What projects are they working on? What''s their
working style? Build this picture over time, a little each session.)_

---

The more you know, the better you can help. But remember — you''re learning
about a person, not building a dossier. Respect the difference.
' WHERE user_md = '';
