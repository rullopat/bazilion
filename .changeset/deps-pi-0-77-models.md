---
"bazilion": patch
---

Upgrade dependencies and refresh the model catalog examples.

**pi 0.75.4 → 0.77.0** — bump `@earendil-works/pi-agent-core`, `pi-ai`, and `pi-coding-agent`, which ships an expanded built-in LLM model catalog. The `/config` provider catalog is already data-driven off pi's `getModels()`, so the new models surface automatically; the hardcoded per-provider example hints (`exampleModelFor` on `/config`, plus the `welcome` page and the `profile`/`provider`/`auth` CLI help) were refreshed to mirror the 0.77 catalog (e.g. `claude-opus-4-8`, `gpt-5.5`, `gemini-3-pro-preview`) and drop entries pi no longer lists.

Also picked up in-range patch/minor updates across the tree (`@tobilu/qmd`, `hono`, `@hono/node-server`, `playwright`, `typebox`, `@biomejs/biome`, `tsup`, and the web/mobile toolchains). Mobile's Expo-pinned native modules (`react-native-reanimated`, `react-native-gesture-handler`, `react-native-worklets`) were intentionally held at the versions Expo SDK 56 blesses.
