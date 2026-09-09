---
id: BAZ-039
title: Agents discover repository context while working
status: in_progress
size: M
created: 2026-09-07
refined: 2026-09-09
priority: high
note: Agent-led remake implemented and validated locally; PR review, merge and release remain pending.
---

# BAZ-039 — Agents discover repository context while working

## User stories

- **As an operator**, I want to give a Team a coding task in an existing repository without first
  inspecting it or configuring commands, so the Agents do the investigation themselves.
- **As a coding Agent**, I want the applicable repository instructions, working-tree context and
  source-backed command candidates when a task takes me into a directory, so I can choose an
  appropriate next step without guessing or applying another directory's conventions.
- **As a teammate continuing the work**, I want useful findings with their source and scope, so I
  can reuse the investigation while checking whether it still applies.

## Goal

Repository orientation is part of doing a task. The operator supplies an ordinary request such as
“Fix the login bug”; no context-preview visit, saved check list, or coding-environment toggle is
required. One Agent can finish the work. Existing teammates can help through normal Team messaging.

This story owns **discovering and understanding** the repository. BAZ-040 owns **trying commands and
preparing the actual execution environment**. Neither story claims that old test results verify
current code. The concrete shared design is [Agent-led coding](../design/agent-led-coding.md).

## Agent workflow

1. At coding-capable turn admission, supply bounded root instructions and repository identity through
   the existing daemon resolver. Distinguish private Agent instructions from repository instructions.
2. As the task identifies a path, the Agent calls `repository_context({ target })` before working
   in the new scope. Return complete applicable root-to-target instructions as a replacement,
   Git state, command candidates, provenance and independent availability reasons.
3. The Agent chooses relevant commands from the findings; discovery does not execute them. An
   ambiguous package manager or conflicting instructions is a finding to investigate, not a guessed
   executable hook. BAZ-040 accepts an ad hoc command without making the operator save it first.
4. Useful recipes can be written to the existing Team memory. Specific handoffs use existing
   `send_message` and reply correlation. Recheck source identity when reusing a recipe; a teammate's
   prose, a memory note or an old tool result is not a fresh instruction snapshot or execution permit.
5. In ordinary chat, explain only relevant discoveries and blockers. The operator can expand the
   source evidence when useful; a repository-inspection dashboard is an optional diagnostic surface.

## Scope and boundaries

- Preserve one Team filesystem root, roster, policy and shared memory. No Project model, new
  discovery database, mandatory preparation role or separate orchestration engine.
- Pi retains the reasoning/tool loop and canonical transcript. Bazilion resolves contained context
  and installs it through the existing Pi integration. Keep ambient context/extension/skill discovery
  disabled; repo `.pi` extensions, includes, Skills and MCP definitions do not activate automatically.
  Installed profile/Agent skills continue through Bazilion's existing skill model.
- Platform/runtime policy and current operator instructions retain priority. Applicable nested
  AGENTS.md specializes broader repository guidance only within its subtree; sibling instructions
  and ancestor files outside the Team cannot enter that scope.
- Root context is automatic for coding-capable turns; targeted lookup is Agent-selected. Do not
  promise universal enforcement by parsing arbitrary Bash commands for every file they may modify.
- Keep the existing read-only implementation: canonical root pinning, deliberate Team-root symlink
  support, contained targets, no nested symlinks/special files/external Git metadata, no recursive
  dependency scanning, no hooks/helpers/network operations from inspection.
- Preserve current limits: 64 KiB per instruction, 128 KiB instruction total, 16 directory levels,
  32 command sources at 64 KiB each/256 KiB total, 32 candidates, 256 KiB serialized report,
  bounded Git inspection (5 seconds/1 MiB output). Limits and incomplete sections are explicit.
- Exact source allowlist remains AGENTS.md plus package.json, pnpm-workspace.yaml, README.md and
  CONTRIBUTING.md along the target ancestry. Node package scripts are structured candidates;
  documentation excerpts remain labelled excerpts. Other stacks still receive instruction/Git
  context and can be investigated through already-authorized tools.
- Missing instructions are normal. Unsafe, unreadable, oversized or changing applicable instructions
  block that scope; unavailable Git or incomplete command discovery does not invalidate good
  instructions. Restricted learning-review workers gain no new tools.
- Workers receive turn-bound context over IPC; Team/root identity is daemon-derived. Reuse existing
  operator API/client/CLI diagnostics, auth/CSRF and egress controls. Do not make private Agent
  findings public merely because the Team page can independently inspect repository files.

## Acceptance criteria

1. Given a linked repository and no saved coding configuration, “Fix the login bug” causes a coding
   Agent to obtain root and relevant nested instructions without any operator dashboard action.
2. A deterministic Agent fixture selects the app's test candidate with source/cwd provenance and
   passes it to BAZ-040 as an ad hoc operation. No configuration or named-check creation is required.
3. Normal and protected turns receive equivalent applicable instruction bytes for the same scope;
   paths remain appropriate to the admitted posture. Private and repository instructions are distinct.
4. An existing teammate can receive an authorized scoped finding and refresh its context. Editing
   AGENTS.md or a manifest between turns invalidates the previous source assumption. Memory cannot
   override the current resolver or grant extra authority.
5. Plain directories, missing Git, incomplete command sources and unsafe instructions yield their
   distinct outcomes. Traversal, symlinks, hostile Git configuration and oversized files retain the
   existing tested boundaries. Inspection executes no project code.
6. Chat shows a concise relevant finding or blocker with optional source details. The operator can
   complete the task without visiting Team setup. CLI/web diagnostics continue to agree.

## Implementation adjustment

Keep the resolver, Pi context replacement, typed IPC, provenance, bounds and security tests from
local implementation. Change the primary acceptance fixture and prompt/tool guidance to the
Agent-led task. Remove operator preview and “Add to checks” from the required journey; inspection
can remain under advanced diagnostics. Do not discard useful safety code to remove the dashboard.

Existing [progress](../BAZ-039-progress.md) proves the previous implementation, not all revised
criteria. The [2026-09-08 refinement](../archive/BAZ-039-2026-09-08-operator-refinement.md) is historical.
The revised Agent task and same-Team reuse are demonstrated in the [remake acceptance](../BAZ-039-040-agent-led-acceptance.md). The story remains in progress until PR delivery and release.

## Dependencies and exclusions

Ship discovery independently; complete the task-driven acceptance alongside BAZ-040. BAZ-041 owns
retained live command logs and code-bound verification; BAZ-042 owns Git review; BAZ-043 owns
separate parallel checkouts; BAZ-045 owns formal specialist verification of a captured change.
This story adds no cloning, installation, Git publication, new role/roster or automatic plugin trust.
