# @bazilion/api-types

The TypeScript types of everything that crosses Bazilion's HTTP and IPC wire: entities (`Agent`,
`Team`, `Profile`, `Message`, …), chat frames and session events (`ChatFrame`, `SessionEvent`),
and the request and response bodies of the daemon's routes, one module per feature.

A private workspace package: the daemon, the CLI, `@bazilion/client` and the web UI import it, and
the published `bazilion` package bundles it. It has no dependencies and no Node-only imports, so
the browser bundle can use it; keep it that way.

```ts
import type { Agent, ChatFrame } from '@bazilion/api-types'
```
