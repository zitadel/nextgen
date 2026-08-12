# Configuration

The server loads settings from a YAML file, environment variables, or both. Environment variables use the `NEXTGEN_`
prefix and nested keys use underscores.

Example file: [`docs/operations/nextgen.example.yaml`](../operations/nextgen.example.yaml).

## Server

| YAML key                 | Environment                      | Default                                               | Description                                                                                             |
|--------------------------|----------------------------------|-------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `server.address`         | `NEXTGEN_SERVER_ADDRESS`         | `:8080`                                               | Listen address                                                                                          |
| `server.data_dir`        | `NEXTGEN_SERVER_DATA_DIR`        | `nextgen-data` next to the binary                     | Local runtime data root                                                                                 |
| `server.master_keys`     | — (YAML only)                    | auto-generated RSA master key under `<server.data_dir>/master-keys` | Master keys that wrap each project's key encryption key (KEK); see [Encryption keys](#encryption-keys) |
| `server.console_enabled` | `NEXTGEN_SERVER_CONSOLE_ENABLED` | `true`                                                | Serve embedded management console                                                                       |
| `server.console_path`    | `NEXTGEN_SERVER_CONSOLE_PATH`    | `/ui/console`                                         | Console URL prefix                                                                                      |
| `server.login_enabled`   | `NEXTGEN_SERVER_LOGIN_ENABLED`   | `true`                                                | Serve embedded login shell                                                                              |
| `server.login_path`      | `NEXTGEN_SERVER_LOGIN_PATH`      | `/ui/login`                                           | Login URL prefix                                                                                        |

## Database

Configure exactly one dialect under `database:`, or omit it for the local
default.

| Backend | When to use | Config key / env |
| ------- | ----------- | ---------------- |
| **SQLite** | Local development, CLI binary runtime, small single-node / homelab | `database.sqlite` / `NEXTGEN_DATABASE_SQLITE` |
| **PostgreSQL** | Production and Docker Compose | `database.postgres` / `NEXTGEN_DATABASE_POSTGRES` |
| **Spanner** | Production on Google Cloud Spanner | `database.spanner` / `NEXTGEN_DATABASE_SPANNER` |

When `database:` is omitted, the server uses **SQLite** at
`<server.data_dir>/zitadel.db` (local / homelab default).

Override examples:

```yaml
database:
  sqlite: ./nextgen-data/zitadel.db
```

```yaml
database:
  postgres: postgres://zitadel:zitadel@localhost:5432/nextgen?sslmode=disable
```

```yaml
database:
  spanner: projects/PROJECT/instances/INSTANCE/databases/DATABASE
```

Or via environment:

```sh
export NEXTGEN_DATABASE_SQLITE='./nextgen-data/zitadel.db'
# or
export NEXTGEN_DATABASE_POSTGRES='postgres://zitadel:zitadel@localhost:5432/nextgen?sslmode=disable'
# or
export NEXTGEN_DATABASE_SPANNER='projects/PROJECT/instances/INSTANCE/databases/DATABASE'
```

SQLite is intended for local development and small single-node deployments
(single-writer limits apply). Use PostgreSQL or Spanner for production.
`IgnoreCase` string filters use SQLite's `LOWER()`, which only folds ASCII —
non-ASCII case folding (for example `Ü`/`ü`) can diverge from Postgres.
Spanner authentication uses Application Default Credentials (ADC); this guide
does not cover IAM setup.

Migrations run automatically when the server starts.

## Config file search paths

When `-c` is not passed, the server looks for `nextgen.yaml` in:

- `.`
- `./config`
- `/etc/nextgen`

## Encryption keys

The server wraps every project's key encryption key (KEK) with one or more master keys, configured under
`server.master_keys`:

```yaml
server:
  master_keys:
    # Each key is keyed by its ID; the ID identifies which key wrapped a value.
    master-key:
      use_for_encryption: true
      # RSA private key inline as PEM (incl. OpenSSH) or JWK ...
      private_key: |
        -----BEGIN PRIVATE KEY-----
        ...
        -----END PRIVATE KEY-----
      # ... or point at a file instead of inlining:
      # file: /etc/nextgen/keys/master-key.pem
```

Exactly one key must be marked `use_for_encryption: true`.

For local development, leave `server.master_keys` unset and persist
`server.data_dir`: the server generates an RSA master key at
`<server.data_dir>/master-keys/master-key.pem` and reuses it on subsequent starts.

To rotate the master key, add a new key marked `use_for_encryption: true` and keep the previous key (s) (as extra
entries or as files in the master key directory) for decryption; existing project KEKs are re-encrypted under the new
master key on the next start. For shared or production deployments, provide the key material through managed secrets
rather than committing it to source control.

Files in `<server.data_dir>/master-keys/` are merged into `server.master_keys` on every start, even when the setting is
configured explicitly. A file whose name matches a config entry's ID replaces that entry outright, dropping an inline
`private_key` and `use_for_encryption` — so keep the master key directory empty when you configure keys yourself, and
never name an entry after a file that could appear there.

For the full picture — the key envelope, key generation, the master-key-directory discovery rules, and the rotation
procedure — see [Encryption keys (master key / project KEK)](../operations/encryption-keys.md).
