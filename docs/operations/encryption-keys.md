# Encryption keys (KEK / DEK)

How the server protects secrets at rest: what a root key-encryption key (KEK)
is, how it is generated, how it is configured, and how it is rotated.

Design rationale lives in
[ADR 029](../adrs/029-cryptography-secrets-and-key-lifecycle.md) and
[ADR 039](../adrs/039-signing-key-rotation-and-incident-response.md). This document describes the shipped
implementation.

## The envelope

Zitadel uses envelope encryption. Two layers of keys:

```mermaid
graph TD
    KEK["Root KEK<br>RSA private key<br>from config / file"]
    DEK["DEK — per project<br>32 random bytes, AES-256-GCM<br>row in encryption_keys"]
    Data["Encrypted data<br>tokens, third-party secrets, …"]
    KEK -- " wraps (JWE, RSA-OAEP-256 + A256GCM) " --> DEK
    DEK -- " encrypts (AES-256-GCM) " --> Data
```

|            | Root KEK                                                    | DEK                                                   |
|------------|-------------------------------------------------------------|-------------------------------------------------------|
| Type       | RSA private key (asymmetric)                                | 32 random bytes (AES-256)                             |
| Scope      | Global, one per deployment (plus decrypt-only predecessors) | One active key per project                            |
| Lives in   | Config file or a file on disk                               | `encryption_keys` table, wrapped                      |
| Created by | The operator (or auto-generated for local dev)              | The server, at project creation                       |
| Rotated by | The operator, by adding a new key to config                 | Re-wrapped on KEK rotation; not rotated on a schedule |

The root KEK never encrypts application data directly — it only wraps DEKs. The DEK never leaves the database in
plaintext; it exists in plaintext only in memory, after a successful unwrap.

## Key identity is part of the ciphertext

A wrapped DEK is a JWE compact serialization whose protected header carries the wrapping KEK's ID as `kid`:

```
eyJhbGciOiJSU0EtT0FFUC0yNTYiLCJlbmMiOiJBMjU2R0NNIiwia2lkIjoicm9vdC1rZWsifQ...
```

On decrypt the server reads `kid` from the header and looks up exactly that key (`domain.RootKEKs.GetByKeyID`) instead
of trying every configured key. Two consequences that matter operationally:

- **The KEK ID must stay stable.** The ID is the YAML map key under
  `server.encryption_keys`, or — for keys discovered in the KEK directory — the *file name*. Renaming a config entry or
  a key file makes every DEK wrapped by it unresolvable, even though the key material is unchanged.
- **A KEK may only be removed from config once no DEK references it.** See
  [Rotation](#rotating-the-root-kek).

The algorithms are fixed: `RSA-OAEP-256` for key wrapping and `A256GCM` for content encryption
(`internal/domain/encryption_key.go`). Only RSA keys are accepted; EC/Ed25519 keys are rejected at startup.

## Generating a KEK

### Automatic (local development only)

If `server.encryption_keys` is unset **and** the KEK directory is empty, the server generates a 4096-bit RSA key on
first start, writes it to
`<server.data_dir>/keks/root-kek.pem` with mode `0600`, and prints:

```
created server KEK file at .../keks/root-kek.pem (generated for local/dev only; configure server.encryption_keys for production)
```

The key is reused on subsequent starts as long as `server.data_dir` persists.
`server.data_dir` defaults to a `nextgen-data` directory next to the binary; in the Docker Compose quick start it is
backed by the `nextgen-server-data`
volume. If that directory is wiped, the key is gone and every DEK — and therefore everything encrypted under it — is
unrecoverable.

### Manual (any shared or production deployment)

Generate an RSA private key with your own tooling and hand it to the server through managed secrets:

```sh
# PKCS#1 PEM
openssl genrsa -out root-kek-2026-07.pem 4096

# or PKCS#8 PEM
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out root-kek-2026-07.pem
```

Accepted input formats (`internal/crypto.ParseRSAKey`):

- PEM — PKCS#1 (`RSA PRIVATE KEY`), PKCS#8 (`PRIVATE KEY`), or OpenSSH (`OPENSSH PRIVATE KEY`)
- JWK — a private RSA JSON Web Key

The key must be unencrypted (no passphrase); the server does not prompt for one.

## Configuration

```yaml
server:
  data_dir: /var/lib/nextgen
  encryption_keys:
    # The map key IS the key ID written into every JWE header. Keep it stable.
    root-kek-2026-07:
      use_for_encryption: true
      file: /etc/nextgen/keys/root-kek-2026-07.pem
    root-kek-2026-01:
      # decrypt-only: still unwraps DEKs it wrapped earlier
      private_key: |
        -----BEGIN PRIVATE KEY-----
        ...
        -----END PRIVATE KEY-----
```

| Field                | Required                      | Description                                                                    |
|----------------------|-------------------------------|--------------------------------------------------------------------------------|
| `file`               | one of `file` / `private_key` | Path to the RSA private key file (PEM or JWK)                                  |
| `private_key`        | one of `file` / `private_key` | The RSA private key inline. **Takes precedence over `file`** when both are set |
| `use_for_encryption` | see below                     | Marks the key used to wrap new and re-wrapped DEKs                             |

Rules enforced at startup (`buildRootKEK` → `domain.NewRootKEKs`):

- At least one key must resolve, otherwise the server exits with
  `no root encryption key provided`.
- Each entry must supply `file` or `private_key`, otherwise
  `either a private key or file must be provided (<id>)`.
- With **exactly one** key, that key is used for encryption regardless of
  `use_for_encryption`.
- With **more than one** key, exactly one must set
  `use_for_encryption: true`; zero yields `no key is marked for encryption` and more than one yields
  `only one key can be marked for encryption`.

All other keys are decrypt-only.

`server.encryption_keys` is **YAML-only**. It is a map with operator-chosen keys, so it is not bound to `NEXTGEN_*`
environment variables the way scalar settings are — use a config file (mounted from a secret) for key material.

### KEK-directory discovery

Independently of the config file, the server scans
`<server.data_dir>/keks/` on every start (`ensureServerKEK`, creating the directory with mode `0700` if missing) and
merges every file it finds into
`server.encryption_keys`, keyed by file name:

| Situation                               | Result                                                                                                                                                                        |
|-----------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Config has keys                         | Directory files are added as **decrypt-only** entries (they never get `use_for_encryption`). A directory file whose name equals a config entry's ID **overwrites** that entry |
| Config has no keys, directory has files | All files are loaded; the one with the newest mtime is marked for encryption                                                                                                  |
| Neither                                 | A 4096-bit key is generated at `keks/root-kek.pem` and marked for encryption                                                                                                  |

> **⚠ The merge is not skipped when `server.encryption_keys` is set.** Directory
> scanning happens on every start, even for a fully explicit configuration, and
> a same-named directory file **replaces the entire config entry** rather than
> filling in its blanks — the replacement carries only `file`, so an inline
> `private_key` and a `use_for_encryption: true` on that entry are both dropped.
>
> Two failure modes follow, and neither is reported as a configuration error:
>
> - **Wrong key material, silently.** A config entry named e.g. `root-kek.pem`
>   with an inline `private_key` is replaced by the RSA key in
>   `<data_dir>/keks/root-kek.pem`. The key ID is unchanged, so `kid` lookups
>   still resolve — they just resolve to a different key, and every unwrap fails
>   at use with `encryption_key.decrypt_failed`.
> - **Lost encryption marker.** If the overwritten entry was the one marked
>   `use_for_encryption` and other keys are configured, startup aborts with
>   `no key is marked for encryption`.
>
> Mitigations, in order of preference:
>
> 1. Point `server.data_dir` at a directory whose `keks/` subdirectory is empty
>    (and has never held a generated key) for any deployment that configures
>    `server.encryption_keys` explicitly.
> 2. Never name a config entry after a file that exists — or could later be
>    created — in the KEK directory. In particular, avoid the ID `root-kek.pem`,
>    which is the name the dev-mode generator uses.
> 3. Prefer IDs that cannot collide with a file name at all (e.g.
>    `root-kek-2026-07`, no extension).
>
> Skipping the directory merge entirely when `server.encryption_keys` is
> non-empty would remove the hazard; until that changes, treat the KEK directory
> and explicit key configuration as mutually exclusive.

## DEK lifecycle

A DEK is created when a project is created (`projectService.Create`): 32 bytes from `crypto/rand`, wrapped with the
current encryption KEK, activated, and inserted in the same transaction as the project. A project therefore never exists
without an active DEK.

Storage (`encryption_keys` table, migration `000012_crypto_keys.sql`):

| Column                                     | Notes                                                          |
|--------------------------------------------|----------------------------------------------------------------|
| `project_id`, `id`                         | Composite primary key; `project_id` cascades on project delete |
| `key`                                      | The wrapped key — JWE compact serialization, never plaintext   |
| `algorithm`                                | `A256GCM`                                                      |
| `state`                                    | `not_active_yet` / `active` / `expired` / `removed`            |
| `purpose`                                  | `dek` or `kek`                                                 |
| `created_at`, `activated_at`, `retired_at` | Lifecycle timestamps                                           |

A partial unique index (`uq_deks_active_per_project`) enforces at most one
`active` DEK per project.

Read path — `keyService.GetProjectDEKCrypter(ctx, projectID)`:

1. Load the project's `active` DEK row.
2. Decode the JWE header of `key` to get the wrapping `kid`.
3. If `kid` matches a configured root KEK, unwrap with it. Otherwise treat
   `kid` as another key **in the database** and resolve it recursively — this is what allows chained key hierarchies
   beyond the single KEK→DEK layer.
4. Verify the unwrapped key is exactly 32 bytes and build an AES-256-GCM crypter whose own key ID is the DEK ID.

That DEK ID is what lands in the `kid` header of everything the DEK encrypts (tokens, third-party secrets), so the same
header-driven lookup works one layer down.

## Rotating the root KEK

Rotation is driven entirely by configuration; there is no API call or CLI command for it.

1. **Add** the new key to `server.encryption_keys` with
   `use_for_encryption: true`, and **keep** the previous key in the config with
   `use_for_encryption` unset (or absent).
2. **Restart** the server. From that moment new DEKs are wrapped with the new key, and old DEKs still unwrap with the
   retained predecessor.
3. **Re-wrap runs automatically.** After the HTTP listener starts, the server runs `keyService.MigrateToLatestRootKEK`
   in the background: it pages through every row in `encryption_keys` (100 at a time, ordered by ID), and for each row
   whose `kid` points at a configured root KEK that is *not* the current encryption key, it unwraps with the old key,
   re-wraps with the new one, and updates the row. Rows already wrapped by the current key, and rows wrapped by a key
   that is not a configured root KEK, are skipped.
4. **Confirm** completion in the logs:

   ```
   INFO  migrate KEKs
   DEBUG KEK migration done
   ```

   Failures are logged as `error during KEK migration` with per-key details and are **not fatal** — the server keeps
   serving, and the migration is retried on the next start.
5. **Remove** the old key from configuration only after a clean migration run.

The plaintext DEK material is unchanged by rotation, so nothing encrypted *by*
a DEK has to be re-encrypted. Only the small wrapped-key column is rewritten, which is why routine rotation is cheap.

### Cautions

- **Do not remove a KEK before its DEKs are migrated.** A DEK whose `kid` is no longer configured is skipped by the
  migration (it is indistinguishable from a key wrapped by another database key) and fails at use with
  `encryption_key.decrypt_failed` / `encryption_key.not_found`.
- **Do not rename a key ID as part of rotation.** Rotation means adding a *new*
  ID; changing an existing ID orphans its ciphertexts.
- **Keep retired keys until migration is verified**, then destroy them deliberately — a retained compromised KEK is a
  live risk (ADR 039).
- **Back up the KEK separately from the database.** A backup of the database alone is useless without the KEK; a leak of
  both together exposes every DEK.

For compromise handling — including the case where the KEK *and* the database are both exposed, which requires new DEKs
and re-encryption of the data itself rather than just re-wrapping — follow
[ADR 039 §2](../adrs/039-signing-key-rotation-and-incident-response.md).

## Errors

| Code                                | Meaning                                              |
|-------------------------------------|------------------------------------------------------|
| `encryption_key.not_found`          | No key row for the requested ID/project/state        |
| `encryption_key.decrypt_failed`     | Unwrap failed, or the unwrapped key was not 32 bytes |
| `encryption_key.encrypt_failed`     | Wrapping failed during rotation                      |
| `encryption_key.unknown_alg`        | Key stored with an algorithm other than `A256GCM`    |
| `encryption_key.no_replacement_key` | A key was retired without a successor                |

Startup errors from key configuration are plain `server: …` errors and abort the process.

## Where this lives in the code

| Concern                                                                  | Location                                                                                    |
|--------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| `RootKEK` / `RootKEKs`, `EncryptionKey`, wrap/unwrap, rotation primitive | `internal/domain/encryption_key.go`                                                         |
| RSA key parsing (PEM / OpenSSH / JWK)                                    | `internal/crypto/key_parser.go`                                                             |
| Config shape                                                             | `cmd/server/config.go` (`EncryptionKeyConfig`)                                              |
| KEK directory handling and dev key generation                            | `cmd/server/runtime.go` (`ensureServerKEK`)                                                 |
| Startup wiring and validation                                            | `cmd/server/server.go` (`buildRootKEK`)                                                     |
| DEK lookup, crypter construction, rotation job                           | `internal/service/keys.go`                                                                  |
| DEK creation at project creation                                         | `internal/service/project.go`                                                               |
| Schema                                                                   | `internal/storage/database/dialect/{postgres,spanner}/migration/sql/000012_crypto_keys.sql` |

## See also

- [Configuration reference](../quick-start/configuration.md#encryption-keys)
- [`nextgen.example.yaml`](nextgen.example.yaml)
- [ADR 029 — Cryptography, secrets and key lifecycle](../adrs/029-cryptography-secrets-and-key-lifecycle.md)
- [ADR 039 — Signing key rotation and incident response](../adrs/039-signing-key-rotation-and-incident-response.md)
