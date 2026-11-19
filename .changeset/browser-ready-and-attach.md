---
"bazilion": minor
---

The managed browser works from the first start on Linux and macOS, and Agents can work in the browser you already have open.

- **Browser lookup on macOS:** Chrome, Brave, Edge and Chromium are found in `/Applications` and `~/Applications`, and Playwright's Chromium in `~/Library/Caches/ms-playwright`. Before, only Linux paths were checked and a Mac found no browser.
- **Chromium is downloaded when none is installed:** the daemon runs Playwright's installer itself, at startup or at the first browser action. The `@playwright/browser-chromium` dependency is gone: its download ran in an install script, which current npm and pnpm skip. `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` turns the download off. The Agent page shows a download in progress or why it failed.
- **A browser left by a crashed daemon is killed on macOS too**, where the check read `/proc` and found nothing.
- **`BROWSER_ATTACH` and `BROWSER_ATTACH_URL`:** with `BROWSER_ATTACH=true`, Agents work in your running Chrome or Chromium, signed in as you, after you allow remote debugging at `chrome://inspect/#remote-debugging` (Chrome 144 or later). Each Agent sees and drives only the tabs it opened; yours are never listed, read or closed. The SSRF proxy cannot cover this mode: requests of the Agent's tabs are checked one by one instead, which is weaker, and downloads are refused in those tabs. Agents are told they act as you. The browser status reports the mode as `attached`.
