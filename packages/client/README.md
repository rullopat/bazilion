# @bazilion/client

HTTP client for the [Bazilion](https://github.com/rullopat/bazilion) daemon. Zero node-only deps — works in browsers, React Native, and Node.

[![npm](https://img.shields.io/npm/v/@bazilion/client.svg)](https://www.npmjs.com/package/@bazilion/client) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/rullopat/bazilion/blob/main/LICENSE)

A thin `fetch` wrapper over the Bazilion HTTP API: bearer auth (with rotating-token support), JSON + multipart + NDJSON streaming, typed errors. Wire types come from the peer package [`@bazilion/api-types`](https://www.npmjs.com/package/@bazilion/api-types).

## Install

```sh
npm install @bazilion/client @bazilion/api-types
```

Requires Node 24+ (or any runtime with `fetch`, `TextDecoder`, and async iteration).

## Usage

```ts
import { createClient, ApiClientError } from '@bazilion/client'
import type { Agent, ChatFrame } from '@bazilion/api-types'

const client = createClient({
  serverUrl: 'http://127.0.0.1:4321',
  token: process.env.BAZILION_TOKEN!, // or () => fetchToken()
})

// Simple JSON GET
const agents = await client.get<Agent[]>('/api/agents')

// Streaming chat (NDJSON)
for await (const frame of client.stream<ChatFrame>(
  'POST',
  `/api/agents/${agentId}/chat`,
  { message: 'say hi' },
)) {
  if (frame.kind === 'event') console.log(frame.event)
}

// Error handling
try {
  await client.post('/api/agents/missing/cancel')
} catch (err) {
  if (err instanceof ApiClientError && err.status === 404) {
    // ...
  }
}
```

## Token rotation

Pass an async supplier instead of a string for OAuth refresh, mobile keychain reads, etc. — it's invoked on every request:

```ts
const client = createClient({
  serverUrl: 'http://127.0.0.1:4321',
  token: async () => await keychain.readToken('bazilion'),
})
```

## Getting a token

On the daemon machine, mint a per-client token with the CLI:

```sh
bazilion token create "my-app"
```

The plaintext is shown once — pass it to `createClient` as the `token` field. Revoke any time with `bazilion token revoke <id>`.

## API surface

`createClient({ serverUrl, token })` returns:

| Method | Signature | Purpose |
| --- | --- | --- |
| `get` | `<T>(path) => Promise<T>` | JSON GET |
| `post` | `<T>(path, body?) => Promise<T>` | JSON POST |
| `put` | `<T>(path, body?) => Promise<T>` | JSON PUT |
| `patch` | `<T>(path, body?) => Promise<T>` | JSON PATCH |
| `del` | `<T>(path) => Promise<T>` | DELETE |
| `postMultipart` | `<T>(path, FormData) => Promise<T>` | File uploads |
| `stream` | `<T>(method, path, body?) => AsyncGenerator<T>` | NDJSON streaming |

All methods reject with `ApiClientError` on non-2xx responses; the error carries `status` and the daemon's `{ error: string }` body.

## Documentation

- Daemon HTTP API & overall architecture: <https://github.com/rullopat/bazilion>
- Wire types: <https://www.npmjs.com/package/@bazilion/api-types>

## License

[MIT](https://github.com/rullopat/bazilion/blob/main/LICENSE)
