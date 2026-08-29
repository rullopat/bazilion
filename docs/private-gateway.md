# Private web gateway

Bazilion supports one remote-access topology: Tailscale Serve publishes the web application over
tailnet-only HTTPS, while both the web listener and daemon stay on loopback. Funnel, a public
reverse proxy, and direct daemon exposure are unsupported.

Run Bazilion as a dedicated unprivileged user. Set the same exact origin in both service
environments, for example:

```sh
BAZILION_PUBLIC_ORIGIN=https://bazilion.example.ts.net
HOST=127.0.0.1
PORT=4321
WEB_HOST=127.0.0.1
WEB_PORT=4322
```

Start the daemon and bundled web application, then configure Serve explicitly:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:4322
tailscale serve status --json
bazilion gateway preflight
```

The preflight is read-only. It fails unless both listeners are loopback-only, the canonical origin
is exact HTTPS, Serve clearly targets the web port, Funnel is absent, authenticated detailed health
works, and BAZ-027 protected turns are ready. It never changes Serve, Funnel, firewall, or tailnet
policy.

On a fresh installation, the browser login accepts the `auth.json` bootstrap secret only until
provider setup is complete. The daemon exchanges it for an internal expiring, revocable device
identity and a bounded browser session; the browser cookies never retain the bootstrap bearer.
After setup completes, the bootstrap secret is rejected by browser login.

For ongoing access, mint a different device credential for each browser or phone. Native clients
always require a device credential. The plaintext is shown once:

```sh
bazilion token create personal-laptop --expires-days 90 --qr
bazilion token list
bazilion session list
```

Open the HTTPS origin from a tailnet device and log in with its named device token. The daemon
exchanges that token for a bounded server session without retaining the bearer in browser cookies.
To recover from a lost device, revoke that device token; all browser sessions derived from it
become invalid immediately.

Verify externally that ports 4321 and 4322 are not reachable directly and that the HTTPS name is
unreachable off-tailnet. `tailscale serve status --json` must show Serve, never Funnel. See the
Tailscale service manager documentation for making the two Bazilion processes persistent; keep the
environment values identical across them.
