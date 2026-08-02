---
'bazilion': minor
'@bazilion/api-types': minor
---

Add opt-in Docker isolation and dangerous-command approval for agent shell commands. Docker mode runs a same-name Pi
`bash` replacement with scrubbed image and worker environments, no network, a read-only root, one
writable team workspace, and non-recursive bounded read-only memory, skill, and attachment mounts;
host-backed coding tools are hidden so absolute paths cannot bypass the container boundary. Reject
remote Docker contexts and implicit image volumes, surface the posture through shared service
configuration and `bazilion doctor`, and harden host-side memory and file delivery against symlink
escapes. Dangerous mode gates classified commands through turn-scoped daemon IPC, inline web and
TTY CLI decisions, timeout/cancellation cleanup, and non-interactive auto-denial.
