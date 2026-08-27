# @bazilion/mobile

Expo (SDK 54) + Expo Router 6 + React 19 + RN 0.81 + new architecture. Pairs to the
private HTTPS Bazilion web gateway via a QR code minted on the server; the daemon remains on
loopback.

## First run

1. **On the server**: expose the daemon on your LAN.
   ```sh
   bazilion serve --host 0.0.0.0
   ```
   The daemon binds `127.0.0.1:4321` by default and prints a loud warning when
   you bind it beyond loopback — TLS is your responsibility (Tailscale handles
   it for personal networks; reverse-proxy with TLS for anything else).
2. **On the server**: mint a pairing token.
   ```sh
   bazilion token create phone --qr
   ```
   A QR encoding `bazilion://pair?server=<url>&token=<t>` prints in the terminal.
3. **On the phone**: install [Expo Go](https://expo.dev/go) and make sure it's on the same network as the server (or Tailscale, etc.).
4. **On your dev machine**:
   ```sh
   pnpm --filter @bazilion/mobile start
   ```
   Scan the QR the Expo CLI prints with Expo Go → the app loads → grant camera access → point the camera at the **pairing** QR from step 2.
5. The app verifies the device token against protected `/api/auth/whoami`, checks that the returned
   canonical public origin matches, saves `server` + `token` into `expo-secure-store`, and lands on
   the agents list.

## Manual pairing

If the camera flow doesn't work (remote testing, wrong Expo Go version, etc.), tap "Paste URL instead" and paste the `bazilion://pair?…` URL the CLI printed. Same verification path.

## Commands

- `pnpm --filter @bazilion/mobile start` — Expo dev server (reads the Metro/Babel config).
- `pnpm --filter @bazilion/mobile typecheck` — TypeScript check over the mobile tree only.
- Root `pnpm test` picks up `apps/mobile/test/**/*.test.ts` — currently the `pair-url` parser suite.

## Layout

```
app/
  _layout.tsx        root stack + StatusBar
  index.tsx          loads SecureStore → redirects /pair or /agents
  pair.tsx           camera QR scan + manual-paste fallback + verify + save
  settings.tsx       server URL + unpair
  agents/
    index.tsx        FlatList of agents (pull-to-refresh, unpair header, 401 → /pair)
    [id]/
      index.tsx      detail: name, status, model, profile, team, skills
      chat.tsx       NDJSON streaming chat screen
src/
  auth.ts            SecureStore wrapper + verifyCredentials + clientFor()
  pair-url.ts        pure TS URL parser (vitest-tested)
  theme.ts           Baziu palette + spacing tokens
test/
  pair-url.test.ts
```

## Status

Pairing, agents list, chat (NDJSON streaming), and settings ship end-to-end. Inbox + triggers screens are the next mobile work — paused for now while focus is on the web app.
