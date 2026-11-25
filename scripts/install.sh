#!/usr/bin/env bash
# Installs Bazilion for one user, with nothing else needed first:
#
#   curl -fsSL https://bazilion.com/install.sh | bash
#
# - Node.js: its own copy, in ~/.local/share/bazilion/node, checked against nodejs.org's checksums.
#   Any other Node on the computer is left alone and not used.
# - Bazilion: the npm package, in ~/.local/share/bazilion, with a `bazilion` command in
#   ~/.local/bin. Shell settings are not changed.
# - On macOS: the Bazilion app in Applications, Bazilion running in the background from login on,
#   and the browser opened, signed in. Data lives in ~/.bazilion, as with any install.
#
# Running it again updates everything. The website serves a copy of this file.
#
# Settings, all optional:
#   BAZILION_VERSION       the version to install (default: latest)
#   BAZILION_PACKAGE       a package file (.tgz) to install instead, for testing
#   BAZILION_PORT          the web UI's port (default 4322)
#   BAZILION_DAEMON_PORT   the daemon's port (default 4321)
#   BAZILION_NO_OPEN=1     do not open the browser; print the sign-in link instead

set -euo pipefail

INSTALL_NODE_VERSION=26.12.1
INSTALL_DIR="${HOME}/.local/share/bazilion"
BIN_DIR="${HOME}/.local/bin"
WRAPPER_MARK='# Made by the Bazilion installer.'

say() { printf '\n==> %s\n' "$1"; }
fail() {
  printf '\nBazilion could not be installed: %s\n' "$1" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "it runs on macOS and Linux. Windows is not supported yet." ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "this kind of computer ($(uname -m)) is not supported." ;;
esac
command -v curl >/dev/null 2>&1 || fail "the curl command is missing."
command -v tar >/dev/null 2>&1 || fail "the tar command is missing."

sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi
}

NODE="${INSTALL_DIR}/node/bin/node"
NPM="${INSTALL_DIR}/node/bin/npm"
CLI="${INSTALL_DIR}/lib/node_modules/bazilion/dist/cli.js"

# Bazilion's own Node is kept while it is a version Bazilion supports: 26.12.1 or a later 26.x.
# Only that Node is asked, never another one on the PATH.
has_supported_node() {
  [ -x "$NODE" ] &&
    PATH="${INSTALL_DIR}/node/bin:/usr/bin:/bin" node -e 'const v = process.versions.node; const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(v); const p = m ? m.slice(1).map(Number) : []; process.exit(v === v.trim() && m && p.every(Number.isSafeInteger) && p[0] === 26 && (p[1] > 12 || (p[1] === 12 && p[2] >= 1)) ? 0 : 1)' 2>/dev/null
}

install_node() {
  if has_supported_node; then
    say "Node.js $("$NODE" -v) is already installed for Bazilion"
    return
  fi
  local name="node-v${INSTALL_NODE_VERSION}-${os}-${arch}"
  local base="https://nodejs.org/dist/v${INSTALL_NODE_VERSION}"
  local work
  work="$(mktemp -d)"
  say "Downloading Node.js ${INSTALL_NODE_VERSION} for Bazilion (about 50 MB)"
  curl -fsSL "${base}/SHASUMS256.txt" -o "${work}/SHASUMS256.txt" ||
    fail "could not reach nodejs.org. Check the internet connection and try again."
  curl -fL --progress-bar "${base}/${name}.tar.gz" -o "${work}/${name}.tar.gz" ||
    fail "could not download Node.js. Check the internet connection and try again."
  local expected actual
  expected="$(grep " ${name}.tar.gz\$" "${work}/SHASUMS256.txt" | cut -d' ' -f1)"
  actual="$(sha256 "${work}/${name}.tar.gz")"
  [ -n "$expected" ] && [ "$expected" = "$actual" ] ||
    fail "the Node.js download did not match its checksum. Try again later."
  tar -xzf "${work}/${name}.tar.gz" -C "$work"
  mkdir -p "$INSTALL_DIR"
  rm -rf "${INSTALL_DIR}/node"
  mv "${work}/${name}" "${INSTALL_DIR}/node"
  rm -rf "$work"
}

install_bazilion() {
  local spec="bazilion@${BAZILION_VERSION:-latest}"
  [ -n "${BAZILION_PACKAGE:-}" ] && spec="$BAZILION_PACKAGE"
  say "Installing Bazilion"
  # Its own Node runs npm and the package's install scripts.
  PATH="${INSTALL_DIR}/node/bin:${PATH}" "$NPM" install --global --prefix "$INSTALL_DIR" \
    --no-fund --no-audit --loglevel=error "$spec" ||
    fail "npm could not install Bazilion; what it printed above says why."
  [ -f "$CLI" ] || fail "the installed package has no ${CLI}."
}

install_command() {
  local wrapper="${BIN_DIR}/bazilion"
  if [ -e "$wrapper" ] && ! grep -qF "$WRAPPER_MARK" "$wrapper" 2>/dev/null; then
    printf '%s is not ours, so it was left as it is.\n' "$wrapper"
    return
  fi
  mkdir -p "$BIN_DIR"
  cat >"$wrapper" <<WRAPPER
#!/bin/sh
${WRAPPER_MARK} It runs Bazilion with its own Node.js.
exec "${NODE}" "${CLI}" "\$@"
WRAPPER
  chmod +x "$wrapper"
}

install_node
install_bazilion
install_command
version="$("$NODE" "$CLI" --version 2>/dev/null || true)"

ports=()
[ -n "${BAZILION_PORT:-}" ] && ports+=(--port "$BAZILION_PORT")
[ -n "${BAZILION_DAEMON_PORT:-}" ] && ports+=(--daemon-port "$BAZILION_DAEMON_PORT")

if [ "$os" = darwin ]; then
  say "Adding the Bazilion app and starting Bazilion (the first start can take a minute)"
  "$NODE" "$CLI" app install ${ports[@]+"${ports[@]}"} ||
    fail "Bazilion was installed but did not start; what it printed above says why."
  if [ "${BAZILION_NO_OPEN:-}" = 1 ]; then
    link="$("$NODE" "$CLI" open --print ${ports[@]+"${ports[@]}"})"
    opened="installed. Open this link once, within two minutes, to sign in:

  ${link}"
  else
    opened="installed and open in your browser."
    "$NODE" "$CLI" open ${ports[@]+"${ports[@]}"} >/dev/null
  fi
  cat <<DONE

Bazilion ${version} is ${opened}

  - Next time, open Bazilion from your Applications folder, Launchpad or Spotlight.
  - It keeps running in the background, and starts by itself when you log in.
  - To update it, run the same install line again.
DONE
else
  cat <<DONE

Bazilion ${version} is installed. Start it, and open it in your browser, with:

  ${BIN_DIR}/bazilion dashboard
DONE
fi

case ":${PATH}:" in
  *":${BIN_DIR}:"*)
    found="$(command -v bazilion || true)"
    if [ -n "$found" ] && [ "$found" != "${BIN_DIR}/bazilion" ]; then
      printf '\nAnother bazilion command comes first in your PATH (%s): Terminal runs that one.\n' "$found"
    fi
    ;;
  *) printf '\n(For Terminal users: the bazilion command is in %s, which is not in your PATH.)\n' "$BIN_DIR" ;;
esac
