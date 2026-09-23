# OpenClaw / Hermes: research-to-social-content workflow

**Online research checked 2026-09-19.** Scope: current official documentation, the official
Hermes skill catalogue, and selected upstream source. No installation, credential access, image
request or publication was performed. Documented behavior is not independently tested behavior.

## Executive conclusion

The operator's skills-first intuition is supported by both projects:

- Use skills and specialized Agents for research, campaign guidance, writing and revision.
- Provide image generation as a reusable tool backed by separately selected image-capable providers.
- Use a platform skill/CLI/MCP/custom integration for actual publishing, rather than requiring a
  purpose-built social-network management application inside the agent framework.
- Approval still needs an explicit execution boundary if it must be enforced rather than prompted.

**Hermes already ships an optional skill very close to the requested scenario.** OpenClaw provides
an optional deterministic approval/resume runtime (Lobster) that could gate the sending step.
Neither finding establishes that arbitrary Agent shell/API actions are automatically held for
immutable, operator-only editorial review.

This supports narrowing Bazilion's initial implementation: reusable image capability + ordinary
Team skills + reviewed durable artifacts; native Meta/LinkedIn connectors are optional later work,
not prerequisites for demonstrating the content-production scenario.

## Local Pi verification and 0.22 scope update

A subsequent inspection of Bazilion's **installed Pi 0.85.1** corrected the earlier assumption that
new image-provider adapters were required. Pi already exposes a separate `ImagesModels` collection
and `generateImages()`. Its current built-in image provider is **OpenRouter only**, with Google and
OpenAI image-model entries. This does not reuse direct vendor keys or Codex OAuth.

[BAZ-059](../in_progress/BAZ-059-pi-image-generation.md) targets **0.22.0**: one Hermes-style
tool, daemon execution and durable Results. The operator subsequently expanded the initial two-entry
Pi/OpenRouter scope to expose **both direct OpenAI API-key and ChatGPT/Codex login routes** to end
users. These use distinct bounded transports, not Pi's OpenRouter adapter. Automatic mode now
follows enabled OpenAI text providers (with the Agent's own route resolving dual enablement);
explicit image choices override it. Credentials alone or provider failures never cause fallback. Direct Google, native social connectors, protected search
and the complete approval/publishing workflow remain outside this release. See the
[operator guide](../../image-generation.md) for implemented choices and unobserved live acceptance.

## 1. Hermes: a directly relevant existing skill

The official optional catalogue lists `creative/social-media-content-calendar`. Its
[actual SKILL.md][h-social] separates campaign planning from platform execution: it prepares
channel-specific material, uses `image_generate` for visuals, reviews factual/rights/accessibility
concerns and presents an approval batch. Platform skills own API commands. If no connector exists,
it hands off approved copy/assets/timing to the user's scheduler and must not report publication.
The cited implementation example is `xurl` for X, not proof of LinkedIn, Facebook or Instagram support.

It is **optional**, not active by default. The documented installation pattern gives:

```sh
hermes skills install official/creative/social-media-content-calendar
```

This is a documentation example, not a command executed during the research.

### What that establishes—and does not

- It directly supports putting editorial expertise and channel conventions in a skill instead of
  writing a whole social-marketing product into the framework.
- Its review rules are skill instructions. The Markdown is not an immutable revision database or
  proof that every publishing path requires a human authorization token.
- External platform APIs and account access remain prerequisites. Reading API docs does not create
  a working authenticated integration by itself.

The official [bundled catalogue][h-catalog] includes `xurl`, grounded citations, competitor news
monitoring and text-voice refinement. The optional catalogue contains the campaign skill. No
ready-to-use Facebook/Instagram/LinkedIn publishing skill was identified in these audited catalogues;
that is a scoped finding, not a claim that no community integration exists anywhere.

### How a Hermes Team could execute the scenario

An inferred assembly from documented components (not a tested packaged recipe):

1. A persistent coordinator Bot/profile holds brand guidance; researcher/writer/designer Bots supply
   specialized skills. [Bot Mode][h-bots] documents persistent profiles, routines and group discussion.
2. [Delegation][h-delegation] can fan out research in separate contexts. Dependencies must be explicit:
   dispatch writing after research completes rather than assuming parallel workers see each other's work.
3. The coordinator combines research, generated media and channel-specific copy into review artifacts.
4. Human feedback arrives through chat or `clarify`; revision is another Agent task.
5. An installed platform integration performs an authorized send, or the outcome remains manual handoff.
6. [Cron][h-cron] starts recurring preparation. A schedule alone does not establish final-post approval.

Hermes [security][h-security] documents dangerous-command approval and unattended default-deny
settings, but also configurable auto-approval modes. Those are command-risk controls, not equivalent
to a final-caption/image/account approval contract. [MCP][h-mcp] supports user elicitation, which a
trusted publishing server could use; whether it actually prevents unapproved sends depends on that
server and the available alternate tools.

## 2. OpenClaw: compose tools/skills, optionally gate with Lobster

OpenClaw's [skills documentation][oc-skills] treats skills as instructions for using tools.
[Web search][oc-web], [sub-agent tools][oc-subagents] and [automations][oc-cron] provide the research,
delegation and cadence pieces. Specialized Agents need not have bespoke platform-specific core code.

A practical inferred composition is:

```
Scheduled research / coordinator
  → delegated research
  → platform-writing skill + image_generate
  → captured proposal / preview
  → human decision (or feedback and a new draft)
  → guarded platform CLI / API / MCP operation
  → host result checked and recorded
```

### Lobster is the relevant approval mechanism

The optional [Lobster plugin][oc-lobster] runs deterministic typed pipelines. A workflow can pause
at a required-approval step, return a resume token, and continue after a decision without repeating
completed preparation. It supports JSON-producing command/script steps and previews. Its managed
Task Flow mode adds persisted flow/revision handling; the approval checkpoint has separate storage.

This is closer to the requested publish-after-review behavior than a system-prompt instruction.
However:

- It is an optional runtime/plugin, not automatic protection on every tool call.
- The documented plugin is disabled in sandboxed tool contexts; it is not a drop-in replacement
  for Bazilion's protected-worker design.
- Side effects must actually occur after the gate. Other tools, scripts, mutable inputs and exposed
  credentials need separate containment. The documented `approve`/resume API alone does not prove
  our stronger operator-only, exact-byte authorization requirement across all execution paths.
- Deny/resume does not itself supply an editorial “request changes” product. Rework must produce a
  new proposal and must not silently modify inputs to an already-approved sending step.
- The runtime does not eliminate platform adapters, account grants, token refresh or media upload.

The lesson for Bazilion is **separate creative Agent work from the approved side effect**, not
“import a general workflow engine.” Preserve the existing no-general-workflow-engine constraint.

## 3. Images: both expose an explicit generation capability

### OpenClaw: the closest match for reusing Bazilion's providers

[Image generation][oc-images] documents one `image_generate` tool spanning multiple providers,
with a separate default image-model configuration. It supports generation/reference editing,
provider-specific limits and reporting of applied settings. Chat-session generation is asynchronous
and delivers structured attachments on completion.

The [Google provider][oc-google] explicitly supplies Gemini image generation using configured Google
credentials. The [OpenAI image documentation][oc-openai] distinguishes API-key and Codex-authenticated
transports. Thus the model used to reason/write need not be the model/service generating images.

For Bazilion, reuse provider configuration, selected credentials, image display and saved Results;
add the missing image service/tool and image-capability metadata. Do not try to make the existing
text/tool `ProviderResponse` silently stand for an image generation result.

### Hermes: image backend selection is explicit too

The current [image guide][h-images] starts with FAL examples but later documents additional direct
providers including OpenAI, OpenRouter and a Codex-authenticated backend, plus the Nous managed
Tool Gateway. It is incorrect to summarize the current implementation as “FAL only.”

Its configured image provider is distinct from the chat model. It documents bounded batch
concurrency, reference-image support per backend, output materialization and reporting actual
geometry for backends that treat requested size as advisory. The
[provider plugin contract][h-image-plugins] makes image generation an explicit extensibility surface.

Selected [upstream image dispatch source][h-image-source] and the
[provider directory][h-image-dir] corroborate this separate capability. The inspected plugin directory did **not** establish a direct Google image adapter;
Google-family models through FAL/OpenRouter are not proof that a Hermes Google chat credential is
reused directly. OpenClaw is the clearer direct OpenAI+Google reference.

### Correction/qualification: ChatGPT/Codex image access

My earlier suggestion to start with a separately billed image API was too narrow if interpreted
as the only possible route. Both current upstream projects document explicit Codex-authenticated
image paths. These are not simply the paid public Images API with a chat token pasted into it.
The documented transports differ: OpenClaw describes a Codex Responses route; Hermes describes
native backend image endpoints with server-managed choices.

Their documentation also distinguishes selectable direct-API models/parameters from subscription
routes; a model label is not evidence that a backend honored it. Bazilion must independently verify
account entitlement, supported usage, authentication/refresh, response contract and actual output
before offering such a path. Existing chat OAuth support does not automatically implement it, and
support in another open-source client is not proof of official API stability or permission for every
account. No live entitlement test was performed here.

## 4. Approval comparison

| Layer | Hermes evidence | OpenClaw evidence | Meaning for Bazilion |
| --- | --- | --- | --- |
| Editorial procedure | Campaign skill defines review and handoff | Skills can define similar process | Reuse procedural knowledge rather than hardcode every campaign step. |
| User feedback | Chat/`clarify`; MCP form elicitation | Chat; workflow preview/decision | Feedback must not itself grant unrelated execution authority. |
| Execution pause | Dangerous-command controls; server-specific MCP behavior | Optional Lobster required-approval checkpoint | A real pause is useful, but scope and bypasses still need validation. |
| Exact immutable content authorization | Not established by the campaign skill | Not established across all tools by Lobster docs alone | Capture final text/assets/destination and bind the decision if enforcement is required. |
| Actual platform publication | Platform integration required; X skill is a concrete example | Platform integration required | API docs guide an implementation; they are not a functioning connector. |
| Rework | Another draft/review cycle | Another preparation/review cycle | Old approval must not authorize newly changed content. |

This is a documentation comparison, not a penetration test or a claim that either project is unsafe.
Their stated control boundaries should not be conflated with Bazilion's stronger proposed guarantee.

## 5. Recommended adjustment to the Bazilion proposal

1. **Do first: general image generation/editing.** Model OpenClaw's capability separation. Reuse
   OpenAI/Google credentials where applicable; expose supported parameters explicitly; keep keys
   daemon-side; save actual bytes/provenance. Assess Codex auth as a separate path, not an assumed alias.
2. **Assemble a content Team using existing primitives.** Brand/research/copy/design/review expertise
   belongs in Profiles and skills, with a preparation trigger and shared artifacts. Adapt the Hermes
   campaign pattern with attribution/license review rather than importing its runtime assumptions.
3. **Demonstrate rework and manual export before publishing.** Existing chat and Results can support
   an initial manual trial. Do not imply that this trial proves an enforced approval boundary.
4. **Add the minimum durable review/execution boundary.** Keep BAZ-058/060 focused on captured content,
   human decision, expected revision, safe sending and truthful receipts—not calendar/CRM/workflow scope.
5. **Choose one trusted publishing integration only when needed.** A reviewed script, narrow tool or
   third-party MCP can be an adapter if it cannot bypass the approval boundary. A prompt-only skill
   with unrestricted shell credentials is not equivalent. Keep Meta/LinkedIn native connectors optional.
6. **Validate the whole scenario.** Human requests a text/image change, approves the replacement,
   and only that account-bound version is exported or sent. Test restart, stale approval, ambiguous
   sends and absence of platform access; never label manual handoff as published.

The wider stories remain proposals except for the now-scoped BAZ-059 image milestone described
above. This research argues against requiring the full sequence before a first useful content-Team
demonstration. It does not justify removing approval enforcement when automatic publication is enabled.

## Sources and reproducibility

Official indexes fetched: `https://docs.openclaw.ai/llms.txt` and
`https://hermes-agent.nousresearch.com/docs/llms.txt`. Targeted documentation was retrieved directly;
Hermes HTML was reduced to its main article. Selected source files were read, not executed.
Observed repository heads at research time (not assertions of the websites' deployment versions):

- OpenClaw: `acbeb3a07197dbdbe89dd674f40b27279c912382`.
- Hermes: `7c6f21a5e12ba9b1c674ec9b410fa6b8c45de4f8`.

Working downloads: `/tmp/bazilion-content-comparison/` (temporary, not committed evidence storage).
API/model names and authentication support are time-sensitive; refresh before implementation.

[h-social]: https://github.com/NousResearch/hermes-agent/blob/main/optional-skills/creative/social-media-content-calendar/SKILL.md
[h-catalog]: https://hermes-agent.nousresearch.com/docs/reference/skills-catalog
[h-bots]: https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode
[h-delegation]: https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation
[h-cron]: https://hermes-agent.nousresearch.com/docs/user-guide/features/cron
[h-security]: https://hermes-agent.nousresearch.com/docs/user-guide/security
[h-mcp]: https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp
[h-images]: https://hermes-agent.nousresearch.com/docs/user-guide/features/image-generation
[h-image-plugins]: https://hermes-agent.nousresearch.com/docs/developer-guide/image-gen-provider-plugin
[h-image-source]: https://github.com/NousResearch/hermes-agent/blob/main/tools/image_generation_tool.py
[h-image-dir]: https://github.com/NousResearch/hermes-agent/tree/main/plugins/image_gen
[oc-skills]: https://docs.openclaw.ai/tools/skills
[oc-web]: https://docs.openclaw.ai/tools/web
[oc-subagents]: https://docs.openclaw.ai/tools/subagents/tool-reference
[oc-cron]: https://docs.openclaw.ai/automation/cron-jobs
[oc-lobster]: https://docs.openclaw.ai/tools/lobster
[oc-images]: https://docs.openclaw.ai/tools/image-generation
[oc-google]: https://docs.openclaw.ai/providers/google
[oc-openai]: https://docs.openclaw.ai/providers/openai/image-and-video
