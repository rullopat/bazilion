---
'bazilion': minor
'@bazilion/client': minor
'@bazilion/api-types': minor
---

**Profile Groups (BAZ-002)** — preconfigured team templates that spawn N agents into a target group in one atomic call.

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
