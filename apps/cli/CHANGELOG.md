# bazilion

## 0.2.0

### Minor Changes

- [#1](https://github.com/rullopat/bazilion/pull/1) [`27a0456`](https://github.com/rullopat/bazilion/commit/27a0456d244361fbab9c79a61491b00c23727cfb) Thanks [@rullopat](https://github.com/rullopat)! - **Profile Groups (BAZ-002)** — preconfigured team templates that spawn N agents into a target group in one atomic call.

  - New `profile_groups` + `profile_group_members` schema; CRUD via `GET|POST|PATCH|DELETE /api/profile-groups` and `PUT /api/profile-groups/:id/members`.
  - `POST /api/profile-groups/:id/spawn` resolves member name collisions with `-2`, `-3`, … suffixes, auto-creates the target group when its slug doesn't exist, and rolls back the whole batch on any failure (with retry-with-backoff cleanup of orphan agent dirs).
  - CLI: `bazilion profile-group create/list/show/update/edit/delete/spawn`.
  - Web UI: `/profile-groups` list + detail pages under a new "templates" tab that shares space with profiles; the sidebar `+ new ▾` menu has two sections (spawn agent from template / spawn group from template); empty groups show a "spawn team from template" CTA.
  - Wire types: `ProfileGroup`, `ProfileGroupMember`, `ProfileGroupDetail`, `ProfileGroupWithCount`, plus `Create|Update|PutMembers|SpawnProfileGroupRequest` and `SpawnProfileGroupResponse` in `@bazilion/api-types`.

  **Other fixes shipped with this release**

  - Friendly error when deleting a profile that's still referenced by a profile group (was a raw SQLite FK error).
  - Web UI now surfaces daemon errors on profile delete (was silently swallowed).
  - New shared `<Button variant="primary|ghost|danger">` component + `.danger-btn` CSS class — prevents the "bare `<button type='button'>` lost all styling" class of bug.
  - Theme flash on navigation fixed (root layout now uses `data-layout` instead of `className` so the pre-paint `.dark` class survives reconciliation).

## 0.1.1

### Patch Changes

- Release v0.1.1.

  - **Shared USER.md editing for agents.** New `user_md_get` / `user_md_write` tools let any agent in a group update the shared USER.md with optimistic-etag concurrency control. Previously agents could only read it. USER.md is capped at 12 KB (it's inlined into every system prompt).
  - **Provider expansion.** Switched the underlying pi-ai package from `@mariozechner/pi-ai` to `@earendil-works/pi-ai`. New providers wired through `loadProviderConfigFromEnv`: DeepSeek, Fireworks, Together, Moonshot AI, Kimi Coding, MiniMax, Xiaomi MiMo, OpenCode, GitHub Copilot, Cloudflare AI Gateway, Cloudflare Workers AI, llama.cpp.
  - **Web fetch tool hardened.** Readability extraction + markdown output, SSRF guard with DNS-rebinding re-validation, 15-min LRU per `${mode}|${url}`. UA spoofs desktop Safari.
  - **Worker IPC protocol extended.** `UserMdHost` joins `MessagingHost` as a daemon-side RPC surface; the worker no longer needs a SQLite handle to touch shared state.
  - **Web UI polish.** Services config page, root chat layout, theme tokens, FieldRow component.
  - **Backlog system grows.** BAZ-002 (Profile Groups — preconfigured team templates) and BAZ-003 (Hermes-style self-learning loop) added as drafts under `docs/backlog/draft/`.
