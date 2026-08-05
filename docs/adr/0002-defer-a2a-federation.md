# ADR 0002: Defer A2A federation until there is a concrete integration

Status: accepted

Date: 2026-08-05

## Decision

Bazilion will not implement A2A federation or keep an A2A implementation story in the active
backlog. The existing daemon HTTP boundary and Team Policy authorizer are sufficient seams; no
protocol abstraction, compatibility adapter, directory, remote-principal model, or speculative UI
will be added in anticipation of A2A.

Reconsider A2A 1.0 when at least one concrete forcing function exists:

- a user or design partner needs a Bazilion Agent invoked from an A2A-capable platform;
- a supported enterprise platform integration has a defined adopter and acceptance environment; or
- stable A2A 1.0 tooling exists for Bazilion's TypeScript runtime and interoperability is required by
  current users.

The first reconsideration should test the narrow, demonstrated market shape: publishing an explicitly
selected Bazilion Agent to an external enterprise orchestrator. Bazilion-to-Bazilion employee
federation remains a separate decision and must justify its directory, identity, offline delivery,
offboarding, policy, and operational infrastructure.

## Rationale

A2A standardizes discovery and task exchange between independently operated agents. It does not
provide the organizational directory, identity issuer, membership model, offline relay, offboarding,
or cross-install Team state that a useful Bazilion federation would require.

Current public adoption is concentrated in enterprise platform integration, marketplace, preview,
and proof-of-concept surfaces. That validates A2A as a possible future external boundary, but not as
a present user need for Bazilion. Building it now would add a large remotely exposed security and
operations surface while displacing improvements to the product's established local workflows.

## Consequences

- The active backlog contains no A2A work.
- Bazilion continues to optimize local and single-daemon multi-Agent operation.
- A future A2A story begins with a named integration and executable acceptance test, not a generic
  federation architecture.
- Bootstrap/web tokens must never be repurposed as remote A2A credentials if the decision is revisited.

## Research baseline

- [A2A 1.0 specification](https://a2a-protocol.org/latest/specification/)
- [A2A agent discovery](https://a2a-protocol.org/latest/topics/agent-discovery/)
- [Google Cloud Marketplace A2A agents](https://docs.cloud.google.com/marketplace/docs/partners/ai-agents)
- [ServiceNow external A2A agents](https://www.servicenow.com/docs/r/intelligent-experiences/external-agent-protocols.html)
