---
'bazilion': patch
'@bazilion/client': patch
'@bazilion/api-types': patch
---

BAZ-049: cross-platform hardening from the new macOS/Windows CI matrix and the fresh-machine installer E2E. Fixes that Windows/macOS users hit: directory fsync on Windows failed every conversation write (chat was broken); fsync on a read-only handle failed bootstrap rotation; symlinked session files were followed on Windows despite the no-follow boundary (now rejected explicitly); the root build's `'./packages/*'` pnpm filters matched nothing on Windows, so `pnpm pack` silently produced an empty tarball; symlinked `BAZILION_HOME` roots broke uninstall's keep-the-root semantics. The workspace-claim identity is now portable off-Linux (same dev/ino semantics without the fd-pinned ancestry window), and the off-Linux turn refusal names its boundary (`safe_reads_unavailable`) as a structured 422 instead of a plain-text 500. Agent turns still require Linux — content-read portability is BAZ-057.
