---
id: BAZ-030
title: Encrypted backups
status: done
created: 2026-08-23
shipped: 2026-08-26
release: v0.13.0
---

# BAZ-030 — Encrypted backups

## Outcome

A backup holds every stored credential together with the `auth.json` that decrypts them, so it
can be encrypted before it touches the disk. With an age recipient the CLI writes only
ciphertext; restore decrypts it with the matching identity.

## Scope

- `backup create --recipient age1…` streams the archive through age encryption and writes
  `<name>.tar.gz.age`; nothing unencrypted is written on the way.
- `backup restore <file>.age --identity <key file>` decrypts into a private staging file, then
  runs the usual archive and database checks ([BAZ-024](BAZ-024-consistent-backup-restore.md)).
- Without `--recipient` the archive is plaintext, like the web download.

## As built

- CLI: `bazilion backup create [file] [--recipient age1…]`,
  `bazilion backup restore <file> [--identity <file>] [--home <dir>] [--force]`.
- Dependency: `age-encryption`; no external `age` binary is needed.
- Guide: [backup, restore and reset](../../backup.md).

## Not built

- Credential inventories, recovery guides and bootstrap-token rotation (removed): a lost
  identity file means the encrypted backup is lost; rotate provider keys at their source.
- Encryption of the web download.
