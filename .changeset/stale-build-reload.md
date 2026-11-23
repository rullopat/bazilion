---
"bazilion": patch
---

A browser tab left open across an upgrade no longer shows "Could not load this page" with "Failed to fetch dynamically imported module" when it opens the Connections map or another part it had not loaded yet: it reloads itself once to get the new version, and otherwise says that Bazilion was updated and offers **Reload**. ⌘K or Ctrl+K pressed while a dialog is still closing opens **Jump to** again (0.57.0 ignored it then).
