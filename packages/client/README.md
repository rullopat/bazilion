# @bazilion/client

The small `fetch`-based HTTP client for the Bazilion daemon: bearer auth (a string or an async
token supplier), JSON, multipart uploads and NDJSON streaming, with `ApiClientError` carrying the
status and the daemon's `{ error }` body. Wire types come from `@bazilion/api-types`.

A private workspace package: the CLI uses it for every daemon call and the web UI's server
functions use it to reach the loopback daemon; the published `bazilion` package bundles it.

```ts
import { ApiClientError, createClient } from '@bazilion/client'
import type { ChatFrame } from '@bazilion/api-types'

const client = createClient({ serverUrl: 'http://127.0.0.1:4321', token })
const agents = await client.get('/api/agents')
for await (const frame of client.stream<ChatFrame>('POST', `/api/agents/${id}/chat`, {
  message: 'say hi',
})) {
  if (frame.kind === 'event') console.log(frame.event)
}
```

Generic methods: `get`, `post`, `put`, `patch`, `del`, `postMultipart`, `binary` and `stream`,
next to a few typed helpers.
