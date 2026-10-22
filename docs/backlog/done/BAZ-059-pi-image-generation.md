---
id: BAZ-059
title: Image generation with explicit OpenAI, ChatGPT and OpenRouter routes
status: done
size: L
created: 2026-09-19
refined: 2026-09-19
target_release: 0.23.0
closed: 2026-10-21
---

# BAZ-059 — Image generation with explicit credential routes

## User stories

- As an operator, I want an opt-in image tool with clear model, credential and billing choices,
  so existing Agents can produce illustrations without another plugin system.
- As a content creator, I want text and an original image, then a requested new version,
  without losing the original or confusing a generated draft with a published post.
- As an operator, I want bounded calls, durable private capture and truthful uncertainty,
  so reload, restart or failure cannot silently spend again or expose held files.

## Goal and accepted scope

Provide `image_generate` through the daemon's admitted host and existing Results system.
Released in [v0.23.0](https://github.com/rullopat/bazilion/releases/tag/v0.23.0).
The operator explicitly reduced required live qualification to **ChatGPT-only**: generation,
same-conversation rework and protected HTTP samples were accepted. Direct OpenAI and both
OpenRouter selections remain implemented/offline-tested but **live-unqualified**, not implicitly
qualified by this story's Done status.

See [product configuration and limits](../../image-generation.md) and [saved Results](../../results.md).

## Scope

### Selection and credentials

| Route | Selection | Authentication |
| --- | --- | --- |
| OpenAI Images API | `openai:gpt-image-2` | `OPENAI_API_KEY` |
| ChatGPT/Codex Responses image tool | `openai-codex:gpt-image-2` | Existing daemon-owned OAuth |
| OpenRouter through Pi | `google/gemini-3.1-flash-image` | `OPENROUTER_API_KEY` |
| OpenRouter through Pi | `openai/gpt-image-2` | `OPENROUTER_API_KEY` |

- Off by default. `auto` follows explicitly enabled OpenAI text providers; stored credentials or
  provider errors never choose another billing route. An OpenAI-family Agent follows its own
  enabled route; otherwise use the sole enabled option or require an explicit choice when ambiguous.
- Explicit image selections override Auto and stay separate from chat models/first-run setup.
  The Agent cannot choose a model, route, endpoint, billing account or arbitrary provider parameter.
- Revalidate admitted configuration/credential identity before dispatch and after refresh. A failed
  or interrupted call never switches provider/account/model or silently retries.
- Pi 1.0's public image-model interface supplies OpenRouter; direct routes use fixed-endpoint bounded
  adapters. Subscription tokens never go to the public Images API; refresh tokens stay in the daemon.

### Admission, bounds and outcomes

- Closed tool arguments: a nonempty prompt up to **8 KiB UTF-8** and optional safe display filename.
  No output path, URL, shell command, count, credential or model argument.
- One in-flight image operation per home; at most **four admitted calls per turn**; **180-second**
  deadline plus cancellation. One provider invocation per tool call, explicit SDK retries disabled.
- Bound raw responses to **40 MiB**, output to at most four images and existing **25 MiB/file** /
  **1 GiB/home** Results limits. Reject malformed/oversized/empty/text-only output.
- Persist narrow turn/tool/Agent/Team-bound admission before dispatch. Duplicate IPC, restart and
  restore cannot replay a billable call. Interrupted dispatch is uncertain, not a fabricated success.
- Complete identity-bound terminal/completed-stream image evidence is required. Progress/deltas,
  partial unions, missing bytes and an HTTP200 alone do not establish a valid captured image.
- Report refusal, quota, timeout, cancellation, access denial and reported usage honestly. Missing
  usage is not an exact currency cap; use account-side spending controls for paid routes.
- Ordinary and protected normal turns use the bound host; restricted reviewers/verification workers
  cannot receive it. No image credentials in worker inputs, prompts, results or logs.

### Durability and disclosure

- Commit immutable bytes, SHA-256 and selected-route/source provenance to existing Results.
- Keep capture separate from authorization. Preview, download, Telegram, peer reads and recovery
  use the canonical authorizer/approval dispatcher; private or held bytes are not a bypass.
- Requested rework creates a new image and preserves the original. Retain deletion tombstones,
  Team provenance, quotas and hash-verified backup/restore behavior.
- Persistent web cards, CLI result management and authorized Telegram delivery expose the same
  captured bytes after reload/restart. Policy-gated private-image inventory/recovery/discard never
  regenerates an image or reopens a terminal provider attempt.

## Out of scope

Reference-image/pixel editing, masks, exact geometry/quality/style guarantees, automatic resizing,
video/audio, batches, general image plugins, new publishing credentials/connectors, social posting,
editorial packet storage and a generic workflow engine. Protected HTTP does not qualify scheduled/
inbox execution or the composed content-Team live/human journey.

## Tests and acceptance

- Exact selection/catalog/configuration checks, including Auto ambiguity and provider enablement
  changing during refresh; unknown models/URLs refuse before any request.
- All route transports with synthetic responses: image/text blocks, MIME/signature/base64, errors,
  aborts, thrown setup, byte/event limits, failed/truncated/malformed/conflicting completed streams.
- Actual worker→IPC→host→Results path; forged identities, replay, cancellation during refresh,
  home concurrency, call caps, quota and late responses cannot bypass admission or disclosure.
- Allow/deny/approval-required previews/downloads/mirroring, policy/membership changes, private
  capture recovery/discard and deletion tombstones; no secret or cross-Team disclosure.
- Original/reworked bytes and provenance survive reload/restart/backup/restore with matching digests.
  Restoring a clone cannot replay uncertain provider work.
- CLI/web configuration and persistent-result parity, keyboard/narrow-screen use and useful errors.
- Accepted bounded ChatGPT live samples include operator visual inspection. Historical evidence
  lacks some raw PNG/full-input/source-pin artifacts; actual dimensions differed from requested
  1024×1024. These limits remain, not a resize task or all-route/backend attestation.
- No new paid call, publication or account access is authorized by this story or its cleanup.
