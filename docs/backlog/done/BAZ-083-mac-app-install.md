---
id: BAZ-083
title: "Install without Node: one line, then the Bazilion app"
status: done
created: 2026-11-25
shipped: 2026-11-25
release: v0.61.0
---

# BAZ-083 — Install without Node: one line, then the Bazilion app

## Outcome

A recruiter who knows nothing about Node could not install Bazilion. The old installer added
Node through Volta, which the Terminal it ran in did not see (`bazilion: command not found`); the
browser then asked for a token from `auth.json`; and closing Terminal stopped Bazilion. Now one
pasted line installs Bazilion with its own Node, and on a Mac leaves an app in Applications, keeps
Bazilion running from login on, and opens the browser signed in. Nobody types a command again.

## Scope

- `scripts/install.sh` (served as bazilion.com/install.sh): Node 26.12.1 from nodejs.org, checked
  against its checksums, and the package, both in `~/.local/share/bazilion`; a `bazilion` command
  in `~/.local/bin`; no shell settings changed, no password. Running it again updates.
- `bazilion app install|remove|status` (macOS): a launchd agent that runs `dashboard --no-open`
  from login on and again when it fails, and Bazilion.app, which runs `bazilion open`.
- `bazilion open`: starts the app's service when Bazilion is not running, then opens the web UI
  signed in; `--print` prints the link.
- One-time sign-in links: `POST /api/auth/sign-in-link` (a token only) and
  `GET /api/login/link`. `bazilion dashboard` opens one too.
- The login page points to the app and `bazilion open`, and says when a link was used or expired.
- `bazilion uninstall` refuses while the app's service is installed.

## As built

- `apps/cli/src/mac-app.ts`: the app is an AppleScript applet made with `osacompile` (the logo as
  its icon, `apps/cli/assets/Bazilion.icns`, made by `scripts/app-icon.sh`), sealed again with an
  ad-hoc `codesign`. Made on the Mac, it is not quarantined, so it opens without Apple's
  notarization. It goes in `/Applications` when that can be written, else `~/Applications`.
- The service and the app run this install's Node and CLI with the installing shell's `PATH`.
  A home other than `~/.bazilion` gets its own label; a scratch `HOME` keeps every file inside it.
- `apps/daemon/src/lib/sign-in-links.ts`: random codes in memory, single use, two minutes.
- CI installs the packed package with the installer on a Mac runner, starts the app, and removes
  it again.

## Known limits

- Terminal is still needed once, for the line. A downloadable, notarized app needs an Apple
  Developer account and is not built.
- Windows is not supported. On Linux the installer installs Bazilion but makes no app or service.
- Updates are not automatic: the same line, run again, updates.
- The service does not see the installing shell's other variables, such as provider keys.
