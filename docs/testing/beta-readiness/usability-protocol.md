# Candidate usability and accessibility protocol

**Rewritten 2026-09-20 for the `0.22.0` candidate. No independent study has been executed.**
This protocol has **16 task cards**: four image-specific tasks and twelve product-wide tasks.
It complements the [plan](README.md) and [scenario catalogue](scenario-catalog.md).
The current Chromium projection smoke establishes selected UI mechanics, not human comprehension,
assistive-technology usability, image quality or a complete live browser journey.

## 1. Questions and scope

For the feature beta (R), establish whether an operator can:

- Enable images deliberately and predict the credential/billing route before requesting one.
- Understand Automatic as text-provider enablement-based selection, not credential discovery or fallback.
- Generate, inspect, download and request a new version without losing the authorized original.
- Distinguish locally Ready, provider entitlement, captured, authorized/held, available and uncertain.
- Recover without assuming cancellation means refund, no visible image means no charge, or a new
  generation will reproduce an old image. Understand the abandoned-private-output loss window.
- Complete affected controls with keyboard and at narrow/zoomed layouts, using accurate instructions.

For broader beta maturity (B), additionally assess onboarding, Agent/Team/template concepts,
conversation versus queue, irreversible actions, coding-evidence interpretation, remote access,
backup/restore and recovery across independent users and supported assistive/device configurations.

B additionally requires the [composed content-Team walkthrough](content-team-acceptance.md): gather
the brief and schedule, inspect actual cron-prepared work, request text/image changes, approve exact
versions and retrieve a manual handoff. It composes these existing cards rather than increasing their
count of 16. Topics, purposes and audiences are selected through the brief, not prescribed by the
protocol. BAZ-066 owns this live/human observation after BAZ-064/065; BAZ-063 reviews the combined
evidence. Include late approval, next-cycle comprehension, timezone limitations and the distinction
between preparation and posting.

Neither study requires implementing new social publication or editorial workflow features. Direct
publication is a conditional, separately authorized extension with its own platform evidence.
A request to generate content or set its cadence is not authorization to publish it externally.

## 2. Participants, roles and safe fixtures

**R preparation:** an expert walkthrough of I01–I04, U01, U08 and U12, with independent review of
safety wording. Label it expert review even if an agent performs it. It cannot satisfy B's human
study. Use findings to choose the narrow release tasks and devices with the operator/reviewer.

**B round one:** recruit 5–6 people spanning first-time users, content creators, coding/maintenance
operators and remote/mobile users. Include an experienced keyboard/screen-reader user or schedule
an additional specialist assessment. These are overlapping profiles, not validated populations.

**B round two:** 3–4 participants after fixes. Use fresh participants for changed discovery/onboarding
and returning participants for targeted recovery retests; record familiarity. Expand a segment if
problems remain. Small samples discover problems; they do not measure population reliability.

A moderator who did not implement the screen leads; the developer observes and resets fixtures.
If no independent participants are available, record the study as Blocked, not an agent-simulated pass.

Use disposable Linux-hosted homes and distinguishable synthetic files/images. Devices on macOS,
Windows or phones can access that Linux daemon; do not imply portable local Agent turns.

Before a session:

1. Obtain observation/recording consent and agree access/deletion dates. No webcam is necessary.
2. Explain: “We are testing the product, not you. You may stop at any point.”
3. Enter any approved credentials off-record into normal configuration, never into chat or a form
   captured by a trace. Do not ask for personal provider keys or refresh tokens during the session.
4. Prefer deterministic fake providers for repeatable failure/held/crash fixtures. Identify this
   substitution in the report. Authorized live samples validate a different integration boundary.
5. Agree attempts and spend/usage limits for live work. Image opt-in is per-home and can enable normal
   background turns; isolate unrelated work. A text turn may also incur usage. Never assume client
   count limits enforce a precise dollar cap, and do not copy OAuth refresh state between homes.
6. Disable unrelated notifications, preserve the participant's normal assistive tooling and record
   browser/device/zoom/input settings. No real recipients or destructive external targets are allowed.

Suggested privacy policy, subject to consent: raw recordings deleted within 14 days; retain only
redacted findings/evidence with the candidate. Delete earlier when requested. Public issues must not
contain credentials, real homes, unredacted traces or personal recordings.

## 3. Facilitation

Use 60–75-minute sessions: consent/background and unaided first impression, four to six tasks,
comprehension/debrief and cleanup. Do not attempt all 16 cards in one sitting.

Give the goal, not menu names or implementation terms. Allow normal documentation detours and record
them. Prompt neutrally: “What are you looking for?”, “What do you think happened?”, “What would you
do next?” Record an impasse before offering a hint; developer rescue is assisted, not independent,
completion. Avoid explaining billing or uncertainty just before measuring whether the UI explains it.

Stop on unsafe action, exposure, unintended spend/recipient, wrong-target deletion or distress.
An independent observer checks the actual receipt/request/byte oracle; confident user speech alone
cannot establish correct completion. No live failure retry is performed just to finish a task.

## 4. Image task cards

### I01 — Choose where image generation goes

**Say:** “You want this assistant to make an illustration. You have these two account options.
Set it up so you know which account will be used, but do not request an image yet.”

**Profiles/fixture:** content creator and administrator; synthetic OpenAI API-key, ChatGPT login
and optional OpenRouter options, initially disabled images. In separate variants, only credentials
exist, one text provider is enabled, both are enabled, or an explicit image choice is saved.

**Observe:** separate opt-in, text-provider enablement, own-Agent versus other-Agent Automatic rule,
ambiguity, explicit override, effective environment setting and Ready versus entitlement. Ask which
service receives the credential, which account may consume usage and whether failure switches it.

**Success/oracle:** zero image requests during configuration; effective settings agree with API/CLI;
participant predicts the concrete route or recognizes ambiguity. They do not assume a ChatGPT
subscription pays separate API charges or that a Gemini name means a direct Google credential.
**Maps:** IMG-01/02/03/14, MGMT-09.

### I02 — Produce and retain two versions

**Say:** “Prepare a short caption and an illustration for this garden event. Inspect and save it.
Now ask for a brighter version, keeping the original. After restarting, find and download both.”

**Profiles/fixture:** creator and phone user; deterministic baseline, separately approved live run.
Use distinct known images for synthetic versions so accidental substitution is detectable.

**Observe:** discoverability of chat cards/Team Results, route/source labels, previews/downloads,
rework expectations, local-file overwrite behavior and recognition that generating again uses more
credit/allowance. No posting to social accounts is part of the task.

**Success/oracle:** two authorized Result IDs with their original hashes survive reload/restart;
downloads match their captured bytes, including CLI no-overwrite behavior. Participant understands
rework is another generation, not a guaranteed consistent edit, and the route/model label is a
selected request rather than verified backend identity. **Maps:** IMG-08/11/13, INT-01/03, UX-06/07.

### I03 — Recover without assuming another charge is safe

**Say:** “The image did not arrive. Work out what is known and what you would do next before asking
for another one.”

**Profiles/fixture:** all; separate missing-login, ambiguous-Automatic, provider-refusal, timeout and
request-received/reply-lost cases. Simulate costly failure cases unless separately authorized live.

**Observe:** participant distinguishes pre-dispatch refusal from possible usage after dispatch,
checks available evidence, does not expect API fallback or a refund, and understands that a fresh
request may consume usage again. Ask what a missing Result proves: it does not prove no charge.

**Success/oracle:** visible explanation agrees with actual operation/provider count; no automatic
resend or credential switch. Record any misleading copy or forced developer explanation. Do not
award success merely because the backend blocked a dangerous misunderstanding. **Maps:** IMG-03/06/10/14.

### I04 — Private, held and unavailable are different

**Say:** “The assistant made an image, but it has not been shared with you yet. Determine what you
can see and what this decision would allow. In this other case the server restarted before delivery;
find out whether the image can still be recovered.”

**Profiles/fixture:** operator/reviewer; held communication approval, denied delivery, authorized
Result, and the current post-capture/pre-authorization crash tombstone as separate states.

**Observe:** exact recipient/payload, approval scope, current policy, unavailable versus an empty
healthy library, and whether the user assumes capture guaranteed delivery or avoided charges.

**Success/oracle:** private preview/download remains denied; authorized delivery exposes the exact
captured bytes only. Participant understands the known abandoned-private-output loss window and that
approval to communicate is neither social-post editorial approval nor a refund. This task observes
comprehension; it does not itself accept the loss limitation for release. **Maps:** IMG-09/10/14, FLOW-09.

## 5. Product-wide task cards

### U01 — First useful answer

**Say:** “Starting with the instructions, set up an assistant for this project and ask it to summarize
the supplied note.” **Fixture/profile:** fresh Linux environment, novice, controlled provider available
through normal browser setup. **Observe:** installation/version, login, configured versus usable text
provider, first Agent and persistence. **Success:** one correct retained answer without private rescue
steps. Record download/wait time separately; do not invent a measured onboarding-time target.

### U02 — Separate work without retargeting a message

**Say:** “Start a new task, then find the earlier answer without changing where your next message goes.”
**Fixture/profile:** retained conversations, all users. **Success:** intended active target and old
history remain distinct; observer checks actual selection and canonical input, not just visible titles.

### U03 — Correct ongoing work after a lost response

**Say:** “Add this correction and attachment while the assistant works. The connection drops; make
sure the correction is handled once.” **Fixture/profile:** controlled committed queue admission with
lost ACK, all/mobile. **Success:** exact saved request/bytes reconcile to one receipt and external
counter increment. A confident fresh duplicate send is not independent success.

### U04 — Resume safely after interruption

**Say:** “The server restarted and waiting work stopped moving. Find out why and make it safe to
continue.” **Fixture/profile:** real interrupted queue head and evidence, operator. **Success:** inspect
uncertainty, reconcile appropriately, then resume separately; no blind replay or falsely healthy queue.

### U05 — Answering is not granting authority

**Say:** “Respond to the assistant's question. There is also a request to send something elsewhere;
decide what to allow.” **Fixture/profile:** question plus independent held communication, all users.
**Success:** answer/consumption/expiry are understood; participant identifies the separate payload,
recipient and consequence before approval. Include a stale callback variant.

### U06 — Explain what a check actually proved

**Say:** “A teammate checked this change. Decide what you know now and whether another check is needed.”
**Fixture/profile:** successful/failed checks, changed snapshot and unverified findings, coder.
**Success:** identify exact revision and executor facts; completed/identical/reviewed is not proof that
current code passed, nor permission to publish, merge or deploy.

### U07 — Publish code deliberately, then reconcile uncertainty

**Say:** “Prepare this reviewed change on a new branch for discussion. The response disappears after
confirmation. Find out what happened before doing anything else.” **Fixture/profile:** local bare
host or specifically approved private repository, maintainer. **Success:** informed exact-target
confirmation, independent host inspection and no blind repeat push/PR. This is existing code-host
publication, not a new social publishing feature.

### U08 — Retrieve and delete only the saved copy

**Say:** “Find yesterday's delivered file and its source conversation. Download it, then remove only
the saved copy.” **Fixture/profile:** changed workspace source, known Result hash and tombstoned item,
all/phone. **Success:** captured bytes match; source link is accurate; confirmation makes deletion
scope clear and the workspace source remains intact after reload.

### U09 — Return to an unfinished edit

**Say:** “Update this Team note and template, check another setting, then come back and finish.”
**Fixture/profile:** dirty editor and second-client conflict, administrator. **Success:** intentional
save/discard, preserved correction on failure/staleness, no silent secret removal or retroactive live
resource edit. Observe terminology and navigation rather than telling the user which guard to use.

### U10 — Connect a phone privately, then revoke it

**Say:** “Reach the Linux-hosted assistant from this phone. Later, stop that lost device from making
changes.” **Fixture/profile:** approved dedicated gateway/device credential, remote administrator.
**Success:** supported private origin and bounded credential; revocation blocks the next privileged
action. Test keyboard/copy/paste, expiry and return route without recording real credential entry.

### U11 — Recover a populated home

**Say:** “Protect this test assistant's history and files, then recover them on the replacement using
the instructions.” **Fixture/profile:** populated disposable home, separate backup key, linked external
project and active-work evidence, maintainer. **Success:** restored data/hash/source links work; identity
pair and backup scope are understood, external files are not assumed included, unresolved work is not
replayed and the only good recovery copy is not destroyed.

### U12 — Recover the page, not just its error box

**Say:** “This page stopped working. Recover it and continue your task.” **Fixture/profile:** failed
loader with restored daemon, plus committed-save/failed-refresh variant, all/keyboard. **Success:** the
offered control causes a new request and correct resource content; draft/outcome are truthful. No
manual URL/source inspection, repeated unsafe save or developer instruction counts as unaided success.

## 6. Accessibility, devices and performance observation

For R, inspect the affected image/configuration/Results/recovery controls and record exactly which
manual/scanner tasks ran. For B, expand across the full catalogue and supported states:

- Keyboard-only navigation, visible unobscured focus, sensible order, reachable overflow controls,
  dialog focus/dismissal/restoration and no pointer-only critical action.
- Accessible names, landmarks, headings, form labels/errors and descriptions. Image cards identify
  the saved file/route and usable actions; do not invent image-description quality from metadata.
- Useful status announcements for generation, held/error/cancelled/uncertain outcomes; no streaming
  speech flood or forced focus/scroll while reading older content.
- Applicable WCAG 2.2 A/AA: normal text contrast 4.5:1, large/non-text contrast 3:1 where applicable,
  non-color status, target-size rules/exceptions, reduced motion, 200% text and 400% zoom/320 CSS-pixel
  reflow. Contained code/table scrolling is different from page-wide overflow.
- Pinned axe checks on normal, menu, dialog, error, pending and populated states in both themes,
  followed by manual examination. A clean scan is not conformance or screen-reader evidence.
- Actual VoiceOver/Safari and NVDA/Firefox or Chrome tasks against Linux; real iPhone/Safari and
  Android/Chrome for downloads, attachments, software keyboard, rotation, suspend/reconnect and expiry.
  Playwright WebKit and narrow Chromium screenshots are not real-device substitutes.

Record elapsed task time, provider waiting, apparent freezes and misclicks as observations. Formal
performance needs traces and declared workloads from the plan; a screenshot or a happy user does
not establish latency, Core Web Vitals or long-term resource stability.

## 7. Recording, synthesis and decision

For every participant/task/attempt record candidate/artifact, fixture and actual substitutions,
profile/device/browser/assistive tools, steps, outcome, time/waits, exact assistance, detours/errors,
participant explanation, independent UI/state/side-effect oracle, redacted evidence and finding owner.
Outcomes are independent success, assisted success, partial, failed or not attempted. Report actual
fractions and denominators, not generic percentages or “users liked it.” An optional 1–7 ease rating
supports qualitative comparison, not statistical population claims.

Classify issues as safety/correctness, comprehension, discovery, feedback, accessibility or rendering.
A safety misunderstanding matters even when a backend guard prevents harm. Reproduce each finding,
make the smallest correction, and repeat the affected task with appropriate fresh/retest users.

The R report must state unresolved cost/disclosure/loss misunderstandings and affected accessibility
barriers for the release decision. It cannot claim B passed. Proposed B exit criteria are:

- No unresolved critical/high-severity task or safety defect; independent retest after fixes.
- At least two independent unaided completions of each agreed critical task across relevant profiles
  in the final round, with all failures/assistance reported. This is an observation minimum, not a
  population-success estimate.
- Repeated safety/state confusion prompts correction and another round, not an average score waiver.
- Core tasks work on the assessed keyboard/screen-reader stacks; untested devices stay explicitly open.
- Documentation-only onboarding/recovery needs no unpublished instructions.

The final report lists scope, actual participants/configurations, findings, retests, remaining gaps
and sign-off. The implementer should not be the sole usability reviewer. No study result authorizes
publishing or accepts the private-output-loss limitation without the separate release decision.
