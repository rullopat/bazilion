# BAZ-065 — current-candidate scheduled readiness and restricted-tool negative

## Scope and authorization

Continued prerequisites after the operator's **“lets go”** for live qualification. These are disposable-home,
local canned-provider tests, not the live content campaign or human walkthrough. No live text/image/
search requests; no campaign allocation consumed. Existing operator home/account/Results unchanged.
No machine-wide clock/TZ change, social posting, release or external fault experiment.

## Observed evidence

Artifacts: `/tmp/baz066-scheduled-readiness-UkBWwQ/`.

1. Existing three real-process scheduling suites, with `BAZILION_TEST_DOCKER=1`, explicit parent
   `TZ=UTC`, isolated tool HOME and no inherited provider credentials: **8 passed**, 325.96 seconds
   (`tests.log`). Actual running scheduler, loopback canned LM, cached local Docker image
   `sha256:f06537653ac770703bc45b4b113475bd402f451e85223f0f2837acbf89ab020a` (no pull).
   Covers two due cron minutes/delegation and protected specialist wakes, scheduled container/PWD/
   environment positive, busy deferral, restart-before-due/no catch-up after missed minute, lifecycle
   disable/resume/remove, bounded provider-failure retries and UTC dispatch timestamp.
2. Added **CT-16 host-tool negative** in `apps/cli/test/content-team-scheduling.test.ts`.
   Dedicated fixture daemon now explicitly `TZ=UTC`; cron fields use UTC getters, without changing
   the parent's zone. Real scheduled worker advertises `coding_command` and deliberate container
   `bash`, but not host `read/edit/write`, browser navigation or namespaced MCP.
   Canned model attempts unadmitted `read` of a **non-secret sentinel outside Team/Agent mounts**.
   Tool error reaches model continuation; sentinel never appears in tool replies and remains
   unchanged. One durable occurrence, matching due instant, `succeeded`, one attempt/two provider
   rounds; disable in `finally`, no additional rounds after disable. No auth.json/secret probe.
3. Entire updated scheduling suite: **3 passed**, 265.11 seconds (`scheduling-final.log`). This includes
   the two existing positive controls and new negative; overlap with initial eight is intentional,
   **not eleven distinct tests**.
4. Final **root and web typechecks**, scoped Biome and diff check pass. `fixtures-final.sha256`
   records source pins. Final change after the three-test pass only annotates HTTP callback types;
   no runtime behavior changed. No full-suite or security-gate rerun for this test-only slice.

## First failures retained

- `restricted-negative.log`: initial new oracle incorrectly assumed `bash` must be absent. Protected
  Docker deliberately exposes same-name **container-backed bash**. The test failed after a real
  scheduled turn; this is a **test-oracle defect**, not proof of host execution or a product escape.
  Did not remove the safe capability or weaken production admission to satisfy the assertion.
  Corrected the negative to genuinely unadmitted host `read`; preserved original failure log.
- `typecheck.log`: callback parameters lacked explicit types because the mock fallback union does
  not supply contextual typing. Added HTTP request/response annotations, final checks pass
  (`typecheck-final.log`). No provider retry/replay involved; all transports were synthetic.

## Boundaries and next work

This advances **CT-16's scheduled restricted-host-tool negative** alongside its existing permitted
container positive. It does not qualify all forbidden capabilities, protected discovery/images,
real model judgment, source relevance, current-version editorial approval, human use, or full CT-16 L.
No real-cycle held/rejected concept approval, controlled-clock scheduler DST materialization/
deduplication, supported BAZ-068 recovery or composed live qualification campaign is passed by these tests.
Known failed-workspace recovery limitation remains open; no recovery row/marker deletion.

Before live qualification live admission: remaining reviewed D/S controls/recovery disposition; frozen candidate;
aggregate cross-Agent transport guards/counters; pinned protected search service; exact brief/windows;
normal isolated-home credential setup and creator/operator observation/notes scope. Do not label
these eight/three canned checks as a live campaign merely because they used real cron/Docker.

Test containers settled: pre/post active-container inventories match. Disposable fixture services
stop through their supported test teardown. Private SearXNG services remain stopped; original daemon
remains images/scheduler/browser off and has no worker children. No trigger added to operator home.
