---
'bazilion': minor
'@bazilion/client': minor
'@bazilion/api-types': minor
---

Publish a reviewed revision to a code host, and observe the boundary claims where they are claimed.

**Publication to a code host.** An operator publishes a **reviewed** packet's revision: the daemon commits it
to a new branch and opens a pull request. It is a decision, not a workflow — nothing an Agent does causes a
publication, and there is no publication tool, worker or capability, because publishing is deterministic and
no model needs to be in the path at all.

- **Content is the reviewed revision, or nothing.** A snapshot stores digests, never bytes, so every path is
  read from the working tree and checked against the digest the capture recorded. A mismatch refuses and says
  which path; current bytes are never committed under a reviewed packet's name.
- **A refusal sends nothing.** `refused` means no commit, no push, no pull request, and it is the only state
  the schema allows to carry a reason. No host configured, no credential, a protected head branch, a branch
  name that is not a valid ref, an incomplete or unreproducible revision: each is a reason, not an error.
- **Never a force push.** A head branch that already exists on the remote is refused before the commit is
  built, and protected branches are never the head branch.
- **Signed is stated, not assumed.** Commits are unsigned, the record says `signed: false`, and the schema
  refuses to store anything else.
- **The credential is never an argument or a URL** — it travels in the environment as a Git `http.extraheader`
  — and **the remote comes from configuration**, never from the Team repository's own `origin`.
- **The outcome is what the host said.** A pull request is recorded only when the host returned one. A push
  that succeeded without one is a published branch with a note. An interrupted attempt becomes `uncertain`
  and is never replayed, because a push may already have landed.
- Nothing is merged or deployed, and the record never claims otherwise.

Surfaces: `/api/teams/:id/publications`, `bazilion team publish create|list|show`, and a **Publications**
panel on the Team Review page. Configure with `PUBLICATION_HOST` (`github`, or `local` for a bare repository
path), `PUBLICATION_REPOSITORY`, `PUBLICATION_BASE_BRANCH` and the `GITHUB_TOKEN` secret. See
`docs/publication.md`.

**Boundary claims observed where they are claimed.** Three guards existed and were asserted; none was observed
where the product claims it.

- A check's working directory was scoped only in the executor, so a `cwd` outside the workspace was accepted,
  had rows written, and surfaced later as a check that mysteriously did not execute. It is refused at capture
  now, naming the value, before any row exists.
- The rule that an unverified finding cannot be resolved held for Agents and not for the operator: the
  operator route stored every finding as `open`, so a finding about a revision nobody could read was
  resolvable. Both entry points now ask one shared question.
- The web verification panel stated none of the limits the result message states, so "all inside the declared
  paths" read as confinement and a completed request as an approval. One shared definition now renders on both
  surfaces, always rather than only after a check has run.
- A review turn is observed to run nothing with isolation switched on, with a control proving the "no
  container" measurement is not simply always true.
- Every declaration-refusal branch is covered on both producers, with zero rows written.

**Also fixed:** recording a conclusion now settles an `open` packet to `reviewed`, whichever entry point
recorded it. Before, an operator could conclude a packet and it stayed `open` while the same report's
`facts.reviewed` said otherwise — one report, two answers, found by building the feature that first consumes
the state.

**Schema change: 0.19.x homes cannot be upgraded in place.** This release adds the `publications` table and
three indexes; the alpha contract remains clean-install only. Take a `bazilion backup` if you need the state.
