---
name: bazilion-release
description: Bazilion release workflow for the rullopat/bazilion monorepo. Use when Codex is asked to cut, prepare, validate, publish, tag, announce, or troubleshoot a Bazilion npm/GitHub release, including dependency/provider refresh releases and Changesets version bumps.
---

# Bazilion Release

## Scope

Use this workflow in `/home/patri/coding/bazilion` for the `rullopat/bazilion` monorepo.

Public release packages are fixed together by `.changeset/config.json`:

- `bazilion`
- `@bazilion/client`
- `@bazilion/api-types`

Private ignored packages still matter for build/test compatibility:

- `@bazilion/daemon`
- `@bazilion/web`
- `@bazilion/mobile`

## Decision points

Ask the user before proceeding when any of these are unclear:

- Release level: `patch`, `minor`, or `major`.
- Whether to publish immediately or only prepare a release commit.
- Whether to push directly to `main` or use a PR branch.
- Whether to create a GitHub Release if the workflow has already published npm tags.
- Whether to include unrelated dirty worktree files.

Default assumptions when the user says “make a new x.y.z release”:

- Use Changesets.
- Pick the semver level from the change scope: dependency/provider feature expansion is `minor`; bug-only fixes are `patch`; breaking CLI/API behavior is `major`.
- Push `main` directly if the user explicitly requests release/publish.
- Create an umbrella GitHub Release tag `vX.Y.Z` after npm publish succeeds.
- Never include unrelated untracked files.

## Preflight

Run these checks before versioning:

```sh
git status --short
cat .changeset/config.json
node -e "for (const p of ['apps/cli/package.json','packages/client/package.json','packages/api-types/package.json']) { const j=require('fs').readFileSync(p,'utf8'); console.log(p, JSON.parse(j).version) }"
```

If the worktree has unexpected unrelated changes, stop and ask what to include. Do not remove or revert user files.

## Validate before release

Run validation before committing a release:

```sh
pnpm typecheck
pnpm test
```

If sandbox loopback/process restrictions cause failures such as `listen EPERM 127.0.0.1` or empty CLI subprocess output, rerun the same test command outside the sandbox with escalation. Treat the sandbox failure as environmental only after the escalated run passes.

For dependency/provider releases, also verify pi provider coverage when relevant:

```sh
node - <<'NODE'
import { getProviders, getModels } from '@earendil-works/pi-ai'
for (const p of getProviders()) console.log(p, (getModels(p) || []).length)
NODE
```

Run that from `apps/daemon` if the root package cannot import `@earendil-works/pi-ai` directly.

## Version with Changesets

Create a changeset file unless one already exists:

```sh
cat > .changeset/<short-release-name>.md <<'EOF_CHANGESET'
---
"bazilion": <patch|minor|major>
---

<Concise release summary.>
EOF_CHANGESET
```

Then version packages:

```sh
pnpm changeset version
```

Confirm the fixed public package group moved together:

```sh
node -e "for (const p of ['apps/cli/package.json','packages/client/package.json','packages/api-types/package.json']) { const j=require('fs').readFileSync(p,'utf8'); console.log(p, JSON.parse(j).version) }"
```

Review changelogs and `git diff --stat`. Changesets may update changelogs for dependency-only fixed-package bumps; that is expected.

## Commit and push

Commit intended tracked files only:

```sh
git add -u
git commit -m "release: bazilion X.Y.Z"
```

If `git push origin main` is rejected because remote moved, fetch and rebase:

```sh
git fetch origin main
git rebase origin/main
git push origin main
```

Do not force-push `main` for releases unless the user explicitly approves.

## Watch publish workflow

The `Release` GitHub Actions workflow runs on pushes to `main` and executes install, typecheck, test, Changesets publish, and tag push.

```sh
gh run list --repo rullopat/bazilion --branch main --limit 5
gh run watch <run-id> --repo rullopat/bazilion --exit-status
```

If the workflow fails, inspect the failing job logs, fix locally, rerun validation, commit, and push again.

## Create GitHub Release

After the workflow succeeds, it should push per-package tags such as:

- `bazilion@X.Y.Z`
- `@bazilion/client@X.Y.Z`
- `@bazilion/api-types@X.Y.Z`

Create the umbrella GitHub Release `vX.Y.Z`. First check whether it exists:

```sh
gh release view vX.Y.Z --repo rullopat/bazilion
```

If missing, create and push an annotated umbrella tag on the release commit, then create the release:

```sh
git tag -a vX.Y.Z <release-commit-sha> -m "vX.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --repo rullopat/bazilion --title "vX.Y.Z" --notes "<release notes>"
```

Use release notes that include:

- Short feature/fix summary.
- Dependency/provider changes when applicable.
- Validation result, including `pnpm typecheck` and `pnpm test` counts if known.

If `gh release create` reports the release already exists, do not recreate it. Use `gh release edit` only if the user asks to change notes/title.

## Final response

Report:

- Version released.
- Commit SHA.
- GitHub Actions run result.
- GitHub Release URL.
- Validation commands/results.
- Any files deliberately left uncommitted.
