---
id: BAZ-107
title: "Search posts on X"
status: in_progress
created: 2026-11-28
release: v0.67.0
---

# BAZ-107 — Search posts on X

## Outcome

Asked for on 2026-11-28 for 0.67.0, from the OpenClaw comparison (BAZ-093). An Agent finds what
people say on X: an account's posts, reactions to news, what is being said now. It does this
through xAI, with the xAI key already saved for Grok, so nothing new needs setting up.

## As built

- `x_search` (`runtime/tools/x-search.ts`): a query, `handles` or `exclude_handles`, `from`/`to`
  days. The Agent gets xAI's answer, the numbered links of the posts it cites and how many posts
  it read.
- `lib/x-search.ts`: the daemon calls `POST https://api.x.ai/v1/responses` with the `x_search`
  tool (`allowed_x_handles`, `excluded_x_handles`, `from_date`, `to_date`), so the key stays in
  the daemon. The answer is the `output_text` parts, the posts their `url_citation` annotations,
  the count `usage.server_side_tool_usage_details.x_posts_fetched`.
- What xAI would ignore without saying so (a date in another form) or refuse (both handle lists)
  is refused first, with the reason.
- A turn has it while `XAI_API_KEY` is saved, unless **Posts on X** on the **Web search** card
  is off (`BAZILION_X_SEARCH`). The model is `grok-4.7` (the newest in Pi's catalog), or
  **X search model** (`BAZILION_X_SEARCH_MODEL`).
- The chat shows it as "Searched X for …"; `/context` counts it.
- Tests: `test/lib/x-search.test.ts`, against a stand-in for xAI's answer.

## Limits

- xAI bills by the posts it reads, $5 per 1,000 as of 2026-09-21, plus the model's tokens.
- Not checked against xAI itself: there is no xAI key in the tests. xAI's docs show `grok-4.7`;
  which other models take the tool, they do not say.
- No image or video understanding of the posts (`enable_image_understanding` and
  `enable_video_understanding` are left off).
- No deadline of its own: a search ends when xAI answers or the turn is stopped.
