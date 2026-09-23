# Research → content → editorial approval → social publication

**Status:** native editorial/publication extension proposed; initial manual recipe slice noted below.
Requested 2026-09-19 against 0.21.0-beta.5. This is a real-world Team acceptance scenario as well as a feature sequence;
it does not authorize any live publication, paid generation or new release.

**Follow-up research:** the operator prefers specialized Agents/skills over mandatory native social
connectors. The [OpenClaw/Hermes documentation comparison](openclaw-hermes-content-workflow.md)
supports that direction and identifies existing image-generation patterns, including explicit Codex
auth routes. Treat the connector stories below as optional integration choices, not prerequisites
for the first research/content/review demonstration; preserve the final-approval execution boundary.

**0.22 milestone:** [BAZ-059](../in_progress/BAZ-059-pi-image-generation.md) implements Pi's two curated
OpenRouter image choices and, following the operator's expanded requirement, **direct OpenAI API-key
and ChatGPT/Codex login routes**. Automatic billing/authentication selection follows explicitly enabled OpenAI text providers;
manual image choices override it. Stored credentials alone and failures never cause fallback.
Live acceptance is pending. Protected-search expansion and automatic social publication remain out of scope.

**Acceptance refinement, 2026-09-20:** [BAZ-063](../draft/BAZ-063-content-team-real-world-acceptance.md)
and its [test protocol](../../testing/beta-readiness/content-team-acceptance.md) now define the required
broader-beta core: generic first-request brief and schedule, actual cron preparation, research/text/
images, human rework and approved manual handoff. Direct publication is a conditional extension.
Topic, purpose and audience come from the brief; two independently selected topics test reuse.
BAZ-063 is now the parent checklist: BAZ-064 owns recipe/deterministic handoff, BAZ-065 real cron/
recovery and BAZ-066 live/human qualification. The [first platform is now Mastodon](content-platform-first-test.md)
for manual handoff only; Meta/LinkedIn and multi-platform qualification are deferred. A Mastodon
publisher would need separate scoped implementation. This does not reopen BAZ-059.

**Initial implementation, 2026-09-20:** [BAZ-064's recipe](../../../examples/content-team/README.md)
and four management/policy checks exist locally; no composed journey has passed. Preflight confirms
protected source discovery is absent; [BAZ-067](../in_progress/BAZ-067-protected-web-discovery.md) records
separate capability work, refined 2026-09-20 (SearXNG first, daemon-owned IPC host). See [evidence and remaining work](../BAZ-064-acceptance.md).

## User outcome

An operator gives a Team a topic, audience, brand/voice guidance, languages, source constraints,
image budget and cadence. Agents research current information, develop original text and visuals,
and propose platform-specific posts. The operator previews the final variants and either requests
changes, rejects them, exports them for manual posting, or authorizes exact publications. Where
an account and official platform API allow it, Bazilion publishes approved content automatically
now or at the approved time and records what the host actually accepted.

**Automation means no additional manual copy/paste after approval. It does not mean bypassing
final approval.** Platform app consent and the operator's editorial decision are separate gates.

## Published beta.5 capability audit (before the unreleased BAZ-059 implementation)

| Need | Current implementation | Gap |
| --- | --- | --- |
| Collaborating researchers/writers/editors | Canonical Teams/Templates, directed Team Policy, messaging, shared memory and scheduled Agent triggers | A useful content-Team template and a tested end-to-end scenario, not a new roster or workflow engine. |
| Web research | `runtime/tools/web.ts`: `web_search` with Brave/SearXNG configuration, `web_fetch`; optional ordinary browser/MCP | Search needs configuration; protected workers intentionally have credential-free fetch only. No durable fact-checking/source-ledger guarantee from a prompt. |
| Platform-specific writing | Normal model turns, shared workspace and Agent documents | Explicit proposals/variants, captured sources and human review UI. The model cannot establish factual accuracy by assertion. |
| Image output | Tool image rendering, browser screenshots, MCP image responses, file generation and durable `deliver_file` | No first-party generative-image tool/service. Vision input and rendering images are not an image-generation integration. Scripts/MCP are an optional workaround, not supported managed generation. |
| Durable files | `agent_results` stores immutable captured bytes/hashes, authorization, previews, source links and deletion receipts | Reuse storage/provenance deliberately, including retention references; a file receipt is not an approved social post. |
| Human feedback | Chat, structured questions, communication approvals | No content-specific revision, change-request loop or approval tied to text + media + exact destination. A question answer grants no publishing permission. |
| Publication | Telegram delivery; BAZ-046 reviewed-code branch/PR publication | No social account connections or official Facebook/Instagram/LinkedIn publisher. Code review/publication types must not be repurposed as social posts. |
| Scheduling | Durable Agent triggers and domain-specific dispatch machinery | Triggering an Agent is not deterministic approved-post delivery. Needs its own bounded publication queue, not an autonomous publisher Agent. |

The current full Agent-turn runtime is Linux-only, including these non-coding tasks; this proposal
does not silently fix or bypass the deferred portable-safe-reads work in BAZ-057.

Inspected source anchors:
`apps/daemon/src/runtime/{tools/web.ts,pi/tools.ts}`, `apps/daemon/src/lib/approval-delivery-plan.ts`,
`apps/daemon/src/lib/mcp/{resolve,pool}.ts`, `apps/daemon/src/core/repos/results.ts`,
`packages/api-types/src/entities.ts`, [results](../../results.md), [publication](../../publication.md).

### The security gap a prompt cannot solve

Ordinary host-backed Agents can execute code; ordinary workers/stdio MCP integrations may receive
merged secrets. A logged-in browser or publisher MCP tool can also have posting authority. Merely
adding “wait for approval” to a system prompt does **not** enforce editorial approval.

The supported automatic-publication configuration must keep social credentials exclusively in
daemon-owned connection storage, outside merged worker/MCP environments and tool responses. The
content Team must use an enforced isolated posture with no host-secret filesystem access, logged-in
publishing browser or generic publisher MCP capability. This is a deployment/capability requirement,
not a claim that a local operator's host shell can be sandboxed by an application permission.

Protected workers currently lack search and image generation. Add narrowly bound daemon-hosted
research/image capabilities without reopening generic browser/MCP/environment access; keep
restricted code reviewers/verifiers unchanged. Tools request research, media and proposal creation;
there is **no agent-callable social publish tool**. Review daemon HTTP/bearer reachability from
isolated workers and every generic egress escape route as part of admission.

## Example Team and user journey

Use existing Team Templates, Profiles and directed policy:

- **Researcher:** retrieves sources, dates, claims and uncertainty; web content is untrusted data.
- **Writer:** makes original audience-specific Facebook/Instagram/LinkedIn variants, attribution and CTA.
- **Visual designer:** generates/selects visuals, crops before review, records provenance and alt text.
- **Editor/coordinator:** checks brand, evidence, dates, rights and platform constraints; submits a proposal.
- **Operator:** final decision maker. The deterministic daemon adapter publishes; it is not a fifth Agent.

Example: “Every Monday research practical home-energy savings in Italy. Propose one evidence-backed
post per connected platform in Italian; include an original illustration; no invented savings claims.
Never post before I approve.” The recurring trigger starts preparation only. It cannot approve or
silently roll approval from last week's content to this week's.

1. Configure brief, Team policy, search/image provider and explicit generation budget.
2. Team prepares a source-backed proposal with platform variants and captured assets.
3. Operator opens **Team → Content**: actual caption, asset/order/crop, alt text, attribution,
   destination identity, intended time/timezone and source links. Preview is approximate, not a claim
   of pixel-identical platform rendering.
4. **Request changes** carries persistent actionable feedback (e.g. “remove this unsupported claim;
   replace the image”). A new immutable revision links to its predecessor and shows the differences.
5. Operator approves selected variants for explicit destinations, either **Publish now** or
   **Approve and schedule**. Export for manual posting remains available when API access is absent.
6. The daemon validates current permissions/capabilities and sends the captured payload, with no
   model transformation during delivery. Each destination gets its own receipt and remote ID/link.
7. Partial success stays partial. A failed Instagram post does not republish an already successful
   LinkedIn post. An ambiguous timeout is uncertain and is not blindly retried.

## Bounded domain model, not a workflow engine

Proposed concepts, final names/schema to be refined:

- **Content proposal:** one Team, brief/source provenance, current revision and review history.
- **Revision:** immutable text variants, media references/digests, transformation metadata, alt text,
  source URLs/retrieval dates/claim annotations and generator or supplied-asset provenance.
- **Editorial decision:** authenticated human, exact revision and selected destination payloads,
  feedback, decision time; no auto-approval by another Agent.
- **Connection:** platform + account identity/type + granted capabilities + encrypted credentials;
  consent/revocation status and token lifecycle owned by daemon.
- **Delivery:** approved revision/variant/account/time + adapter version; durable lease/attempt and
  remote evidence. Per-destination status rather than one boolean for a whole batch.

Keep editorial states separate from delivery states. Editorial review can be draft, pending,
changes requested, approved or rejected/superseded. Delivery can be scheduled, preparing,
publishing, published, failed, blocked, cancelled or uncertain, with precise transition definitions.
Do not add project-wide stages, run/event tables, approval chains, arbitrary transforms or model
retries. Pi JSONL remains the authoritative conversation; these are narrow typed domain records.

### Load-bearing acceptance rules

- Approval covers exact final text, links/hashtags, media order and bytes, alt text, destination
  account, publication action, schedule/timezone and any staged public disclosure. No late AI rewrite,
  crop, compression under Bazilion's control or destination substitution after approval. Platform-side
  transcoding is disclosed; promise submitted bytes, not identical downloaded host bytes.
- Material changes create a new revision/decision. Requesting rework atomically revokes eligibility
  of unclaimed scheduled work. If sending already began, report that cancellation cannot guarantee
  recall; never promise a published post has been withdrawn.
- Bind decisions to scopes and expected revisions. Two-tab actions/conflicts and approval/claim
  races cannot authorize two sends. A communication approval, question answer, teammate endorsement
  or permission to access an account does not stand in for editorial approval.
- Continue using existing Team Policy for Agent/peer/operator communication; editorial approval is
  a distinct operator decision. Do not silently widen communication edges into social-publication
  authority or invent a second Team-policy evaluator. Reuse Attention and source links for pending
  decisions/errors rather than a disconnected approval inbox.
- Deterministic daemon delivery reads retained bytes, not live workspace files. Asset references
  need defined retention/pinning: deletion cannot resurrect or silently replace approved media.
  Deletion/missing bytes blocks unexecuted deliveries; do not duplicate an unbounded blob store.
- Revalidate account identity, grant, ownership, capability, expiry and content limits at execution.
  Expired grants do not fall back to browser automation. No CAPTCHA bypass or password scraping.
- Persist intent before side effects; distinguish upload/container accepted from post published.
  Use host idempotency only where documented. Ambiguous upload/publish acknowledgements become
  uncertain; reconciliation depends on actual read access. Do not claim universal exactly-once
  delivery across third-party APIs. Explicit manual resolution cannot hide duplicate risk.
- Scheduling uses durable claims with one owner; restart/restore cannot replay uncertain effects.
  Restore starts social connections/deliveries blocked for operator reconciliation so a cloned home
  does not compete with the original. Define overdue-window/timezone behavior before enabling schedules.
- A safety or rights concern raised during preparation requires operator review, not a fabricated
  “verified” badge. Source retrieval success is not permission to reuse text/images. Prompt injection
  in sources must not change destination, request credential access or authorize posting.
- Web/CLI parity for proposal review, rework, connection status, export, schedule/cancel and receipts.
  Add forward schema migrations under BAZ-047; never edit the already-released initial schema.

## Official platform feasibility and constraints

Research checked 2026-09-19. Access depends on the operator's account, app and approved products;
reading API documentation does not prove our future application has permission.

| Platform | Initial supported target | Implementation implications |
| --- | --- | --- |
| Facebook | **Pages**, not an assumption of personal-profile posting | Page token and appropriate permissions/tasks; Page Posts API supports posting and scheduling. Validate actual account grants and app access. |
| Instagram | **Professional accounts**, login-flow-specific grants | Image container then publish; media must be fetchable by Meta. The current guide requires JPEG for photos. Validate the chosen login route rather than mixing Facebook Login and Instagram Login permission sets. |
| LinkedIn | Member and/or organization **only as granted** | Posts API uses explicit author identity and version headers; images uploaded to obtain an Image URN. Member and organization write scopes differ; Community Management access is vetted. Read/reconciliation access cannot be inferred from write access. |
| Other networks | Not implicitly supported | Add an explicit tested adapter/capability matrix later; no universal browser-click publisher. |

The Meta guide currently contains differing general/carousel quota statements. Do not hardcode a
quota from this design: validate selected endpoint/version/account limits and handle real backpressure.
Platform requirements and API versions must be refreshed when each connector is implemented.

### Instagram's important deployment consequence

The supported Bazilion gateway stays private and the daemon loopback-only. Meta cannot fetch a
private Results URL. Do **not** solve this with Funnel, anonymous Results endpoints or a public daemon.

Refine an operator-configured external media staging service/object store: only exact approved
assets, opaque short-lived URLs, no listing, lifecycle cleanup and sufficient lifetime for platform
fetches. Even an unpublished upload is external disclosure; staging therefore occurs only after the
appropriate approval. URL expiry does not recall a copy the platform already fetched. Exclude captions,
credentials and unapproved files from staging. If this facility is unavailable, Instagram remains
manual export/blocked rather than pretending it is automated. No storage vendor has been selected.

### Images and costs

For the first milestone, use Pi's separate image-generation API rather than its chat interface.
Its pinned built-in image provider is OpenRouter: the initial Google/OpenAI model entries require
`OPENROUTER_API_KEY`, not direct Google/OpenAI keys or Codex OAuth. Direct vendor and subscription
routes remain later options. Operator enablement, model selection and account spending controls are
explicit; no credential or billing fallback is implied.

Generation is daemon-mediated with bounded prompt/reference inputs, output count/size, concurrency,
cost controls, timeouts and retained immutable output. Record generator/model, prompt/provenance and
any supplied-asset rights notes. Meter known usage; where costs are unavailable enforce conservative
request/output ceilings rather than claiming exact spending. Do not blindly repeat a potentially
billable timed-out operation. Existing result release rules remain in force; generation does not
implicitly authorize external social publication. Support supplied images/manual export before a
live generator is configured.

## Implementation sequence

| Story | Deliverable | Dependencies |
| --- | --- | --- |
| [BAZ-058](../draft/BAZ-058-content-proposals-and-editorial-review.md) | Immutable proposals/variants, preview, rework, review/export, web/CLI | Existing Team/results/conversation foundations; no platform account needed. |
| [BAZ-059](../in_progress/BAZ-059-pi-image-generation.md) | Image tool with two OpenRouter selections, direct OpenAI API-key and ChatGPT/Codex routes, durable Results | Frozen 0.22.0 candidate; live qualification pending, no protected-search expansion. |
| [BAZ-060](../draft/BAZ-060-approved-social-delivery.md) | Credential isolation, account contract, approved delivery/scheduling/reconciliation, fake adapter | BAZ-058; enforced content-Team posture; no live publishing by itself. |
| [BAZ-061](../draft/BAZ-061-meta-page-and-instagram-publishing.md) | Official Facebook Page and Instagram photo connectors, scoped media staging | BAZ-060; app/account access and staging choice. Split if refinement exceeds L. |
| [BAZ-062](../draft/BAZ-062-linkedin-publishing.md) | Official granted LinkedIn author connector, images and receipts | BAZ-060; selected member/org scope and access. |
| [BAZ-063](../draft/BAZ-063-content-team-real-world-acceptance.md) | Parent acceptance checklist/evidence review | BAZ-064/065/066; direct publication requires BAZ-060 plus a separately refined platform adapter. Mastodon starts manual-only; Meta/LinkedIn deferred. |
| [BAZ-064](../in_progress/BAZ-064-content-team-recipe-and-manual-handoff.md) | Topic-neutral Team recipe and deterministic manual-handoff checks | Existing Team/Results plus BAZ-059 and actually permitted research; no native editorial packet required. |
| [BAZ-065](../in_progress/BAZ-065-content-team-scheduling-and-recovery.md) | Actual preparation cron, protected posture and recovery evidence | BAZ-064 and the existing scheduler; missing capabilities refined separately. |
| [BAZ-066](../draft/BAZ-066-content-team-live-and-human-acceptance.md) | Authorized live core and independent human qualification | Reviewed BAZ-064/065 outputs, selected topics, account/usage consent and participants. |

BAZ-059 is scoped for 0.22.0; the other stories remain drafts. Start with the image tool and
an existing-Team recipe for **research → draft → human feedback → regenerate → export**. A durable
editorial approval/publishing vertical slice follows separately if required. Protected research
still needs explicit capability refinement outside BAZ-059; do not silently enable search/MCP/browser.
The target version is a plan, not authorization to publish a release now.

## Scenario acceptance

The canonical case matrix is now [the BAZ-063 acceptance protocol](../../testing/beta-readiness/content-team-acceptance.md),
linked from the broader beta campaign. Run deterministic integration, actual scheduler/process,
authorized live core and independent human lanes. None has passed as a composed journey yet.

The core gathers topic/purpose/platform/delivery preferences, frequency, publication slots/timezone,
preparation lead time and approval/missed-slot rules. It requires two actual preparation-cron cycles,
specialist handoffs, sourced platform copy/images, two rework rounds and exact approved manual assets.
Cron currently uses the daemon's local timezone and does not schedule social publication; missing
safe research or timezone support is a separate gap, not permission to weaken the protected runtime.

Direct publication is conditional: exact text/media/account/time approval before staging or posting,
per-platform independent host receipts, partial-failure and lost-ACK/restart tests with no blind replay.
No native editorial packet is required to demonstrate manual feedback and handoff, and that manual
conversation is not a machine-enforced publishing grant. No public demo is authorized by this plan.

## Decisions needed for refinement

- First destinations: Facebook Page? Instagram professional account? LinkedIn personal profile,
  organization Page, or both? Which developer apps/access approvals are available?
- Image provider, budget, supplied-reference-image permissions, and whether generated or supplied
  assets are sufficient for the first milestone.
- Private media-staging choice and consent to that provider; no Bazilion public exposure.
- Publication timing: manual export, approve-and-publish-now, approve-and-schedule; lateness window.
  Mandatory review per revision is the default in all automated modes.
- The manual core is now a required broader-beta acceptance journey. Which optional direct-publishing
  adapters should be implemented/qualified later? They are not prerequisites for core or frozen 0.22.
- Assign tester/reviewer and authorize bounded live usage; resolve safe scheduled discovery and
  daemon-timezone constraints before execution. New capabilities require separate implementation work.

## Primary references

- [Meta Page posts](https://developers.facebook.com/documentation/pages-api/posts): Page-token grants,
  publication and scheduling.
- [Instagram content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing):
  account/login prerequisites, photo formats, media containers, hosted-media and rate limits.
- [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api):
  author permissions, upload references, status/ID responses, read restrictions and versioning.
- [LinkedIn Community Management access](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview):
  vetted access/tier prerequisites; not a guarantee that any member app can use every feature.
- [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation):
  dedicated image generation/editing API, distinct from Bazilion's current Pi chat integration.

The HTML documentation was retrieved and inspected, including Meta's embedded documentation tree.
No API credential was used; no account grant, image generation or live post was tested.
