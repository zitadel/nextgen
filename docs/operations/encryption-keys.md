# Encryption keys (master key / project KEK)

How the server protects secrets at rest: what a master key is, how it is generated, how it is configured, and how it is
rotated.

Design rationale lives in
[ADR 029](../adrs/029-cryptography-secrets-and-key-lifecycle.md) and
[ADR 039](../adrs/039-signing-key-rotation-and-incident-response.md). This document describes the shipped
implementation.

## The envelope

Zitadel uses envelope encryption. Three layers of keys:

```mermaid
graph TD
    MasterKey["Master key<br>RSA private key<br>from config / file"]
    KEK["Project KEK<br>32 random bytes, AES-256-GCM<br>row in encryption_keys"]
    PurposeKeys["Purpose-scoped keys — per project<br>token / secret / cookie encryption,<br>token signing"]
    Data["Encrypted data<br>tokens, third-party secrets, cookies, …"]
    MasterKey -- " wraps (JWE, RSA-OAEP-256 + A256GCM) " --> KEK
    KEK -- " wraps (JWE, A256GCM) " --> PurposeKeys
    PurposeKeys -- " encrypt (AES-256-GCM) " --> Data
```

|            | Master key                                                  | Project KEK                                          | Purpose-scoped keys                             |
|------------|-------------------------------------------------------------|------------------------------------------------------|-------------------------------------------------|
| Type       | RSA private key (asymmetric)                                | 32 random bytes (AES-256)                            | 32 random bytes (AES-256), or EdDSA for signing |
| Scope      | Global, one per deployment (plus decrypt-only predecessors) | One active key per project                           | One active key per purpose, per project         |
| Lives in   | Config file or a file on disk                               | `encryption_keys` table, wrapped                     | `encryption_keys` / `signing_keys`, wrapped     |
| Created by | The operator (or auto-generated for local dev)              | The server, at project creation                      | The server, at project creation                 |
| Rotated by | The operator, by adding a new key to config                 | Re-wrapped on master key rotation; not on a schedule | Not rotated on a schedule                       |

Neither the master key nor the project KEK encrypts application data directly — the master key only wraps project KEKs,
and a project KEK only wraps that project's purpose-scoped keys. Because each class of data has its own key, a
purpose-scoped key can be rotated without re-encrypting anything the other keys protect. No key below the master key
ever leaves the database in plaintext; each exists in plaintext only in memory, after a successful unwrap.

## Key identity is part of the ciphertext

A wrapped key is a JWE compact serialization whose protected header carries the wrapping key's ID as `kid`:

```
eyJhbGciOiJSU0EtT0FFUC0yNTYiLCJlbmMiOiJBMjU2R0NNIiwia2lkIjoibWFzdGVyLWtleSJ9...
```

On decrypt the server reads `kid` from the header and looks up exactly that key (`domain.MasterKeys.GetByKeyID`) instead
of trying every configured key. Two consequences that matter operationally:

- **The master key ID must stay stable.** The ID is the YAML map key under
  `server.master_keys`, or — for keys discovered in the master key directory — the *file name*. Renaming a config entry
  or a key file makes every project KEK wrapped by it unresolvable, even though the key material is unchanged.
- **A master key may only be removed from config once no project KEK references it.** See
  [Rotation](#rotating-the-master-key).

The algorithms are fixed: `RSA-OAEP-256` for key wrapping and `A256GCM` for content encryption
(`internal/domain/encryption_key.go`). Only RSA keys are accepted; EC/Ed25519 keys are rejected at startup.

## Generating a master key

### Automatic (local development only)

If `server.master_keys` is unset **and** the master key directory is empty, the server generates a 4096-bit RSA key on
first start, writes it to
`<server.data_dir>/master-keys/master-key.pem` with mode `0600`, and logs a warning:

```
WARN created server master key file (generated for local/dev only; configure server.master_keys for production)
  path=.../master-keys/master-key.pem disable_with=--disable-master-key-generation
```

Set `server.generate_master_key: false` (or pass `--disable-master-key-generation`, which outranks the config file and
the environment) to refuse that instead: a start with no configured key and an empty key directory then fails with an
error naming the directory it searched. Do that anywhere a generated key would be wrong rather than convenient — most
sharply on ephemeral storage, where each instance would otherwise mint its own key and leave the previous instance's
project KEKs unwrappable.

`server.master_keys` cannot be set from the environment, because it is a map keyed by key id and environment variables
cannot populate map keys. Any `NEXTGEN_SERVER_MASTER_KEYS_*` variable is dropped; the server logs a warning naming the
variables it ignored, since a dropped variable is what leaves the server with no key and sends it down the generation
path.

The key is reused on subsequent starts as long as `server.data_dir` persists.
`server.data_dir` defaults to a `nextgen-data` directory next to the binary; in the Docker Compose quick start it is
backed by the `nextgen-server-data`
volume. If that directory is wiped, the key is gone and every project KEK — and therefore everything encrypted under
it — is unrecoverable.

### Manual (any shared or production deployment)

Generate an RSA private key with your own tooling and hand it to the server through managed secrets:

```sh
# PKCS#1 PEM
openssl genrsa -out master-key-2026-07.pem 4096

# or PKCS#8 PEM
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out master-key-2026-07.pem
```

Accepted input formats (`internal/crypto.ParseRSAKey`):

- PEM — PKCS#1 (`RSA PRIVATE KEY`), PKCS#8 (`PRIVATE KEY`), or OpenSSH (`OPENSSH PRIVATE KEY`)
- JWK — a private RSA JSON Web Key

The key must be unencrypted (no passphrase); the server does not prompt for one.

## Configuration

```yaml
server:
  data_dir: /var/lib/nextgen
  master_keys:
    # The map key IS the key ID written into every JWE header. Keep it stable.
    master-key-2026-07:
      use_for_encryption: true
      file: /etc/nextgen/keys/master-key-2026-07.pem
    master-key-2026-01:
      # decrypt-only: still unwraps project KEKs it wrapped earlier
      private_key: |
        -----BEGIN PRIVATE KEY-----
        ...
        -----END PRIVATE KEY-----
```

| Field                | Required                      | Description                                                                    |
|----------------------|-------------------------------|--------------------------------------------------------------------------------|
| `file`               | one of `file` / `private_key` | Path to the RSA private key file (PEM or JWK)                                  |
| `private_key`        | one of `file` / `private_key` | The RSA private key inline. **Takes precedence over `file`** when both are set |
| `use_for_encryption` | see below                     | Marks the key used to wrap new and re-wrapped project KEKs                     |

Rules enforced at startup (`buildMasterKey` → `domain.NewMasterKeys`):

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

`server.master_keys` is **YAML-only**. It is a map with operator-chosen keys, so it is not bound to `NEXTGEN_*`
environment variables the way scalar settings are — use a config file (mounted from a secret) for key material.

### Master-key-directory discovery

Independently of the config file, the server scans
`<server.data_dir>/master-keys/` on every start (`ensureServerMasterKey`, creating the directory with mode `0700` if
missing) and merges every file it finds into
`server.master_keys`, keyed by file name:

| Situation                               | Result                                                                                                                                                                        |
|-----------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Config has keys                         | Directory files are added as **decrypt-only** entries (they never get `use_for_encryption`). A directory file whose name equals a config entry's ID **overwrites** that entry |
| Config has no keys, directory has files | All files are loaded; the one with the newest mtime is marked for encryption                                                                                                  |
| Neither                                 | A 4096-bit key is generated at `master-keys/master-key.pem` and marked for encryption, unless `server.generate_master_key` is `false`, which fails the start instead          |

> **⚠ The merge is not skipped when `server.master_keys` is set.** Directory
> scanning happens on every start, even for a fully explicit configuration, and
> a same-named directory file **replaces the entire config entry** rather than
> filling in its blanks — the replacement carries only `file`, so an inline
> `private_key` and a `use_for_encryption: true` on that entry are both dropped.
>
> Two failure modes follow, and neither is reported as a configuration error:
>
> - **Wrong key material, silently.** A config entry named e.g. `master-key.pem`
>   with an inline `private_key` is replaced by the RSA key in
>   `<data_dir>/master-keys/master-key.pem`. The key ID is unchanged, so `kid`
>   lookups still resolve — they just resolve to a different key, and every
>   unwrap fails at use with `enc_key.decrypt_failed`.
> - **Lost encryption marker.** If the overwritten entry was the one marked
>   `use_for_encryption` and other keys are configured, startup aborts with
>   `no key is marked for encryption`.
>
> Mitigations, in order of preference:
>
> 1. Point `server.data_dir` at a directory whose `master-keys/` subdirectory is
>    empty (and has never held a generated key) for any deployment that
>    configures `server.master_keys` explicitly.
> 2. Never name a config entry after a file that exists — or could later be
>    created — in the master key directory. In particular, avoid the ID
>    `master-key.pem`, which is the name the dev-mode generator uses.
> 3. Prefer IDs that cannot collide with a file name at all (e.g.
>    `master-key-2026-07`, no extension).
>
> Skipping the directory merge entirely when `server.master_keys` is
> non-empty would remove the hazard; until that changes, treat the master key
> directory and explicit key configuration as mutually exclusive.

## Project key lifecycle

A project's full key set is created when the project is created (`projectService.Create`) and inserted in the same
transaction as the project, so a project never exists without one:

| Key                   | Purpose value | Wrapped by      | Used for                                     |
|-----------------------|---------------|-----------------|----------------------------------------------|
| Key encryption key    | `kek`         | The master key  | Wrapping the project's other keys            |
| Token encryption key  | `token`       | The project KEK | Opaque tokens, project and preview secrets   |
| Secret encryption key | `secret`      | The project KEK | Third-party secrets (IdP secrets, API keys)  |
| Cookie encryption key | `cookie`      | The project KEK | Flow state cookies                           |
| Token signing key     | `token`       | The project KEK | Signing tokens (EdDSA, `signing_keys` table) |

Each key is 32 bytes from `crypto/rand` (the signing key is an EdDSA key pair), wrapped and activated at creation.

Storage (`encryption_keys` and `signing_keys` tables, migration `000012_crypto_keys.sql`):

| Column                                     | Notes                                                          |
|--------------------------------------------|----------------------------------------------------------------|
| `project_id`, `id`                         | Composite primary key; `project_id` cascades on project delete |
| `key`                                      | The wrapped key — JWE compact serialization, never plaintext   |
| `algorithm`                                | `A256GCM` (`EdDSA` for signing keys)                           |
| `state`                                    | `not_active_yet` / `active` / `expired` / `removed`            |
| `purpose`                                  | `kek`, `token`, `secret` or `cookie`                           |
| `created_at`, `activated_at`, `retired_at` | Lifecycle timestamps                                           |

One partial unique index per purpose (`uq_keks_active_per_project`,
`uq_token_encryption_keys_active_per_project`, and so on) enforces at most one
`active` key per purpose per project.

Read path — `keyService.GetProjectCrypter(ctx, projectID, purpose)`:

1. Load the project's `active` row for that purpose.
2. Decode the JWE header of `key` to get the wrapping `kid`.
3. If `kid` matches a configured master key, unwrap with it. Otherwise treat
   `kid` as another key **in the database** and resolve it recursively — this is what resolves a purpose-scoped key
   through its project KEK, and what allows deeper key hierarchies.
4. Verify the unwrapped key is exactly 32 bytes and build an AES-256-GCM crypter whose own key ID is the key's ID.

That key ID is what lands in the `kid` header of everything the key encrypts (tokens, third-party secrets), so the same
header-driven lookup works one layer down.

## Rotating the master key

Rotation is driven entirely by configuration; there is no API call or CLI command for it.

1. **Add** the new key to `server.master_keys` with
   `use_for_encryption: true`, and **keep** the previous key in the config with
   `use_for_encryption` unset (or absent).
2. **Restart** the server. From that moment new project KEKs are wrapped with the new key, and old ones still unwrap
   with the retained predecessor.
3. **Re-wrap runs automatically.** After the HTTP listener starts, the server runs `keyService.MigrateToLatestMasterKey`
   in the background: it pages through every row in `encryption_keys` (100 at a time, ordered by ID), and for each row
   whose `kid` points at a configured master key that is *not* the current encryption key, it unwraps with the old key,
   re-wraps with the new one, and updates the row. Rows already wrapped by the current key, and rows wrapped by a
   project KEK rather than a master key, are skipped.
4. **Confirm** completion in the logs:

   ```
   INFO  migrate keys to latest master key
   DEBUG master key migration done
   ```

   Failures are logged as `error during master key migration` with per-key details and are **not fatal** — the server
   keeps serving, and the migration is retried on the next start.
5. **Remove** the old key from configuration only after a clean migration run.

The plaintext key material is unchanged by rotation, so nothing encrypted *by* a project KEK or a purpose-scoped key has
to be re-encrypted. Only the small wrapped-key column is rewritten, which is why routine rotation is cheap.

### Cautions

- **Do not remove a master key before the project KEKs it wrapped are migrated.** A KEK whose `kid` is no longer
  configured is skipped by the migration (it is indistinguishable from a key wrapped by another database key) and fails
  at use with `enc_key.decrypt_failed` / `enc_key.not_found`.
- **Do not rename a key ID as part of rotation.** Rotation means adding a *new*
  ID; changing an existing ID orphans its ciphertexts.
- **Keep retired keys until migration is verified**, then destroy them deliberately — a retained compromised master key
  is a live risk (ADR 039).
- **Back up the master key separately from the database.** A backup of the database alone is useless without the master
  key; a leak of both together exposes every project KEK.

For compromise handling — including the case where the master key *and* the database are both exposed, which requires
new keys and re-encryption of the data itself rather than just re-wrapping — follow
[ADR 039 §2](../adrs/039-signing-key-rotation-and-incident-response.md).

## Errors

| Code                         | Meaning                                              |
|------------------------------|------------------------------------------------------|
| `enc_key.not_found`          | No key row for the requested ID/project/state        |
| `enc_key.decrypt_failed`     | Unwrap failed, or the unwrapped key was not 32 bytes |
| `enc_key.encrypt_failed`     | Wrapping failed during rotation                      |
| `enc_key.unknown_alg`        | Key stored with an algorithm other than `A256GCM`    |
| `enc_key.no_replacement_key` | A key was retired without a successor                |

Startup errors from key configuration are plain `server: …` errors and abort the process.

## Where this lives in the code

| Concern                                                                      | Location                                                                              |
|------------------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `MasterKey` / `MasterKeys`, `EncryptionKey`, wrap/unwrap, rotation primitive | `internal/domain/encryption_key.go`                                                   |
| RSA key parsing (PEM / OpenSSH / JWK)                                        | `internal/crypto/key_parser.go`                                                       |
| Config shape                                                                 | `cmd/server/config.go` (`MasterKeyConfig`)                                            |
| Master key directory handling and dev key generation                         | `cmd/server/runtime.go` (`ensureServerMasterKey`)                                     |
| Startup wiring and validation                                                | `cmd/server/server.go` (`buildMasterKey`)                                             |
| Key lookup by purpose, crypter construction, rotation job                    | `internal/service/keys.go`                                                            |
| Project key set creation                                                     | `internal/domain/project.go` (`GenerateNewKeySet`), `internal/service/project.go`     |
| Schema                                                                       | `internal/storage/dialect/{postgres,spanner}/migration/sql/000012_crypto_keys.sql` |

## See also

- [Configuration reference](../quick-start/configuration.md#encryption-keys)
- [`nextgen.example.yaml`](nextgen.example.yaml)
- [ADR 029 — Cryptography, secrets and key lifecycle](../adrs/029-cryptography-secrets-and-key-lifecycle.md)
- [ADR 039 — Signing key rotation and incident response](../adrs/039-signing-key-rotation-and-incident-response.md)