---
"bazilion": patch
---

**Going to another Agent and back keeps where you were, in a tab that was open before the upgrade too.** 0.58.1 stopped the router from carrying a conversation's scroll position to the next Agent, but positions the router had already saved in a tab, which a reload keeps, still landed on every conversation. The router no longer restores scrolling in the workspace at all; each conversation keeps only its own place. Other pages still return to where they were on Back.
