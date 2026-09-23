# First content-Team platform: Mastodon

**Decision: 2026-09-20.** Use **Mastodon only** for BAZ-064/065/066's first acceptance campaign.
The operator asked to reduce access friction and delegated the platform choice. This replaces the
previous three-platform manual-handoff scope; Facebook, Instagram and LinkedIn are deferred, not
additional gates. Topic and purpose remain generic inputs. No account, grant, post or integration
has been created by this research.

## Why this choice

This is a practical first-test choice, not a claim that every Mastodon server is easier to join than
any other network. It covers text plus generated images in a normal web composer and has a relatively
small documented path for possible later API qualification:

- Applications can be registered on the selected server; a user authorizes the requested scopes.
  The documented flow does not require a centralized developer-app review programme. The server's
  registration policy, account eligibility and rules still apply; confirm them before a live test.
- `POST /api/v2/media` accepts the actual file as multipart data with a user token and `write:media`.
  No externally hosted image URL or public Bazilion listener is needed for this upload flow.
- `POST /api/v1/statuses` takes text and media IDs with a user token and `write:statuses`, returning
  a status rather than requiring an Agent to click a logged-in browser.
- Scoped user credentials, observable status IDs and documented idempotency behavior are useful for
  a later bounded acceptance experiment. They do not implement Bazilion's approval boundary.

**Manual handoff does not require any platform API access.** LinkedIn's API-access difficulty is not
an obstacle to manually uploading content there. Mastodon reduces the *future integration* hurdle and
keeps the first campaign to one format/account, rather than proving three platform adaptations at once.

Bluesky is a credible alternative: its official quickstart documents session creation and posting,
and its post guide documents blob uploads/image embeds. Mastodon is preferred here for explicit
posting/media scopes and documented status visibility/idempotency controls. Neither a live signup nor
a live post was tested, so this is documentation-based selection, not account-access qualification.

## First campaign contract

1. Use two different operator-selected topics on the **same platform**, not two platforms. One final
   post per cycle, with one image sufficient for the basic fixture. Two actual cron preparation cycles,
   text/concept approval before images, image rework and final approval remain required.
2. Deliver copy-ready text, approved image bytes, suggested alt text for user review, source references,
   intended time/timezone and manual composer instructions. Check the chosen server's current text/
   media limits; do not hardcode a universal limit or silently change approved bytes to fit.
3. Manual handoff needs no API token. For an observed UI rehearsal, the operator selects a dedicated
   account/server whose rules permit the topic and any generated/automated content. The operator can
   inspect a draft without submitting it. Clicking Post is a separate external-publication decision;
   a screenshot, draft or export is not a remote publication receipt.
4. Record intended visibility explicitly if a real post is later authorized. Unlisted/followers-only
   settings are not a private sandbox or encryption; server operators and authorized recipients may
   see the content, and uploaded media can be externally accessible. Use no confidential test data.
5. Requests for another platform are explained as outside this first campaign, not silently substituted
   or reported as qualified. Future multi-platform checks may extend the same parameterized recipe.

## Direct publication remains separate

Bazilion does **not** gain a Mastodon publishing capability by choosing it for manual handoff.
The shared approval/delivery contract remains BAZ-060. A Mastodon adapter needs separately scoped
implementation/refinement before PUB-01–06 can qualify it; BAZ-061/062 concern other platforms and
cannot provide that evidence. Do not add publisher work to BAZ-064/065/066 or claim a connector pass.

Future refinement must preserve daemon-owned credentials, exact final approval before media upload,
validated server/account identity, minimum scopes, rate/format/processing limits, independent receipts
and safe interrupted-operation reconciliation. Never put a posting token in Agent shell/MCP/browser
access. API documentation samples are not credential-handling instructions for Bazilion.

Mastodon's status `Idempotency-Key` is documented as retained **up to one hour**: it is not permanent
exactly-once delivery and does not automatically deduplicate media uploads. Its `scheduled_at` returns
a scheduled-status object, not proof of publication. Do not introduce competing platform and daemon
schedules; existing Agent cron is only preparation. API availability does not authorize spend or posting.

## Sources consulted

Public documentation was fetched on 2026-09-20, without credentials or side-effecting API calls:

- [Mastodon application registration](https://docs.joinmastodon.org/client/token/)
- [Mastodon user authorization and granular scopes](https://docs.joinmastodon.org/client/authorized/)
- [Mastodon media upload](https://docs.joinmastodon.org/methods/media/)
- [Mastodon status creation, visibility and idempotency](https://docs.joinmastodon.org/methods/statuses/)
- [Bluesky official quickstart source](https://github.com/bluesky-social/bsky-docs/blob/fd3d7f8bae5b5fb407afd715bc3cc06e1fafc1ee/docs/get-started.mdx)
- [Bluesky official post/image guide source](https://github.com/bluesky-social/bsky-docs/blob/fd3d7f8bae5b5fb407afd715bc3cc06e1fafc1ee/docs/advanced-guides/posts.md)

The Bluesky documentation-site fetch did not yield usable page text; the comparison used its official
source repository instead. This note records the selection, not live compatibility or a universal API
limit comparison. Recheck actual server/API behavior before implementation and authorized execution.

See [BAZ-064](../in_progress/BAZ-064-content-team-recipe-and-manual-handoff.md) and
[the composed protocol](../../testing/beta-readiness/content-team-acceptance.md).
