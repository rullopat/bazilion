---
'bazilion': patch
---

BAZ-050: UI consistency sweep of the post-hardening coding surfaces. Router-level defaults: every route now degrades to a calm recovery fallback (named failure, retry, safe exit — nothing substituted) on loader errors, and shows a marked loading state during navigation, instead of TanStack's default error screen and a blank area. Surface-named error components on the 18 coding-sequence routes that lacked them. Cancel-verification now requires a confirmation stating the consequence. apps/web is now typechecked by the root typecheck (it was excluded — a pre-existing type error sat in main). New browser-acceptance walk (scripts/check-coding-surfaces-ui.mjs) covers desktop/narrow overflow, empty states, and a real daemon-kill error-state walk with evidence screenshots.
