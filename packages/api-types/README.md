# @bazilion/api-types

Hermetic TypeScript wire types for the [Bazilion](https://github.com/rullopat/bazilion) HTTP/IPC surface. Zero runtime deps, zero node-only imports — safe to consume from any environment (Node, browsers, React Native, Cloudflare Workers, edge runtimes).

[![npm](https://img.shields.io/npm/v/@bazilion/api-types.svg)](https://www.npmjs.com/package/@bazilion/api-types) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/rullopat/bazilion/blob/main/LICENSE)

This package is the canonical source of truth for everything that crosses the daemon's HTTP wire: entity shapes (`Agent`, `Team`, `Profile`, `Message`, `WebToken`, `AgentTrigger`, `ResolvedAgent`, `LoadedProfile`, …), chat/provider events (`ChatFrame`, `SessionEvent`, `ProviderMessage`, `ToolCall`, `ToolDef`), memory wire types, and request/response envelopes. The daemon, the official `@bazilion/client`, and the bazilion CLI all import their types from here.

## Install

```sh
npm install @bazilion/api-types
```

Requires Node 24+ (or any TypeScript ≥5.0 environment).

## When to use this directly

Most consumers should pull in [`@bazilion/client`](https://www.npmjs.com/package/@bazilion/client), which re-exports the relevant types alongside a typed `fetch` wrapper. Reach for `@bazilion/api-types` directly when:

- you're writing your own HTTP client and only need the type definitions
- you're writing a Slack/Raycast/webhook bridge that consumes daemon payloads
- you're typing inbound NDJSON frames in a stream consumer that doesn't need the full client

## Usage

```ts
import type { Agent, ChatFrame, Profile } from '@bazilion/api-types'

function renderAgentList(agents: Agent[]): string {
  return agents.map((a) => `${a.id} ${a.name} (${a.status})`).join('\n')
}

function handleChatFrame(frame: ChatFrame): void {
  switch (frame.kind) {
    case 'event':
      console.log(frame.event)
      break
    case 'done':
      console.log(`turn finished: ${frame.messages.length} messages`)
      break
    case 'fatal':
      console.error(frame.error)
      break
  }
}
```

## Documentation

- Full project: <https://github.com/rullopat/bazilion>
- Typed HTTP client: <https://www.npmjs.com/package/@bazilion/client>

## License

[MIT](https://github.com/rullopat/bazilion/blob/main/LICENSE)
