# Releasing

How a Bazilion release happens end to end, including the presentation conventions
for release notes.

## The flow

1. **Changesets** land on `main` with every shipped BAZ (`pnpm changeset` — the
   fixed version group bumps `bazilion`, `@bazilion/client`, `@bazilion/api-types`
   together).
2. The **Release workflow** opens/updates the `chore(release): version packages` PR;
   merging it publishes to npm (with provenance) and pushes the per-package tags.
3. The **umbrella GitHub release** (`vX.Y.Z`) is hand-crafted after each publish:
   `gh release create vX.Y.Z --target main --title … --notes …`. Per-package
   auto-releases are suppressed (`createGithubReleases: false`) — the Releases page
   shows only the umbrella tags.
4. **Bump the release upgrade matrix** (`scripts/migration-upgrade-matrix.mjs`): the
   released tag becomes an `upgrade` entry, so the next release proves homes can
   migrate from this one.
5. Fill the `release:` frontmatter and Done-table rows of the shipped BAZs.

## Pre-releases

The repo uses changesets **pre mode** (`pnpm changeset pre enter beta`). Version
ladder agreed 2026-09-17:

```
0.20.0          last stable feature release
0.21.0-beta.1   pre-beta checkpoint (schema contract, surface cleanup)
0.21.0-beta.N   hardening stories land (BAZ-049–052)
1.0.0-beta.1    beta criteria met — fix-only from here
1.0.0
```

Prerelease versions sort correctly against stable tags (`0.21.0-beta.1 < 0.21.0 <
1.0.0-beta.1`), and npm's `latest` dist-tag keeps pointing at the last *stable*
release — install prereleases explicitly.

## Presentation conventions (release notes + website)

- **Patch releases fold into their minor's page.** `0.19.1` is not its own page —
  its notes are appended to the `0.19.0` page/section ("0.19.0 (incl. 0.19.1)").
  Applies to the website's release listing and to GitHub umbrella releases: for a
  patch, edit the existing minor's release instead of creating a new page.
- Every release's notes state the **upgrade path in operator terms**: which prior
  versions upgrade in place, what happens on failure, downgrades unsupported.
- Note the provenance: npm packages carry the "Built and signed on GitHub Actions"
  attestation.
