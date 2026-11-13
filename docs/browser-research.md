# Managed browser

Each Agent has a browser of its own: the Chrome, Brave, Edge or Chromium installed on the machine,
running on a persistent profile, so cookies and logins carry over from turn to turn. Agents use it
through the `browser_*` tools: they read pages as accessibility snapshots, click, type, fill forms,
switch tabs and take screenshots. Every Agent turn gets these tools while `BROWSER_ENABLED` is on
(the default); learning reviews do not.

## How it works

- The browser starts at the Agent's first browser action. The daemon starts the installed binary
  itself on the Agent's profile and connects to it over the DevTools protocol.
- `browser_snapshot` returns the page's accessibility tree. Elements carry refs such as `[ref=e5]`
  that the other tools act on, and every action answers with a fresh snapshot. A long snapshot comes
  in pages of about 24,000 characters; `browser_snapshot {"page": 2}` reads the next one.
- A browser idle for `BROWSER_IDLE_MS` is stopped. At most `BROWSER_MAX_SESSIONS` browsers run at
  once; when another Agent needs one, the least recently used idle browser is stopped. A browser
  that leaves a call unanswered for two minutes (a hung page) is stopped too, and so is one whose
  turn is cancelled while an action runs; the next call starts it again.

## Settings

Set them on `/config/services` (**Browser Automation**), or with
`bazilion config set <KEY> <value>`:

| Key | Default | Meaning |
| --- | --- | --- |
| `BROWSER_ENABLED` | `true` | Give Agent turns the browser tools. |
| `BROWSER_EXECUTABLE_PATH` | discovery | Browser binary to run. Without it: the first Chrome, Brave, Edge or Chromium in the usual install paths, then the Chromium Playwright downloaded at install time. |
| `BROWSER_HEADLESS` | `true` | `false` opens a visible window on the desktop the daemon runs in. |
| `BROWSER_ALLOW_PRIVATE_NETWORK` | `false` | Let pages reach loopback and private addresses by turning the SSRF proxy off. Local development only. |
| `BROWSER_IDLE_MS` | `900000` | Stop a browser after this much inactivity (15 minutes). |
| `BROWSER_MAX_SESSIONS` | `4` | Browsers running at the same time. |

Changes apply from the Agent's next turn. A new executable, `BROWSER_HEADLESS` or
`BROWSER_ALLOW_PRIVATE_NETWORK` value restarts a running browser at its next action; the other
settings need no restart.

## Network

All browser traffic goes through a proxy in the daemon. It refuses loopback, private and link-local
addresses, including host names that resolve to one, and connects only to the address it checked.
Navigation to `file:` and similar local schemes is refused. Downloads are refused, WebRTC is removed
from pages and QUIC is off, so no traffic goes around the proxy. Service workers can register and
keep running, but their requests go through the same proxy. `BROWSER_ALLOW_PRIVATE_NETWORK=true`
turns off the proxy and the URL check, so `file:` pages open too; downloads stay refused and WebRTC
and QUIC stay off.

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

On the web, the **Managed browser** card on the Agent page shows whether the browser runs, whether a
profile exists, which browser and mode are used and the last launch error, with **Stop session** and
**Reset profile** buttons. From the CLI:

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
- Results are bounded: page URLs and titles are cut at 500 characters, console messages at 2,000,
  and any other text or error at about 28,000 (long snapshots come in pages instead).
- Tested on Linux. On other systems the browser may work but is untested.
