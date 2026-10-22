# Security acceptance gate

The deterministic personal-server security gate is:

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

## What the gate establishes

An offline suite pass, live `bazilion gateway preflight`, release commit and published release
are separate facts. A green offline gate is not a deployment or penetration-test claim. It does not inspect the live
tailnet, firewall, reverse proxy, cloud account, third-party logs, dependency supply chain, or
unknown vulnerabilities.

## Failure handling

The runner removes its private temporary Vitest report only after successful execution and report
validation. Failed/partial/missing/malformed reports retain their diagnostic directory; treat all
such output as potentially sensitive. Reproduce a failure with the exact file and test name from the manifest. If a temporary
artifact must be preserved for diagnosis, first inspect it for bearer/cookie/CSRF values, OAuth or
Telegram credentials, encrypted-secret plaintext, and private host paths; retain only a redacted
copy outside the repository.
