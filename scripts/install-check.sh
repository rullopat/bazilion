#!/usr/bin/env bash
# Runs scripts/install.sh as a new user would, on a package file, and checks what it left:
#
#   bash scripts/install-check.sh path/to/bazilion-x.y.z.tgz
#
# Everything happens in a scratch HOME with a bare environment (no Node on the PATH), on ports
# 54321 and 54322 unless BAZILION_DAEMON_PORT and BAZILION_PORT say otherwise. On macOS it then
# opens the Bazilion app once, restarts it after a crash, installs again and removes it all. On
# Linux it starts and stops `bazilion dashboard`.
#
# Opening the app opens the default browser signed in, and a browser keeps cookies per host, not
# per port: on a computer where you use Bazilion, that session would replace yours. CI opens it;
# on your own Mac set SKIP_OPENING_APP=1.

set -euo pipefail

package="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
root="$(cd "$(dirname "$0")/.." && pwd)"
web_port="${BAZILION_PORT:-54322}"
daemon_port="${BAZILION_DAEMON_PORT:-54321}"
web="http://127.0.0.1:${web_port}"
scratch="$(mktemp -d)"
user_home="${scratch}/home"
mkdir -p "$user_home"
dashboard=""
# Whatever happens, nothing is left running or registered.
cleanup() {
  if [ -x "${user_home}/.local/bin/bazilion" ] && [ "$(uname -s)" = Darwin ]; then
    bazilion app remove >/dev/null 2>&1 || true
  fi
  [ -n "$dashboard" ] && kill "$dashboard" 2>/dev/null || true
  rm -rf "$scratch"
}
trap cleanup EXIT

step() { printf '\n--- %s\n' "$1"; }
fail() {
  printf '\nFAILED: %s\n' "$1" >&2
  [ -d "${user_home}/Library/Logs/Bazilion" ] && tail -n 40 "${user_home}"/Library/Logs/Bazilion/*.log >&2 || true
  exit 1
}
# Bazilion's command as the installer left it, in the scratch HOME and a bare environment.
bazilion() {
  env -i HOME="$user_home" USER="${USER:-runner}" PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG=en_US.UTF-8 \
    "${user_home}/.local/bin/bazilion" "$@"
}
run_installer() {
  env -i HOME="$user_home" USER="${USER:-runner}" PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG=en_US.UTF-8 \
    BAZILION_PACKAGE="$package" BAZILION_PORT="$web_port" BAZILION_DAEMON_PORT="$daemon_port" \
    BAZILION_NO_OPEN=1 /bin/bash "${root}/scripts/install.sh"
}
wait_until() { # seconds, description, command…
  local seconds="$1" what="$2"
  shift 2
  for _ in $(seq 1 "$seconds"); do
    "$@" >/dev/null 2>&1 && return 0
    sleep 1
  done
  fail "$what"
}
answers() { curl -sf -o /dev/null "$web/login"; }
down() { ! curl -s -o /dev/null "$web/login"; }
# A sign-in link signs a browser in once: then it is refused.
check_link() {
  local link="$1" jar="${scratch}/cookies"
  case "$link" in "${web}/api/login/link?code="*) ;; *) fail "no sign-in link: $link" ;; esac
  [ "$(curl -s -o /dev/null -c "$jar" -w '%{http_code} %{redirect_url}' "$link")" = "302 ${web}/welcome" ] ||
    fail "the sign-in link did not sign in"
  [ "$(curl -s -o /dev/null -b "$jar" -w '%{http_code}' "${web}/welcome")" = 200 ] ||
    fail "the session from the link did not open /welcome"
  [ "$(curl -s -o /dev/null -w '%{redirect_url}' "$link")" = "${web}/login?error=link" ] ||
    fail "a used sign-in link was accepted again"
}

step "install"
output="$(run_installer 2>&1)" || {
  printf '%s\n' "$output"
  fail "the installer failed"
}
printf '%s\n' "$output"
[ "$(bazilion --version)" = "$(tar -xzOf "$package" package/package.json | sed -n 's/.*"version": "\(.*\)".*/\1/p')" ] ||
  fail "the installed version is not the package's"

if [ "$(uname -s)" = Darwin ]; then
  app="${user_home}/Applications/Bazilion.app"
  check_link "$(printf '%s\n' "$output" | grep -o "${web}/api/login/link?code=[A-Za-z0-9_-]*")"
  /usr/bin/codesign --verify --deep --strict "$app" || fail "the app's signature does not verify"
  label="$(sed -n 's/.*"label": "\(.*\)".*/\1/p' "${app}/Contents/Resources/bazilion-app.json")"
  service="gui/$(id -u)/${label}"
  launchctl print "$service" | grep -q 'state = running' || fail "the service is not running"

  if [ "${SKIP_OPENING_APP:-}" != 1 ]; then
    step "the app starts a stopped Bazilion"
    launchctl kill SIGTERM "$service"
    wait_until 30 "Bazilion did not stop" down
    open -a "$app"
    wait_until 120 "opening the app did not start Bazilion" answers
  fi

  step "a crash is restarted"
  launchctl kill SIGKILL "$service"
  sleep 2
  wait_until 60 "the service did not come back after a crash" answers

  step "uninstall waits for the app to go"
  if bazilion uninstall --yes 2>"${scratch}/uninstall.err"; then fail "uninstall ran beside the app"; fi
  grep -q 'bazilion app remove' "${scratch}/uninstall.err" || fail "uninstall did not say what to do"

  step "install again (an update)"
  output="$(run_installer 2>&1)" || {
    printf '%s\n' "$output"
    fail "the second install failed"
  }
  check_link "$(printf '%s\n' "$output" | grep -o "${web}/api/login/link?code=[A-Za-z0-9_-]*")"

  step "remove"
  bazilion app remove
  wait_until 30 "Bazilion still answers after app remove" down
  if launchctl print "$service" >/dev/null 2>&1; then fail "the service is still loaded"; fi
  [ ! -e "$app" ] || fail "the app is still there"
else
  step "dashboard"
  # Without the function, so that $! is the dashboard itself (env and the command exec into it).
  env -i HOME="$user_home" PATH=/usr/bin:/bin "${user_home}/.local/bin/bazilion" dashboard --no-open \
    --port "$web_port" --daemon-port "$daemon_port" >"${scratch}/dashboard.log" 2>&1 &
  dashboard=$!
  wait_until 120 "the dashboard did not start" answers
  check_link "$(bazilion open --print --port "$web_port" --daemon-port "$daemon_port")"
  kill "$dashboard"
  wait "$dashboard" || true
  dashboard=""
  wait_until 30 "the dashboard did not stop" down
fi

bazilion uninstall --all --yes
printf '\nThe install checks passed.\n'
