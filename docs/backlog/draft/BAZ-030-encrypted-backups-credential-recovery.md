---
id: BAZ-030
title: Encrypted backups and single-operator credential recovery
status: draft
size: L
created: 2026-08-23
priority: medium
note: Protect the complete auth.json plus database credential bundle produced by BAZ-024 and define bounded recovery for a personal Telegram, web, and mobile server.
---

# BAZ-030 - Encrypted backups and single-operator credential recovery

## User stories

- **As the sole operator of an online Bazilion server**, I want off-server backups encrypted for a
  key I control so losing a backup does not disclose my OpenAI OAuth credential, Telegram bot
  credential, Bazilion bearer tokens, transcripts, or Team work.
- **As an operator restoring after a server failure**, I want decryption and the existing strict
  BAZ-024 validation to complete before Bazilion changes the target home so a wrong key, truncated
  ciphertext, or malicious archive cannot damage a working installation.
- **As an operator responding to suspected credential exposure**, I want one bounded recovery
  procedure that tells me which Bazilion, Telegram, and OpenAI credentials must be invalidated and
  which steps Bazilion can perform locally without pretending it can rotate external accounts.

## Goal

Extend BAZ-024's consistent backup and validated restore contract with client-side authenticated
encryption and an explicit single-operator incident-recovery flow.

An existing backup deliberately contains both `bazilion.db` and `auth.json`. The database holds
encrypted secrets while `auth.json` holds the bootstrap bearer used to derive their encryption key;
possession of both is therefore possession of the OpenAI OAuth refresh credential, Telegram bot
credential, every other stored secret, and the complete Bazilion state. Mode `0600` protects a file
on a correctly administered host, but it does not protect a copied archive, cloud-sync mistake,
lost backup disk, or exposed object-store entry.

## Security boundary

```text
daemon --authenticated backup stream--> trusted CLI --encrypt--> untrusted backup storage
                                                  |
recovery key/identity ----------------------------+

encrypted archive --decrypt to private staging--> BAZ-024 validation --> atomic restore
```

- Encryption happens on the trusted CLI so a passphrase or private identity never reaches the
  Bazilion daemon.
- Backup bytes are authenticated as well as encrypted; corruption or a wrong identity fails before
  tar parsing and before the target home is touched.
- Decrypted bytes exist only in bounded owner-only staging and are removed on success, failure,
  cancellation, and process signals where cleanup is possible.
- BAZ-024 remains the sole archive-shape, path, symlink, SQLite-integrity, schema, and auth/DB pairing
  validator. This story wraps that contract; it does not create a weaker restore path.

## Scope

### Encrypted creation

- Add an encrypted `bazilion backup create` mode using a standard, independently decryptable
  envelope rather than Bazilion-specific cryptography.
- Support a non-interactive recipient-key mode suitable for scheduled VPS backups. If passphrase
  mode is retained after refinement, read it from a TTY or inherited descriptor and never accept it
  as a normal command-line argument, environment variable, URL, or API field.
- Stream daemon response bytes through encryption into an owner-only sibling temporary file, then
  atomically install the completed ciphertext. Never write a complete plaintext archive beside the
  requested destination.
- Give encrypted artifacts an unambiguous extension and authenticated format/version marker.
- Refuse accidental overwrite using the same safe-install behavior as BAZ-024. Partial ciphertext
  must never replace a known-good backup.
- Make plaintext backup creation an explicit, loudly warned compatibility choice once the encrypted
  UX is ready; decide during refinement whether the first release changes the default.

### Encrypted restore

- Detect the encrypted format before extraction and require the matching identity/passphrase.
- Decrypt only into an owner-only staging area, authenticate the complete stream, then invoke the
  existing archive and canonical-schema validators unchanged.
- A wrong key, truncated envelope, modified ciphertext, invalid archive, incompatible schema, or
  mismatched `auth.json`/database pair must leave the target home byte-for-byte untouched.
- Preserve BAZ-024's offline-target ownership lock, staged install, rollback, linked-Team behavior,
  and recovery-required state.
- Do not silently accept a plaintext archive when the operator requested encrypted-only restore.

### Credential inventory and recovery

- Add an authenticated/local security report that identifies the credential classes captured by a
  backup without printing their values: bootstrap token, active web/mobile tokens, OpenAI OAuth,
  Telegram bot token, provider keys, MCP bearer tokens, and other configured secrets.
- Define a local bootstrap-rotation operation that:
  - requires the daemon to be stopped and the target home ownership lock to be held;
  - validates the current `auth.json`/database pair first;
  - decrypts every readable secrets row with the old bootstrap value and re-encrypts it with a new
    cryptographically random bootstrap value;
  - replaces the protected bootstrap `web_tokens` row and `auth.json` as one recoverable staged
    operation;
  - revokes all other Bazilion web/mobile tokens by default, with an explicit reviewed exception if
    preserving them is proven necessary;
  - rolls back or leaves a precise recovery record if filesystem installation fails after the DB
    transaction commits.
- Provide an incident checklist for external credentials Bazilion cannot rotate:
  - revoke/regenerate the Telegram bot token through BotFather, then update Bazilion;
  - disconnect OpenAI OAuth locally, revoke the affected OpenAI session/grant using the supported
    account control, then authenticate again;
  - rotate any provider or MCP credentials reported by the inventory;
  - create a fresh encrypted backup only after rotation finishes.
- Never claim that rotating the local encryption/bootstrap token revokes an already copied OpenAI,
  Telegram, provider, or MCP credential.

### Surfaces

- CLI owns key/identity input, encrypted create/restore, bootstrap rotation, and human-readable
  incident guidance.
- HTTP continues to expose only the authenticated plaintext backup stream needed by the trusted
  client. It never accepts a recovery secret or returns stored secret values.
- Web may show backup sensitivity and recovery documentation, but browser-based archive encryption
  or credential rotation is not required in the first delivery slice.
- Add wire types only if an HTTP-visible capability genuinely needs them; do not invent an API
  merely for CLI-local cryptographic work.

## Out of scope

- Defending against an attacker who currently controls the running Bazilion process, server root
  account, or unlocked operator account.
- Automatically operating BotFather, OpenAI account security pages, provider consoles, or MCP
  services on the operator's behalf.
- Multi-user key escrow, organization recovery officers, shared custody, RBAC, or enterprise KMS.
- Backing up linked Team targets outside `~/.bazilion`; BAZ-024's linked-Team semantics remain.
- Cloud-storage upload, retention schedules, snapshot orchestration, or a hosted backup service.
- Weak home-grown encryption, passwords in argv, or embedding a decryption key beside the backup.
- Treating application-layer encryption as a substitute for OS permissions, disk encryption, SSH
  hardening, or server patching.

## Acceptance tests

- An encrypted backup round-trip restores the same database, auth pairing, agents, Teams, profiles,
  skills, sessions, acknowledgements, and secrets accepted by BAZ-024.
- Ciphertext does not contain recognizable `auth.json`, SQLite, tar, transcript, Telegram token, or
  OAuth fixtures, and modifying any authenticated byte makes restore fail.
- Wrong identity/passphrase, truncation, cancellation, disk-full, cross-device installation, and
  process failure never install a partial output or mutate the target home.
- Decrypted staging and output siblings are owner-only and are cleaned on every handled exit path;
  tests assert no reusable plaintext archive remains.
- Restore reuses the complete BAZ-024 path, link, schema, SQLite integrity/foreign-key, auth-token,
  ownership-lock, install, rollback, and recovery-required checks.
- Bootstrap rotation preserves every decryptable secret value under the new bootstrap credential,
  invalidates the old bootstrap bearer, updates `auth.json`, and revokes the intended device tokens.
- Injected failure at every DB/file boundary either restores the old consistent pair or leaves a
  deterministic recovery record with no state in which neither bootstrap value can open the store.
- Inventory and logs reveal secret names/status only; raw credentials, passphrases, identities,
  decrypted archive bytes, and encryption command lines never enter stdout, stderr, session JSONL,
  HTTP errors, or daemon logs.
- The external recovery checklist distinguishes verified local rotation from operator-required
  Telegram/OpenAI/provider actions and never reports those external credentials as revoked without
  evidence.

## Smallest delivery slice

Ship recipient-key encrypted `backup create` and `backup restore` first, wrapping the complete
BAZ-024 validator and proving atomic failure behavior. Bootstrap rotation and the coordinated
external-credential recovery checklist may follow as the second slice without weakening or delaying
encrypted backup protection.

## Open questions

- Which standard envelope and maintained library provide the best cross-platform recipient support
  without making a shell-installed binary a hidden runtime dependency? `age` compatibility is the
  preferred direction, but refinement must validate Node 24, Windows, macOS, and Linux behavior.
- Should encrypted creation become the immediate default, or should one release require an explicit
  recipient while warning on plaintext creation? A default cannot strand operators who have not yet
  created a recovery identity.
- Is passphrase mode necessary for the first release, or does recipient-only encryption provide a
  safer, automation-friendly contract with fewer secret-input paths?
- Should bootstrap rotation always revoke every non-bootstrap token, or may an explicitly named
  local token survive? The secure default is revoke all.
- Does bootstrap rotation belong in this story's second slice or in a separately refined story once
  the DB/file crash-consistency proof is written in detail?
