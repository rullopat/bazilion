---
"bazilion": minor
---

**Install Bazilion with one line and nothing else, and on a Mac open it like any app.** `curl -fsSL https://bazilion.com/install.sh | bash` now brings its own Node.js (checked against nodejs.org's checksums) and installs Bazilion for your user, without Volta, shell changes or a password. On macOS it also adds the **Bazilion** app to Applications, keeps Bazilion running in the background from login on, and opens it in your browser already signed in. New commands: `bazilion app install|remove|status` and `bazilion open`. `bazilion dashboard` and `bazilion open` sign the browser in with a one-time link, so the token is needed only on other devices. Also: a browser test's cleanup no longer fails now and then on macOS (it waits for Chrome to close before removing its folder).
