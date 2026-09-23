# Releasing Bazilion

**Published 2026-09-23: `0.22.0` is live on npm with `latest`; the `beta` dist-tag points at
0.22.0 (the token cannot delete tags, so it was moved — same outcome); `0.21` → `0.21.0` (the
version-only republish of `v0.21.0-beta.5` that closes the 0.21 line). Umbrella release:
`v0.22.0`. The site's 0.22 page and version claims are deployed. 0.23.0 work starts with BAZ-069
(browser-backed default search) and BAZ-066 (live/human content-Team acceptance).**
The published baseline is `0.21.0-beta.5`. This procedure was rewritten on 2026-09-20 to match the
implemented image-generation candidate and its observed validation. It does not authorize any
version change, merge that triggers publishing, npm/tag operation or website deployment.

[Readiness plan](testing/beta-readiness/README.md) ·
[Current evidence](testing/beta-readiness/evidence-audit.md) ·
[Freeze record](testing/0.22.0-freeze.md) ·
[BAZ-059 acceptance](backlog/BAZ-059-acceptance.md)

## 1. Release scope and required decision

The next feature beta is BAZ-059: default-off image generation through the four implemented
OpenRouter/OpenAI/ChatGPT selections, enablement-based Automatic routing, daemon-owned dispatch
and existing Results/Team Policy. No social publication, editorial engine, additional models or
connectors are required for this release. Further implementation is limited to demonstrated defects
unless the operator deliberately reopens scope.

Before release approval:

- Review the candidate and obtain current Node 24/platform PR checks, artifact identity and affected
  regression evidence. A Linux/Node 26 local pass does not replace those checks.
- Qualify each advertised image selection with approved account/spend/usage access; observe the
  browser generation/rework/restart journey and a real protected-origin image turn. Synthetic
  provider and configured-operator Docker evidence must remain labelled as such.
- Decide explicitly whether the abandoned-private-output limitation is acceptable: a crash after
  capture but before delivery authorization can reclaim the bytes despite possible provider charges.
  Keep that warning visible if accepted; otherwise fix and requalify. Never bypass disclosure policy.
- Disposition the 14 existing whole-tree lint errors; changed-file lint passing is not a waiver.
- Prepare matching release/upgrade notes and website changes, and archive redacted evidence outside
  temporary local storage. Record remaining limitations and the approving reviewer/operator.

Broader independent usability, multi-browser/accessibility, larger/active recovery and soak qualification
has its own maturity decision in the readiness plan. A feature beta does not qualify `1.0.0-beta.1`.
No critical safety or core-task defect may be silently exempted by calling the release a beta.

## 2. Changesets and the exact 0.22 transition (re-verified 2026-09-21)

The fixed public group is **`bazilion`, `@bazilion/client`, `@bazilion/api-types`**. The verified
recipe (executed for real in a scratch copy on 2026-09-21):

1. **Seed commit:** set the three public packages to unpublished `0.22.0-beta.0`; set `pre.json`
   `initialVersions` to the published `0.21.0-beta.5` baseline and empty its consumed
   `changesets` list.
2. `changeset version` — consumes the four candidate changesets with correct attribution;
   versions read `0.22.0-beta.1`.
3. `changeset pre exit`, then `changeset version` again — the suffix is stripped to **exactly
   `0.22.0`** and `pre.json` is deleted. One version commit; fix the changelog header if it still
   reads beta.1.

Rejected shortcuts (both rehearsed, both wrong): unseeded pre-mode version plans
`0.21.0-beta.6`; pre-exit-first strips to `0.21.0` while consuming the pending changesets
unapplied. Publication dist-tags: `0.21.0` final republishes the beta.5 commit, `0.22.0` takes
**`latest`**, then the `beta` dist-tag is removed — all under the operator's explicit
publication authorization.

<details><summary>Superseded 0.22.0-beta.1 recipe (for the record)</summary>

With current package versions/pre-state, the pending minor changeset plans
**`0.21.0-beta.6`**, not a 0.22 target. A normal automatically generated version PR was not
sufficient under the beta plan. A disposable-copy rehearsal executed the installed Changesets
version command successfully using:

1. All three public package versions seeded at **unpublished `0.22.0-beta.0`**.
2. Their `pre.json` initial versions set to the published `0.21.0-beta.5` baseline, preserving the
   already-consumed changeset IDs so old changesets are not replayed.
3. The new BAZ-059 changeset applied in pre mode, producing **exactly `0.22.0`** in all three.

</details>

This is a tested preparation recipe, **not applied repository state**. Incorporate the transition
deliberately into the reviewed version PR. Coordinate the release bot/main-branch updates so it
cannot overwrite that preparation. The rehearsal disabled the GitHub changelog plugin only in
scratch to avoid network access; real changelog generation
and resulting notes still need review. Do not copy that scratch configuration into production.

Before approving the real version PR, inspect the release plan, all three final versions, lockfile,
changelogs, consumed changesets and unchanged released migrations. Rebuild, pack and test the final
versioned artifact. Record its SHA-256 and reviewed source commit; a beta.5-labelled local candidate
tarball is not that artifact. Verify the intended prerelease dist-tag and that `latest` will remain
on the stable release. Exiting pre mode or preparing 1.0 is a separate explicit decision.

## 3. End-to-end release flow

1. **Implementation PR:** include the scoped changeset and truthful evidence/limitations. Complete
   review and required PR checks before landing. Do not combine unrelated feature expansion.
2. **Version PR:** the main-branch Release workflow opens/updates it while changesets are pending.
   Apply/review the deliberate train transition above instead of accepting beta.6 automatically.
3. **Authorization checkpoint:** confirm exact candidate/artifact, required evidence, support notes,
   residual-risk decisions and release authorization **before merging the version PR**. That merge
   can cause automatic npm publication; it is not a harmless preparation step.
4. **Publish workflow:** when no changesets remain and versions are ahead of npm, the workflow runs
   build/Changesets publish with npm provenance and pushes per-package tags. Observe the actual
   result; an interrupted workflow is not grounds for a blind rerun or duplicate publication.
5. **Verify public artifacts:** inspect versions, intended dist-tags, provenance and package tags;
   smoke the exact published version through the documented installation path in a clean fixture.
   Do not claim public installation evidence from the earlier local tarball smoke.
6. **Umbrella release:** after confirmed publication, create the authorized `vX.Y.Z` GitHub release
   targeting the exact released commit with reviewed notes. Mark beta releases as prereleases, not
   the latest stable release. Per-package automatic GitHub Releases are disabled; package tags still
   exist. Do not target a moving `main` that has advanced beyond the released source.
7. **Upgrade/closure:** add the published tag as an upgrade source in
   `scripts/migration-upgrade-matrix.mjs`, run it, then fill story `release:` metadata and Done rows.
   Do not close BAZ-059 just because its local implementation or version rehearsal passed.
8. **Website:** merge/deploy the reviewed matching documentation only with authorization and after
   confirming the referenced release exists. Main-branch updates in the separate website repository
   deploy automatically; do not treat them as draft-only changes.

The currently inspected PR workflow includes type/test/build/pack, packed-installer, source-upgrade
and security jobs. The main release workflow reruns typecheck/test before build/publish, not all
manual browser/Docker/live/human gates. Verify branch rules and required checks; do not infer them
from workflow YAML or assume the publication path enforces the whole readiness plan.

## 4. Operator-facing notes and website

Every release packet states:

- What changed and whether it is opt-in; supported platforms and exact install/version selection.
- Which prior versions upgrade in place, backup/snapshot behavior, failure recovery and that downgrades
  are unsupported. Distinguish source-worktree sentinel tests from populated installed-home evidence.
- Which image credentials/destinations incur API billing versus account-dependent subscription usage;
  Ready is local configuration, not entitlement. Automatic never falls back after errors.
- Rework is a new generation; request limits are not precise dollar budgets; cancellation is not a refund.
- Private/held versus authorized Results, restart retention, tombstones and the accepted private-loss
  limitation. No guaranteed recovery or backend-model attestation beyond actual evidence.
- Known gaps and any supported-scope narrowing. No claim that human usability, all providers or a
  multi-day soak passed when only deterministic/projection checks were executed.

Update `/home/patri/coding/bazilion-web` from the confirmed source contract: configuration/image use,
Results, upgrade guidance, release listing and the 0.22 minor page. Follow that repository's release
instructions and `skills/release-notes/SKILL.md`; run `pnpm check:docs` there before review/deployment.
Keep links/redirects, visible package versions and platform limits consistent. Do not announce the
candidate as published while credentials, risk decisions or release authorization are still pending.

Presentation conventions:

- Website patches and prereleases share their minor's page, with distinct sections/anchors rather
  than a page per patch/beta counter.
- Stable patch release notes fold into the existing minor's presentation, including its GitHub
  umbrella notes; preserve exact package/tag/version references. Beta umbrella releases retain
  their explicit prerelease identity.
- npm provenance is a build attestation, not a security/quality certificate; describe it accurately.

## 5. Version ladder

```text
0.20.0          last recorded stable feature release
0.21.0-beta.5   published hardening baseline
0.22.0   published 2026-09-23 (image generation, bounded discovery, Pi 0.87.1)
1.0.0-beta.1    separate broader readiness and operator decision, not automatic
1.0.0          separate stable-release decision
```

Reconfirm actual registry/tag state before publishing. Preparing documents or passing a rehearsal
changes none of these release permissions.
