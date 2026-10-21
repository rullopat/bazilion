# Releasing Bazilion

## Released: 0.23.0

[GitHub release](https://github.com/rullopat/bazilion/releases/tag/v0.23.0) ·
[Single release checklist/evidence index](testing/0.23.0-release-status.md) · [Upgrade guidance](upgrades.md)

All three public packages are0.23.0 on npm `latest`; package and umbrella tags name exact released
commit `b6d354b5e5e6bc8f82febd1a8047f7a7984c7443`. Six exact-head CI jobs and independent final
acceptance preceded the single successful main-triggered publication. Public integrity, registry
signatures and fresh public-byte installations passed. **Npm build attestations are absent**;
the operator explicitly accepted completing this release with that limitation documented. Registry
signatures are not build attestations; no provenance badge is claimed, and no republish was attempted.

This remains alpha maturity and a clean-rebootstrap schema boundary, not an in-place upgrade.
BAZ-059 closes with its accepted ChatGPT-only/evidence limits; BAZ-065/068/069 retain limited scopes,
BAZ-066 remains canceled, and broader live/human campaigns stay unqualified. Website completion is
tracked separately in the single checklist. The homepage must never state the Pi version.

<details>
<summary>Historical0.23 preparation record — superseded by the release checklist above</summary>

## Historical target: 0.23.0 — preparation HOLD

**Current checklist:** [0.23.0 release status](testing/0.23.0-release-status.md). Reuse the applicable
passes below; final candidate commit/CI/artifact review and publication remain pending. Historical
anomalies are retained for final review, not new standalone diagnostic tracks. The dated preparation
records below keep their original applicability; routine amendment chains ended at r30.

[Current r26 local runtime/source qualification](testing/0.23.0-node-runtime-floor-20261021.md) uses
the operator-admitted private Node24.22.0 and enforces `^24.22.0 || ^26.4.0` before CLI/daemon payload
linking or state bootstrap. Dependencies/Pi/package managers did not change. Root/web types,28focused,
2642whole-suite passes (49pending),41helpers and the unchanged397-case gate (1326passes,0pending)
pass. Actual oldNode24.20 source/packed refusal and supported built-CLI checks pass after a documented
verification-helper cleanup correction. Current provisional0.23tarballs include the image controls
and guarded entry layout; old r12 tarballs do not represent this source. No global installation,
standalone crash probe, new live qualification, source commit, publication or website deployment.
Independent final review, final-source/CI, current installed-prefix closure/backup/refusal/affected-
feature qualification and public artifact/provenance/install checks remain required.
[Fresh r27 runtime-floor component review](testing/0.23.0-runtime-floor-component-review-20261021.md)
returned **ACCEPT WITH NOTES**, no issues found. It covers the correction and supplied small artifact
projections, not complete installed closure or final release acceptance; no source change followed.
[Current r28 installed-artifact trial](testing/0.23.0-current-installed-artifacts-20261021.md) now passes
both installed libraries and the unchanged guarded CLI installer on private Node24.22.0. Dependency
metadata/native digests were captured from the actual trial prefix before its confirmed removal.
That npm graph differs from the source-test pnpm graph; it has the same version sets as the admitted
r13 cache tree, not proven identical bytes. No hidden npm lock is claimed. Backup/refusal/affected-
feature qualification, final-source/CI/review and public release gates remain open.
[The r29 installed feature/backup fixture stopped](testing/0.23.0-installed-backup-checkpoint-20261021.md)
after installed qmd/private-image checks and plaintext backup creation passed: its archive-inspection
helper failed `tar.list is not a function`. The failure/fixture are retained; encrypted restore,
exclusion/refusal and packed prior-home checks were not reached. Bounded helper-interop correction
and continuation await operator confirmation. No product failure or backup acceptance is inferred.
[The operator-approved r30 helper correction and new fixture](testing/0.23.0-installed-backup-closeout-20261021.md)
now pass all originally declared installed backup/refusal/affected-feature checks, including encrypted
restore, retained/private/tombstoned Result hashes, browser-root exclusion, three unchanged-target
restore refusals and eight actual packed genuine-prior-home refusals. Only one helper import line
changed; the r29 failure and originals remain intact. No provider request or product/dependency
change occurred. Historical intermittency/risk disposition, final-source/CI/artifact/final-review
and public release/website gates remain open.

### Earlier preparation records — retain their original applicability

**Historical full-suite qualification failure:** [r22 failure record](testing/0.23.0-current-qualification-hold-20261019.md)
retains2,618 passes/17 failures/49 pending on r21 source, plus error-free lint with112 warnings/14 infos.
The approved [r23 offline diagnostic checkpoint](testing/0.23.0-native-vm-diagnostic-20261019.md) now
reproduces the native assertion during standalone VM-context creation with dropped SQLite statements;
the retained-reference control exited normally. This is no production fix or qualification pass.
The exact original worker caller/supported fix and private CWD/output-profile corrections remain open.
A parent API risk rejection interrupted the turn; affected execution stopped with no replay, fallback,
account access or bypass. No397-case gate or release action followed. The historical security pass and
new diagnostic are not substitutes for current qualification or waivers of older intermittency.

The operator-confirmed [r24 routine tranche](testing/0.23.0-routine-qualification-20261019.md) passes
root/web types, whole lint (0errors/112warnings/14infos),41 helper cases,33 selected CLI cases and the
source web build. All eight prior non-chat fixture failures pass under a corrected nested/writable
**private** checkout; seven fake received files were actually created and source hashes stayed fixed.
No native-chat/probe, whole-suite or397-case gate rerun occurred; the native investigation stays
paused. [r25 operator-approved official metadata lookup](testing/0.23.0-upstream-compatibility-metadata-20261020.md)
found the upstream cleanup-hook explanation matching the observed mechanism and its inclusion in
Node24.22.0/26.4.0 release notes. No runtime was installed/tested and no supported-version policy changed.
Private-runtime admission, the support-floor decision and actual qualification of this candidate fix
remain open; publisher notes are not a test pass. No driver/Pi upgrade or production GC workaround.

The authoritative current preparation packet is the
[0.23.0 scope/source freeze](testing/0.23.0-freeze.md) and
[current release checklist](testing/0.23.0-release-checklist.md), recorded 2026-10-19.
The [pnpm 12.14.0 amendment](testing/0.23.0-pnpm-amendment-20261019.md) supersedes the initial
package-manager selection only; the original freeze remains retained. The dirty working-tree
baseline is identified, not approved for publication. The
[uninstall-guidance amendment](testing/0.23.0-uninstall-guidance-20261019.md) resolves H2 with
focused fixture checks; independent final-candidate review remains pending. BAZ-069 and the
explicitly limited BAZ-068/065 slices are accepted; required ChatGPT-only BAZ-059 samples are
satisfied, with final evidence/story/release closeout still required. Optional paid-route trials
and missing broader composed/live/human qualification are not silently converted into passes.

All three public **source manifest versions are now 0.23.0, not published**; the owned minor changeset
was consumed after checked offline generation/idempotence with the unchanged Changesets plugin.
[Current versioned-candidate preparation](testing/0.23.0-versioned-candidate-20261019.md) records the
exact three tarballs, real versioned types/build/pack passes and two installed library smokes.
The first pnpm automatic-store mismatch/build failure and its private-config correction are
preserved; dependency verification was not disabled. [Npm cache population and the guarded installed
CLI trial now pass](testing/0.23.0-guarded-installer-20261019.md): exact0.23 tarball, scripts-off install,
project-positive offline rebuilds, SSR/fake chat/MCP/coding/reset and29 settled owned process outcomes.
[Independent component review BLOCKED the initial harness](testing/0.23.0-installer-independent-review-20261019.md)
on failure-state erasure before uninstall. [Three bounded corrections now pass32 controlled tests](testing/0.23.0-installer-review-corrections-20261019.md),
including19 installer/13 upgrade-helper cases. [Independent corrective re-review ACCEPTED this
component, no issues found](testing/0.23.0-installer-corrective-review-20261019.md);
[receipt r15](testing/0.23.0-installer-component-closeout-20261019.json) binds the review and unchanged
source/artifacts. The historical installed trial was not rerun. No unrestricted npm-script approval,
trial-prefix closure identity inference or whole-release acceptance is implied.

[The single approved serial security sequence](testing/0.23.0-security-sequence-20261019.md)
passed all366 required cases (1,294 selected tests, no failures/skips). The earlier intermittency is
unexplained and retained for final review, not waived. [Registry-only availability](testing/0.23.0-registry-availability-20261019.md)
and [offline allowlisted builds plus eight genuine prior-home refusals](testing/0.23.0-offline-build-matrix-20261019.md)
passed with actual clean old exits/current exit1 and unchanged ledger/state manifests. Those are
scoped source/fixture observations, not final installed0.23 backup/platform acceptance. No personal
home reset, compatibility adapter, unknown-build/agent-skill approval, provider call or publication
is inferred. Final installed CLI/affected features, applicable source/platform CI, risk/story
closeout, exact source commit and fresh independent source/artifact/release acceptance remain open.
[The operator-requested image-retention repair](testing/0.23.0-image-retention-fix-20261019.md)
now has96 focused/crash passes and root types. [Independent review accepts the intermediate retention
component with notes but BLOCKS full recovery/release](testing/0.23.0-image-retention-independent-review-20261019.md):
private images can strand quota without recovery/discard controls. The operator approved the bounded
follow-up: [minimal owner inventory, policy-gated recovery and confirmed discard are implemented](testing/0.23.0-image-recovery-controls-20261019.md),
with125 current focused/CLI passes, root/web types, fresh web build and actual browser projection.
[Fresh independent complete-repair review ACCEPTED WITH NOTES, no issues found](testing/0.23.0-image-recovery-independent-review-20261019.md),
resolving that P1 within the approved contract; no automatic release, provider retry or policy bypass.
The397-case full gate, whole suite and final pack/installed/CI gates remain open; old tarballs do not
contain this runtime/API/UI/wire change.
The confirmed Sisyphus goal authorizes non-publishing candidate commits after local checks and stable
0.23/latest publication plus website deployment **only after applicable gates pass**. No such release
operation has occurred. The website homepage must not state the Pi version, including future updates.
**Do not apply the old 0.22 prerelease transition below**.

The operator approved [bounded recovery of genuine retained BAZ-059 evidence](testing/0.23.0-baz059-evidence-recovery-20261019.md).
Three complete historical logged summaries, image/restart checks, observer source and exact operator
phrase projections are now archived; the original independent review matches its unchanged recorded
SHA256. This does not restore original PNGs/full canonical input/source-pin files or establish a new
live pass. [Fresh independent historical evidence review ACCEPTED WITH NOTES](testing/0.23.0-baz059-live-evidence-review-20261019.md);
[additive corrections](testing/0.23.0-baz059-evidence-closeout-20261019.md) bind the actual journal pin
and limit observer truthiness claims. The old `/tmp` loss and recovery limits remain recorded; no
trial replay, original home/account/daemon access or invented replacement. BAZ-059 remains in progress
for current-candidate and actual release closeout.

This packet authorizes no tests/services/installations, new live requests, version mutation,
commit/merge/push, npm/tag/workflow operation or website deployment. Obtain explicit authorization
for execution and publication boundaries. The main-branch Release workflow can publish
conditionally on any push; merging the version PR is not a draft-only step.

</details>

## Historical 0.22.0 release procedure — not the current checklist

The record below is retained for history. Its version recipes, qualification requirements,
platform counts, baseline claims and old lint counts do not define the 0.23.0 gate. Use the
current packet above; do not reuse historical results as final-candidate evidence.

<details>
<summary>Recorded 0.22.0 procedure and historical decisions</summary>

**Published 2026-09-23: `0.22.0` is live on npm with `latest`; the `beta` dist-tag points at
0.22.0 (the token cannot delete tags, so it was moved — same outcome); `0.21` → `0.21.0` (the
version-only republish of `v0.21.0-beta.5` that closes the 0.21 line). Umbrella release:
`v0.22.0`. The site's 0.22 page and version claims are deployed. The 0.23.0 slate starts with
BAZ-059 live image qualification, then BAZ-069 Agent-led browser research; see the [ordered backlog](backlog/README.md#0230-plan-operator-decision-2026-09-23).**
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

</details>
