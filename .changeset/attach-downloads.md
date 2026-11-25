---
"bazilion": patch
---

**Your own Chrome keeps its downloads while Agents work in it.** With browser attach on, your own tabs' downloads silently went nowhere: nothing was saved and nothing showed in Chrome's downloads list.
- Playwright took the whole browser's downloads over, sending them to a temporary folder of its own that was deleted when the connection closed.
- The refusal Bazilion set in an Agent's tab also applied to every other tab.

Now only a download that starts in an Agent's tab is cancelled, and deleted if it finished first. Your tabs also keep their own color scheme: Playwright no longer emulates light mode and focus in them, only focus in the Agent's tabs.
