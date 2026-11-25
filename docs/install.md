# Installing Bazilion

## The one-line installer (macOS and Linux)

```sh
curl -fsSL https://bazilion.com/install.sh | bash
```

It needs nothing installed first, and asks for no password. On a Mac, open **Terminal** (type
"Terminal" in Spotlight), paste the line and press Return. The script is
[`scripts/install.sh`](../scripts/install.sh); the website serves a copy.

- **Node.js**: its own copy of Node.js 26.12.1, downloaded from nodejs.org and checked against
  its published checksums, in `~/.local/share/bazilion/node`. A Node installed some other way is
  left alone and not used.
- **Bazilion**: the npm package, installed by that Node into `~/.local/share/bazilion`, with a
  `bazilion` command in `~/.local/bin`. Shell settings are not changed: when `~/.local/bin` is
  not in your `PATH`, the script says so.
- **On macOS**, it then runs `bazilion app install` and `bazilion open` (below): Bazilion runs in
  the background, the Bazilion app is in Applications, and the browser opens signed in. On Linux
  it says how to start Bazilion: `~/.local/bin/bazilion dashboard`.

Running the line again updates Bazilion to the latest release and restarts it. Settings, all
optional: `BAZILION_VERSION` (a release instead of the latest), `BAZILION_PORT` and
`BAZILION_DAEMON_PORT` (4322 and 4321 otherwise), `BAZILION_NO_OPEN=1` (print the sign-in link
instead of opening it), and `BAZILION_PACKAGE` (a package file to install, for testing).

With Node.js 26.12.1 or a later 26.x already installed, `npm install -g bazilion` works as well;
`bazilion app install` then gives that install the app.

## The Bazilion app (macOS)

`bazilion app install` makes two things, both running this very install of Bazilion:

- **A background service**: a launchd agent in `~/Library/LaunchAgents/com.bazilion.dashboard.plist`
  that runs `bazilion dashboard --no-open` from login on, and again within seconds if it fails.
  macOS may say that `node` added an item that can run in the background; it is listed, and can
  be turned off, under **System Settings → General → Login Items**. What it prints goes to
  `~/Library/Logs/Bazilion/com.bazilion.dashboard.log`. The service sees the `PATH` of the
  terminal it was installed from, not the rest of that shell's variables: keep provider keys in
  Bazilion's own settings.
- **Bazilion.app**, in `/Applications` (or `~/Applications` when that cannot be written). Opening
  it runs `bazilion open`: it starts the service if it is not running, then opens the web UI in
  the default browser, signed in. If that fails, a dialog says why.

Run `bazilion app install` again after moving or upgrading the install it runs; it replaces the
app and restarts the service. `bazilion app status` says whether both are there and running;
`bazilion app remove` stops the service and removes the app, the service file and its log, and
keeps your data. A Bazilion already running on the same ports, such as `bazilion dashboard` in a
terminal, keeps them: the service starts once that one stops, or at the next login. A home other
than `~/.bazilion` (`BAZILION_HOME`) gets a service of its own, named after it.

## Signing in

`bazilion dashboard` and `bazilion open` open the browser with a one-time sign-in link: the CLI
asks the daemon for it with the home's token, and the browser gets a session without the token
being pasted. A link works once, for two minutes; a used or expired one leads to the login page,
which says so. `bazilion open --print` prints the link instead of opening it. Another device, or
a browser without the link, signs in with a token, as before (`bazilion token show-local`, or a
device token from `bazilion token create`).

## Removing Bazilion

```sh
~/.local/bin/bazilion app remove           # macOS: the app and the background service
~/.local/bin/bazilion uninstall --all      # your data in ~/.bazilion, after asking
rm -rf ~/.local/share/bazilion ~/.local/bin/bazilion
```

`bazilion uninstall` refuses while the Bazilion app's service is installed, since the service
would start Bazilion again.
