# Managed browser

Each Agent has a browser of its own: the Chrome, Brave, Edge or Chromium installed on the machine,
running on a persistent profile, so cookies and logins carry over from turn to turn. Agents use it
through the `browser_*` tools: they read pages as accessibility snapshots, click, type, fill forms,
switch tabs and take screenshots. Every Agent turn gets these tools while `BROWSER_ENABLED` is on
(the default).

Agents can work in the browser you already have open instead, with your logins: see
[Your running browser](#your-running-browser). The setting is the default, and you can tell an
Agent which one to use in a conversation: see
[Its own or yours, per conversation](#its-own-or-yours-per-conversation).

## Its own or yours, per conversation

**Which browser, unless you say otherwise** on the **Browser** card (`BROWSER_ATTACH`) is where
every conversation starts: the Agent's own browser unless you change it. In a conversation, ask
the Agent to "use my Chrome" or "use your own browser": it switches with `browser_use`, and its
browser tools work there for the rest of that conversation, in later turns too. Other
conversations keep the default.

- Moving to your Chrome asks you first, in the conversation and on Telegram, as a risky command
  does: on every site you are signed in to, the Agent acts as you, and a page it reads must not
  be able to talk it into that. **Allow** lasts for the conversation. In a turn nobody can answer
  (a schedule, a teammate's message), the move is refused and the Agent says so. With your Chrome
  as the default, nothing is asked.
- Going back to its own browser needs nothing. A move made without asking, while your Chrome was
  the default, ends when you change the default: the conversation goes back to the Agent's own
  browser.
- A helper starts in the browser of the conversation that started it; it cannot move to your
  Chrome itself, since nobody can approve that in a helper's turn.
- Your Chrome is reached when the Agent switches, so a Chrome that has not allowed remote debugging
  says so then.
- An Agent works in one browser at a time: switching closes the other one; its profile and logins
  stay. **Browser** in the Agent's side panel names the one it is using.

## Which browser

Without `BROWSER_EXECUTABLE_PATH`, Bazilion uses the first browser it finds in the usual install
places: Chrome, then Brave, Edge and Chromium. On Linux those are paths such as
`/usr/bin/google-chrome`; on macOS the app bundles in `/Applications` and `~/Applications`.

When none is installed, the daemon downloads Chromium once (a few hundred MB on disk) into
Playwright's browser cache: `~/.cache/ms-playwright` on Linux, `~/Library/Caches/ms-playwright` on
macOS, or `PLAYWRIGHT_BROWSERS_PATH`. The download starts when the daemon starts; a browser action
that comes first waits for it. **Browser** in the Agent's side panel shows the download or why it
failed.
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in the daemon's environment turns the download off. On a Linux
machine without a desktop, the downloaded Chromium can still miss system libraries; its start error
names them, and `npx playwright install-deps chromium` installs them.

## How it works

- The browser starts at the Agent's first browser action. The daemon starts the installed binary
  itself on the Agent's profile and connects to it over the DevTools protocol.
- `browser_snapshot` returns the page's accessibility tree. Elements carry refs such as `[ref=e5]`
  that the other tools act on, and every action answers with a fresh snapshot. A long snapshot comes
  in pages of about 24,000 characters; `browser_snapshot {"page": 2}` reads the next one.
- Reading and checking a page: `browser_text` gives the readable text of the page or of one
  element; `browser_errors` the console errors and warnings and uncaught page errors since it was
  last asked; `browser_network` the recent requests with their status or failure, filtered by text
  or method; `browser_take_screenshot` with a `ref` captures one element.
- `browser_wait` waits up to the `seconds` it is given until a text or an element shows, the
  address contains a text, the page settles, or its downloads finish, and says what did not happen.
- `browser_emulate` shows the tab as a device (`"iPhone 15"`, `"Pixel 7"`; Playwright's list), or
  at a width and height, with or without touch, light or dark, in a locale and a time zone, until
  `reset: true` or the tab closes.
- `browser_pdf` saves the page as a PDF, and a file a page downloads is saved: both with the
  Agent's uploads (`uploads/browser/` in its folder, `/inputs/browser/` in Docker), and the result
  says where.
- A browser idle for `BROWSER_IDLE_MS` is stopped. At most `BROWSER_MAX_SESSIONS` browsers run at
  once; when another Agent needs one, the least recently used idle browser is stopped. A browser
  that leaves a call unanswered for two minutes (a hung page) is stopped too, and so is one whose
  turn is cancelled while an action runs; the next call starts it again.

## Settings

Set them on the **Browser** card under **Setup → Tools** (`/config/tools`), where the rarer ones
are under **More settings**, or with `bazilion config set <KEY> <value>`:

| Key | Default | Meaning |
| --- | --- | --- |
| `BROWSER_ENABLED` | `true` | Give Agent turns the browser tools. |
| `BROWSER_EXECUTABLE_PATH` | discovery | Browser binary to run. Without it: see [Which browser](#which-browser). |
| `BROWSER_ATTACH` | `false` | `true` makes conversations start in [your running browser](#your-running-browser); a conversation can [switch](#its-own-or-yours-per-conversation). |
| `BROWSER_ATTACH_URL` | found | DevTools address of the running browser, such as `http://127.0.0.1:9222`. Without it, Bazilion finds the running Chrome or Chromium. |
| `BROWSER_HEADLESS` | `true` | `false` opens a visible window on the desktop the daemon runs in. Not used with a running browser. |
| `BROWSER_ALLOW_PRIVATE_NETWORK` | `false` | Let pages reach loopback and private addresses by turning the SSRF proxy off. Local development only. |
| `BROWSER_IDLE_MS` | `900000` | Stop a browser after this much inactivity (15 minutes). |
| `BROWSER_MAX_SESSIONS` | `4` | Browsers running at the same time. |

Changes apply from the Agent's next turn. A new executable, `BROWSER_HEADLESS`, `BROWSER_ATTACH`,
`BROWSER_ATTACH_URL` or `BROWSER_ALLOW_PRIVATE_NETWORK` value restarts a running browser at its next
action; the other settings need no restart.

To sign an Agent in to a site in its own browser, set `BROWSER_HEADLESS=false`, let the Agent open
the site, and sign in in the window that appears. The login stays in that Agent's profile.

## Your running browser

With `BROWSER_ATTACH=true`, or in a conversation you switched to it, Agents work in the Chrome or
Chromium you have open, signed in wherever you are.

1. In Chrome 144 or later, open `chrome://inspect/#remote-debugging` and allow remote debugging.
2. Choose **My running Chrome** on the **Browser** card under **Setup → Tools**, or run
   `bazilion config set BROWSER_ATTACH true`; or ask an Agent in a conversation to use your
   Chrome.
3. At an Agent's first browser action, Chrome asks whether to allow the connection. Allow it within
   a minute.

Bazilion finds the browser through the `DevToolsActivePort` file in the default profile directory of
Chrome (stable, beta, canary or dev) or Chromium. For any other Chromium-family browser, or a profile
elsewhere, start it with `--remote-debugging-port=9222 --user-data-dir=<directory>` and set
`BROWSER_ATTACH_URL=http://127.0.0.1:9222`. On macOS the system can deny the daemon access to
Chrome's folder; the error says so, and System Settings > Privacy & Security > Files & Folders is
where to allow the terminal that runs Bazilion.

What changes in this mode:

- An Agent sees and drives only the tabs it opens and the tabs those open. Your own tabs are never
  listed, read or closed. The Agent's tabs open in your window.
- On every site you are signed in to, the Agent acts as you. It is told to post, send, buy, delete
  or change settings only when you asked for exactly that. Use this mode with Agents and tasks you
  trust.
- All Agents share one connection. Chrome shows its "controlled by automated test software" banner
  while it is open. When the last Agent's session ends (idle timeout, **Stop it**, daemon
  stop), its tabs close, the connection is dropped and your browser keeps running. The next browser
  action asks Chrome again.
- There is no proxy between your browser and the network. Bazilion checks each request of an
  Agent's tab against the same rules and refuses loopback and private addresses, but a service
  worker's requests, the first request of a tab that a page opened, and a host name whose address
  changes after the check are not covered.
- A download that starts in an Agent's tab is cancelled, and deleted if it finished first. Yours go
  where your browser saves them, and your tabs keep their own settings, such as dark mode. A
  download that a page starts in a tab it has just opened can get through before Bazilion knows the
  tab is the Agent's.
- `BROWSER_HEADLESS` and `BROWSER_EXECUTABLE_PATH` are not used, and an Agent's saved profile is
  left as it is for when it works in its own browser again.

## Network

In an Agent's own browser, all traffic goes through a proxy in the daemon. It refuses loopback, private and link-local
addresses, including host names that resolve to one, and connects only to the address it checked.
Navigation to `file:` and similar local schemes is refused. WebRTC is removed from pages and QUIC is
off, so no traffic goes around the proxy; downloads go through it like any request, and are saved
with the Agent's uploads, never in the browser's own Downloads folder. Service workers can register
and keep running, but their requests go through the same proxy. `BROWSER_ALLOW_PRIVATE_NETWORK=true`
turns off the proxy and the URL check, so `file:` pages open too; WebRTC and QUIC stay off.

## Profile

`~/.bazilion/browsers/<agent-id>/` holds the profile (`user-data/`) and the browser's own home
directory (`home/`). It contains the Agent's cookies, logins and site data. It is separate from the
Agent's and the Team's files, is never mounted into the Docker sandbox and is left out of backups.
Saved passwords stay in the profile, not in your desktop keyring.

- **Stop** quits the browser and keeps the profile. Archiving the Agent does the same.
- **Reset** quits the browser and deletes the profile. Deleting the Agent deletes it too.
- Moving the Agent to another Team keeps both the browser and the profile.
- `bazilion uninstall`, which refuses while the daemon runs, deletes the profiles with the rest of
  the Agent data.

A browser left running by a daemon that crashed is killed the next time that Agent's browser
starts, or when its profile is reset or the Agent is deleted.

## Status, stop and reset

On the web, **Browser** in the Agent's side panel shows whether the browser runs, whether a
profile exists, which browser and mode are used and the last launch error, with **Stop it** and
**Forget its sign-ins** buttons. From the CLI:

```sh
bazilion agent browser status <agent>   # JSON; never starts the browser
bazilion agent browser stop <agent>
bazilion agent browser reset <agent>    # asks you to type the agent id; --yes skips the prompt
```

Stop and reset are refused while the Agent has a turn running.

## Limits

- Sites may still block the browser or show CAPTCHAs, consent walls or logins. The Agent is told to
  stop there and tell you, not to get around them.
- An action uses the refs of the latest snapshot; if the page changed meanwhile, the click can land
  on a changed page. A failed action may still have taken effect, and the Agent is told to check the
  fresh snapshot before trying again.
- Screenshots larger than 4 MB are refused; take one of the visible area instead of `full_page`.
- `browser_pdf` needs the Agent's own browser running headless: a visible window
  (`BROWSER_HEADLESS=false`) and your running browser cannot print to PDF.
- A call that waits longer than `browser_wait` was asked to, by two minutes, stops the browser as a
  hung page would.
- Results are bounded: page URLs and titles are cut at 500 characters, console messages at 2,000,
  and any other text or error at about 28,000 (long snapshots come in pages instead).
- Linux and macOS are supported. Linux is tested in CI; macOS is checked by hand.
