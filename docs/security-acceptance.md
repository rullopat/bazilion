# Security acceptance gate

Bazilion 0.13's deterministic personal-server security gate is:

```sh
pnpm security:acceptance
```

The command builds the production web application, verifies every entry in
`security/acceptance-manifest.json` names an exactly collected Vitest case, and runs the bounded
matrix serially. Missing, renamed, skipped, todo, or failed required cases make the command fail.
The suite uses temporary Bazilion homes and synthetic credentials, DNS answers, Telegram updates,
archives, and upstream responses. It does not contact Telegram, OpenAI, public DNS, Tailscale, or
the operator's Bazilion installation, and it does not require Docker.

The manifest is the reviewable mapping from each adversarial scenario to its canonical BAZ owner
and exact test. Production-gateway cases run the built TanStack application in front of a real
test daemon; simulated services remain outside the production decision boundary. Docker cases
validate the exact hardened invocation and fail-closed checks without claiming a local Docker
daemon was exercised. The repository has no deterministic browser viewport harness, so gateway
security assertions are DOM-independent; this gate does not make a visual mobile-layout claim.

## Release evidence

Record these as four separate states:

1. Offline acceptance passed: preserve the commit SHA and the command's final case count.
2. Live private-gateway preflight passed: on the target server, run the read-only
   `bazilion gateway preflight` and record its timestamp separately.
3. Release committed: record the release commit or tag.
4. Release published: record the registry and GitHub release result.

A green offline gate is not a deployment or penetration-test claim. It does not inspect the live
tailnet, firewall, reverse proxy, cloud account, third-party logs, dependency supply chain, or
unknown vulnerabilities.

## Failure handling

The runner deletes its temporary Vitest JSON report even on failure and prints no synthetic secret
values. Reproduce a failure with the exact file and test name from the manifest. If a temporary
artifact must be preserved for diagnosis, first inspect it for bearer/cookie/CSRF values, OAuth or
Telegram credentials, encrypted-secret plaintext, and private host paths; retain only a redacted
copy outside the repository.
