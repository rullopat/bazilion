# Product backlog

One file per user story, organized by state. Each story owns its user outcome, scope, exclusions,
acceptance criteria, unresolved work and concise As-built summary. Done means the accepted scope
shipped, not that every provider, platform or future journey is qualified. Active stories describe
concrete product capability changes or defects; example recipes and validation campaigns are not
standalone implementation work.

- **Draft:** uncommitted ideas or unresolved prerequisites; refine before starting.
- **Todo:** refined and ready to implement.
- **In progress:** active implementation or incomplete acceptance.
- **Done:** shipped within the explicit recorded scope.

Use `BAZ-NNN-short-slug.md` and frontmatter with `id`, `title`, `status`, `size`, `created` and
applicable release dates. Move the same story between state folders rather than creating a
progress/acceptance sidecar. Current behavior belongs in the [product documentation](../README.md).

## Draft (0)

No draft stories currently retained.

The [Telegram roadmap](../telegram-v2.md) retains unnumbered future user stories. It is not an
implementation commitment or supported-feature list. The
[experimental content-Team recipe](../../examples/content-team/README.md) remains an example,
not a product implementation commitment or qualified end-to-end workflow.
Removed stories remain recoverable through Git history; do not reuse their IDs.

## Todo (0)

No stories currently ready to pull.

## In progress (0)

No active implementation stories. Release 0.24.0 shipped the two bounded stories below and the
embedded Pi 1.4.0 upgrade. Codemode and Durable were not included.

## Done (56)

### Released in 0.24.0 within explicit limits

- [BAZ-057 — Ordinary macOS chat](done/BAZ-057-portable-safe-reads.md): bounded macOS arm64
  CLI/API/browser qualification; Linux-only Git/stdio and conservative ownership remain.
- [BAZ-071 — Installation and platform diagnostics](done/BAZ-071-platform-readiness-diagnostics.md):
  independent CLI/web health, support and protected readiness; execution gates unchanged.

### Agent configuration, policy and runtime

- [BAZ-002 — Profile groups](done/BAZ-002-profile-groups.md)
- [BAZ-003 — Reviewed self-learning](done/BAZ-003-hermes-self-learning.md)
- [BAZ-005 — Agent templates](done/BAZ-005-agent-templates-refresh.md)
- [BAZ-006 — Shell isolation and command approval](done/BAZ-006-skill-execution-security.md)
- [BAZ-007 — Installer and dashboard](done/BAZ-007-simple-installer-and-dashboard.md)
- [BAZ-008 — Skill content scan](done/BAZ-008-skill-content-scan.md)
- [BAZ-009 — Configurable Team policy](done/BAZ-009-configurable-agent-harness.md)
- [BAZ-010 — Policy persistence/API](done/BAZ-010-harness-persistence-api.md)
- [BAZ-011 — Policy runtime enforcement](done/BAZ-011-harness-runtime-enforcement.md)
- [BAZ-012 — Policy management web UI](done/BAZ-012-production-harness-web.md)
- [BAZ-013 — Policy CLI](done/BAZ-013-harness-cli-policy-tools.md)
- [BAZ-014 — Communication approvals](done/BAZ-014-harness-communication-approvals.md)
- [BAZ-015 — Policy lifecycle/API](done/BAZ-015-harness-policy-lifecycle-api.md)
- [BAZ-016 — Runtime communication boundaries](done/BAZ-016-harness-runtime-boundaries.md)
- [BAZ-017 — Canonical web editor](done/BAZ-017-harness-web-editor-migration.md)
- [BAZ-018 — Canonical Teams](done/BAZ-018-canonical-teams-cleanup.md)
- [BAZ-019 — Scheduled trigger reliability](done/BAZ-019-scheduled-trigger-reliability.md)
- [BAZ-023 — Worker OAuth refresh](done/BAZ-023-worker-oauth-refresh.md)
- [BAZ-024 — Consistent backup/restore](done/BAZ-024-consistent-backup-restore.md)
- [BAZ-025 — Agent-loop circuit breaker](done/BAZ-025-agent-loop-circuit-breaker.md)
- [BAZ-026 — Operator attention](done/BAZ-026-operator-attention-center.md)
- [BAZ-027 — Credential-minimal protected execution](done/BAZ-027-credential-minimal-protected-agent-execution.md)
- [BAZ-028 — Private gateway](done/BAZ-028-secure-personal-web-mobile-gateway.md)
- [BAZ-029 — Telegram owner pairing](done/BAZ-029-single-owner-telegram-pairing.md)
- [BAZ-030 — Encrypted backups/recovery](done/BAZ-030-encrypted-backups-credential-recovery.md)
- [BAZ-031 — Protected provider coverage](done/BAZ-031-protected-runtime-provider-expansion.md)
- [BAZ-032 — Personal-server security](done/BAZ-032-personal-server-security-acceptance.md)
- [BAZ-033 — Product experience](done/BAZ-033-product-experience-hardening.md)

### Conversations and Agent-led coding

- [BAZ-034 — Durable Results](done/BAZ-034-durable-agent-deliverables.md)
- [BAZ-035 — Conversation library](done/BAZ-035-conversation-library.md)
- [BAZ-036 — Follow-up queue](done/BAZ-036-visible-follow-up-queue.md)
- [BAZ-037 — Structured questions](done/BAZ-037-structured-agent-questions.md)
- [BAZ-038 — Attention notifications](done/BAZ-038-telegram-attention-notifications.md)
- [BAZ-039 — Repository context](done/BAZ-039-repository-coding-context.md)
- [BAZ-040 — Coding readiness](done/BAZ-040-coding-environment-readiness.md)
- [BAZ-041 — Coding command receipts](done/BAZ-041-coding-command-verification.md)
- [BAZ-042 — Captured source changes](done/BAZ-042-git-change-review.md)
- [BAZ-043 — Specialist review](done/BAZ-043-coding-review-handoff.md)
- [BAZ-044 — Specialist verification](done/BAZ-044-specialist-verification-handoff.md)
- [BAZ-045 — Boundary claims](done/BAZ-045-boundary-claims-observed.md)
- [BAZ-046 — Operator-controlled publication](done/BAZ-046-publish-accepted-change.md)
- [BAZ-047 — Schema compatibility](done/BAZ-047-stable-schema-contract.md)
- [BAZ-049 — Platform CI/installer](done/BAZ-049-cross-platform-ci-and-installer-e2e.md)
- [BAZ-050 — Coding UI consistency](done/BAZ-050-post-coding-sequence-ui-consistency-sweep.md)
- [BAZ-051 — Failure visibility](done/BAZ-051-failure-mode-visibility-audit.md)
- [BAZ-052 — Supportability and growth](done/BAZ-052-beta-supportability-gates-and-growth.md)
- [BAZ-053 — Remove Expo app](done/BAZ-053-remove-expo-mobile-app.md)
- [BAZ-055 — Device credentials/pairing](done/BAZ-055-scoped-device-credentials-and-pairing.md)
- [BAZ-056 — Remove CLI REPL](done/BAZ-056-remove-cli-chat-repl.md)

### Released in 0.23.0 within explicit limits

- [BAZ-059 — Image generation](done/BAZ-059-pi-image-generation.md): bounded ChatGPT live scope;
  direct OpenAI/OpenRouter remain live-unqualified; no exact-geometry guarantee.
- [BAZ-065 — Scheduling/recovery](done/BAZ-065-content-team-scheduling-and-recovery.md): limited
  scheduler/process scope; composed D/S and live/human content journey remain unassigned.
- [BAZ-067 — Protected discovery](done/BAZ-067-protected-web-discovery.md): bounded configured
  SearXNG, not native search/browser access for protected turns.
- [BAZ-068 — Workspace recovery](done/BAZ-068-workspace-recovery-surface.md): only known recorded
  owned resources; no arbitrary-host cleanup or unknown-owner force unlock.
- [BAZ-069 — Web research](done/BAZ-069-browser-backed-default-web-search.md): bounded subscription
  acceptance; API-key search remains experimental/live-unqualified and browser access is site-dependent.
