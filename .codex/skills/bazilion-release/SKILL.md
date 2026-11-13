---
name: bazilion-release
description: Bazilion release workflow for the rullopat/bazilion monorepo. Use when Codex is asked to cut, prepare, validate, publish, tag, announce, or troubleshoot a Bazilion npm/GitHub release, including dependency/provider refresh releases and Changesets version bumps.
---

# Bazilion Release

## Scope

Use this workflow from the root of the `rullopat/bazilion` monorepo. Confirm the root with
`git rev-parse --show-toplevel`; do not rely on a machine-specific absolute path.

Only one package is published to npm: `bazilion` (the CLI in `apps/cli`, which bundles the daemon,
the worker and the web UI). Every other workspace package (`@bazilion/daemon`, `@bazilion/web`,
`@bazilion/api-types`, `@bazilion/client`) is private, and Changesets does not version it.

## Decision points

Ask the user before proceeding when any of these are unclear:

- Release level: `patch`, `minor`, or `major`.
- Whether to publish immediately or only prepare a release commit.
- Whether to push directly to `main` or use a PR branch.
- Whether to create a GitHub Release if the workflow has already published the npm tag.
- Whether to include unrelated dirty worktree files.

Default assumptions when the user says “make a new x.y.z release”:

- Use Changesets.
- Pick the semver level from the change scope: dependency/provider feature expansion is `minor`; bug-only fixes are `patch`; breaking CLI/API behavior is `major`.
- Push `main` directly if the user explicitly requests release/publish.
- Create an umbrella GitHub Release tag `vX.Y.Z` after npm publish succeeds.
- Never include unrelated untracked files.

## Preflight

```sh
git status --short
node -p "require('./apps/cli/package.json').version"
ls .changeset
```

If the worktree has unexpected unrelated changes, stop and ask what to include. Do not remove or revert user files.

## Validate before release

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
(cd apps/cli && pnpm pack --pack-destination "$(mktemp -d)")
node scripts/pack-smoke.mjs <path-to-the-packed-bazilion-x.y.z.tgz>
```

The pack smoke test installs the tarball into a scratch npm prefix, checks that every package the
bundle imports is an installed dependency, serves a fresh scratch home, runs one chat turn against a
stub provider and renders the web login page. The alpha database
contract is clean-install only, so a release that changes the schema needs the changeset to say
that existing homes must be backed up and reset.

If sandbox loopback/process restrictions cause failures such as `listen EPERM 127.0.0.1` or empty CLI subprocess output, rerun the same test command outside the sandbox with escalation. Treat the sandbox failure as environmental only after the escalated run passes.

For dependency/provider releases, also check Pi's provider coverage when relevant, from `apps/daemon`:

```sh
node --input-type=module -e "import { getProviders, getModels } from '@earendil-works/pi-ai'; for (const p of getProviders()) console.log(p, (getModels(p) || []).length)"
```

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

Then version the package and review the result:

```sh
pnpm changeset version
node -p "require('./apps/cli/package.json').version"
git diff --stat
```

`changeset version` bumps `apps/cli/package.json` and prepends the release notes to `apps/cli/CHANGELOG.md`.

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

The `Release` GitHub Actions workflow runs on pushes to `main`: install, typecheck, test, then Changesets publishes `bazilion` and pushes its `bazilion@X.Y.Z` tag.

```sh
gh run list --repo rullopat/bazilion --branch main --limit 5
gh run watch <run-id> --repo rullopat/bazilion --exit-status
```

If the workflow fails, inspect the failing job logs, fix locally, rerun validation, commit, and push again.

## Create GitHub Release

After the workflow succeeds, create the umbrella GitHub Release `vX.Y.Z`. First check whether it exists:

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
