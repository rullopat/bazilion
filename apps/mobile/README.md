# @bazilion/mobile

Expo (SDK 54) + Expo Router 6 + React 19 + RN 0.81 + new architecture. Pairs to the
private HTTPS Bazilion web gateway via a QR code minted on the server; the daemon remains on
loopback.

## First run

1. **On the server**: configure the exact private HTTPS origin for both Bazilion processes. Keep
   the daemon and web listeners on loopback.
   ```sh
   export BAZILION_PUBLIC_ORIGIN=https://bazilion.example.ts.net
   export HOST=127.0.0.1 PORT=4321
   export WEB_HOST=127.0.0.1 WEB_PORT=4322
   bazilion dashboard --no-open
   ```
2. **On the server**: publish only the loopback web gateway with tailnet-only Tailscale Serve and
   verify the supported posture. Do not use Funnel and do not expose ports 4321 or 4322 directly.
   ```sh
   tailscale serve --bg --https=443 http://127.0.0.1:4322
   bazilion gateway preflight
   ```
3. **On the server**: mint a separate, expiring device credential for the phone.
   ```sh
   bazilion token create phone --expires-days 90 --qr \
     --server "$BAZILION_PUBLIC_ORIGIN"
   ```
   A QR encoding `bazilion://pair?server=<url>&token=<t>` prints in the terminal.
4. **On the phone**: install [Expo Go](https://expo.dev/go), sign in to the same tailnet, and
   confirm the HTTPS gateway opens in the phone's browser.
5. **On your dev machine**:
   ```sh
   pnpm --filter @bazilion/mobile start
   ```
   Scan the QR the Expo CLI prints with Expo Go → the app loads → grant camera access → point the
   camera at the **pairing** QR from step 3.
6. The app verifies the device token against protected `/api/auth/whoami`, checks that the returned
   canonical public origin matches, saves `server` + `token` into `expo-secure-store`, and lands on
   the agents list.

## Manual pairing

If the camera flow doesn't work (remote testing, wrong Expo Go version, etc.), tap "Paste URL
instead" and paste the `bazilion://pair?…` URL the CLI printed. Opening that custom-scheme URL in
an installed build also lands on the same verification flow. Pairing rejects plain HTTP except for
loopback development.

See [`docs/private-gateway.md`](../../docs/private-gateway.md) for service-manager setup, external
verification, and credential recovery. Direct daemon exposure, direct LAN access, public reverse
proxies, and Tailscale Funnel are unsupported.

## Commands

- `pnpm --filter @bazilion/mobile start` — Expo dev server (reads the Metro/Babel config).
- `pnpm --filter @bazilion/mobile typecheck` — TypeScript check over the mobile tree only.
- Root `pnpm test` picks up `apps/mobile/test/**/*.test.ts` — currently the `pair-url` parser suite.

## Layout

```
app/
  _layout.tsx        root stack + StatusBar
  index.tsx          loads SecureStore → redirects /pair or /agents
  pair.tsx           deep link + deduplicated camera scan + manual paste + verify + save
  settings.tsx       server URL + unpair
  agents/
    index.tsx        FlatList of agents (pull-to-refresh, unpair header, 401 → /pair)
    [id]/
      index.tsx      detail: name, status, model, profile, team, skills
      chat.tsx       NDJSON chat with recipient identity, authoritative done reconciliation,
                     accepted-approval handling, cancellation, and retry states
src/
  auth.ts            SecureStore wrapper + verifyCredentials + clientFor()
  pair-url.ts        pure TS URL parser (vitest-tested)
  pairing-attempt.ts duplicate-scan gate
  chat-state.ts      pure transcript/frame reducer
  ndjson.ts          chunk-safe incremental decoder
  theme.ts           Baziu palette + spacing tokens
test/
  pair-url.test.ts
```

## Status

Pairing, agents list, chat (NDJSON streaming), and settings ship end-to-end. Native chat keeps risky
shell commands fail-closed; use web chat when an interactive command approval surface is required.
Inbox + triggers screens remain future mobile work.
