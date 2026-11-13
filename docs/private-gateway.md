# Private web gateway

To use Bazilion from a laptop or phone elsewhere, publish the web UI over Tailscale Serve:
tailnet-only HTTPS in front of the loopback web listener. The daemon and the web UI both stay on
loopback. Tailscale Funnel, a public reverse proxy and exposing the daemon directly are not
supported.

## Set up

Run Bazilion as an ordinary user, with the exact HTTPS origin in its environment (the daemon and
the web UI both read it):

```sh
export BAZILION_PUBLIC_ORIGIN=https://bazilion.example.ts.net
bazilion dashboard --no-open        # daemon on 127.0.0.1:4321, web UI on 127.0.0.1:4322
tailscale serve --bg --https=443 http://127.0.0.1:4322
tailscale serve status --json       # must show Serve on the web port, never Funnel
```

With `BAZILION_PUBLIC_ORIGIN` set, the daemon refuses a non-loopback `HOST`, cookies become
`__Host-` cookies, and the web UI answers only requests for that host. When the two processes run
as separate services (`bazilion serve` with `HOST`/`PORT`, the web server with
`WEB_HOST`/`WEB_PORT`), give both the same value. Check from outside that ports 4321 and 4322 are
not reachable and that the HTTPS name does not resolve off the tailnet.

## Sign in

Open the HTTPS origin on a tailnet device and log in with a token: the bootstrap token
(`bazilion token show-local` on the server) or a device token. The daemon turns it into a session
cookie; the browser does not keep the token. A session ends after 30 days without use.

Give each browser, phone or remote CLI its own device token, on **Setup → Tokens**
(`/config/tokens`) or with the CLI. The plaintext is shown once; every token has full access
(with `BAZILION_BASH_SANDBOX=off` that includes running host commands through an Agent) and
expires only when you ask:

```sh
bazilion token create personal-laptop               # --expires-days 90 for one that expires
bazilion token list
bazilion session list
```

A remote CLI talks to the same HTTPS origin. Set `BAZILION_SERVER=https://bazilion.example.ts.net`
and `BAZILION_TOKEN=<device token>` in its environment, or save the pair with
`bazilion login --server https://bazilion.example.ts.net --token <device token>`
(`bazilion login --clear` goes back to the local daemon). `login` stores the remote in the local
`auth.json`, so it needs a machine that has run `bazilion serve` once; elsewhere use the two
environment variables.

## Lost device

Revoke its token (`bazilion token revoke <id>` or the Tokens page); every browser session opened
with it ends at once. A single session can be revoked with `bazilion session revoke <id>`. The
bootstrap token cannot be revoked.
