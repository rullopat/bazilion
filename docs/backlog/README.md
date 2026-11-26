# Backlog

One file per user story, `BAZ-NNN-short-slug.md`, in `draft/` (an idea), `in_progress/` or
`done/`; move the file when its state changes. A story holds the outcome, the scope, a short
as-built summary and the known limits, in 25 to 60 lines. Current behaviour belongs in the
[guides](../README.md). Stories of removed features are deleted (Git history keeps them), and IDs
are never reused, so the gaps below are deliberate.

## Done

| ID | Story | Release | Guide |
| --- | --- | --- | --- |
| [BAZ-003](done/BAZ-003-reviewed-learning.md) | Reviewed learning | 0.12.0 | |
| [BAZ-005](done/BAZ-005-agent-templates-refresh.md) | Agent templates with a two-sided first run | 0.5.0 | |
| [BAZ-006](done/BAZ-006-shell-sandbox-and-approval.md) | Docker shell sandbox and dangerous-command approval | 0.11.0 | [coding](../coding-environments.md) |
| [BAZ-007](done/BAZ-007-simple-installer-and-dashboard.md) | One-command install and dashboard launch | 0.6.0 | [README](../../README.md) |
| [BAZ-008](done/BAZ-008-skill-content-scan.md) | Skill content scan | 0.8.0 | |
| [BAZ-015](done/BAZ-015-team-templates.md) | Team templates | 0.9.0 | [Team Policy](../team-policy.md) |
| [BAZ-016](done/BAZ-016-team-policy.md) | Team Policy | 0.9.0 | [Team Policy](../team-policy.md) |
| [BAZ-018](done/BAZ-018-canonical-teams-cleanup.md) | One Team vocabulary and a clean-install schema | 0.9.0 | [upgrades](../upgrades.md) |
| [BAZ-019](done/BAZ-019-scheduled-triggers.md) | Scheduled triggers | 0.10.0 | [agent engine](../agent-engine.md#9-scheduler) |
| [BAZ-023](done/BAZ-023-worker-oauth-refresh.md) | ChatGPT token refresh during long turns | 0.11.0 | |
| [BAZ-024](done/BAZ-024-consistent-backup-restore.md) | Consistent backup and checked restore | 0.11.0 | [backup](../backup.md) |
| [BAZ-025](done/BAZ-025-agent-loop-circuit-breaker.md) | Agent-message loop breaker | 0.12.0 | |
| [BAZ-026](done/BAZ-026-operator-attention-center.md) | Attention | 0.12.0 | [attention](../attention-notifications.md) |
| [BAZ-028](done/BAZ-028-private-web-gateway.md) | Private web gateway | 0.13.0 | [private gateway](../private-gateway.md) |
| [BAZ-029](done/BAZ-029-single-owner-telegram-pairing.md) | Telegram owner pairing | 0.13.0 | [Telegram](../telegram.md) |
| [BAZ-030](done/BAZ-030-encrypted-backups.md) | Encrypted backups | 0.13.0 | [backup](../backup.md) |
| [BAZ-034](done/BAZ-034-durable-agent-deliverables.md) | Saved results | 0.15.0 | [results](../results.md) |
| [BAZ-035](done/BAZ-035-conversation-library.md) | Conversation library | 0.15.0 | [conversations](../conversations.md) |
| [BAZ-036](done/BAZ-036-visible-follow-up-queue.md) | Follow-up queue | 0.15.0 | [follow-up queue](../follow-up-queue.md) |
| [BAZ-037](done/BAZ-037-structured-agent-questions.md) | Agent questions | 0.15.0 | [questions](../questions.md) |
| [BAZ-038](done/BAZ-038-telegram-attention-notifications.md) | Attention notifications on Telegram | 0.15.0 | [attention](../attention-notifications.md) |
| [BAZ-039](done/BAZ-039-repository-instructions.md) | Repository instructions | 0.16.0 | [coding](../coding-environments.md) |
| [BAZ-041](done/BAZ-041-live-tool-output.md) | Live tool output | 0.17.0 | [change review](../change-review.md) |
| [BAZ-042](done/BAZ-042-git-change-review.md) | Change review | 0.17.0 | [change review](../change-review.md) |
| [BAZ-053](done/BAZ-053-remove-expo-mobile-app.md) | Remove the Expo mobile app | 0.21.0-beta.1 | |
| [BAZ-056](done/BAZ-056-remove-cli-chat-repl.md) | Remove the interactive CLI chat loop | 0.21.0-beta.1 | |
| [BAZ-059](done/BAZ-059-pi-image-generation.md) | Image generation | 0.22.0 | [image generation](../image-generation.md) |
| [BAZ-069](done/BAZ-069-web-research-and-managed-browser.md) | Web research and the managed browser | 0.23.0 | [web research](../web-research.md), [browser](../browser-research.md) |
| [BAZ-071](done/BAZ-071-installation-diagnostics.md) | Installation diagnostics | 0.24.0 | |
| [BAZ-072](done/BAZ-072-web-workspace.md) | One web workspace | 0.50.0 | [workspace](../workspace.md) |
| [BAZ-073](done/BAZ-073-models-by-function.md) | Models by function, connected in one step | 0.51.0 | [models and providers](../models-and-providers.md) |
| [BAZ-074](done/BAZ-074-tools-and-model-names.md) | Tools with typed settings, model names in the menus | 0.52.0 | [tools](../tools.md) |
| [BAZ-075](done/BAZ-075-manage-pages.md) | Manage pages on the shared parts | 0.53.0 | [manage](../manage.md) |
| [BAZ-076](done/BAZ-076-ux-walkthrough.md) | The walkthrough's changes to the web app | 0.54.0 | [workspace](../workspace.md), [attention](../attention-notifications.md) |
| [BAZ-077](done/BAZ-077-live-and-away.md) | Live updates, reaching the operator when away, browser tests | 0.55.0 | [workspace](../workspace.md#live), [coding environments](../coding-environments.md) |
| [BAZ-078](done/BAZ-078-cost-search-and-checks.md) | Usage and cost, failed turns in Attention, conversation search, checks on CI | 0.56.0 | [usage](../usage.md), [Attention](../attention-notifications.md#failed-background-turns), [conversations](../conversations.md#search) |
| [BAZ-079](done/BAZ-079-polish-and-fixes.md) | Polish and fixes: teammates, live lists, kept places, a bug hunt | 0.57.0 | [Team Policy](../team-policy.md), [agent engine](../agent-engine.md#5-tools), [workspace](../workspace.md#live) |
| [BAZ-080](done/BAZ-080-say-what-it-does.md) | Say what it does: connections, roles, names, a Team's day, common connections | 0.58.0 | [MCP](../mcp.md#common-connections), [Team Policy](../team-policy.md), [manage](../manage.md#agents), [workspace](../workspace.md) |
| [BAZ-081](done/BAZ-081-full-conversations.md) | Full conversations: automatic compaction, the whole history, a window meter | 0.59.0 | [conversations](../conversations.md), [agent engine](../agent-engine.md#2-the-worker) |
| [BAZ-082](done/BAZ-082-recall.md) | Recall: the Agent rereads what a summary replaced | 0.60.0 | [conversations](../conversations.md), [agent engine](../agent-engine.md#5-tools) |
| [BAZ-083](done/BAZ-083-mac-app-install.md) | Install without Node: one line, then the Bazilion app | 0.61.0 | [installing](../install.md) |
| [BAZ-084](done/BAZ-084-context-windows.md) | Context windows: from the server or set by hand, never assumed | 0.62.0 | [models and providers](../models-and-providers.md#context-windows), [agent engine](../agent-engine.md#2-the-worker) |
| [BAZ-085](done/BAZ-085-exchanges.md) | Exchanges between Agents: no length limit, stopped by repetition or by you | 0.62.0 | [Team Policy](../team-policy.md#exchanges-between-agents) |

No story is in draft or in progress.
