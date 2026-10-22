# Image generation

BAZ-059 adds an opt-in `image_generate` tool to normal Agent turns, including protected turns.
It has OpenAI API-key, ChatGPT/Codex login and optional OpenRouter routes.
**ChatGPT login alone supports image generation; an OpenAI API key is not required for that route.**
The operator-approved required live qualification is now ChatGPT-only: generation, rework and
protected HTTP samples visually accepted. Direct OpenAI and both OpenRouter selections remain
implemented/offline-tested but **live-unqualified**, with optional live qualification deferred.
[Accepted scope and limits](backlog/done/BAZ-059-pi-image-generation.md).
Image models are separate
from text models; Automatic authentication selection follows enabled OpenAI text providers. Restricted reviewers and verification specialists cannot receive or call it.
Agent turns remain Linux-only.

## Configure

1. Configure the credential for the route you want:
   - **OpenAI API key:** save `OPENAI_API_KEY` under Config → Providers → OpenAI. This incurs
     separate OpenAI API charges; a ChatGPT subscription does not pay those API charges.
   - **ChatGPT/Codex login:** use **Connect ChatGPT** on /config or `bazilion auth openai login`.
     Uses the existing daemon-owned OAuth login/refresh, subject to subscription limits and image
     entitlement. It does not borrow an API key or promise access for every account.
   - **OpenRouter (optional):** save `OPENROUTER_API_KEY` under its provider settings.
2. In **Config → Services → Image generation**, leave the route unset or select **Automatic**
   (the default) to follow enabled OpenAI text providers. Explicit choices remain available:

   | Choice | CLI/config value | Credential and destination |
   | --- | --- | --- |
   | Automatic · follow enabled OpenAI text providers | `auto` (or unset) | Resolve using the rules below |
   | OpenAI API key · GPT Image 2 | `openai:gpt-image-2` | `OPENAI_API_KEY` → OpenAI Images API |
   | ChatGPT/Codex login · GPT Image 2 (requested) | `openai-codex:gpt-image-2` | Stored OAuth → Codex Responses backend |
   | OpenRouter · Gemini 3.1 Flash Image | `google/gemini-3.1-flash-image` | `OPENROUTER_API_KEY` → OpenRouter, via Pi |
   | OpenRouter · GPT Image 2 | `openai/gpt-image-2` | `OPENROUTER_API_KEY` → OpenRouter, via Pi |

3. Set **Image generation** to **on** and save. Check the status before starting a new turn.

### Automatic switching rules

- Enable **OpenAI API key** or **ChatGPT/Codex** for text in Config → Providers. Saving a key or logging
  in alone does not enable an automatic image route. Enabling text does **not** turn on image generation.
- An Agent using OpenAI or Codex text uses that same authentication route, provided its text provider
  is enabled. A disabled text provider is refused, not replaced with another billing route.
- For other text providers, use the sole enabled OpenAI option. If both are enabled, choose an explicit
  image route for those Agents; there is no guessed billing preference. The service status describes
  this per-Agent rule when both providers are enabled.
- Changes to text enablement affect subsequent calls in Automatic mode. A request already sent stays
  on its captured route. Changes during OAuth refresh refuse before dispatch rather than rerouting.
- Automatic mode never selects OpenRouter and never switches after an error, quota limit or failed
  login. Explicit image choices override Automatic and can be used independently of text enablement.

“Ready” confirms local configuration, not entitlement or a successful live generation. The Agent
cannot select a different route, model, endpoint or provider parameters. Direct Google image access
is not implemented; the Gemini choice above specifically uses OpenRouter.

After saving the key through the web UI (avoiding shell-history exposure), CLI equivalents are:

```sh
# Follow enabled OpenAI text providers (also the default when the value is unset):
bazilion config set BAZILION_IMAGE_MODEL auto
# Enable whichever text route you want; credentials/login are configured separately:
bazilion provider enable openai
# Or: bazilion provider enable openai-codex
# Explicit override, if wanted:
# bazilion config set BAZILION_IMAGE_MODEL openai:gpt-image-2
bazilion config set BAZILION_IMAGE_GENERATION on
bazilion config list
# Disable future requests:
bazilion config set BAZILION_IMAGE_GENERATION off
```

Environment variables override stored settings, as with other Bazilion configuration. If an env
variable enables images, saving `off` in the UI cannot override it: change the daemon environment.
The service status reports the effective configuration. A newly enabled tool appears on the next
turn; every invocation rechecks configuration. Enabling also permits scheduled/background normal
turns to request images. Configure account-side spending controls before enabling.

## Use and rework

Ask an Agent for an illustration, optionally alongside text. For example:

> Draft a short post about urban gardening and generate an original square-style illustration of
> a balcony garden. Save the image as balcony-garden. Do not publish anything.

The tool accepts a text `prompt` and optional safe display `name`, not a path. Aspect/layout wishes
are prompt guidance, not guaranteed dimensions. Reference-image edits, masks, exact geometry,
quality controls and batches are not supported. Asking “make the illustration brighter” performs
another generation consuming API credit or subscription usage; it does not edit or guarantee consistency with the
previous image. Each version remains a separate saved Result.

Authorized files appear in chat and **Team → Results**. Preview or download there, including after
reload/restart; CLI `bazilion result list|show|download` accesses the same immutable bytes. The
one-shot chat saves received files only when the local filename is unused; it preserves an existing
file and prints the saved Result reference for an explicit download to another path. The
metadata/card identifies the selected route/model, not an independent attestation of the model
actually used by a backend. Direct OpenAI/Codex requests ask for one 1024×1024 PNG; OpenRouter
uses Pi's model defaults. PNG/JPEG/WebP responses are validated before capture. The existing 10 MiB preview limit still applies; larger saved images remain downloadable.

Generation does **not** grant permission to disclose the images. Existing Agent-to-user Team Policy
may deny or hold delivery for approval. Tool results/history contain only opaque Result references,
not inline generated-image bytes. HTTP, background library delivery and Telegram reuse the existing
file authorizer. A communication approval is not final-social-post editorial approval.

## Limits, failures and billing

- Maximum prompt: **8 KiB UTF-8**.
- At most **four provider calls per turn**, **one in flight per home**, **180 seconds per request**.
- At most four returned images; **40 MiB raw response**, **25 MiB/file**, **1 GiB retained Results/home**.
- No SDK/transport retry. A narrow receipt commits *before* dispatch. Duplicate tool-call IPC uses
  captured results or refuses; interrupted/uncertain operations never resume after restart/restore.
- An uncertain operation blocks further image requests in that turn, even with a fresh tool-call ID.
  Inspect Results before explicitly asking again in a new turn. A cancellation/timeout can still
  have been billed or consumed subscription allowance. Cancellation does not reverse usage/charges.
- Missing credentials, disabled configuration and unsupported models refuse before dispatch. Provider
  failure/refusal reports access/quota guidance without echoing provider-controlled errors or secrets.
  Empty/text-only, malformed and oversized responses never become successful saved images.
  Codex protocol refusals expose only closed phase/media/terminal/reason codes, never upstream
  error text. Empty or omitted final output can use actual completed image snapshots only after
  strict lifecycle, identity, completeness and full-stream validation. Partial images/progress are
  never recovered as final images. Insufficient or contradictory evidence refuses; do not blindly retry.
- File bytes and operation completion commit atomically. Storage failure can lose an already-generated
  image; it does not silently regenerate it. Free Result storage before making another request.
- Atomically committed image captures are retained across daemon restart even before delivery
  authorization. Retention requires the matching completed image-operation identity; image metadata
  alone does not preserve an ordinary abandoned file. Retained bytes stay private, count against the
  existing 1 GiB Results quota, and do not trigger automatic delivery or regeneration. Deleted
  captures stay deleted. Provider/storage failures **before commit** can still lose an image despite
  billing or account usage.
- For committed private captures, use **Retained private images** on the Team Results page or
  `bazilion result private-images --team <team>`. Its owner-only inventory exposes IDs, producer,
  capture time and size, not image contents. Explicit recovery follows the existing Team Policy and
  approval path without generating again; confirmed discard frees eligible private bytes without
  disclosing them and preserves the no-regeneration tombstone. Active producers/live delivery holds
  must settle first; closed approvals stay closed and ineligible original producers cannot recover.
  See [Saved Agent results](results.md#retained-private-images) for CLI commands and limits. This is
  stored-byte recovery, not recovery of a provider response that was never committed.

These are operational request/storage limits, **not a precise dollar budget**. Pi's recorded costs
are estimates; each service's invoice/account limits are authoritative. Unknown costs stay unknown,
not zero. With the image host enabled, new normal-worker/MCP environments omit OpenAI/OpenRouter
keys unless that provider is also selected for chat. OAuth image credentials are loaded/refreshed
only in the daemon; no refresh token enters the image request or worker. Protected workers still
receive only their selected chat credentials. This does not
revoke an already-running integration's credentials or turn an ordinary host-trusted Agent into an
isolated worker; its existing host/filesystem authority remains.
Private generation receipts record the resolved credential route/model (never just `auto`), identities,
request digests and bounded reported
usage/response IDs, not a duplicate prompt/transcript. They retain replay protection with the Team;
Team deletion removes them. Restoring a home cannot replay them automatically.

## Existing-Team content recipe

Use existing Profiles/skills and a Team; no special roster or workflow runtime is required:

1. Research with the tools that the selected posture actually permits, cite sources, and distinguish
   facts from suggestions. Protected discovery requires its separately configured bounded
   SearXNG capability; native search/browser/MCP cannot be added as a fallback. If sources are
   unavailable, explain the blocker or ask for source material instead of widening capabilities.
2. Draft a platform-appropriate caption and an illustration prompt, honoring the user's brand/brief.
3. Call `image_generate`; explain where the saved image can be previewed and downloaded.
4. Ask for feedback. Revise the caption or generate a new image only as requested. Do not automatically
   repeat an uncertain generation; tell the user it may have been billed.
5. Deliver the text and authorized files for manual use. **Do not publish to a social account.**

This supports content preparation/manual export. Editorial packets, irreversible publishing,
platform credentials and native social connectors are separate future scope.

## Supported scope and limitations

[BAZ-059](backlog/done/BAZ-059-pi-image-generation.md) shipped with bounded ChatGPT-only live
acceptance for generation, same-conversation rework and protected HTTP. Direct OpenAI and both
OpenRouter selections remain implemented/offline-tested but live-unqualified. Synthetic transport
and UI checks are not evidence of account entitlement, image quality or every provider's live API.
Protected HTTP does not qualify unattended scheduled/inbox execution or the composed content-Team
live/human journey. New paid trials require their own explicit authorization and limits.

Exact output geometry is not guaranteed: accepted ChatGPT samples differed from the requested
1024×1024 size. No automatic resizing/regeneration, reference-image editing or backend-model
attestation is implied. Historical unretained outputs cannot be recovered by replaying a request.

Fresh Codex tool details distinguish `imageEvidence.outputSource: terminal` from `completed_stream`.
The latter requires complete identity-bound completed-image evidence, not deltas or partial output
union. Receipt replays do not invent a source fact. Retained private captures can be managed through
[Results](results.md#retained-private-images), subject to the same disclosure policy.

The Codex route uses the separate image-tool Responses protocol, a pinned `gpt-6-astra`
orchestrator and requested `gpt-image-2`, with storage disabled and bounded complete-stream checks.
This does not mean the public Images API accepts subscription tokens. The direct API-key route uses
the [OpenAI image API](https://developers.openai.com/api/docs/guides/image-generation). Neither
route downloads provider-returned URLs, retries an uncertain call or falls back to another account.
