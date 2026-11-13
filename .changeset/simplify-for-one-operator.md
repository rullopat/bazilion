---
"bazilion": minor
---

Simplify Bazilion for a single local operator.

- Removed features: review packets, specialist verification, publication to a code host, the
  communication approval queue, Team Policy lineage and denial history, the workspace lease and its
  recovery commands, the coding evidence layer (coding tools, receipts, retained command logs and
  source snapshots), device pairing codes and token scopes, and the native Bubblewrap sandbox.
- Docker is the only sandbox. `BAZILION_BASH_SANDBOX` is `off` or `docker` and applies the same way
  to every kind of turn.
- The database schema was reset to a single clean-install schema. An existing home is refused at
  startup: back up the whole home directory, run `bazilion uninstall --yes`, then start Bazilion
  again to bootstrap a fresh home.
- macOS runs commands on the host and is untested. Windows is not supported.
- `@bazilion/client` and `@bazilion/api-types` are no longer published to npm.
- CLI flags renamed: `token create --expires-days` and `login --skip-verify`.
- Team memory keys must end in `.md`.
- A chat sent while its Agent is compacting, resetting or archiving is refused as busy instead of
  waiting. Scheduled triggers and learning reviews run once per occurrence, without retries.
