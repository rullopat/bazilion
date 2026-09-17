---
id: BAZ-054
title: Native iOS and Android apps (post-1.0 successor to the removed Expo app)
status: draft
size: XL — must be split into per-platform and per-capability stories before refinement
created: 2026-09-17
deferred: post-1.0
deferred_reason: Operator decision 2026-09-17 — mobile is native-first, but not before 1.0; capture the design constraints now so gateway/auth decisions made meanwhile stay compatible.
note: Successor to the Expo app removed by BAZ-053. Deliberately unrefined; refine per-platform from a concrete use case.
---

# BAZ-054 - Native iOS and Android apps (post-1.0 successor to the removed Expo app)

## User stories

- **As an operator away from my desk**, I want a native app that shows my Attention
  queue and lets me approve/deny agent requests, so the agent never blocks on me while
  I'm reachable only by phone.
- **As an operator**, I want the app integrated with the device — push notifications,
  share sheet ("send this to my agent"), biometric unlock of the device credential —
  so the agent is a first-class citizen of my phone, not a browser tab.

## Goal

Two native apps (iOS, Android) that talk to the operator's own daemon over the
private gateway, using the device-credential model BAZ-028 designed for exactly this:
"native clients always require a device credential" — the auth path already exists.

## Why

The Expo app was removed (BAZ-053) because a thin web wrapper cannot reach the
integration that makes an agent useful on a phone. Native is the operator's chosen
direction for device integration depth. This story exists now mainly as a **design
constraint holder**: decisions made between now and then (gateway, auth, API surface)
must not foreclose it.

## Constraints this story must preserve (for decisions made meanwhile)

- The daemon's HTTP API stays the only integration surface; device credentials stay
  per-device, minted, revocable, and shown-once (BAZ-028 semantics).
- The daemon remains local-first and private: no new always-on cloud dependency is
  introduced *for the core loop* (see push question below).
- The web UI keeps full operator parity, so the apps are additive surfaces.

## Candidate capability slices (to be split into individual BAZs)

1. Read-first companion: attention queue, approvals, follow-ups, agent status.
2. Interactive turn: structured agent questions (BAZ-037) answered from the phone.
3. Device integration: biometric/keychain credential storage, share-sheet intake,
   home-screen widget.
4. Push notifications — **hardest slice, see Open Questions.**

## Open Questions

- **Push is the architectural crux.** APNs/FCM require a relay that can reach the
  device when the daemon can't (or a persistent connection on the device). For a
  private, self-hosted product: is a minimal opt-in push relay acceptable, do we
  accept foreground-only/web-push-style behavior, or is Telegram delivery (BAZ-038,
  already shipped) the answer for attention-offline? This decision gates the whole
  story and should be made *before* any native code.
- **Platform strategy:** Swift/Kotlin native per platform, or a native-UI
  cross-platform core (not Expo) — the operator wants deep device integration, which
  argues native, at the cost of two codebases.
- **Distribution:** App Store review for a self-hosted-server client, TestFlight/
  internal distribution first? Android sideload/Play?
- **Which capability slice justifies v1?** Read-first companion is the smallest honest
  product; device integration depth is the *reason* for going native. Sequence per
  value.

## Out of scope

- Any change to the daemon's auth or gateway model (must remain compatible).
- Reintroducing a web-technology app shell (decided against, BAZ-053 context).

## Tests

_Per slice when refined. Standing requirement for all slices: no device credential
ever leaves keychain/keystore; revocation from the web UI immediately ends app access._
